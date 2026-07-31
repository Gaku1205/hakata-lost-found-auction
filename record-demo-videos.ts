import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join } from 'path';

const SITE_URL = 'https://REDACTED_DISTRIBUTION.cloudfront.net';
const OUTPUT_DIR = 'C:\\Users\\unera\\AppData\\Local\\Temp\\claude\\c--Users-unera-Desktop-Claude-Code\\49eded21-0506-4622-b849-e8e6f2c36e05\\scratchpad';
const VIDEO_DIR = join(OUTPUT_DIR, 'videos');
const DEMO_NICKNAME = 'はかた太郎';

// 各シーンのwaitForTimeoutにかける倍率。45秒前後に収まるよう計測しながら微調整する。
const WAIT_SCALE = 1.6;
const W = (ms: number): number => Math.round(ms * WAIT_SCALE);

if (!existsSync(VIDEO_DIR)) {
  mkdirSync(VIDEO_DIR, { recursive: true });
}

type LostItemLite = { itemId: string; status: string; endTime: string };
type BidLite = { bidderName: string };

// 入札ルール（吊り上げ防止: 現在最高額の入札者は連続入札できない）に抵触しないよう、
// 「まだ終了しておらず」「直近の入札者がデモユーザー自身ではない」出品を事前に選定する。
async function pickBiddableItemId(): Promise<string | null> {
  try {
    const listRes = await fetch(`${SITE_URL}/api/items?sort=end_asc`);
    if (!listRes.ok) return null;
    const list = (await listRes.json()) as { items: LostItemLite[] };
    const now = Date.now();

    for (const item of list.items) {
      if (item.status === 'sold') continue;
      if (new Date(item.endTime).getTime() < now + 60 * 60 * 1000) continue; // 録画中に終了しない余裕を確保

      const detailRes = await fetch(`${SITE_URL}/api/items/${encodeURIComponent(item.itemId)}`);
      if (!detailRes.ok) continue;
      const detail = (await detailRes.json()) as { bids: BidLite[] };
      const topBidder = detail.bids[0]?.bidderName;
      if (topBidder !== DEMO_NICKNAME) {
        return item.itemId;
      }
    }
  } catch (err) {
    console.error('  ⚠ 入札可能な出品の事前選定に失敗:', err);
  }
  return null;
}

// スクロールは「多段階の刻みループ」ではなく1回の滑らかな移動のみにする（見づらさの原因だったため）。
async function scrollOnce(page: Page, distance: number, waitMs: number) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
  await page.waitForTimeout(waitMs);
}

async function scrollToId(page: Page, elementId: string, waitMs: number) {
  await page.evaluate(
    (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    elementId,
  );
  await page.waitForTimeout(waitMs);
}

async function newRecordingContext(subdir: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: join(VIDEO_DIR, subdir),
      size: { width: 1280, height: 720 },
    },
  });
  return { browser, context };
}

