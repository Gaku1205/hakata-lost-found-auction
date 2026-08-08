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
  Favorite,
  Inquiry,
  ItemCategory,
  ItemStatus,
  LostItem,
  Organization,
  PartnerApplication,
  PaymentStatus,
  PickupStatus,
} from '../lambda/types';
// 出品データ本体は check-ai-accuracy.ts と共有するため別ファイルに置いている
import { DAYS, foundAt, generateBoxNumber, hashString, now, SEEDS } from './seed-items';

const ITEMS_TABLE = 'megurimono-items';
const BIDS_TABLE = 'megurimono-bids';
const ORGANIZATIONS_TABLE = 'megurimono-organizations';
const PARTNER_APPLICATIONS_TABLE = 'megurimono-partner-applications';
const FAVORITES_TABLE = 'megurimono-favorites';
const INQUIRIES_TABLE = 'megurimono-inquiries';
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
// 出品元（商業施設）アカウントのデモ。JR博多シティ（org-jr-hakata）に紐づける
const ORG_USER = {
  email: 'org@example.com',
  password: 'REDACTED_ORG_PASSWORD',
  nickname: 'JR博多シティ',
  orgId: 'org-jr-hakata',
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const cfn = new CloudFormationClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });


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
  orgId?: string,
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
        ...(orgId !== undefined ? [{ Name: 'custom:orgId', Value: orgId }] : []),
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

const generateCaseNumber =(org: Organization, itemId: string, foundDate: string): string => {
  const seq = (hashString(itemId) % 9000) + 1000;
  const yyyymmdd = foundDate.replaceAll('-', '');
  return `${org.orgCode}-${yyyymmdd}-${seq}`;
};


// ---------- 出品元（警察・自治体／企業） ----------

const ORGANIZATIONS: readonly Organization[] = [
  {
    orgId: 'org-fukuoka-police',
    orgCode: 'FKP',
    name: '福岡県警察',
    type: 'police',
    contactNote: '福岡県警察本部 遺失物センター（運営代理登録）',
    createdAt: at(-120 * DAYS),
  },
  {
    orgId: 'org-jr-hakata',
    orgCode: 'JRH',
    name: 'JR博多シティ',
    type: 'corporate',
    contactNote: '博多駅 総合案内所 担当者確認済み（運営代理登録）',
    createdAt: at(-60 * DAYS),
  },
  {
    orgId: 'org-canal-city',
    orgCode: 'CCH',
    name: 'キャナルシティ博多',
    type: 'corporate',
    contactNote: '施設管理事務所 担当者確認済み（運営代理登録）',
    createdAt: at(-45 * DAYS),
  },
];

// ---------- 出品元 申し込み（デモ表示用） ----------

const PARTNER_APPLICATIONS: readonly PartnerApplication[] = [
  {
    applicationId: 'app-demo-tenjin-core',
    name: '天神コア',
    type: 'corporate',
    contactName: '施設管理部 山田',
    contactEmail: 'partner@example.com',
    contactPhone: '092-000-0000',
    message: '館内での落とし物をめぐりモノで出品したいと考えています。',
    status: 'new',
    createdAt: at(-2 * DAYS),
  },
  {
    applicationId: 'app-demo-hakata-ward',
    name: '博多区役所',
    type: 'police',
    contactName: '地域振興課 佐藤',
    contactEmail: 'ward-partner@example.com',
    status: 'reviewed',
    createdAt: at(-10 * DAYS),
  },
];

// ---------- 出品元からの問い合わせ（デモ表示用） ----------

const INQUIRIES: readonly Inquiry[] = [
  {
    inquiryId: 'inq-demo-001',
    orgId: 'org-jr-hakata',
    orgName: 'JR博多シティ',
    fromSub: 'seed-org-jr-hakata',
    message: '出品可能な物品の点数に上限はありますか？月末にまとめて登録したい物品があります。',
    status: 'new',
    createdAt: at(-3 * DAYS),
  },
  {
    inquiryId: 'inq-demo-002',
    orgId: 'org-jr-hakata',
    orgName: 'JR博多シティ',
    fromSub: 'seed-org-jr-hakata',
    message: '受取拠点を博多駅構内にも追加することは可能でしょうか。',
    status: 'reviewed',
    createdAt: at(-14 * DAYS),
  },
];

