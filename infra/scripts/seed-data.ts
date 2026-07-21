import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Bid, ItemCategory, ItemStatus, LostItem } from '../lambda/types';

const ITEMS_TABLE = 'megurimono-items';
const BIDS_TABLE = 'megurimono-bids';
const REGION = 'ap-northeast-1';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;
const now = Date.now();

const at = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

const BIDDER_NAMES = [
  'はかたっ子',
  'めんたい太郎',
  '中洲のカモメ',
  'つばめ号',
  '山笠のぼせ',
  'ラーメン部長',
  '博多織姫',
  'ベイサイド走者',
  'どんたく囃子',
  '祇園の風',
];

type SeedDef = {
  itemId: string;
  title: string;
  category: ItemCategory;
  description: string;
  foundLocation: string;
  foundMonth: string;
  startPrice: number;
  currentPrice: number;
  bidCount: number;
  status: ItemStatus;
  endOffsetMs: number;
};

const SEEDS: readonly SeedDef[] = [
  {
    itemId: 'i-001',
    title: '折りたたみ傘（紺・チェック柄）',
    category: 'umbrella',
    description: '骨組みに歪みなし。開閉スムーズです。持ち手に小さな擦れがあります。',
    foundLocation: '博多駅 筑紫口',
    foundMonth: '2026-04',
    startPrice: 200,
    currentPrice: 350,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 6 * HOURS,
  },
  {
    itemId: 'i-002',
    title: 'ビニール傘（未使用に近い）',
    category: 'umbrella',
    description: '大きな汚れ・破れなし。60cmサイズ。',
    foundLocation: '祇園駅 出入口2',
    foundMonth: '2026-05',
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 2 * DAYS,
  },
  {
    itemId: 'i-003',
    title: '二つ折り財布（茶・レザー）',
    category: 'wallet',
    description: '現金・カード類は抜き取り済み。角に使用感がありますが、状態は良好です。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: '2026-03',
    startPrice: 800,
    currentPrice: 1200,
    bidCount: 4,
    status: 'active',
    endOffsetMs: 1 * DAYS,
  },
  {
    itemId: 'i-004',
    title: '腕時計（アナログ・シルバー）',
    category: 'watch',
    description: '動作確認済み。ベルトに小傷あり。文字盤はきれいです。',
    foundLocation: '博多駅 博多口',
    foundMonth: '2026-02',
    startPrice: 3000,
    currentPrice: 4500,
    bidCount: 6,
    status: 'active',
    endOffsetMs: 8 * HOURS,
  },
  {
    itemId: 'i-005',
    title: 'ワイヤレスイヤホン（充電ケース付き）',
    category: 'audio',
    description: '初期化済み。左右とも動作確認済み。ケースに擦り傷があります。',
    foundLocation: '地下鉄空港線 車内',
    foundMonth: '2026-04',
    startPrice: 500,
    currentPrice: 800,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
  },
  {
    itemId: 'i-006',
    title: 'シティサイクル（26インチ・グレー）',
    category: 'bicycle',
    description: '防犯登録抹消済み。タイヤ・ブレーキ点検済み。カゴに小さな凹みあり。',
    foundLocation: '中洲川端駅 駐輪場',
    foundMonth: '2026-01',
    startPrice: 2000,
    currentPrice: 3200,
    bidCount: 5,
    status: 'active',
    endOffsetMs: 2 * DAYS + 12 * HOURS,
  },
  {
    itemId: 'i-007',
    title: 'キャリーケース（機内持込サイズ・黒）',
    category: 'bag',
    description: '中身は空の状態で保管されていました。キャスター動作良好。',
    foundLocation: '博多バスターミナル',
    foundMonth: '2026-03',
    startPrice: 1500,
    currentPrice: 2600,
    bidCount: 4,
    status: 'active',
    endOffsetMs: 4 * DAYS,
  },
  {
    itemId: 'i-008',
    title: 'トートバッグ（キャンバス地・生成り）',
    category: 'bag',
    description: '内ポケットあり。目立つ汚れなし。',
    foundLocation: '櫛田神社前',
    foundMonth: '2026-05',
    startPrice: 300,
    currentPrice: 400,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
  },
  {
    itemId: 'i-009',
    title: 'カーディガン（ベージュ・Mサイズ）',
    category: 'clothing',
    description: 'クリーニング済み。毛玉少なめです。',
    foundLocation: '博多座前',
    foundMonth: '2026-04',
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
  },
  {
    itemId: 'i-010',
    title: 'ネックレス（シルバー調）',
    category: 'accessory',
    description: '刻印なし・貴金属検査済み。チェーン長 約45cm。',
    foundLocation: '中洲 那珂川沿い',
    foundMonth: '2026-02',
    startPrice: 1000,
    currentPrice: 1800,
    bidCount: 7,
    status: 'active',
    endOffsetMs: 10 * HOURS,
  },
  {
    itemId: 'i-011',
    title: '文庫本セット（ミステリー5冊）',
    category: 'book',
    description: '書き込みなし。日焼けが少しあります。',
    foundLocation: '博多市民センター',
    foundMonth: '2026-05',
    startPrice: 150,
    currentPrice: 200,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 7 * DAYS,
  },
  {
    itemId: 'i-012',
    title: '折りたたみ自転車（20インチ）',
    category: 'bicycle',
    description: '防犯登録抹消済み。折りたたみ機構の動作確認済み。',
    foundLocation: '呉服町駅 駐輪場',
    foundMonth: '2025-12',
    startPrice: 3000,
    currentPrice: 8500,
    bidCount: 12,
    status: 'sold',
    endOffsetMs: -3 * DAYS,
  },
  {
    itemId: 'i-013',
    title: '腕時計（クロノグラフ・革ベルト）',
    category: 'watch',
    description: '動作確認済み。風防に薄い傷あり。付属品なし。',
    foundLocation: '博多駅 新幹線改札前',
    foundMonth: '2025-11',
    startPrice: 5000,
    currentPrice: 12000,
    bidCount: 9,
    status: 'sold',
    endOffsetMs: -5 * DAYS,
  },
  {
    itemId: 'i-014',
    title: 'ショルダーバッグ（レザー・黒）',
    category: 'bag',
    description: '金具に小傷あり。内装はきれいな状態です。',
    foundLocation: '住吉神社前',
    foundMonth: '2025-12',
    startPrice: 2000,
    currentPrice: 5400,
    bidCount: 8,
    status: 'sold',
    endOffsetMs: -7 * DAYS,
  },
];