// 3本共通のログイン導線。トップページ紹介は一般ユーザー動画のみで見せ、
// 管理者・出品元の動画では「3本を通して見ても重複が気にならない」よう、ログインのみ最小限に見せる。
async function quickLogin(page: Page, buttonLabel: string) {
  await page.goto(`${SITE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(W(700));
  const loginBtn = page.locator(`button:has-text("${buttonLabel}")`);
  await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loginBtn.click();
  await page.waitForTimeout(W(2800));
}

async function recordGeneralUserDemo(safeItemId: string | null) {
  console.log('📹 Recording general user demo...');
  const { browser, context } = await newRecordingContext('general-raw');
  const page = await context.newPage();

  try {
    // 1) トップ（紹介ページ）— 3本の中で唯一ここで見せる
    console.log('  → トップページ...');
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(W(2200));
    await scrollOnce(page, 750, W(2200));

    // 2) ログイン（一般ユーザー）
    console.log('  → ログイン（一般ユーザー）...');
    await quickLogin(page, '一般ユーザーでお試しログイン');

    // 3) 出品一覧
    console.log('  → 出品一覧...');
    await page.goto(`${SITE_URL}/items`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(W(2800));

    // 4) 商品詳細（入札ルールに抵触しない出品を選定済み。無ければ一覧の先頭をクリック）
    console.log('  → 商品詳細画面...');
    if (safeItemId !== null) {
      await page.goto(`${SITE_URL}/items/${encodeURIComponent(safeItemId)}`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
    } else {
      const firstItem = page.locator('a[href^="/items/"]').first();
      await firstItem.waitFor({ state: 'visible', timeout: 10000 });
      await firstItem.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    }
    await page.waitForTimeout(W(2200));

    // 5) お気に入り登録（すでに登録済みなら状態維持のみ）
    console.log('  → お気に入り登録...');
    const favBtn = page.locator('.favorite-toggle').first();
    if (await favBtn.isVisible().catch(() => false)) {
      const pressed = await favBtn.getAttribute('aria-pressed');
      if (pressed !== 'true') {
        await favBtn.click();
        await page.waitForTimeout(W(1500));
      } else {
        await page.waitForTimeout(W(1000));
      }
    }

    // 6) 入札（吊り上げ防止ルールに抵触しないよう、控えめな+100円のみ加算して送信）
    console.log('  → 入札...');
    await scrollToId(page, 'bid-panel', W(1600));

    const bidInput = page.locator('input[type="number"]').first();
    const isBidInputVisible = await bidInput.isVisible().catch(() => false);
    if (isBidInputVisible) {
      await bidInput.click();
      await page.waitForTimeout(W(500));

      const plus100 = page.locator('button:has-text("+100円")').first();
      if (await plus100.isVisible().catch(() => false)) {
        await plus100.click();
        await page.waitForTimeout(W(900));
      }

      const submitBtn = page.locator('button[type="submit"]:has-text("入札")').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(W(2600));
      }
    }

    // 7) マイページ（入札中／購入済み／お気に入りタブ）
    console.log('  → マイページ（入札中）...');
    await page.goto(`${SITE_URL}/mypage`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(W(2400));

    console.log('  → マイページ（購入済み）...');
    const winsTab = page.locator('.mypage-tabs__tab:has-text("購入済み")');
    if (await winsTab.isVisible().catch(() => false)) {
      await winsTab.click();
      await page.waitForTimeout(W(1600));
    }

    console.log('  → マイページ（お気に入り）...');
    const favTab = page.locator('.mypage-tabs__tab:has-text("お気に入り")');
    if (await favTab.isVisible().catch(() => false)) {
      await favTab.click();
      await page.waitForTimeout(W(1800));
    }
  } catch (err) {
    console.error('  ❌ Error in general user demo:', err);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log('✅ General user demo recorded');
}

async function recordAdminDemo() {
  console.log('📹 Recording admin demo...');
  const { browser, context } = await newRecordingContext('admin-raw');
  const page = await context.newPage();

  try {
    // 1) ログイン（管理者）— トップページ紹介は一般ユーザー動画と重複するため省略
    console.log('  → ログイン（管理者）...');
    await quickLogin(page, '管理者でお試しログイン');

    // 2) 出品管理（タブ切り替え＋ページネーション）
    console.log('  → 出品管理（タブ切り替え）...');
    await page.goto(`${SITE_URL}/admin`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(W(2400));

    const nextPageBtn = page.locator('.pagination button:has-text("次へ")');
    if (await nextPageBtn.isVisible().catch(() => false)) {
      await nextPageBtn.click();
      await page.waitForTimeout(W(1300));
    }

    for (const tabLabel of ['出品中', '受け渡し待ち', '受け渡し完了']) {
      const tabBtn = page.locator(`.mypage-tabs__tab:has-text("${tabLabel}")`);
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(W(1700));
      }
    }

    // 3) 出品元管理
    console.log('  → 出品元管理...');
    const orgTab = page.locator('a.admin-tabs__tab:has-text("出品元管理")');
    if (await orgTab.isVisible().catch(() => false)) {
      await orgTab.click();
    } else {
      await page.goto(`${SITE_URL}/admin/organizations`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2800));

    // 4) 出品元申し込み
    console.log('  → 出品元申し込み...');
    const partnerTab = page.locator('a.admin-tabs__tab:has-text("出品元申し込み")');
    if (await partnerTab.isVisible().catch(() => false)) {
      await partnerTab.click();
    } else {
      await page.goto(`${SITE_URL}/admin/partners`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2600));

    // 5) 問い合わせ管理
    console.log('  → 問い合わせ管理...');
    const inquiriesTab = page.locator('a.admin-tabs__tab:has-text("問い合わせ管理")');
    if (await inquiriesTab.isVisible().catch(() => false)) {
      await inquiriesTab.click();
    } else {
      await page.goto(`${SITE_URL}/admin/inquiries`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2600));

    // 6) 入札監視
    console.log('  → 入札監視...');
    const monitorTab = page.locator('a.admin-tabs__tab:has-text("入札監視")');
    if (await monitorTab.isVisible().catch(() => false)) {
      await monitorTab.click();
    } else {
      await page.goto(`${SITE_URL}/admin/monitor`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2800));

    // 7) 収益ダッシュボード
    console.log('  → 収益ダッシュボード...');
    const dashboardTab = page.locator('a.admin-tabs__tab:has-text("収益ダッシュボード")');
    if (await dashboardTab.isVisible().catch(() => false)) {
      await dashboardTab.click();
    } else {
      await page.goto(`${SITE_URL}/admin/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2600));
    await scrollOnce(page, 420, W(2000));
  } catch (err) {
    console.error('  ❌ Error in admin demo:', err);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log('✅ Admin demo recorded');
}

