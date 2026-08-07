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

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID ?? 'REDACTED_CLIENT_ID';
const API_BASE =
  process.env.API_BASE ?? 'https://REDACTED_API_ID.execute-api.ap-northeast-1.amazonaws.com/prod';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'REDACTED_ADMIN_PASSWORD';

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

// ai-accuracy-check.md の「正解データ一覧」テーブルをそのまま転記（出典: seed-data.ts の SEEDS）
const GROUND_TRUTH: GroundTruth[] = [
  { itemId: 'i-001', title: '折りたたみ傘（紺・チェック柄）', category: 'umbrella', conditionRank: 'good', color: '紺（チェック柄）', brand: '', size: '親骨55cm', accessories: '' },
  { itemId: 'i-002', title: 'ビニール傘（未使用に近い）', category: 'umbrella', conditionRank: 'like_new', color: '透明', brand: '', size: '60cm', accessories: '' },
  { itemId: 'i-003', title: '二つ折り財布（茶・レザー）', category: 'wallet', conditionRank: 'good', color: '茶（ブラウン）', brand: '', size: 'W10×H9cm', accessories: '' },
  { itemId: 'i-004', title: '腕時計（アナログ・シルバー）', category: 'watch', conditionRank: 'good', color: 'シルバー', brand: '不明（国内メーカー刻印あり）', size: 'ケース径36mm', accessories: '' },
  { itemId: 'i-005', title: 'ワイヤレスイヤホン（充電ケース付き）', category: 'audio', conditionRank: 'good', color: 'ブラック', brand: '', size: '', accessories: '充電ケース、充電ケーブル' },
  { itemId: 'i-006', title: 'シティサイクル（26インチ・グレー）', category: 'bicycle', conditionRank: 'used', color: 'グレー', brand: '', size: '26インチ', accessories: '' },
  { itemId: 'i-007', title: 'キャリーケース（機内持込サイズ・黒）', category: 'bag', conditionRank: 'good', color: 'ブラック', brand: '', size: '機内持込サイズ（高さ55cm程度）', accessories: '' },
  { itemId: 'i-008', title: 'トートバッグ（キャンバス地・生成り）', category: 'bag', conditionRank: 'like_new', color: '生成り（ネイビーストライプ）', brand: '', size: '', accessories: '' },
  { itemId: 'i-009', title: 'カーディガン（ベージュ・Mサイズ）', category: 'clothing', conditionRank: 'good', color: 'ベージュ', brand: '', size: 'Mサイズ', accessories: '' },
  { itemId: 'i-010', title: 'ネックレス（シルバー調）', category: 'accessory', conditionRank: 'good', color: 'シルバー', brand: '', size: 'チェーン長 約45cm', accessories: '' },
  { itemId: 'i-011', title: '文庫本セット（ミステリー5冊）', category: 'book', conditionRank: 'used', color: '', brand: '', size: '', accessories: '' },
  { itemId: 'i-012', title: '折りたたみ自転車（20インチ）', category: 'bicycle', conditionRank: 'good', color: 'ブラック', brand: '', size: '20インチ', accessories: '' },
  { itemId: 'i-013', title: '腕時計（クロノグラフ・革ベルト）', category: 'watch', conditionRank: 'good', color: 'ブラック×ブラウン', brand: '不明（スイス製表記あり）', size: 'ケース径42mm', accessories: '' },
  { itemId: 'i-014', title: 'ショルダーバッグ（レザー・黒）', category: 'bag', conditionRank: 'good', color: 'ブラック', brand: '', size: '', accessories: '' },
  { itemId: 'i-015', title: '折りたたみ傘（黒無地）', category: 'umbrella', conditionRank: 'like_new', color: '黒', brand: '', size: '親骨58cm', accessories: '' },
  { itemId: 'i-016', title: '長傘（ビニール・大きめ）', category: 'umbrella', conditionRank: 'good', color: '透明', brand: '', size: '65cm', accessories: '' },
  { itemId: 'i-017', title: '折りたたみ傘（花柄・ミニサイズ）', category: 'umbrella', conditionRank: 'good', color: 'ピンク（花柄）', brand: '', size: '親骨50cm', accessories: '' },
  { itemId: 'i-018', title: '長傘（紳士用・黒無地）', category: 'umbrella', conditionRank: 'good', color: '黒', brand: '', size: '65cm', accessories: '' },
  { itemId: 'i-019', title: '折りたたみ傘（迷彩柄）', category: 'umbrella', conditionRank: 'like_new', color: 'カーキ（迷彩柄）', brand: '', size: '', accessories: '収納ケース' },
  { itemId: 'i-020', title: 'ビニール傘（骨折れあり）', category: 'umbrella', conditionRank: 'damaged', color: '透明', brand: '', size: '', accessories: '' },
  { itemId: 'i-021', title: '長財布（黒・レザー）', category: 'wallet', conditionRank: 'good', color: '黒', brand: '', size: 'W19×H10cm', accessories: '' },
  { itemId: 'i-022', title: '二つ折り財布（グレー・合皮）', category: 'wallet', conditionRank: 'good', color: 'グレー', brand: '', size: '', accessories: '' },
  { itemId: 'i-023', title: 'ミニ財布（コインケース一体型・赤）', category: 'wallet', conditionRank: 'like_new', color: '赤', brand: '', size: '', accessories: '' },
  { itemId: 'i-024', title: '長財布（ネイビー・ナイロン）', category: 'wallet', conditionRank: 'used', color: 'ネイビー', brand: '', size: '', accessories: '' },
  { itemId: 'i-025', title: 'カードケース（本革・茶）', category: 'wallet', conditionRank: 'good', color: '茶（ブラウン）', brand: '不明（型押しロゴあり）', size: '', accessories: '' },
  { itemId: 'i-026', title: '腕時計（デジタル・黒）', category: 'watch', conditionRank: 'good', color: '黒', brand: '', size: 'ケース径40mm', accessories: '' },
  { itemId: 'i-027', title: '腕時計（レディース・ゴールド）', category: 'watch', conditionRank: 'good', color: 'ゴールド', brand: '', size: 'ケース径24mm', accessories: '' },
  { itemId: 'i-028', title: '腕時計（スポーツウォッチ・ラバーベルト）', category: 'watch', conditionRank: 'good', color: '黒×赤', brand: '', size: '', accessories: '取扱説明書' },
  { itemId: 'i-029', title: '腕時計（アンティーク調・革ベルト）', category: 'watch', conditionRank: 'used', color: 'ブラウン', brand: '', size: 'ケース径34mm', accessories: '' },
  { itemId: 'i-030', title: '腕時計（防水デジタル・黒）', category: 'watch', conditionRank: 'good', color: '黒', brand: '', size: 'ケース径38mm', accessories: '' },
  { itemId: 'i-031', title: '有線イヤホン（白）', category: 'audio', conditionRank: 'good', color: '白', brand: '', size: '', accessories: '' },
  { itemId: 'i-032', title: 'ワイヤレスイヤホン（片耳のみ）', category: 'audio', conditionRank: 'damaged', color: '黒', brand: '', size: '', accessories: '' },
  { itemId: 'i-033', title: 'ヘッドホン（オーバーイヤー・黒）', category: 'audio', conditionRank: 'good', color: '黒', brand: '', size: '', accessories: '収納ポーチ' },
  { itemId: 'i-034', title: 'ワイヤレススピーカー（小型）', category: 'audio', conditionRank: 'good', color: 'ブルー', brand: '', size: '', accessories: '' },
  { itemId: 'i-035', title: 'ワイヤレスイヤホン（ケースのみ・本体なし）', category: 'audio', conditionRank: 'damaged', color: '白', brand: '', size: '', accessories: '' },
  { itemId: 'i-036', title: 'イヤホン（有線・巻き取り式）', category: 'audio', conditionRank: 'good', color: 'ピンク', brand: '', size: '', accessories: '' },
  { itemId: 'i-037', title: 'マウンテンバイク風自転車（27インチ）', category: 'bicycle', conditionRank: 'used', color: '黒×赤', brand: '', size: '27インチ', accessories: '' },
  { itemId: 'i-038', title: '電動アシスト自転車（バッテリー別売）', category: 'bicycle', conditionRank: 'used', color: '白', brand: '', size: '24インチ', accessories: '' },
  { itemId: 'i-039', title: 'ミニベロ（20インチ・折りたたみ不可）', category: 'bicycle', conditionRank: 'used', color: 'グリーン', brand: '', size: '20インチ', accessories: '' },
  { itemId: 'i-040', title: '子供用自転車（16インチ）', category: 'bicycle', conditionRank: 'good', color: 'ピンク', brand: '', size: '16インチ', accessories: '' },
  { itemId: 'i-041', title: 'シティサイクル（カゴ破損）', category: 'bicycle', conditionRank: 'damaged', color: '白', brand: '', size: '26インチ', accessories: '' },
  { itemId: 'i-042', title: 'リュックサック（黒・ビジネス用）', category: 'bag', conditionRank: 'good', color: '黒', brand: '', size: 'A4対応', accessories: '' },
  { itemId: 'i-043', title: 'ハンドバッグ（レディース・白）', category: 'bag', conditionRank: 'good', color: '白', brand: '', size: '', accessories: '' },
  { itemId: 'i-044', title: 'ボストンバッグ（旅行用・紺）', category: 'bag', conditionRank: 'used', color: 'ネイビー', brand: '', size: '', accessories: '' },
  { itemId: 'i-045', title: 'ウエストポーチ（黒・ナイロン）', category: 'bag', conditionRank: 'good', color: '黒', brand: '', size: '', accessories: '' },
  { itemId: 'i-046', title: 'エコバッグ（保冷機能付き）', category: 'bag', conditionRank: 'like_new', color: 'グレー', brand: '', size: '', accessories: '' },
  { itemId: 'i-047', title: '巾着袋（和柄・小物入れ）', category: 'bag', conditionRank: 'like_new', color: '紺（和柄）', brand: '', size: '', accessories: '' },
  { itemId: 'i-048', title: 'マフラー（ウール・グレー）', category: 'clothing', conditionRank: 'good', color: 'グレー', brand: '', size: '', accessories: '' },
  { itemId: 'i-049', title: '手袋（革・黒・片方のみ）', category: 'clothing', conditionRank: 'damaged', color: '黒', brand: '', size: '', accessories: '' },
  { itemId: 'i-050', title: 'パーカー（グレー・Lサイズ）', category: 'clothing', conditionRank: 'used', color: 'グレー', brand: '', size: 'Lサイズ', accessories: '' },
  { itemId: 'i-051', title: 'ストール（シルク調・花柄）', category: 'clothing', conditionRank: 'like_new', color: 'ベージュ（花柄）', brand: '', size: '', accessories: '' },
  { itemId: 'i-052', title: 'ジャケット（デニム・Mサイズ）', category: 'clothing', conditionRank: 'good', color: 'インディゴブルー', brand: '', size: 'Mサイズ', accessories: '' },
  { itemId: 'i-053', title: '帽子（キャップ・黒）', category: 'clothing', conditionRank: 'used', color: '黒', brand: '', size: '', accessories: '' },
  { itemId: 'i-054', title: 'ピアス（片方のみ・シルバー）', category: 'accessory', conditionRank: 'damaged', color: 'シルバー', brand: '', size: '', accessories: '' },
  { itemId: 'i-055', title: 'ブレスレット（ビーズ）', category: 'accessory', conditionRank: 'good', color: 'マルチカラー', brand: '', size: '', accessories: '' },
  { itemId: 'i-056', title: 'サングラス（黒縁）', category: 'accessory', conditionRank: 'good', color: '黒', brand: '', size: '', accessories: '' },
  { itemId: 'i-057', title: '指輪（シンプルリング）', category: 'accessory', conditionRank: 'good', color: 'シルバー', brand: '', size: '13号相当', accessories: '' },
  { itemId: 'i-058', title: 'ネクタイピン（シルバー）', category: 'accessory', conditionRank: 'good', color: 'シルバー', brand: '', size: '', accessories: '' },
  { itemId: 'i-059', title: 'ヘアアクセサリー（バレッタ3点セット）', category: 'accessory', conditionRank: 'like_new', color: 'マルチカラー', brand: '', size: '', accessories: '' },
  { itemId: 'i-060', title: 'ビジネス書2冊セット', category: 'book', conditionRank: 'used', color: '', brand: '', size: '', accessories: '' },
  { itemId: 'i-061', title: '漫画コミックセット（10冊）', category: 'book', conditionRank: 'good', color: '', brand: '', size: '', accessories: '' },
  { itemId: 'i-062', title: '旅行ガイドブック（福岡版）', category: 'book', conditionRank: 'like_new', color: '', brand: '', size: '', accessories: '' },
  { itemId: 'i-063', title: '参考書・問題集セット（高校生用）', category: 'book', conditionRank: 'used', color: '', brand: '', size: '', accessories: '' },
  { itemId: 'i-064', title: '洋書ペーパーバック', category: 'book', conditionRank: 'good', color: '', brand: '', size: '', accessories: '' },
];

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

