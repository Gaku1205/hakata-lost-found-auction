// AI画像解析（analyzeItemImage）の精度チェック用スクリプト。
// frontend/public/images/items/i-001.jpg 〜 i-064.jpg を実際のAPIに投げて、
// seed-data.ts 由来の正解データ（ai-accuracy-check.md から転記）と突き合わせる。
//
// 実行方法: cd infra && npx tsx scripts/check-ai-accuracy.ts
//
// 管理者アカウントでCognito認証し、デプロイ済みAPIの
// POST /api/admin/images/analyze を64回呼び出す（Claude Haiku課金が発生する点に注意）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ITEM_IDS_WITHOUT_PHOTO, SEEDS } from './seed-items';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`環境変数 ${name} が未設定です`);
  }
  return value;
};

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const USER_POOL_CLIENT_ID = requireEnv('USER_POOL_CLIENT_ID');
const API_BASE = requireEnv('API_BASE');
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = requireEnv('SEED_ADMIN_PASSWORD');

const IMAGES_DIR = join(__dirname, '../../frontend/public/images/items');
const REPORT_PATH = join(__dirname, '../../../../other/aws-ai-contest/ai-accuracy-results.md');

type GroundTruth = {
  itemId: string;
  title: string;
  category: string;
  conditionRank: string;
  color: string;
  brand: string;
  size: string;
  accessories: string;
};

// 正解データは seed-items.ts の SEEDS をそのまま使う。以前はこのファイルに手動コピーを
// 持っていたが、商品画像を差し替えてもコピー側が古いまま取り残され、正しいAI出力に
// ✕が付いていた（例: i-045は採点表「黒」／実データ「オレンジ」）。
const GROUND_TRUTH: GroundTruth[] = SEEDS.filter(
  (seed) => !ITEM_IDS_WITHOUT_PHOTO.has(seed.itemId),
).map((seed) => ({
  itemId: seed.itemId,
  title: seed.title,
  category: seed.category,
  conditionRank: seed.conditionRank,
  color: seed.color ?? '',
  brand: seed.brand ?? '',
  size: seed.size ?? '',
  accessories: seed.accessories ?? '',
}));

type Suggestion = {
  title: string;
  category: string;
  conditionRank: string;
  description: string;
  color: string;
  brand: string;
  size: string;
  accessories: string;
};

const getIdToken = async (): Promise<string> => {
  const client = new CognitoIdentityProviderClient({ region: REGION });
  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: { USERNAME: ADMIN_EMAIL, PASSWORD: ADMIN_PASSWORD },
    }),
  );
  const idToken = result.AuthenticationResult?.IdToken;
  if (idToken === undefined) throw new Error('IdTokenの取得に失敗しました');
  return idToken;
};

