import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, type AuthUser } from './auth';
import {
  isConditionRank,
  isItemCategory,
  isOrgType,
  isSortKey,
  type AdminItemInput,
  type AdminOrgInput,
  type Bid,
  type BidderSummary,
  type LostItem,
  type Organization,
  type SortKey,
  type Stats,
} from './types';

const ITEMS_TABLE = process.env.ITEMS_TABLE ?? '';
const BIDS_TABLE = process.env.BIDS_TABLE ?? '';
const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';

const PICKUP_DEADLINE_DAYS = 14;

// 商品画像アップロード
const UPLOAD_URL_EXPIRY_SECONDS = 300;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// 吊り上げ・不正入札対策のパラメータ
const EXTENSION_WINDOW_MS = 5 * 60 * 1000; // 残りこの時間未満の入札で自動延長
const MAX_BID_MULTIPLIER = 3; // 現在価格の何倍まで入札可能か
const MAX_BID_INCREMENT = 50_000; // 1回の入札で上乗せできる最大額
const RAPID_BID_COUNT = 5; // この件数が
const RAPID_BID_WINDOW_MS = 10 * 60 * 1000; // この時間内にあれば連続入札フラグ

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isLostItem = (value: unknown): value is LostItem => {
  if (!isRecord(value)) return false;
  return (
    typeof value['itemId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['currentPrice'] === 'number' &&
    typeof value['status'] === 'string' &&
    typeof value['endTime'] === 'string'
  );
};

const isOrganization = (value: unknown): value is Organization => {
  if (!isRecord(value)) return false;
  return (
    typeof value['orgId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string'
  );
};

const parseBody = (body: string | null): Record<string, unknown> | null => {
  if (body === null) return null;
  try {
    const data: unknown = JSON.parse(body);
    return isRecord(data) ? data : null;
  } catch {
    return null;
  }
};

const scanAllItems = async (): Promise<LostItem[]> => {
  const items: LostItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({ TableName: ITEMS_TABLE, ExclusiveStartKey: lastKey }),
    );
    items.push(...(result.Items ?? []).filter(isLostItem));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey !== undefined);
  return items;
};

// ---------- 公開API ----------

const getConfig = (): APIGatewayProxyResult =>
  json(200, { userPoolId: USER_POOL_ID, clientId: USER_POOL_CLIENT_ID, region: REGION });

type SearchQuery = {
  q: string;
  category: string;
  status: string;
  minPrice: number | null;
  maxPrice: number | null;
  sort: SortKey;
};

