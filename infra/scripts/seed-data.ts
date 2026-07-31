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

// 拾得日を「実行時から何日前か」で表現し、再シードのたびに自動で最新化する
// （出品は保管期間90日満了後という前提のため、常に90日より前の日付になるようにする）
const foundAt = (daysAgo: number): string =>
  new Date(now - daysAgo * DAYS).toISOString().slice(0, 10);

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
  paymentStatus?: PaymentStatus;
  pickupStatus?: PickupStatus;
  pickupDate?: string;
  pickupCode?: string;
  pickupBoxNumber?: number;
  // 出品元が受け取り拠点への納品を確認済みかどうか（購入者側のpickupStatusとは独立したデモ用フラグ）
  orgHandoverConfirmed?: boolean;
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
    foundMonth: foundAt(135).slice(0, 7),
    startPrice: 200,
    currentPrice: 350,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 6 * HOURS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(135),
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
    foundMonth: foundAt(105).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 2 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(105),
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
    foundMonth: foundAt(155).slice(0, 7),
    startPrice: 800,
    currentPrice: 1200,
    bidCount: 4,
    status: 'active',
    endOffsetMs: 1 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(155),
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
    foundMonth: foundAt(185).slice(0, 7),
    startPrice: 3000,
    currentPrice: 4500,
    bidCount: 6,
    status: 'active',
    endOffsetMs: 8 * HOURS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(185),
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
    foundMonth: foundAt(125).slice(0, 7),
    startPrice: 500,
    currentPrice: 800,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(125),
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
    foundMonth: foundAt(195).slice(0, 7),
    startPrice: 2000,
    currentPrice: 3200,
    bidCount: 5,
    status: 'active',
    endOffsetMs: 2 * DAYS + 12 * HOURS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(195),
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
    foundMonth: foundAt(165).slice(0, 7),
    startPrice: 1500,
    currentPrice: 2600,
    bidCount: 4,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(165),
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
    foundMonth: foundAt(115).slice(0, 7),
    startPrice: 300,
    currentPrice: 400,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(115),
    color: '生成り（ネイビーストライプ）',
  },
  {
    itemId: 'i-009',
    orgId: 'org-fukuoka-police',
    title: 'カーディガン（ベージュ・Mサイズ）',
    category: 'clothing',
    description: 'クリーニング済み。毛玉少なめです。',
    foundLocation: '博多座前',
    foundMonth: foundAt(145).slice(0, 7),
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(145),
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
    foundMonth: foundAt(175).slice(0, 7),
    startPrice: 1000,
    currentPrice: 1800,
    bidCount: 11,
    status: 'active',
    endOffsetMs: 10 * HOURS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(175),
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
    foundMonth: foundAt(100).slice(0, 7),
    startPrice: 150,
    currentPrice: 200,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'used',
    quantity: 5,
    foundDate: foundAt(100),
  },
  {
    itemId: 'i-012',
    orgId: 'org-fukuoka-police',
    title: '折りたたみ自転車（20インチ）',
    category: 'bicycle',
    description: '防犯登録抹消済み。折りたたみ機構の動作確認済み。',
    foundLocation: '呉服町駅 駐輪場',
    foundMonth: foundAt(210).slice(0, 7),
    startPrice: 3000,
    currentPrice: 8500,
    bidCount: 12,
    status: 'sold',
    endOffsetMs: -3 * DAYS,
    paymentStatus: 'unpaid',
    pickupStatus: 'awaiting',
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(210),
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
    foundMonth: foundAt(240).slice(0, 7),
    startPrice: 5000,
    currentPrice: 12000,
    bidCount: 9,
    status: 'sold',
    endOffsetMs: -5 * DAYS,
    paymentStatus: 'paid',
    pickupStatus: 'reserved',
    pickupDate: new Date(now + 2 * DAYS).toISOString().slice(0, 10),
    pickupCode: '384912',
    pickupBoxNumber: generateBoxNumber('i-013'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(240),
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
    foundMonth: foundAt(225).slice(0, 7),
    startPrice: 2000,
    currentPrice: 5400,
    bidCount: 8,
    status: 'sold',
    endOffsetMs: -7 * DAYS,
    paymentStatus: 'paid',
    pickupStatus: 'completed',
    orgHandoverConfirmed: true,
    pickupDate: new Date(now - 2 * DAYS).toISOString().slice(0, 10),
    pickupCode: '551208',
    pickupBoxNumber: generateBoxNumber('i-014'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(225),
    color: 'ブラック',
  },

  // ---------- 追加分（i-015〜i-064） ----------
  {
    itemId: 'i-015',
    orgId: 'org-jr-hakata',
    title: '折りたたみ傘（黒無地）',
    category: 'umbrella',
    description: '骨組み・生地に破損なし。開閉動作も良好です。',
    foundLocation: '博多駅 博多口',
    foundMonth: foundAt(100).slice(0, 7),
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(100),
    color: '黒',
    size: '親骨58cm',
  },
  {
    itemId: 'i-016',
    orgId: 'org-fukuoka-police',
    title: '長傘（ビニール・大きめ）',
    category: 'umbrella',
    description: '一部の骨に軽い歪みがありますが、開閉に支障はありません。',
    foundLocation: '天神地下街',
    foundMonth: foundAt(103).slice(0, 7),
    startPrice: 100,
    currentPrice: 150,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(103),
    color: '透明',
    size: '65cm',
  },
  {
    itemId: 'i-017',
    orgId: 'org-fukuoka-police',
    title: '折りたたみ傘（花柄・ミニサイズ）',
    category: 'umbrella',
    description: '女性用サイズ。目立つ汚れなし。',
    foundLocation: '警固神社前',
    foundMonth: foundAt(106).slice(0, 7),
    startPrice: 150,
    currentPrice: 150,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(106),
    color: 'ピンク（花柄）',
    size: '親骨50cm',
  },
  {
    itemId: 'i-018',
    orgId: 'org-fukuoka-police',
    title: '長傘（紳士用・黒無地）',
    category: 'umbrella',
    description: '骨組みしっかりしています。持ち手に使用感あり。',
    foundLocation: '地下鉄空港線 車内',
    foundMonth: foundAt(109).slice(0, 7),
    startPrice: 150,
    currentPrice: 300,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 2 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(109),
    color: '黒',
    size: '65cm',
  },
  {
    itemId: 'i-019',
    orgId: 'org-canal-city',
    title: '折りたたみ傘（迷彩柄）',
    category: 'umbrella',
    description: '未使用に近い状態です。収納ケース付き。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(112).slice(0, 7),
    startPrice: 250,
    currentPrice: 250,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(112),
    color: 'カーキ（迷彩柄）',
    accessories: '収納ケース',
  },
  {
    itemId: 'i-020',
    orgId: 'org-fukuoka-police',
    title: 'ビニール傘（骨折れあり）',
    category: 'umbrella',
    description: '骨が1本折れています。使用には問題ありません。',
    foundLocation: '博多バスターミナル',
    foundMonth: foundAt(115).slice(0, 7),
    startPrice: 50,
    currentPrice: 50,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(115),
    color: '透明',
  },
  {
    itemId: 'i-021',
    orgId: 'org-jr-hakata',
    title: '長財布（黒・レザー）',
    category: 'wallet',
    description: '現金・カード類は抜き取り済み。角に軽い擦れがあります。',
    foundLocation: '博多駅 筑紫口',
    foundMonth: foundAt(118).slice(0, 7),
    startPrice: 700,
    currentPrice: 700,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(118),
    color: '黒',
    size: 'W19×H10cm',
  },
  {
    itemId: 'i-022',
    orgId: 'org-fukuoka-police',
    title: '二つ折り財布（グレー・合皮）',
    category: 'wallet',
    description: '目立った傷や汚れはありません。',
    foundLocation: '天神中央公園',
    foundMonth: foundAt(121).slice(0, 7),
    startPrice: 400,
    currentPrice: 650,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(121),
    color: 'グレー',
  },
  {
    itemId: 'i-023',
    orgId: 'org-canal-city',
    title: 'ミニ財布（コインケース一体型・赤）',
    category: 'wallet',
    description: '小銭入れ部分のファスナー動作良好です。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(124).slice(0, 7),
    startPrice: 300,
    currentPrice: 300,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(124),
    color: '赤',
  },
  {
    itemId: 'i-024',
    orgId: 'org-fukuoka-police',
    title: '長財布（ネイビー・ナイロン）',
    category: 'wallet',
    description: '軽度の色あせがありますが、機能に問題ありません。',
    foundLocation: '西鉄福岡（天神）駅',
    foundMonth: foundAt(127).slice(0, 7),
    startPrice: 300,
    currentPrice: 450,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(127),
    color: 'ネイビー',
  },
  {
    itemId: 'i-025',
    orgId: 'org-fukuoka-police',
    title: 'カードケース（本革・茶）',
    category: 'wallet',
    description: '名刺も数枚収納可能なタイプです。',
    foundLocation: '博多阪急前',
    foundMonth: foundAt(130).slice(0, 7),
    startPrice: 500,
    currentPrice: 500,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(130),
    color: '茶（ブラウン）',
    brand: '不明（型押しロゴあり）',
  },
  {
    itemId: 'i-026',
    orgId: 'org-fukuoka-police',
    title: '腕時計（デジタル・黒）',
    category: 'watch',
    description: '動作確認済み。ベルトに使用感があります。',
    foundLocation: '六本松421前',
    foundMonth: foundAt(133).slice(0, 7),
    startPrice: 800,
    currentPrice: 1200,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(133),
    color: '黒',
    size: 'ケース径40mm',
  },
  {
    itemId: 'i-027',
    orgId: 'org-fukuoka-police',
    title: '腕時計（レディース・ゴールド）',
    category: 'watch',
    description: '文字盤が小さめのレディースタイプ。動作確認済み。',
    foundLocation: '大丸福岡天神店前',
    foundMonth: foundAt(136).slice(0, 7),
    startPrice: 1500,
    currentPrice: 2400,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 2 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(136),
    color: 'ゴールド',
    size: 'ケース径24mm',
  },
  {
    itemId: 'i-028',
    orgId: 'org-fukuoka-police',
    title: '腕時計（スポーツウォッチ・ラバーベルト）',
    category: 'watch',
    description: '防水機能付き。ボタン操作は良好です。',
    foundLocation: '舞鶴公園',
    foundMonth: foundAt(139).slice(0, 7),
    startPrice: 1000,
    currentPrice: 1000,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(139),
    color: '黒×赤',
    accessories: '取扱説明書',
  },
  {
    itemId: 'i-029',
    orgId: 'org-canal-city',
    title: '腕時計（アンティーク調・革ベルト）',
    category: 'watch',
    description: '手巻き式です。動作は確認できていません（現状品）。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(142).slice(0, 7),
    startPrice: 2000,
    currentPrice: 3100,
    bidCount: 4,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(142),
    color: 'ブラウン',
    size: 'ケース径34mm',
  },
  {
    itemId: 'i-030',
    orgId: 'org-jr-hakata',
    title: '腕時計（防水デジタル・黒）',
    category: 'watch',
    description: '動作確認済み。目立つ傷はありません。',
    foundLocation: '博多駅 新幹線改札前',
    foundMonth: foundAt(145).slice(0, 7),
    startPrice: 1200,
    currentPrice: 3800,
    bidCount: 7,
    status: 'sold',
    endOffsetMs: -4 * DAYS,
    paymentStatus: 'paid',
    pickupStatus: 'completed',
    orgHandoverConfirmed: true,
    pickupDate: new Date(now - 1 * DAYS).toISOString().slice(0, 10),
    pickupCode: '204577',
    pickupBoxNumber: generateBoxNumber('i-030'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(145),
    color: '黒',
    size: 'ケース径38mm',
  },
  {
    itemId: 'i-031',
    orgId: 'org-fukuoka-police',
    title: '有線イヤホン（白）',
    category: 'audio',
    description: 'コード・イヤーピースに問題ありません。',
    foundLocation: '地下鉄七隈線 車内',
    foundMonth: foundAt(148).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(148),
    color: '白',
  },
  {
    itemId: 'i-032',
    orgId: 'org-fukuoka-police',
    title: 'ワイヤレスイヤホン（片耳のみ）',
    category: 'audio',
    description: '片耳のみの拾得です。初期化済み。',
    foundLocation: '西鉄バス車内',
    foundMonth: foundAt(151).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(151),
    color: '黒',
  },
  {
    itemId: 'i-033',
    orgId: 'org-jr-hakata',
    title: 'ヘッドホン（オーバーイヤー・黒）',
    category: 'audio',
    description: '初期化済み。イヤーパッドに使用感があります。',
    foundLocation: '博多駅 博多口',
    foundMonth: foundAt(154).slice(0, 7),
    startPrice: 700,
    currentPrice: 1100,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(154),
    color: '黒',
    accessories: '収納ポーチ',
  },
  {
    itemId: 'i-034',
    orgId: 'org-canal-city',
    title: 'ワイヤレススピーカー（小型）',
    category: 'audio',
    description: '動作確認済み。充電ケーブルは付属していません。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(157).slice(0, 7),
    startPrice: 500,
    currentPrice: 900,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 2 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(157),
    color: 'ブルー',
  },
  {
    itemId: 'i-035',
    orgId: 'org-fukuoka-police',
    title: 'ワイヤレスイヤホン（ケースのみ・本体なし）',
    category: 'audio',
    description: '充電ケースのみの拾得です。本体は入っていません。',
    foundLocation: '中洲川端駅',
    foundMonth: foundAt(160).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(160),
    color: '白',
  },
  {
    itemId: 'i-036',
    orgId: 'org-fukuoka-police',
    title: 'イヤホン（有線・巻き取り式）',
    category: 'audio',
    description: '巻き取り機構の動作良好です。',
    foundLocation: '呉服町駅',
    foundMonth: foundAt(163).slice(0, 7),
    startPrice: 100,
    currentPrice: 150,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(163),
    color: 'ピンク',
  },
  {
    itemId: 'i-037',
    orgId: 'org-fukuoka-police',
    title: 'マウンテンバイク風自転車（27インチ）',
    category: 'bicycle',
    description: '防犯登録抹消済み。タイヤの空気圧はやや低めです。',
    foundLocation: '祇園駅 駐輪場',
    foundMonth: foundAt(166).slice(0, 7),
    startPrice: 2500,
    currentPrice: 4000,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(166),
    color: '黒×赤',
    size: '27インチ',
  },
  {
    itemId: 'i-038',
    orgId: 'org-jr-hakata',
    title: '電動アシスト自転車（バッテリー別売）',
    category: 'bicycle',
    description: '防犯登録抹消済み。本体のみでバッテリーは付属しません。',
    foundLocation: '博多駅 筑紫口 駐輪場',
    foundMonth: foundAt(169).slice(0, 7),
    startPrice: 5000,
    currentPrice: 15000,
    bidCount: 10,
    status: 'sold',
    endOffsetMs: -6 * DAYS,
    paymentStatus: 'unpaid',
    pickupStatus: 'awaiting',
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(169),
    color: '白',
    size: '24インチ',
  },
  {
    itemId: 'i-039',
    orgId: 'org-fukuoka-police',
    title: 'ミニベロ（20インチ・折りたたみ不可）',
    category: 'bicycle',
    description: '防犯登録抹消済み。チェーンに軽い錆があります。',
    foundLocation: '薬院大通り',
    foundMonth: foundAt(172).slice(0, 7),
    startPrice: 1500,
    currentPrice: 1500,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(172),
    color: 'グリーン',
    size: '20インチ',
  },
  {
    itemId: 'i-040',
    orgId: 'org-fukuoka-police',
    title: '子供用自転車（16インチ）',
    category: 'bicycle',
    description: '補助輪付き。防犯登録抹消済み。',
    foundLocation: '大濠公園',
    foundMonth: foundAt(175).slice(0, 7),
    startPrice: 1000,
    currentPrice: 1600,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(175),
    color: 'ピンク',
    size: '16インチ',
  },
  {
    itemId: 'i-041',
    orgId: 'org-fukuoka-police',
    title: 'シティサイクル（カゴ破損）',
    category: 'bicycle',
    description: '前カゴが一部破損しています。走行には支障ありません。',
    foundLocation: '博多バスターミナル',
    foundMonth: foundAt(178).slice(0, 7),
    startPrice: 500,
    currentPrice: 500,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(178),
    color: '白',
    size: '26インチ',
  },
  {
    itemId: 'i-042',
    orgId: 'org-jr-hakata',
    title: 'リュックサック（黒・ビジネス用）',
    category: 'bag',
    description: 'PC収納ポケットあり。ファスナー動作良好です。',
    foundLocation: '博多駅 新幹線改札前',
    foundMonth: foundAt(181).slice(0, 7),
    startPrice: 800,
    currentPrice: 800,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(181),
    color: '黒',
    size: 'A4対応',
  },
  {
    itemId: 'i-043',
    orgId: 'org-fukuoka-police',
    title: 'ハンドバッグ（レディース・白）',
    category: 'bag',
    description: '内側のポケットに軽いペン汚れがあります。',
    foundLocation: 'パルコ天神店前',
    foundMonth: foundAt(184).slice(0, 7),
    startPrice: 600,
    currentPrice: 950,
    bidCount: 2,
    status: 'active',
    endOffsetMs: 3 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(184),
    color: '白',
  },
  {
    itemId: 'i-044',
    orgId: 'org-fukuoka-police',
    title: 'ボストンバッグ（旅行用・紺）',
    category: 'bag',
    description: '底面に多少の使用感があります。ファスナー動作良好。',
    foundLocation: '博多バスターミナル',
    foundMonth: foundAt(187).slice(0, 7),
    startPrice: 700,
    currentPrice: 700,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(187),
    color: 'ネイビー',
  },
  {
    itemId: 'i-045',
    orgId: 'org-fukuoka-police',
    title: 'ウエストポーチ（黒・ナイロン）',
    category: 'bag',
    description: '中身は空の状態で保管されていました。',
    foundLocation: '百道浜 海浜公園',
    foundMonth: foundAt(190).slice(0, 7),
    startPrice: 500,
    currentPrice: 1400,
    bidCount: 5,
    status: 'sold',
    endOffsetMs: -2 * DAYS,
    paymentStatus: 'paid',
    pickupStatus: 'reserved',
    orgHandoverConfirmed: true,
    pickupDate: new Date(now + 3 * DAYS).toISOString().slice(0, 10),
    pickupCode: '719045',
    pickupBoxNumber: generateBoxNumber('i-045'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(190),
    color: '黒',
  },
  {
    itemId: 'i-046',
    orgId: 'org-canal-city',
    title: 'エコバッグ（保冷機能付き）',
    category: 'bag',
    description: '内側保冷シート付き。目立つ汚れなし。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(193).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(193),
    color: 'グレー',
  },
  {
    itemId: 'i-047',
    orgId: 'org-fukuoka-police',
    title: '巾着袋（和柄・小物入れ）',
    category: 'bag',
    description: '小物用の巾着袋です。汚れ・傷みなし。',
    foundLocation: '櫛田神社前',
    foundMonth: foundAt(196).slice(0, 7),
    startPrice: 100,
    currentPrice: 150,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(196),
    color: '紺（和柄）',
  },
  {
    itemId: 'i-048',
    orgId: 'org-fukuoka-police',
    title: 'マフラー（ウール・グレー）',
    category: 'clothing',
    description: 'クリーニング済み。毛玉少なめです。',
    foundLocation: '天神地下街',
    foundMonth: foundAt(199).slice(0, 7),
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(199),
    color: 'グレー',
  },
  {
    itemId: 'i-049',
    orgId: 'org-fukuoka-police',
    title: '手袋（革・黒・片方のみ）',
    category: 'clothing',
    description: '片方のみの拾得です。目立つ傷みなし。',
    foundLocation: '西鉄福岡（天神）駅',
    foundMonth: foundAt(202).slice(0, 7),
    startPrice: 50,
    currentPrice: 50,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(202),
    color: '黒',
  },
  {
    itemId: 'i-050',
    orgId: 'org-fukuoka-police',
    title: 'パーカー（グレー・Lサイズ）',
    category: 'clothing',
    description: 'クリーニング済み。ロゴプリントに軽い色あせがあります。',
    foundLocation: '六本松421前',
    foundMonth: foundAt(205).slice(0, 7),
    startPrice: 300,
    currentPrice: 450,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(205),
    color: 'グレー',
    size: 'Lサイズ',
  },
  {
    itemId: 'i-051',
    orgId: 'org-fukuoka-police',
    title: 'ストール（シルク調・花柄）',
    category: 'clothing',
    description: '目立った傷みはありません。',
    foundLocation: '大丸福岡天神店前',
    foundMonth: foundAt(208).slice(0, 7),
    startPrice: 300,
    currentPrice: 300,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(208),
    color: 'ベージュ（花柄）',
  },
  {
    itemId: 'i-052',
    orgId: 'org-canal-city',
    title: 'ジャケット（デニム・Mサイズ）',
    category: 'clothing',
    description: 'クリーニング済み。裾に軽い擦れがあります。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(211).slice(0, 7),
    startPrice: 500,
    currentPrice: 1900,
    bidCount: 6,
    status: 'sold',
    endOffsetMs: -8 * DAYS,
    paymentStatus: 'paid',
    pickupStatus: 'completed',
    pickupDate: new Date(now - 3 * DAYS).toISOString().slice(0, 10),
    pickupCode: '660231',
    pickupBoxNumber: generateBoxNumber('i-052'),
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(211),
    color: 'インディゴブルー',
    size: 'Mサイズ',
  },
  {
    itemId: 'i-053',
    orgId: 'org-fukuoka-police',
    title: '帽子（キャップ・黒）',
    category: 'clothing',
    description: 'つばに軽い折れ跡があります。',
    foundLocation: '舞鶴公園',
    foundMonth: foundAt(214).slice(0, 7),
    startPrice: 150,
    currentPrice: 150,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'used',
    quantity: 1,
    foundDate: foundAt(214),
    color: '黒',
  },
  {
    itemId: 'i-054',
    orgId: 'org-fukuoka-police',
    title: 'ピアス（片方のみ・シルバー）',
    category: 'accessory',
    description: '片方のみの拾得です。貴金属検査済み。',
    foundLocation: 'パルコ天神店前',
    foundMonth: foundAt(217).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'damaged',
    quantity: 1,
    foundDate: foundAt(217),
    color: 'シルバー',
  },
  {
    itemId: 'i-055',
    orgId: 'org-fukuoka-police',
    title: 'ブレスレット（ビーズ）',
    category: 'accessory',
    description: '目立った傷みなし。ビーズの欠けもありません。',
    foundLocation: '福岡タワー前',
    foundMonth: foundAt(220).slice(0, 7),
    startPrice: 150,
    currentPrice: 250,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(220),
    color: 'マルチカラー',
  },
  {
    itemId: 'i-056',
    orgId: 'org-fukuoka-police',
    title: 'サングラス（黒縁）',
    category: 'accessory',
    description: 'レンズに目立つ傷はありません。ケースは付属しません。',
    foundLocation: '博多埠頭 ベイサイドプレイス',
    foundMonth: foundAt(223).slice(0, 7),
    startPrice: 300,
    currentPrice: 300,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(223),
    color: '黒',
  },
  {
    itemId: 'i-057',
    orgId: 'org-canal-city',
    title: '指輪（シンプルリング）',
    category: 'accessory',
    description: '刻印なし・貴金属検査済み。サイズ13号相当。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(226).slice(0, 7),
    startPrice: 800,
    currentPrice: 2600,
    bidCount: 5,
    status: 'sold',
    endOffsetMs: -10 * DAYS,
    paymentStatus: 'unpaid',
    pickupStatus: 'awaiting',
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(226),
    color: 'シルバー',
    size: '13号相当',
  },
  {
    itemId: 'i-058',
    orgId: 'org-jr-hakata',
    title: 'ネクタイピン（シルバー）',
    category: 'accessory',
    description: '目立った変色・傷みはありません。',
    foundLocation: '博多駅 博多口',
    foundMonth: foundAt(229).slice(0, 7),
    startPrice: 300,
    currentPrice: 300,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(229),
    color: 'シルバー',
  },
  {
    itemId: 'i-059',
    orgId: 'org-fukuoka-police',
    title: 'ヘアアクセサリー（バレッタ3点セット）',
    category: 'accessory',
    description: '色違い3点セットです。目立つ傷みなし。',
    foundLocation: '警固神社前',
    foundMonth: foundAt(232).slice(0, 7),
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'like_new',
    quantity: 3,
    foundDate: foundAt(232),
    color: 'マルチカラー',
  },
  {
    itemId: 'i-060',
    orgId: 'org-jr-hakata',
    title: 'ビジネス書2冊セット',
    category: 'book',
    description: '書き込みなし。カバーに軽い日焼けがあります。',
    foundLocation: '博多駅 博多口',
    foundMonth: foundAt(235).slice(0, 7),
    startPrice: 200,
    currentPrice: 200,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'used',
    quantity: 2,
    foundDate: foundAt(235),
  },
  {
    itemId: 'i-061',
    orgId: 'org-fukuoka-police',
    title: '漫画コミックセット（10冊）',
    category: 'book',
    description: '同一シリーズ10冊セットです。全体的に状態良好。',
    foundLocation: '地下鉄空港線 車内',
    foundMonth: foundAt(238).slice(0, 7),
    startPrice: 500,
    currentPrice: 900,
    bidCount: 3,
    status: 'active',
    endOffsetMs: 4 * DAYS,
    conditionRank: 'good',
    quantity: 10,
    foundDate: foundAt(238),
  },
  {
    itemId: 'i-062',
    orgId: 'org-fukuoka-police',
    title: '旅行ガイドブック（福岡版）',
    category: 'book',
    description: '書き込み・折れなし。',
    foundLocation: '博多バスターミナル',
    foundMonth: foundAt(241).slice(0, 7),
    startPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 7 * DAYS,
    conditionRank: 'like_new',
    quantity: 1,
    foundDate: foundAt(241),
  },
  {
    itemId: 'i-063',
    orgId: 'org-fukuoka-police',
    title: '参考書・問題集セット（高校生用）',
    category: 'book',
    description: '一部書き込みがあります。付録の別冊は揃っています。',
    foundLocation: '西鉄福岡（天神）駅',
    foundMonth: foundAt(244).slice(0, 7),
    startPrice: 150,
    currentPrice: 150,
    bidCount: 0,
    status: 'active',
    endOffsetMs: 6 * DAYS,
    conditionRank: 'used',
    quantity: 3,
    foundDate: foundAt(244),
  },
  {
    itemId: 'i-064',
    orgId: 'org-canal-city',
    title: '洋書ペーパーバック',
    category: 'book',
    description: '英語小説です。日焼け・傷みは少なめです。',
    foundLocation: 'キャナルシティ博多前',
    foundMonth: foundAt(247).slice(0, 7),
    startPrice: 100,
    currentPrice: 150,
    bidCount: 1,
    status: 'active',
    endOffsetMs: 5 * DAYS,
    conditionRank: 'good',
    quantity: 1,
    foundDate: foundAt(247),
  },
];

// frontend/public/images/items/ に実写真が用意済みのitemIdのみ。
// それ以外はimageUrlを付けず、ItemCardのカテゴリアイコン表示にフォールバックさせる。
const ITEM_IDS_WITH_PHOTO = new Set(
  Array.from({ length: 14 }, (_, i) => `i-${String(i + 1).padStart(3, '0')}`),
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
      imageUrl: ITEM_IDS_WITH_PHOTO.has(seed.itemId)
        ? `/images/items/${seed.itemId}.jpg`
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