async function recordOrgDemo() {
  console.log('📹 Recording org (出品元) demo...');
  const { browser, context } = await newRecordingContext('org-raw');
  const page = await context.newPage();

  try {
    // 1) ログイン（出品元）— トップページ紹介は一般ユーザー動画と重複するため省略
    console.log('  → ログイン（出品元）...');
    await quickLogin(page, '出品元でお試しログイン');

    // 2) 出品一覧（タブ切り替え）
    console.log('  → 出品一覧（タブ切り替え）...');
    await page.goto(`${SITE_URL}/org`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(W(2400));

    for (const tabLabel of ['出品中', '受け渡し待ち', '受け渡し完了']) {
      const tabBtn = page.locator(`.mypage-tabs__tab:has-text("${tabLabel}")`);
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(W(1900));
      }
    }

    // 3) 商品詳細（出品元アカウントは入札できない旨の表示）
    console.log('  → 商品詳細（入札不可の表示）...');
    const allTab = page.locator('.mypage-tabs__tab:has-text("すべて")');
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click();
      await page.waitForTimeout(W(1000));
    }
    const firstOrgItem = page.locator('a[href^="/items/"]').first();
    if (await firstOrgItem.isVisible().catch(() => false)) {
      await firstOrgItem.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(W(1600));
      await scrollToId(page, 'bid-panel', W(2000));
      await page.goBack({ waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(W(800));
    }

    // 4) 収益情報
    console.log('  → 収益情報...');
    const revenueTab = page.locator('a.admin-tabs__tab:has-text("収益情報")');
    if (await revenueTab.isVisible().catch(() => false)) {
      await revenueTab.click();
    } else {
      await page.goto(`${SITE_URL}/org/revenue`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(2600));
    await scrollOnce(page, 350, W(1800));

    // 5) 運営への問い合わせ（送信はせず、入力の様子のみ見せる）
    console.log('  → 運営への問い合わせ...');
    const contactTab = page.locator('a.admin-tabs__tab:has-text("運営への問い合わせ")');
    if (await contactTab.isVisible().catch(() => false)) {
      await contactTab.click();
    } else {
      await page.goto(`${SITE_URL}/org/contact`, { waitUntil: 'networkidle', timeout: 15000 });
    }
    await page.waitForTimeout(W(1800));
    const textarea = page.locator('#org-inquiry-message');
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.click();
      await textarea.type('受け取りBOXの追加設置について相談したいです。', { delay: 55 });
      await page.waitForTimeout(W(1800));
    }
  } catch (err) {
    console.error('  ❌ Error in org demo:', err);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log('✅ Org demo recorded');
}

function collectVideoFile(subdir: string, finalName: string) {
  const dir = join(VIDEO_DIR, subdir);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith('.webm'));
  if (files.length > 0) {
    const src = join(dir, files[0]!);
    const dest = join(VIDEO_DIR, finalName);
    renameSync(src, dest);
    console.log(`  📁 Saved: ${dest}`);
  }
}

async function main() {
  console.log('🎬 Starting demo video recording...\n');
  try {
    console.log('🔎 入札可能な出品を事前選定中...');
    const safeItemId = await pickBiddableItemId();
    console.log(safeItemId !== null ? `  ✓ 選定: ${safeItemId}` : '  ⚠ 該当なし。一覧の先頭を使用します');
    console.log('');

    await recordGeneralUserDemo(safeItemId);
    collectVideoFile('general-raw', 'demo-general-user.webm');
    console.log('');

    await recordAdminDemo();
    collectVideoFile('admin-raw', 'demo-admin.webm');
    console.log('');

    await recordOrgDemo();
    collectVideoFile('org-raw', 'demo-org.webm');

    console.log('\n✨ All demo videos recorded to:', VIDEO_DIR);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