const parseSearchQuery = (
  params: Record<string, string | undefined> | null,
): SearchQuery => {
  const get = (key: string): string => {
    const value = params?.[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const toPrice = (raw: string): number | null => {
    if (raw === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const sortRaw = get('sort');
  return {
    q: get('q').toLowerCase(),
    category: get('category'),
    status: get('status'),
    minPrice: toPrice(get('minPrice')),
    maxPrice: toPrice(get('maxPrice')),
    sort: isSortKey(sortRaw) ? sortRaw : 'end_asc',
  };
};

const compareBySort = (sort: SortKey) => (a: LostItem, b: LostItem): number => {
  switch (sort) {
    case 'price_asc':
      return a.currentPrice - b.currentPrice;
    case 'price_desc':
      return b.currentPrice - a.currentPrice;
    case 'bids_desc':
      return b.bidCount - a.bidCount;
    case 'end_asc':
      return a.endTime.localeCompare(b.endTime);
  }
};

const getItems = async (
  params: Record<string, string | undefined> | null,
): Promise<APIGatewayProxyResult> => {
  const query = parseSearchQuery(params);
  const all = await scanAllItems();

  const filtered = all.filter((item) => {
    if (query.category !== '' && item.category !== query.category) return false;
    if (query.status === 'active' && item.status !== 'active') return false;
    if (query.status === 'sold' && item.status !== 'sold') return false;
    if (query.minPrice !== null && item.currentPrice < query.minPrice) return false;
    if (query.maxPrice !== null && item.currentPrice > query.maxPrice) return false;
    if (query.q !== '') {
      const haystack =
        `${item.title} ${item.description} ${item.foundLocation} ${item.pickupLocation}`.toLowerCase();
      if (!haystack.includes(query.q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return compareBySort(query.sort)(a, b);
  });

  return json(200, { items: sorted });
};

const getItemDetail = async (itemId: string): Promise<APIGatewayProxyResult> => {
  const [itemResult, bidsResult] = await Promise.all([
    doc.send(new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } })),
    doc.send(
      new QueryCommand({
        TableName: BIDS_TABLE,
        KeyConditionExpression: 'itemId = :id',
        ExpressionAttributeValues: { ':id': itemId },
        ScanIndexForward: false,
        Limit: 20,
      }),
    ),
  ]);
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) {
    return json(404, { message: '出品が見つかりません' });
  }
  return json(200, { item, bids: bidsResult.Items ?? [] });
};

const getStats = async (): Promise<APIGatewayProxyResult> => {
  const items = await scanAllItems();
  const stats = items.reduce<Stats>(
    (acc, item) => {
      const isSold = item.status === 'sold';
      const hasBids = item.bidCount > 0;
      return {
        itemCount: acc.itemCount + 1,
        activeCount: acc.activeCount + (isSold ? 0 : 1),
        soldCount: acc.soldCount + (isSold ? 1 : 0),
        totalBids: acc.totalBids + item.bidCount,
        soldTotal: acc.soldTotal + (isSold ? item.currentPrice : 0),
        activeBidTotal: acc.activeBidTotal + (!isSold && hasBids ? item.currentPrice : 0),
      };
    },
    { itemCount: 0, activeCount: 0, soldCount: 0, totalBids: 0, soldTotal: 0, activeBidTotal: 0 },
  );
  return json(200, stats);
};

// ---------- 認証つきAPI（一般ユーザー） ----------

const extractSourceIp = (event: APIGatewayProxyEvent): string => {
  const forwarded =
    event.headers['X-Forwarded-For'] ?? event.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') {
    const first = forwarded.split(',')[0];
    if (first !== undefined) return first.trim();
  }
  return event.requestContext.identity.sourceIp ?? '';
};

const placeBid = async (
  itemId: string,
  event: APIGatewayProxyEvent,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(event.body);
  const amount = data?.['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    return json(400, { message: '入札金額は1〜1,000,000円の整数で入力してください' });
  }

  // 事前チェック（自動延長の計算・分かりやすいエラーのため）。
  // 競合時の整合性はトランザクションの条件式が最終防衛線になる。
  const preResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const preItem: unknown = preResult.Item;
  if (!isLostItem(preItem)) return json(404, { message: '出品が見つかりません' });

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  if (preItem.status !== 'active' || preItem.endTime <= now) {
    return json(409, { message: 'このオークションは終了しています' });
  }
  if (preItem.topBidderSub === user.sub) {
    return json(409, {
      message: 'あなたが現在の最高額入札者です。他の入札があるまでお待ちください（吊り上げ防止）',
    });
  }
  const maxAllowed = Math.min(
    preItem.currentPrice * MAX_BID_MULTIPLIER,
    preItem.currentPrice + MAX_BID_INCREMENT,
  );
  if (amount > maxAllowed) {
    return json(400, {
      message: `1回の入札は${maxAllowed.toLocaleString('ja-JP')}円まで（現在価格の${MAX_BID_MULTIPLIER}倍・+${MAX_BID_INCREMENT.toLocaleString('ja-JP')}円以内）です。価格の吊り上げ・誤入力防止のためご協力ください`,
      maxAllowed,
    });
  }

  // アンチスナイプ: 終了間際の入札は終了時刻を延長する
  const endMs = new Date(preItem.endTime).getTime();
  const extended = endMs - nowMs < EXTENSION_WINDOW_MS;
  const newEndTime = extended
    ? new Date(nowMs + EXTENSION_WINDOW_MS).toISOString()
    : preItem.endTime;

  const bid: Bid = {
    itemId,
    bidId: `${now}#${Math.random().toString(36).slice(2, 8)}`,
    bidderName: user.nickname,
    bidderSub: user.sub,
    amount,
    createdAt: now,
    sourceIp: extractSourceIp(event),
  };

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: ITEMS_TABLE,
              Key: { itemId },
              UpdateExpression:
                'SET currentPrice = :amount, bidCount = bidCount + :one, topBidderSub = :sub, endTime = :newEnd',
              ConditionExpression:
                '#st = :active AND endTime > :now AND currentPrice < :amount AND (attribute_not_exists(topBidderSub) OR topBidderSub <> :sub)',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: {
                ':amount': amount,
                ':one': 1,
                ':active': 'active',
                ':now': now,
                ':sub': user.sub,
                ':newEnd': newEndTime,
              },
            },
          },
          { Put: { TableName: BIDS_TABLE, Item: bid } },
        ],
      }),
    );
  } catch (error: unknown) {
    if (error instanceof TransactionCanceledException) {
      const itemResult = await doc.send(
        new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
      );
      const item: unknown = itemResult.Item;
      if (!isLostItem(item)) {
        return json(404, { message: '出品が見つかりません' });
      }
      if (item.status !== 'active' || item.endTime <= now) {
        return json(409, { message: 'このオークションは終了しています' });
      }
      if (item.topBidderSub === user.sub) {
        return json(409, {
          message: 'あなたが現在の最高額入札者です。他の入札があるまでお待ちください（吊り上げ防止）',
        });
      }
      return json(409, {
        message: `入札額は現在価格（${item.currentPrice.toLocaleString('ja-JP')}円）より高い金額を指定してください`,
        currentPrice: item.currentPrice,
      });
    }
    throw error;
  }

  return json(201, { currentPrice: amount, bid, extended, endTime: newEndTime });
};

