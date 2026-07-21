import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Bid,
  ConditionRank,
  ItemCategory,
  ItemStatus,
  LostItem,
  Organization,
  PickupStatus,
} from '../lambda/types';

const ITEMS_TABLE = 'megurimono-items';
const BIDS_TABLE = 'megurimono-bids';
const ORGANIZATIONS_TABLE = 'megurimono-organizations';
const REGION = 'ap-northeast-1';
const STACK_NAME = 'MeguriMonoStack';

const DEMO_USER = {
  email: 'demo@example.com',
  password: 'REDACTED_DEMO_PASSWORD',
  nickname: 'はかた太郎',
};
const ADMIN_USER = {
  email: 'admin@example.com',
  password: 'REDACTED_ADMIN_PASSWORD',
  nickname: '運営局',
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const cfn = new CloudFormationClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;
const now = Date.now();

const at = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

const PICKUP_LOCATIONS = [
  '博多区役所 1F 受取窓口',
  '上川端商店街 受取ステーション',
  '博多市民センター 受付',
] as const;

const BIDDER_NAMES = [
  'めんたい太郎',
  '中洲のカモメ',
  'つばめ号',
  '山笠のぼせ',
  'ラーメン部長',
  '博多織姫',
  'ベイサイド走者',
  'どんたく囃子',
  '祇園の風',
] as const;

// 入札監視デモ用のIP割り当て（TEST-NET帯）。
// 「つばめ号」と「祇園の風」は同一IPを共有 = サクラアカウント検知のデモ。
const DEMO_USER_IP = '198.51.100.7';
const SHARED_IP = '203.0.113.50';

const ipForBidder = (name: string): string => {
  if (name === 'つばめ号' || name === '祇園の風') return SHARED_IP;
  const index = BIDDER_NAMES.findIndex((n) => n === name);
  return `203.0.113.${10 + (index < 0 ? 0 : index)}`;
};

// ---------- Cognito ----------

const getUserPoolId = async (): Promise<string> => {
  const result = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const outputs = result.Stacks?.[0]?.Outputs ?? [];
  const output = outputs.find((o) => o.OutputKey === 'UserPoolId');
  if (output?.OutputValue === undefined) {
    throw new Error(`CloudFormation出力 UserPoolId が見つかりません（stack: ${STACK_NAME}）`);
  }
  return output.OutputValue;
};

type SeedUser = { email: string; password: string; nickname: string };

const ensureUser = async (
  userPoolId: string,
  user: SeedUser,
  group?: string,
): Promise<string> => {
  const getSub = (attributes: { Name?: string; Value?: string }[] | undefined): string => {
    const sub = attributes?.find((a) => a.Name === 'sub')?.Value;
    if (sub === undefined) throw new Error(`ユーザー ${user.email} の sub を取得できません`);
    return sub;
  };

  try {
    const existing = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: user.email }),
    );
    return getSub(existing.UserAttributes);
  } catch (error: unknown) {
    if (!(error instanceof UserNotFoundException)) throw error;
  }

  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: user.email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: user.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'nickname', Value: user.nickname },
      ],
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: user.email,
      Password: user.password,
      Permanent: true,
    }),
  );
  if (group !== undefined) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: user.email,
        GroupName: group,
      }),
    );
  }
  return getSub(created.User?.Attributes);
};

// ---------- アイテム・入札 ----------

// 拾得日から公告日・保管期間満了日・整理番号を算出する（infra/lambda/api.ts と同じロジック）
const NOTICE_WINDOW_DAYS = 14;
const CUSTODY_PERIOD_DAYS = 90;

const addDays = (dateStr: string, days: number): string =>
  new Date(new Date(dateStr).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

const hashString = (value: string): number => {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
};

const generateCaseNumber = (org: Organization, itemId: string, foundDate: string): string => {
  const seq = (hashString(itemId) % 9000) + 1000;
  if (org.type === 'police') {
    const reiwaYear = new Date(foundDate).getFullYear() - 2018;
    return `${org.name} 遺失物第${reiwaYear}-${seq}号`;
  }
  const year = new Date(foundDate).getFullYear();
  return `${org.name} 拾得物管理番号 ${year}-${seq}`;
};

const generateBoxNumber = (itemId: string): number => (hashString(`box-${itemId}`) % 24) + 1;

// ---------- 出品元（警察・自治体／企業） ----------

const ORGANIZATIONS: readonly Organization[] = [
  {
    orgId: 'org-fukuoka-police',
    name: '福岡県警察',
    type: 'police',
    contactNote: '福岡県警察本部 遺失物センター（運営代理登録）',
    createdAt: at(-120 * DAYS),
  },
  {
    orgId: 'org-jr-hakata',
    name: 'JR博多シティ',
    type: 'corporate',
    contactNote: '博多駅 総合案内所 担当者確認済み（運営代理登録）',
    createdAt: at(-60 * DAYS),
  },
  {
    orgId: 'org-canal-city',
    name: 'キャナルシティ博多',
    type: 'corporate',
    contactNote: '施設管理事務所 担当者確認済み（運営代理登録）',
    createdAt: at(-45 * DAYS),
  },
];

const orgById = new Map(ORGANIZATIONS.map((org) => [org.orgId, org]));

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
  pickupStatus?: PickupStatus;
  pickupDate?: string;
  pickupCode?: string;
  pickupBoxNumber?: number;
  conditionRank: ConditionRank;
  quantity: number;
  foundDate: string;
  accessories?: string;
  size?: string;
  color?: string;
  brand?: string;
  orgId: string;
};