const analyzeOne = async (itemId: string, idToken: string): Promise<Suggestion> => {
  const imagePath = join(IMAGES_DIR, `${itemId}.jpg`);
  const imageBase64 = readFileSync(imagePath).toString('base64');
  const res = await fetch(`${API_BASE}/api/admin/images/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ images: [{ imageBase64, mediaType: 'image/jpeg' }] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${itemId}: HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as { suggestion: Suggestion };
  return data.suggestion;
};

// ブランドは「seedが空欄なのにAIが埋めた」場合だけハルシネーションとして重要度高めで扱う
const judgeBrand = (truth: string, actual: string): string => {
  if (truth === '' && actual !== '') return `✕ハルシネーション疑い（AI:「${actual}」）`;
  if (truth === '' && actual === '') return '○(空欄一致)';
  return truth === actual ? '○' : `△(seed:「${truth}」 AI:「${actual}」)`;
};

const judgeExact = (truth: string, actual: string): string => {
  if (truth === actual) return '○';
  if (truth === '' && actual === '') return '○(空欄一致)';
  return `✕(seed:「${truth}」 AI:「${actual}」)`;
};

// 色は完全一致で判定すると「黒」と「ブラック」が不一致になり、指標が実態から
// 大きくずれる（旧実装では52件が✕、うち25件は実質同色だった）。カタカナ表記を
// 漢字に寄せ、濃淡の修飾語を落としたうえで色の集合として比較する。
const COLOR_SYNONYMS: readonly (readonly [string, string])[] = [
  ['ブラック', '黒'], ['ホワイト', '白'], ['ブラウン', '茶'], ['ネイビー', '紺'],
  ['グレー', '灰'], ['グレイ', '灰'], ['ゴールド', '金'], ['シルバー', '銀'],
  ['レッド', '赤'], ['ブルー', '青'], ['グリーン', '緑'], ['イエロー', '黄'],
  ['パープル', '紫'], ['オレンジ', '橙'], ['ピンク', '桃'], ['マゼンタ', '桃'],
  ['タン', 'キャメル'], ['クリーム', 'ベージュ'], ['生成り', 'ベージュ'],
  ['虹', 'マルチカラー'],
];

// 「ライトブルー」と「ブルー」を別色として扱わないため、濃淡だけを表す語は落とす
const COLOR_MODIFIERS = ['ライト', 'ダーク', 'ディープ', 'パステル', '濃', '薄', '明るい', '暗い'];

const normalizeColorToken = (value: string): string => {
  let t = value;
  for (const [kana, kanji] of COLOR_SYNONYMS) t = t.split(kana).join(kanji);
  for (const mod of COLOR_MODIFIERS) t = t.split(mod).join('');
  return t.replace(/[\s系色]/g, '');
};

const splitColors = (value: string): string[] =>
  value
    // 「透明（フレーム：黒）」のような補足は主色の判定に使わない
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[×・、,+]/)
    .map(normalizeColorToken)
    .filter((t) => t !== '');

// a の各色が b のいずれかに含まれていれば「a は b に包含される」とみなす。
// 「茶」⊂「キャメル茶」のような粒度差を拾うため部分一致で判定する。
const isCoveredBy = (a: string[], b: string[]): boolean =>
  a.length > 0 && a.every((x) => b.some((y) => y.includes(x) || x.includes(y)));

const judgeColor = (truth: string, actual: string): string => {
  if (truth === actual) return '○';
  if (truth === '' && actual === '') return '○(空欄一致)';
  if (truth === '') return `-(seed空欄 AI:「${actual}」)`;

  const t = splitColors(truth);
  const a = splitColors(actual);
  if (t.length > 0 && a.length > 0) {
    const sameSet = t.length === a.length && isCoveredBy(t, a) && isCoveredBy(a, t);
    if (sameSet) return '○(表記ゆれ)';
    if (isCoveredBy(t, a)) return '○(AIがより詳細)';
    if (isCoveredBy(a, t)) return `△(AIが一部のみ seed:「${truth}」 AI:「${actual}」)`;
  }
  return `✕(seed:「${truth}」 AI:「${actual}」)`;
};

const judgeCondition = (truth: string, actual: string): string =>
  truth === actual ? '○' : `△(seed:${truth} AI:${actual})`;

const main = async (): Promise<void> => {
  console.log('Cognito認証中...');
  const idToken = await getIdToken();

  const rows: string[] = [];
  let categoryMatch = 0;
  let conditionMatch = 0;
  let colorMatch = 0;
  let colorSkipped = 0;
  let brandHallucination = 0;
  let errors = 0;

  for (const truth of GROUND_TRUTH) {
    process.stdout.write(`${truth.itemId} 解析中... `);
    try {
      const suggestion = await analyzeOne(truth.itemId, idToken);
      const categoryJudge = judgeExact(truth.category, suggestion.category);
      const conditionJudge = judgeCondition(truth.conditionRank, suggestion.conditionRank);
      const colorJudge = judgeColor(truth.color, suggestion.color);
      const brandJudge = judgeBrand(truth.brand, suggestion.brand);
      if (categoryJudge === '○') categoryMatch += 1;
      if (conditionJudge === '○') conditionMatch += 1;
      if (colorJudge.startsWith('○')) colorMatch += 1;
      // seedに色の記載がない出品は正解が存在しないため、色の母数から除く
      if (colorJudge.startsWith('-')) colorSkipped += 1;
      if (brandJudge.startsWith('✕')) brandHallucination += 1;

      rows.push(
        `| ${truth.itemId} | ${truth.title} → AI:「${suggestion.title}」 | ${categoryJudge} | ${conditionJudge} | ${colorJudge} | ${brandJudge} | ${suggestion.size !== '' ? suggestion.size : '(空欄)'} | ${suggestion.accessories !== '' ? suggestion.accessories : '(空欄)'} |`,
      );
      console.log('OK');
    } catch (err: unknown) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      rows.push(`| ${truth.itemId} | エラー: ${message} | - | - | - | - | - | - |`);
      console.log(`ERROR: ${message}`);
    }
  }

  const total = GROUND_TRUTH.length;
  const summary = `# AI画像解析 精度チェック結果

対象: \`analyzeItemImage\`（Bedrock経由のclaude-haiku-4-5） / ${total}枚を実際のAPIに投げて自動採点
（写真を持たない${ITEM_IDS_WITHOUT_PHOTO.size}件は対象外）

## サマリー

- カテゴリ一致: ${categoryMatch}/${total}
- 状態ランク一致: ${conditionMatch}/${total}
- 色一致: ${colorMatch}/${total - colorSkipped}（表記ゆれ・粒度差は一致扱い。seedに色の記載がない${colorSkipped}件は母数から除外）
- ブランドのハルシネーション疑い（seed空欄なのにAIが埋めた件数）: ${brandHallucination}/${total}
- 通信エラー: ${errors}/${total}

## 詳細

| 画像 | 品名（正解 → AI出力） | カテゴリ | 状態ランク | 色 | ブランド | サイズ(AI) | 付属品(AI) |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;

  writeFileSync(REPORT_PATH, summary, 'utf-8');
  console.log(`\n完了。結果を書き出しました: ${REPORT_PATH}`);
  console.log(
    `カテゴリ一致 ${categoryMatch}/${total} / 状態ランク一致 ${conditionMatch}/${total} / 色一致 ${colorMatch}/${total - colorSkipped} / ブランドのハルシネーション疑い ${brandHallucination}/${total} / エラー ${errors}/${total}`,
  );
};

main().catch((error: unknown) => {
  console.error('精度チェックに失敗しました:', error);
  process.exitCode = 1;
});