const getMyWins = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  const items = await scanAllItems();
  const wins = items
    .filter((item) => item.status === 'sold' && item.winnerSub === user.sub)
    .sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? ''));
  return json(200, { items: wins });
};

const generatePickupCode = (): string =>
  String(Math.floor(100000 + Math.random() * 900000));

const reservePickup = async (
  itemId: string,
  body: string | null,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  const date = data?.['date'];
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(400, { message: '受取日を選択してください' });
  }

  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.status !== 'sold' || item.winnerSub !== user.sub) {
    return json(403, { message: 'この物品の落札者ではありません' });
  }
  if (item.pickupStatus === 'completed') {
    return json(409, { message: 'すでに受け渡しが完了しています' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const deadlineDay = (item.pickupDeadline ?? '9999-12-31').slice(0, 10);
  if (date < today || date > deadlineDay) {
    return json(400, {
      message: `受取日は本日〜受取期限（${deadlineDay}）の間で選択してください`,
    });
  }

  const pickupCode = item.pickupCode ?? generatePickupCode();
  const pickupBoxNumber = item.pickupBoxNumber ?? generateBoxNumber(itemId);
  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression:
        'SET pickupStatus = :reserved, pickupDate = :date, pickupCode = :code, pickupBoxNumber = :box',
      ExpressionAttributeValues: {
        ':reserved': 'reserved',
        ':date': date,
        ':code': pickupCode,
        ':box': pickupBoxNumber,
      },
    }),
  );

  return json(200, { pickupStatus: 'reserved', pickupDate: date, pickupCode, pickupBoxNumber });
};

// 無人ボックスがQRコード／認証コードを読み取り、購入者本人の操作で受け渡しを完了する
const selfCompletePickup = async (
  itemId: string,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.winnerSub !== user.sub) {
    return json(403, { message: 'この物品の落札者ではありません' });
  }
  if (item.pickupStatus !== 'reserved') {
    return json(409, { message: '受取予約が完了していないか、すでに受け渡し済みです' });
  }

  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression: 'SET pickupStatus = :completed',
      ExpressionAttributeValues: { ':completed': 'completed' },
    }),
  );
  return json(200, { pickupStatus: 'completed' });
};

// ---------- 管理者API ----------

// 拾得日から公告日・保管期間満了日を算出する（遺失物法の建付けを表現するための日数）
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

// itemIdから決定的に整理番号を発行する（同じitemIdなら常に同じ番号）
// 警察・自治体は遺失物法の「遺失物第X号」形式、企業は施設占有者拾得の管理番号形式にする
const generateCaseNumber = (org: Organization, itemId: string, foundDate: string): string => {
  const seq = (hashString(itemId) % 9000) + 1000;
  if (org.type === 'police') {
    const reiwaYear = new Date(foundDate).getFullYear() - 2018;
    return `${org.name} 遺失物第${reiwaYear}-${seq}号`;
  }
  const year = new Date(foundDate).getFullYear();
  return `${org.name} 拾得物管理番号 ${year}-${seq}`;
};