// ---------- お気に入り（デモ表示用） ----------

const FAVORITE_ITEM_IDS = ['i-002', 'i-005'] as const;

const orgById = new Map(ORGANIZATIONS.map((org) => [org.orgId, org]));



// frontend/public/images/items/ に実写真が用意済みのitemIdのみ。
// それ以外はimageUrlを付けず、ItemCardのカテゴリアイコン表示にフォールバックさせる。
const ITEM_IDS_WITH_PHOTO = new Set(
  Array.from({ length: 64 }, (_, i) => `i-${String(i + 1).padStart(3, '0')}`),
);

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
      imageUrls: ITEM_IDS_WITH_PHOTO.has(seed.itemId)
        ? [`/images/items/${seed.itemId}.jpg`]
        : undefined,
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
      paymentStatus: seed.paymentStatus ?? 'unpaid',
      pickupStatus: seed.pickupStatus ?? 'awaiting',
      pickupDate: seed.pickupDate,
      pickupCode: seed.pickupCode,
      pickupBoxNumber: seed.pickupBoxNumber,
      pickupDeadline: at(seed.endOffsetMs + 14 * DAYS),
      orgHandoverAt: seed.orgHandoverConfirmed === true ? at(seed.endOffsetMs + 1 * DAYS) : undefined,
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
  const orgUserSub = await ensureUser(userPoolId, ORG_USER, 'org', ORG_USER.orgId);
  console.log(`Users ready: demo=${demoUserSub} admin=${adminUserSub} org=${orgUserSub}`);

  const purgedBids = await purgeTable(BIDS_TABLE, ['itemId', 'bidId']);
  const purgedItems = await purgeTable(ITEMS_TABLE, ['itemId']);
  const purgedOrgs = await purgeTable(ORGANIZATIONS_TABLE, ['orgId']);
  const purgedApplications = await purgeTable(PARTNER_APPLICATIONS_TABLE, ['applicationId']);
  const purgedFavorites = await purgeTable(FAVORITES_TABLE, ['userSub', 'itemId']);
  const purgedInquiries = await purgeTable(INQUIRIES_TABLE, ['inquiryId']);
  console.log(
    `Purged ${purgedItems} items, ${purgedBids} bids, ${purgedOrgs} organizations, ${purgedApplications} partner applications, ${purgedFavorites} favorites, and ${purgedInquiries} inquiries.`,
  );

  const organizations = ORGANIZATIONS.map((org) =>
    org.orgId === ORG_USER.orgId ? { ...org, loginSub: orgUserSub } : org,
  );
  await batchWrite(ORGANIZATIONS_TABLE, organizations);
  await batchWrite(PARTNER_APPLICATIONS_TABLE, PARTNER_APPLICATIONS);
  await batchWrite(INQUIRIES_TABLE, INQUIRIES);
  const bids = buildBids(demoUserSub);
  const items = buildItems(demoUserSub, topBidderMapOf(bids));
  await batchWrite(ITEMS_TABLE, items);
  await batchWrite(BIDS_TABLE, bids);
  const favorites: Favorite[] = FAVORITE_ITEM_IDS.map((itemId) => ({
    userSub: demoUserSub,
    itemId,
    createdAt: at(-1 * DAYS),
  }));
  await batchWrite(FAVORITES_TABLE, favorites);
  console.log(
    `Seeded ${organizations.length} organizations, ${PARTNER_APPLICATIONS.length} partner applications, ${items.length} items, ${bids.length} bids, ${favorites.length} favorites, and ${INQUIRIES.length} inquiries.`,
  );
};

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