const SEEDS: readonly SeedDef[] = [
  {
    itemId: 'i-001',
    orgId: 'org-jr-hakata',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-04-12',
    color: '紺（チェック柄）',
    size: '親骨55cm',
  },
  {
    itemId: 'i-002',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: '2026-05-08',
    color: '透明',
    size: '60cm',
  },
  {
    itemId: 'i-003',
    orgId: 'org-canal-city',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-03-20',
    color: '茶（ブラウン）',
    size: 'W10×H9cm',
  },
  {
    itemId: 'i-004',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-02-14',
    color: 'シルバー',
    size: 'ケース径36mm',
    brand: '不明（国内メーカー刻印あり）',
  },
  {
    itemId: 'i-005',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-04-25',
    color: 'ブラック',
    accessories: '充電ケース、充電ケーブル',
  },
  {
    itemId: 'i-006',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'used',
    quantity: 1,
    foundDate: '2026-01-18',
    color: 'グレー',
    size: '26インチ',
  },
  {
    itemId: 'i-007',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-03-05',
    color: 'ブラック',
    size: '機内持込サイズ（高さ55cm程度）',
  },
  {
    itemId: 'i-008',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: '2026-05-02',
    color: '生成り（ネイビーストライプ）',
  },
  {
    itemId: 'i-009',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-04-08',
    color: 'ベージュ',
    size: 'Mサイズ',
  },
  {
    itemId: 'i-010',
    orgId: 'org-fukuoka-police',
    title: 'ネックレス（シルバー調）',
    category: 'accessory',
    description: '刻印なし・貴金属検査済み。チェーン長 約45cm。',
    foundLocation: '中洲 那珂川沿い',
    foundMonth: '2026-02',
    startPrice: 1000,
    currentPrice: 1800,
    bidCount: 11,
    status: 'active',
    endOffsetMs: 10 * HOURS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2026-02-27',
    color: 'シルバー',
    size: 'チェーン長 約45cm',
  },
  {
    itemId: 'i-011',
    orgId: 'org-fukuoka-police',
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
    conditionRank: 'used',
    quantity: 5,
    foundDate: '2026-05-14',
  },
  {
    itemId: 'i-012',
    orgId: 'org-fukuoka-police',
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
    pickupStatus: 'awaiting',
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2025-12-10',
    color: 'ブラック',
    size: '20インチ',
  },
  {
    itemId: 'i-013',
    orgId: 'org-jr-hakata',
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
    pickupStatus: 'reserved',
    pickupDate: new Date(now + 2 * DAYS).toISOString().slice(0, 10),
    pickupCode: '384912',
    pickupBoxNumber: generateBoxNumber('i-013'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2025-11-22',
    color: 'ブラック×ブラウン',
    size: 'ケース径42mm',
    brand: '不明（スイス製表記あり）',
  },
  {
    itemId: 'i-014',
    orgId: 'org-fukuoka-police',
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
    pickupStatus: 'completed',
    pickupDate: new Date(now - 2 * DAYS).toISOString().slice(0, 10),
    pickupCode: '551208',
    pickupBoxNumber: generateBoxNumber('i-014'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: '2025-12-03',
    color: 'ブラック',
  },
];

const buildItems = (
  demoUserSub: string,
  topBidderByItem: ReadonlyMap<string, string>,
): LostItem[] =>
  SEEDS.map((seed, index) => {
    const org = orgById.get(seed.orgId);
    if (org === undefined) throw new Error(`出品元 ${seed.orgId} が見つかりません（${seed.itemId}）`);
    const base: LostItem = {
      itemId: seed.itemId,
      title: seed.title,
      category: seed.category,
      description: seed.description,
      foundLocation: seed.foundLocation,
      foundMonth: seed.foundMonth,
      pickupLocation: PICKUP_LOCATIONS[index % PICKUP_LOCATIONS.length] ?? PICKUP_LOCATIONS[0],
      startPrice: seed.startPrice,
      currentPrice: seed.currentPrice,
      bidCount: seed.bidCount,
      status: seed.status,
      endTime: at(seed.endOffsetMs),
      imageUrl: `/images/items/${seed.itemId}.jpg`,
      conditionRank: seed.conditionRank,
      quantity: seed.quantity,
      foundDate: seed.foundDate,
      accessories: seed.accessories,
      size: seed.size,
      color: seed.color,
      brand: seed.brand,
      caseNumber: generateCaseNumber(org, seed.itemId, seed.foundDate),
      noticeDate: addDays(seed.foundDate, NOTICE_WINDOW_DAYS),
      custodyEndDate: addDays(seed.foundDate, CUSTODY_PERIOD_DAYS),
      orgId: org.orgId,
      orgName: org.name,
      orgType: org.type,
      topBidderSub: topBidderByItem.get(seed.itemId),
    };
    if (seed.status !== 'sold') return base;
    return {
      ...base,
      winnerSub: demoUserSub,
      winnerNickname: DEMO_USER.nickname,
      soldAt: at(seed.endOffsetMs),
      pickupStatus: seed.pickupStatus ?? 'awaiting',
      pickupDate: seed.pickupDate,
      pickupCode: seed.pickupCode,
      pickupBoxNumber: seed.pickupBoxNumber,
      pickupDeadline: at(seed.endOffsetMs + 14 * DAYS),
    };
  });

const buildBids = (demoUserSub: string): Bid[] => {
  const bids: Bid[] = [];
  for (const seed of SEEDS) {
    if (seed.bidCount === 0) continue;
    const span = seed.currentPrice - seed.startPrice;
    // i-010 は入札監視デモ用: 直近10分弱に入札が密集（連続入札フラグの実演）
    const isRapidDemo = seed.itemId === 'i-010';
    for (let i = 0; i < seed.bidCount; i += 1) {
      const progress = (i + 1) / seed.bidCount;
      const amount = Math.round(seed.startPrice + span * progress);
      const baseOffset =
        seed.status === 'sold' ? seed.endOffsetMs - 2 * DAYS : -2 * DAYS;
      // 連続入札デモ: 直近11分弱に55秒間隔で密集させる（交互2人が各自10分内に5件以上）
      const createdAt = isRapidDemo
        ? new Date(now - 11 * 60 * 1000 + i * 55 * 1000).toISOString()
        : new Date(
            now + baseOffset + (2 * DAYS * (i + 1)) / (seed.bidCount + 1),
          ).toISOString();
      // 落札済み品の最高額入札はデモ一般ユーザーのものにする（マイページのデモ用）
      const isWinningBid = seed.status === 'sold' && i === seed.bidCount - 1;
      // 連続入札デモは「つばめ号」「祇園の風」（同一IP組）が交互に吊り上げた体にする
      const rapidName = i % 2 === 0 ? 'つばめ号' : '祇園の風';
      const bidderName = isWinningBid
        ? DEMO_USER.nickname
        : isRapidDemo
          ? rapidName
          : BIDDER_NAMES[(i + seed.itemId.length) % BIDDER_NAMES.length] ?? '匿名';
      const bidderSub = isWinningBid ? demoUserSub : `seed-${bidderName}`;
      bids.push({
        itemId: seed.itemId,
        bidId: `${createdAt}#seed${i}`,
        bidderName,
        bidderSub,
        amount,
        createdAt,
        sourceIp: isWinningBid ? DEMO_USER_IP : ipForBidder(bidderName),
      });
    }
  }
  return bids;
};

const topBidderMapOf = (bids: readonly Bid[]): Map<string, string> => {
  const map = new Map<string, string>();
  const best = new Map<string, number>();
  for (const bid of bids) {
    if (bid.amount >= (best.get(bid.itemId) ?? 0)) {
      best.set(bid.itemId, bid.amount);
      map.set(bid.itemId, bid.bidderSub);
    }
  }
  return map;
};

// ---------- DynamoDB書き込み ----------

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const batchWrite = async (
  tableName: string,
  records: readonly Record<string, unknown>[],
): Promise<void> => {
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
  const userPoolId = await getUserPoolId();
  const demoUserSub = await ensureUser(userPoolId, DEMO_USER);
  const adminUserSub = await ensureUser(userPoolId, ADMIN_USER, 'admin');
  console.log(`Users ready: demo=${demoUserSub} admin=${adminUserSub}`);

  const purgedBids = await purgeTable(BIDS_TABLE, ['itemId', 'bidId']);
  const purgedItems = await purgeTable(ITEMS_TABLE, ['itemId']);
  const purgedOrgs = await purgeTable(ORGANIZATIONS_TABLE, ['orgId']);
  console.log(`Purged ${purgedItems} items, ${purgedBids} bids, and ${purgedOrgs} organizations.`);

  await batchWrite(ORGANIZATIONS_TABLE, ORGANIZATIONS);
  const bids = buildBids(demoUserSub);
  const items = buildItems(demoUserSub, topBidderMapOf(bids));
  await batchWrite(ITEMS_TABLE, items);
  await batchWrite(BIDS_TABLE, bids);
  console.log(
    `Seeded ${ORGANIZATIONS.length} organizations, ${items.length} items, and ${bids.length} bids.`,
  );
};

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