// 受取拠点の無人ボックス番号（1〜24番）をitemIdから決定的に発行する
const generateBoxNumber = (itemId: string): number => (hashString(`box-${itemId}`) % 24) + 1;

const parseAdminItemInput = (
  data: Record<string, unknown>,
): AdminItemInput | string => {
  const title = data['title'];
  const category = data['category'];
  const description = data['description'];
  const foundLocation = data['foundLocation'];
  const foundMonth = data['foundMonth'];
  const pickupLocation = data['pickupLocation'];
  const startPrice = data['startPrice'];
  const endTime = data['endTime'];
  const imageUrlRaw = data['imageUrl'];
  const conditionRank = data['conditionRank'];
  const quantity = data['quantity'];
  const foundDate = data['foundDate'];
  const accessoriesRaw = data['accessories'];
  const sizeRaw = data['size'];
  const colorRaw = data['color'];
  const brandRaw = data['brand'];

  if (typeof title !== 'string' || title.trim() === '' || title.length > 60) {
    return '品名は1〜60文字で入力してください';
  }
  if (!isItemCategory(category)) return 'カテゴリを選択してください';
  if (typeof description !== 'string' || description.length > 300) {
    return '状態説明は300文字以内で入力してください';
  }
  if (typeof foundLocation !== 'string' || foundLocation.trim() === '') {
    return '発見場所を入力してください';
  }
  if (typeof foundMonth !== 'string' || !/^\d{4}-\d{2}$/.test(foundMonth)) {
    return '拾得時期を選択してください';
  }
  if (typeof pickupLocation !== 'string' || pickupLocation.trim() === '') {
    return '受取拠点を入力してください';
  }
  if (
    typeof startPrice !== 'number' ||
    !Number.isInteger(startPrice) ||
    startPrice < 1 ||
    startPrice > 1_000_000
  ) {
    return '開始価格は1〜1,000,000円の整数で入力してください';
  }
  if (typeof endTime !== 'string' || Number.isNaN(new Date(endTime).getTime())) {
    return '終了日時を選択してください';
  }
  if (imageUrlRaw !== undefined && typeof imageUrlRaw !== 'string') {
    return '画像URLが不正です';
  }
  const imageUrl = typeof imageUrlRaw === 'string' && imageUrlRaw.trim() !== ''
    ? imageUrlRaw.trim()
    : undefined;
  if (!isConditionRank(conditionRank)) {
    return '状態ランクを選択してください';
  }
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  ) {
    return '数量は1〜99の整数で入力してください';
  }
  if (typeof foundDate !== 'string' || Number.isNaN(new Date(foundDate).getTime())) {
    return '拾得日を選択してください';
  }
  const toOptionalText = (raw: unknown): string | undefined =>
    typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;

  return {
    title: title.trim(),
    category,
    description,
    foundLocation: foundLocation.trim(),
    foundMonth,
    pickupLocation: pickupLocation.trim(),
    startPrice,
    endTime: new Date(endTime).toISOString(),
    imageUrl,
    conditionRank,
    quantity,
    foundDate: new Date(foundDate).toISOString().slice(0, 10),
    accessories: toOptionalText(accessoriesRaw),
    size: toOptionalText(sizeRaw),
    color: toOptionalText(colorRaw),
    brand: toOptionalText(brandRaw),
  };
};

// ---------- 出品元（Organization）管理API ----------

const adminListOrganizations = async (): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new ScanCommand({ TableName: ORGANIZATIONS_TABLE }));
  const organizations = (result.Items ?? []).filter(isOrganization);
  organizations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(200, { organizations });
};

const parseAdminOrgInput = (data: Record<string, unknown>): AdminOrgInput | string => {
  const name = data['name'];
  const type = data['type'];
  const contactNoteRaw = data['contactNote'];

  if (typeof name !== 'string' || name.trim() === '' || name.length > 40) {
    return '出品元名は1〜40文字で入力してください';
  }
  if (!isOrgType(type)) return '出品元の種別を選択してください';
  const contactNote =
    typeof contactNoteRaw === 'string' && contactNoteRaw.trim() !== ''
      ? contactNoteRaw.trim()
      : undefined;

  return { name: name.trim(), type, contactNote };
};