const buildItems = (): LostItem[] =>
  SEEDS.map((seed) => ({
    itemId: seed.itemId,
    title: seed.title,
    category: seed.category,
    description: seed.description,
    foundLocation: seed.foundLocation,
    foundMonth: seed.foundMonth,
    startPrice: seed.startPrice,
    currentPrice: seed.currentPrice,
    bidCount: seed.bidCount,
    status: seed.status,
    endTime: at(seed.endOffsetMs),
  }));

const buildBids = (): Bid[] => {
  const bids: Bid[] = [];
  for (const seed of SEEDS) {
    if (seed.bidCount === 0) continue;
    const span = seed.currentPrice - seed.startPrice;
    for (let i = 0; i < seed.bidCount; i += 1) {
      const progress = (i + 1) / seed.bidCount;
      const amount = Math.round(seed.startPrice + span * progress);
      // 入札時刻: 過去2日間に分散（sold は終了前に収める）
      const baseOffset =
        seed.status === 'sold' ? seed.endOffsetMs - 2 * DAYS : -2 * DAYS;
      const createdAt = new Date(
        now + baseOffset + (2 * DAYS * (i + 1)) / (seed.bidCount + 1),
      ).toISOString();
      const bidderName = BIDDER_NAMES[(i + seed.itemId.length) % BIDDER_NAMES.length] ?? '匿名';
      bids.push({
        itemId: seed.itemId,
        bidId: `${createdAt}#seed${i}`,
        bidderName,
        amount,
        createdAt,
      });
    }
  }
  return bids;
};

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const batchWrite = async (tableName: string, records: readonly Record<string, unknown>[]): Promise<void> => {
  for (const group of chunk(records, 25)) {
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: group.map((record) => ({ PutRequest: { Item: record } })),
        },
      }),
    );
  }
};

const purgeTable = async (tableName: string, keyNames: readonly string[]): Promise<number> => {
  let deleted = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: keyNames.map((_, i) => `#k${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(keyNames.map((name, i) => [`#k${i}`, name])),
        ExclusiveStartKey: lastKey,
      }),
    );
    const keys = result.Items ?? [];
    for (const group of chunk(keys, 25)) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: group.map((key) => ({ DeleteRequest: { Key: key } })),
          },
        }),
      );
      deleted += group.length;
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey !== undefined);
  return deleted;
};

const main = async (): Promise<void> => {
  const purgedBids = await purgeTable(BIDS_TABLE, ['itemId', 'bidId']);
  const purgedItems = await purgeTable(ITEMS_TABLE, ['itemId']);
  console.log(`Purged ${purgedItems} items and ${purgedBids} bids.`);
  const items = buildItems();
  const bids = buildBids();
  await batchWrite(ITEMS_TABLE, items);
  await batchWrite(BIDS_TABLE, bids);
  console.log(`Seeded ${items.length} items and ${bids.length} bids.`);
};

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