const judgeCondition = (truth: string, actual: string): string =>
  truth === actual ? '○' : `△(seed:${truth} AI:${actual})`;

const main = async (): Promise<void> => {
  console.log('Cognito認証中...');
  const idToken = await getIdToken();

  const rows: string[] = [];
  let categoryMatch = 0;
  let conditionMatch = 0;
  let colorMatch = 0;
  let brandHallucination = 0;
  let errors = 0;

  for (const truth of GROUND_TRUTH) {
    process.stdout.write(`${truth.itemId} 解析中... `);
    try {
      const suggestion = await analyzeOne(truth.itemId, idToken);
      const categoryJudge = judgeExact(truth.category, suggestion.category);
      const conditionJudge = judgeCondition(truth.conditionRank, suggestion.conditionRank);
      const colorJudge = judgeExact(truth.color, suggestion.color);
      const brandJudge = judgeBrand(truth.brand, suggestion.brand);
      if (categoryJudge === '○') categoryMatch += 1;
      if (conditionJudge === '○') conditionMatch += 1;
      if (colorJudge.startsWith('○')) colorMatch += 1;
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

対象: \`analyzeItemImage\`（claude-haiku-4-5） / 64枚を実際のAPIに投げて自動採点

## サマリー

- カテゴリ一致: ${categoryMatch}/${total}
- 状態ランク一致: ${conditionMatch}/${total}
- 色一致: ${colorMatch}/${total}
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
    `カテゴリ一致 ${categoryMatch}/${total} / 状態ランク一致 ${conditionMatch}/${total} / 色一致 ${colorMatch}/${total} / ブランドのハルシネーション疑い ${brandHallucination}/${total} / エラー ${errors}/${total}`,
  );
};

main().catch((error: unknown) => {
  console.error('精度チェックに失敗しました:', error);
  process.exitCode = 1;
});