const adminCreateOrganization = async (body: string | null): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminOrgInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const orgId = `org-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const organization: Organization = {
    orgId,
    ...input,
    createdAt: new Date().toISOString(),
  };
  await doc.send(new PutCommand({ TableName: ORGANIZATIONS_TABLE, Item: organization }));
  return json(201, { organization });
};

const adminCreateItem = async (body: string | null): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminItemInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const orgId = data['orgId'];
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    return json(400, { message: '出品元を選択してください' });
  }
  const orgResult = await doc.send(
    new GetCommand({ TableName: ORGANIZATIONS_TABLE, Key: { orgId } }),
  );
  const org: unknown = orgResult.Item;
  if (!isOrganization(org)) return json(404, { message: '出品元が見つかりません' });

  const itemId = `i-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const item: LostItem = {
    itemId,
    ...input,
    currentPrice: input.startPrice,
    bidCount: 0,
    status: 'active',
    noticeDate: addDays(input.foundDate, NOTICE_WINDOW_DAYS),
    custodyEndDate: addDays(input.foundDate, CUSTODY_PERIOD_DAYS),
    caseNumber: generateCaseNumber(org, itemId, input.foundDate),
    orgId: org.orgId,
    orgName: org.name,
    orgType: org.type,
  };
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: item }));
  return json(201, { item });
};

const adminUpdateItem = async (
  itemId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminItemInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const existing: unknown = itemResult.Item;
  if (!isLostItem(existing)) return json(404, { message: '出品が見つかりません' });
  if (existing.status !== 'active') {
    return json(409, { message: '終了済みの出品は編集できません' });
  }
  if (existing.bidCount > 0 && input.startPrice !== existing.startPrice) {
    return json(409, { message: '入札がある出品の開始価格は変更できません' });
  }

  const updated: LostItem = {
    ...existing,
    ...input,
    currentPrice: existing.bidCount === 0 ? input.startPrice : existing.currentPrice,
    noticeDate: addDays(input.foundDate, NOTICE_WINDOW_DAYS),
    custodyEndDate: addDays(input.foundDate, CUSTODY_PERIOD_DAYS),
  };
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
  return json(200, { item: updated });
};

const adminCloseItem = async (itemId: string): Promise<APIGatewayProxyResult> => {
  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.status !== 'active') return json(409, { message: 'すでに終了しています' });
  if (item.bidCount === 0) {
    return json(409, { message: '入札がないため落札確定できません' });
  }

  const bidsResult = await doc.send(
    new QueryCommand({
      TableName: BIDS_TABLE,
      KeyConditionExpression: 'itemId = :id',
      ExpressionAttributeValues: { ':id': itemId },
      ScanIndexForward: false,
      Limit: 50,
    }),
  );
  const bids = (bidsResult.Items ?? []).filter(
    (b): b is Bid =>
      isRecord(b) && typeof b['amount'] === 'number' && typeof b['bidderSub'] === 'string',
  );
  const winner = bids.find((b) => b.amount === item.currentPrice) ?? bids[0];
  if (winner === undefined) {
    return json(409, { message: '入札情報が見つかりません' });
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + PICKUP_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  const updated: LostItem = {
    ...item,
    status: 'sold',
    endTime: now.toISOString(),
    soldAt: now.toISOString(),
    winnerSub: winner.bidderSub,
    winnerNickname: winner.bidderName,
    pickupStatus: 'awaiting',
    pickupDeadline: deadline.toISOString(),
  };
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
  return json(200, { item: updated });
};

const adminCompletePickup = async (
  itemId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  const code = data?.['code'];
  if (typeof code !== 'string' || code.trim() === '') {
    return json(400, { message: '受取コードを入力してください' });
  }

  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.pickupStatus !== 'reserved') {
    return json(409, { message: '受取予約がされていません' });
  }
  if (item.pickupCode !== code.trim()) {
    return json(409, { message: '受取コードが一致しません' });
  }

  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression: 'SET pickupStatus = :completed',
      ExpressionAttributeValues: { ':completed': 'completed' },
    }),
  );
  return json(200, { pickupStatus: 'completed' });
};

const adminImageUploadUrl = async (body: string | null): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });

  const itemId = data['itemId'];
  const contentType = data['contentType'];
  if (typeof itemId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(itemId)) {
    return json(400, { message: '出品IDが不正です' });
  }
  if (typeof contentType !== 'string' || !(contentType in ALLOWED_IMAGE_TYPES)) {
    return json(400, { message: '画像形式はJPEG・PNG・WEBPのいずれかにしてください' });
  }

  const ext = ALLOWED_IMAGE_TYPES[contentType];
  // CloudFrontはパスをそのままS3オブジェクトキーとして origin に転送するため、
  // キー自体に配信パス（uploads/）を含めておく。
  const key = `uploads/items/${itemId}/${Date.now()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: IMAGES_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_EXPIRY_SECONDS },
  );

  return json(200, { uploadUrl, imageUrl: `/${key}` });
};

const isBidRecord = (value: unknown): value is Bid =>
  isRecord(value) &&
  typeof value['itemId'] === 'string' &&
  typeof value['bidId'] === 'string' &&
  typeof value['bidderName'] === 'string' &&
  typeof value['bidderSub'] === 'string' &&
  typeof value['amount'] === 'number' &&
  typeof value['createdAt'] === 'string';

const adminBidMonitor = async (): Promise<APIGatewayProxyResult> => {
  // デモ規模のため全件Scan（実運用ではGSI/ストリーム集計に置き換える想定）
  const bids: Bid[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({ TableName: BIDS_TABLE, ExclusiveStartKey: lastKey }),
    );
    bids.push(...(result.Items ?? []).filter(isBidRecord));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey !== undefined);

  const items = await scanAllItems();
  const titleById = new Map(items.map((item) => [item.itemId, item.title]));

  // IP → 利用アカウント集合（サクラアカウント検知用）
  const subsByIp = new Map<string, Set<string>>();
  for (const bid of bids) {
    const ip = bid.sourceIp ?? '';
    if (ip === '') continue;
    const set = subsByIp.get(ip) ?? new Set<string>();
    set.add(bid.bidderSub);
    subsByIp.set(ip, set);
  }

  const byBidder = new Map<string, Bid[]>();
  for (const bid of bids) {
    const list = byBidder.get(bid.bidderSub) ?? [];
    list.push(bid);
    byBidder.set(bid.bidderSub, list);
  }

  const bidders: BidderSummary[] = [...byBidder.entries()].map(([sub, list]) => {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const timestamps = sorted.map((b) => new Date(b.createdAt).getTime());
    let rapidBids = false;
    for (let i = 0; i + RAPID_BID_COUNT - 1 < timestamps.length; i += 1) {
      const first = timestamps[i];
      const last = timestamps[i + RAPID_BID_COUNT - 1];
      if (first !== undefined && last !== undefined && last - first <= RAPID_BID_WINDOW_MS) {
        rapidBids = true;
        break;
      }
    }
    const ips = [...new Set(list.map((b) => b.sourceIp ?? '').filter((ip) => ip !== ''))];
    const sharedIp = ips.some((ip) => (subsByIp.get(ip)?.size ?? 0) >= 2);
    const lastBid = sorted[sorted.length - 1];
    return {
      bidderSub: sub,
      bidderName: lastBid?.bidderName ?? '不明',
      bidCount: list.length,
      itemCount: new Set(list.map((b) => b.itemId)).size,
      ips,
      lastBidAt: lastBid?.createdAt ?? '',
      flags: { sharedIp, rapidBids },
    };
  });

  bidders.sort((a, b) => {
    const flagsA = (a.flags.sharedIp ? 1 : 0) + (a.flags.rapidBids ? 1 : 0);
    const flagsB = (b.flags.sharedIp ? 1 : 0) + (b.flags.rapidBids ? 1 : 0);
    if (flagsA !== flagsB) return flagsB - flagsA;
    return b.bidCount - a.bidCount;
  });

  const recentBids = [...bids]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((bid) => ({
      bidId: bid.bidId,
      itemId: bid.itemId,
      itemTitle: titleById.get(bid.itemId) ?? bid.itemId,
      bidderName: bid.bidderName,
      bidderSub: bid.bidderSub,
      amount: bid.amount,
      createdAt: bid.createdAt,
      sourceIp: bid.sourceIp ?? '',
    }));

  return json(200, { bidders, recentBids });
};

const adminDeleteItem = async (itemId: string): Promise<APIGatewayProxyResult> => {
  const bidKeys: { itemId: string; bidId: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: BIDS_TABLE,
        KeyConditionExpression: 'itemId = :id',
        ExpressionAttributeValues: { ':id': itemId },
        ProjectionExpression: 'itemId, bidId',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const record of result.Items ?? []) {
      if (isRecord(record) && typeof record['bidId'] === 'string') {
        bidKeys.push({ itemId, bidId: record['bidId'] });
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey !== undefined);

  for (let i = 0; i < bidKeys.length; i += 25) {
    const group = bidKeys.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [BIDS_TABLE]: group.map((key) => ({ DeleteRequest: { Key: key } })),
        },
      }),
    );
  }

  await doc.send(
    new BatchWriteCommand({
      RequestItems: {
        [ITEMS_TABLE]: [{ DeleteRequest: { Key: { itemId } } }],
      },
    }),
  );
  return json(200, { deleted: itemId, deletedBids: bidKeys.length });
};

// ---------- ルーティング ----------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const segments = event.path.split('/').filter((s) => s.length > 0);
    const method = event.httpMethod.toUpperCase();

    if (segments[0] !== 'api') return json(404, { message: 'Not Found' });

    // --- 公開 ---
    if (segments[1] === 'config' && segments.length === 2 && method === 'GET') {
      return getConfig();
    }
    if (segments[1] === 'items' && segments.length === 2 && method === 'GET') {
      return await getItems(event.queryStringParameters);
    }
    if (segments[1] === 'items' && segments.length === 3 && method === 'GET') {
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await getItemDetail(decodeURIComponent(itemId));
    }
    if (segments[1] === 'stats' && segments.length === 2 && method === 'GET') {
      return await getStats();
    }

    // --- ここから認証必須 ---
    const authHeader = event.headers['Authorization'] ?? event.headers['authorization'];
    const user = await authenticate(authHeader);

    if (
      segments[1] === 'items' &&
      segments.length === 4 &&
      segments[3] === 'bids' &&
      method === 'POST'
    ) {
      if (user === null) return json(401, { message: '入札にはログインが必要です' });
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await placeBid(decodeURIComponent(itemId), event, user);
    }

    if (
      segments[1] === 'items' &&
      segments.length === 4 &&
      segments[3] === 'pickup-reservation' &&
      method === 'POST'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await reservePickup(decodeURIComponent(itemId), event.body, user);
    }

    if (
      segments[1] === 'items' &&
      segments.length === 4 &&
      segments[3] === 'pickup-self-complete' &&
      method === 'POST'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await selfCompletePickup(decodeURIComponent(itemId), user);
    }

    if (
      segments[1] === 'me' &&
      segments[2] === 'wins' &&
      segments.length === 3 &&
      method === 'GET'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      return await getMyWins(user);
    }

    // --- 管理者 ---
    if (segments[1] === 'admin') {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      if (!user.isAdmin) return json(403, { message: '管理者権限がありません' });

      if (segments[2] === 'bid-monitor' && segments.length === 3 && method === 'GET') {
        return await adminBidMonitor();
      }
      if (segments[2] === 'images' && segments[3] === 'upload-url' && segments.length === 4 && method === 'POST') {
        return await adminImageUploadUrl(event.body);
      }
      if (segments[2] === 'organizations' && segments.length === 3) {
        if (method === 'GET') return await adminListOrganizations();
        if (method === 'POST') return await adminCreateOrganization(event.body);
      }
      if (segments[2] === 'items' && segments.length === 3 && method === 'POST') {
        return await adminCreateItem(event.body);
      }
      const itemId = segments[3];
      if (segments[2] === 'items' && segments.length === 4 && itemId !== undefined) {
        if (method === 'PUT') return await adminUpdateItem(decodeURIComponent(itemId), event.body);
        if (method === 'DELETE') return await adminDeleteItem(decodeURIComponent(itemId));
      }
      if (
        segments[2] === 'items' &&
        segments.length === 5 &&
        itemId !== undefined &&
        method === 'POST'
      ) {
        if (segments[4] === 'close') return await adminCloseItem(decodeURIComponent(itemId));
        if (segments[4] === 'pickup-complete') {
          return await adminCompletePickup(decodeURIComponent(itemId), event.body);
        }
      }
    }

    return json(404, { message: 'Not Found' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Unhandled error:', message, error);
    return json(500, { message: 'サーバー内部でエラーが発生しました' });
  }
};
