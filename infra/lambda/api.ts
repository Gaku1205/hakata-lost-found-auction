import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
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
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import Anthropic from '@anthropic-ai/sdk';
import { CloudFormationClient, DescribeStacksCommand, DescribeStackResourcesCommand, DescribeStackEventsCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { authenticate, type AuthUser } from './auth';
import {
  CONDITION_ORDER,
  ITEM_CATEGORIES,
  MAX_ITEM_IMAGES,
  isConditionRank,
  isItemCategory,
  isOrgType,
  isSortKey,
  type AdminItemInput,
  type ItemSuggestion,
  type AdminOrgInput,
  type Bid,
  type BidderSummary,
  type Favorite,
  type Inquiry,
  type LostItem,
  type Organization,
  type PartnerApplication,
  type PartnerApplicationInput,
  type SortKey,
  type Stats,
} from './types';

const ITEMS_TABLE = process.env.ITEMS_TABLE ?? '';
const BIDS_TABLE = process.env.BIDS_TABLE ?? '';
const BIDDER_INDEX = process.env.BIDDER_INDEX ?? '';
const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE ?? '';
const PARTNER_APPLICATIONS_TABLE = process.env.PARTNER_APPLICATIONS_TABLE ?? '';
const FAVORITES_TABLE = process.env.FAVORITES_TABLE ?? '';
const INQUIRIES_TABLE = process.env.INQUIRIES_TABLE ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';
const ANTHROPIC_API_KEY_SECRET_ARN = process.env.ANTHROPIC_API_KEY_SECRET_ARN ?? '';

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
const cfn = new CloudFormationClient({});
const secrets = new SecretsManagerClient({});
const cognitoIdp = new CognitoIdentityProviderClient({});

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

export const isLostItem = (value: unknown): value is LostItem => {
  if (!isRecord(value)) return false;
  return (
    typeof value['itemId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['currentPrice'] === 'number' &&
    typeof value['status'] === 'string' &&
    typeof value['endTime'] === 'string'
  );
};

export const isOrganization = (value: unknown): value is Organization => {
  if (!isRecord(value)) return false;
  return (
    typeof value['orgId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string'
  );
};

const isPartnerApplication = (value: unknown): value is PartnerApplication => {
  if (!isRecord(value)) return false;
  return (
    typeof value['applicationId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['status'] === 'string'
  );
};

const isInquiry = (value: unknown): value is Inquiry => {
  if (!isRecord(value)) return false;
  return (
    typeof value['inquiryId'] === 'string' &&
    typeof value['orgId'] === 'string' &&
    typeof value['message'] === 'string' &&
    typeof value['status'] === 'string'
  );
};

export const parseBody = (body: string | null): Record<string, unknown> | null => {
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

const batchGetItems = async (itemIds: readonly string[]): Promise<LostItem[]> => {
  const items: LostItem[] = [];
  for (let i = 0; i < itemIds.length; i += 100) {
    const chunk = itemIds.slice(i, i + 100);
    const result = await doc.send(
      new BatchGetCommand({
        RequestItems: { [ITEMS_TABLE]: { Keys: chunk.map((itemId) => ({ itemId })) } },
      }),
    );
    items.push(...(result.Responses?.[ITEMS_TABLE] ?? []).filter(isLostItem));
  }
  return items;
};

const extractItemIds = (records: readonly unknown[]): string[] =>
  records
    .filter((r): r is Record<string, unknown> => isRecord(r) && typeof r['itemId'] === 'string')
    .map((r) => r['itemId'] as string);

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

export const parseSearchQuery = (
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

export const compareBySort = (sort: SortKey) => (a: LostItem, b: LostItem): number => {
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

const getItemDetail = async (
  itemId: string,
  user: AuthUser | null,
): Promise<APIGatewayProxyResult> => {
  const [itemResult, bidsResult, favoriteResult] = await Promise.all([
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
    user !== null
      ? doc.send(new GetCommand({ TableName: FAVORITES_TABLE, Key: { userSub: user.sub, itemId } }))
      : Promise.resolve(null),
  ]);
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) {
    return json(404, { message: '出品が見つかりません' });
  }
  const isFavorited = favoriteResult !== null && favoriteResult.Item !== undefined;
  return json(200, { item, bids: bidsResult.Items ?? [], isFavorited });
};

const computeStats = (items: readonly LostItem[]): Stats =>
  items.reduce<Stats>(
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

const adminGetStats = async (): Promise<APIGatewayProxyResult> => {
  const items = await scanAllItems();
  return json(200, computeStats(items));
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
  if (user.isOrg) {
    return json(403, { message: '出品元アカウントは入札できません' });
  }

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

// 自分が入札したことのある出品のうち、まだ受付中のものを返す（「入札中」タブ用）
const getMyActiveBids = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  const bidsResult = await doc.send(
    new QueryCommand({
      TableName: BIDS_TABLE,
      IndexName: BIDDER_INDEX,
      KeyConditionExpression: 'bidderSub = :sub',
      ExpressionAttributeValues: { ':sub': user.sub },
    }),
  );
  const itemIds = [...new Set(extractItemIds(bidsResult.Items ?? []))];
  const items = (await batchGetItems(itemIds))
    .filter((item) => item.status === 'active')
    .sort((a, b) => a.endTime.localeCompare(b.endTime));
  return json(200, { items });
};

const putFavorite = async (itemId: string, user: AuthUser): Promise<APIGatewayProxyResult> => {
  const itemResult = await doc.send(new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }));
  if (!isLostItem(itemResult.Item)) return json(404, { message: '出品が見つかりません' });

  const favorite: Favorite = { userSub: user.sub, itemId, createdAt: new Date().toISOString() };
  await doc.send(new PutCommand({ TableName: FAVORITES_TABLE, Item: favorite }));
  return json(200, { favorited: true });
};

const deleteFavorite = async (itemId: string, user: AuthUser): Promise<APIGatewayProxyResult> => {
  await doc.send(
    new DeleteCommand({ TableName: FAVORITES_TABLE, Key: { userSub: user.sub, itemId } }),
  );
  return json(200, { favorited: false });
};

const getMyFavorites = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(
    new QueryCommand({
      TableName: FAVORITES_TABLE,
      KeyConditionExpression: 'userSub = :sub',
      ExpressionAttributeValues: { ':sub': user.sub },
    }),
  );
  const itemIds = extractItemIds(result.Items ?? []);
  const items = (await batchGetItems(itemIds)).sort((a, b) => a.endTime.localeCompare(b.endTime));
  return json(200, { items });
};

// ---------- 出品元（org）API ----------

const getOrgItems = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const items = await scanAllItems();
  const mine = items
    .filter((item) => item.orgId === user.orgId)
    .sort((a, b) => b.endTime.localeCompare(a.endTime));
  return json(200, { items: mine });
};

// 出品元が「受け取り拠点へ現物を納品した」ことを確認する。購入者側の受け取り確認（pickupStatus）とは
// 独立して管理し、両方が揃った時点でフロントエンドが「受け渡し完了（双方確認済み）」として表示する。
const orgConfirmHandover = async (
  itemId: string,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const itemResult = await doc.send(new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }));
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.orgId !== user.orgId) {
    return json(403, { message: 'この出品元が登録した商品ではありません' });
  }
  if (item.status !== 'sold') {
    return json(409, { message: 'まだ落札されていません' });
  }
  if (item.orgHandoverAt !== undefined) {
    return json(409, { message: 'すでに納品済みです' });
  }

  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression: 'SET orgHandoverAt = :now',
      ExpressionAttributeValues: { ':now': now },
    }),
  );
  return json(200, { orgHandoverAt: now });
};

const getOrgStats = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const items = await scanAllItems();
  const mine = items.filter((item) => item.orgId === user.orgId);
  return json(200, computeStats(mine));
};

const INQUIRY_MESSAGE_MAX_LENGTH = 1000;

const submitOrgInquiry = async (
  body: string | null,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const data = parseBody(body);
  const messageRaw = data?.['message'];
  if (typeof messageRaw !== 'string' || messageRaw.trim() === '') {
    return json(400, { message: 'お問い合わせ内容を入力してください' });
  }
  if (messageRaw.trim().length > INQUIRY_MESSAGE_MAX_LENGTH) {
    return json(400, {
      message: `お問い合わせ内容は${INQUIRY_MESSAGE_MAX_LENGTH}文字以内で入力してください`,
    });
  }

  const orgResult = await doc.send(
    new GetCommand({ TableName: ORGANIZATIONS_TABLE, Key: { orgId: user.orgId } }),
  );
  const org: unknown = orgResult.Item;
  if (!isOrganization(org)) return json(404, { message: '出品元情報が見つかりません' });

  const inquiryId = `inq-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const inquiry: Inquiry = {
    inquiryId,
    orgId: user.orgId,
    orgName: org.name,
    fromSub: user.sub,
    message: messageRaw.trim(),
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  await doc.send(new PutCommand({ TableName: INQUIRIES_TABLE, Item: inquiry }));
  return json(201, { inquiry });
};

const getOrgInquiries = async (user: AuthUser): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const result = await doc.send(new ScanCommand({ TableName: INQUIRIES_TABLE }));
  const inquiries = (result.Items ?? [])
    .filter(isInquiry)
    .filter((inquiry) => inquiry.orgId === user.orgId);
  inquiries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { inquiries });
};

const generatePickupCode = (): string =>
  String(Math.floor(100000 + Math.random() * 900000));

// ダミー決済: 実際の課金・カード情報の送受信は行わず、支払い済み状態へ遷移させるのみ
const payForItem = async (itemId: string, user: AuthUser): Promise<APIGatewayProxyResult> => {
  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const item: unknown = itemResult.Item;
  if (!isLostItem(item)) return json(404, { message: '出品が見つかりません' });
  if (item.winnerSub !== user.sub) {
    return json(403, { message: 'この物品の落札者ではありません' });
  }
  if (item.status !== 'sold') {
    return json(409, { message: 'まだ落札が確定していません' });
  }
  if (item.paymentStatus === 'paid') {
    return json(409, { message: 'すでに支払いが完了しています' });
  }

  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression: 'SET paymentStatus = :paid, paidAt = :now',
      ExpressionAttributeValues: { ':paid': 'paid', ':now': now },
    }),
  );
  return json(200, { paymentStatus: 'paid', paidAt: now });
};

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
  if (item.paymentStatus !== 'paid') {
    return json(403, { message: '支払いが完了していません。先にお支払いを行ってください' });
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

export const hashString = (value: string): number => {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
};

// itemIdから決定的に整理番号を発行する（同じitemIdなら常に同じ番号）
// 警察・自治体は遺失物法の「遺失物第X号」形式、企業は施設占有者拾得の管理番号形式にする
export const generateCaseNumber = (org: Organization, itemId: string, foundDate: string): string => {
  const seq = (hashString(itemId) % 9000) + 1000;
  if (org.type === 'police') {
    const reiwaYear = new Date(foundDate).getFullYear() - 2018;
    return `${org.name} 遺失物第${reiwaYear}-${seq}号`;
  }
  const year = new Date(foundDate).getFullYear();
  return `${org.name} 拾得物管理番号 ${year}-${seq}`;
};

// 受取拠点の無人ボックス番号（1〜24番）をitemIdから決定的に発行する
export const generateBoxNumber = (itemId: string): number => (hashString(`box-${itemId}`) % 24) + 1;

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
  const imageUrlsRaw = data['imageUrls'];
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
  if (
    imageUrlsRaw !== undefined &&
    (!Array.isArray(imageUrlsRaw) ||
      imageUrlsRaw.length > MAX_ITEM_IMAGES ||
      imageUrlsRaw.some((url) => typeof url !== 'string' || url.trim() === ''))
  ) {
    return `画像は${MAX_ITEM_IMAGES}枚まで登録できます`;
  }
  const imageUrls =
    Array.isArray(imageUrlsRaw) && imageUrlsRaw.length > 0
      ? (imageUrlsRaw as string[]).map((url) => url.trim())
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
    imageUrls,
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

// 出品元アカウントのログインを発行する（新規作成時・既存出品元への後付けの両方から利用）。
// 招待メールは送らず、管理者が控えたメール・初期パスワードを直接共有する運用（seed-data.tsのensureUserと同じ方式）
const adminProvisionOrgLogin = async (
  orgId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const emailRaw = data['email'];
  const passwordRaw = data['password'];
  if (typeof emailRaw !== 'string' || !EMAIL_PATTERN.test(emailRaw.trim())) {
    return json(400, { message: 'メールアドレスの形式が正しくありません' });
  }
  if (typeof passwordRaw !== 'string' || passwordRaw.length < 8) {
    return json(400, { message: 'パスワードは8文字以上で入力してください' });
  }

  const orgResult = await doc.send(new GetCommand({ TableName: ORGANIZATIONS_TABLE, Key: { orgId } }));
  const org: unknown = orgResult.Item;
  if (!isOrganization(org)) return json(404, { message: '出品元が見つかりません' });
  if (org.loginSub !== undefined) {
    return json(409, { message: 'この出品元はすでにログインが発行されています' });
  }

  const email = emailRaw.trim();
  let loginSub: string;
  try {
    const createResult = await cognitoIdp.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'nickname', Value: org.name },
          { Name: 'custom:orgId', Value: orgId },
        ],
      }),
    );
    const subAttr = createResult.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (subAttr === undefined) return json(500, { message: 'アカウント作成に失敗しました' });
    loginSub = subAttr;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'アカウント作成に失敗しました';
    return json(409, { message });
  }

  await cognitoIdp.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: passwordRaw,
      Permanent: true,
    }),
  );
  await cognitoIdp.send(
    new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: 'org' }),
  );
  await doc.send(
    new UpdateCommand({
      TableName: ORGANIZATIONS_TABLE,
      Key: { orgId },
      UpdateExpression: 'SET loginSub = :sub',
      ExpressionAttributeValues: { ':sub': loginSub },
    }),
  );

  return json(201, { loginSub, email });
};

// ---------- 出品元 申し込み（PartnerApplication）API ----------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parsePartnerApplicationInput = (
  data: Record<string, unknown>,
): PartnerApplicationInput | string => {
  const name = data['name'];
  const type = data['type'];
  const contactName = data['contactName'];
  const contactEmail = data['contactEmail'];
  const contactPhoneRaw = data['contactPhone'];
  const messageRaw = data['message'];

  if (typeof name !== 'string' || name.trim() === '' || name.length > 40) {
    return '法人・団体名は1〜40文字で入力してください';
  }
  if (!isOrgType(type)) return '種別を選択してください';
  if (typeof contactName !== 'string' || contactName.trim() === '' || contactName.length > 40) {
    return 'ご担当者名は1〜40文字で入力してください';
  }
  if (typeof contactEmail !== 'string' || !EMAIL_PATTERN.test(contactEmail.trim())) {
    return 'メールアドレスの形式が正しくありません';
  }
  const contactPhone =
    typeof contactPhoneRaw === 'string' && contactPhoneRaw.trim() !== ''
      ? contactPhoneRaw.trim()
      : undefined;
  if (contactPhone !== undefined && contactPhone.length > 20) {
    return '電話番号が長すぎます';
  }
  const message =
    typeof messageRaw === 'string' && messageRaw.trim() !== '' ? messageRaw.trim() : undefined;
  if (message !== undefined && message.length > 500) {
    return 'お問い合わせ内容は500文字以内で入力してください';
  }

  return {
    name: name.trim(),
    type,
    contactName: contactName.trim(),
    contactEmail: contactEmail.trim(),
    contactPhone,
    message,
  };
};

const submitPartnerApplication = async (body: string | null): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parsePartnerApplicationInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const applicationId = `app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const application: PartnerApplication = {
    applicationId,
    ...input,
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  await doc.send(new PutCommand({ TableName: PARTNER_APPLICATIONS_TABLE, Item: application }));
  return json(201, { application });
};

const adminListPartnerApplications = async (): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new ScanCommand({ TableName: PARTNER_APPLICATIONS_TABLE }));
  const applications = (result.Items ?? []).filter(isPartnerApplication);
  applications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { applications });
};

const adminReviewPartnerApplication = async (
  applicationId: string,
): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(
    new GetCommand({ TableName: PARTNER_APPLICATIONS_TABLE, Key: { applicationId } }),
  );
  const application: unknown = result.Item;
  if (!isPartnerApplication(application)) return json(404, { message: '申し込みが見つかりません' });

  await doc.send(
    new UpdateCommand({
      TableName: PARTNER_APPLICATIONS_TABLE,
      Key: { applicationId },
      UpdateExpression: 'SET #st = :reviewed',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':reviewed': 'reviewed' },
    }),
  );
  return json(200, { status: 'reviewed' });
};

// ---------- 出品元からの問い合わせ（Inquiry）管理API ----------

const adminListInquiries = async (): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new ScanCommand({ TableName: INQUIRIES_TABLE }));
  const inquiries = (result.Items ?? []).filter(isInquiry);
  inquiries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { inquiries });
};

const adminReviewInquiry = async (inquiryId: string): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new GetCommand({ TableName: INQUIRIES_TABLE, Key: { inquiryId } }));
  const inquiry: unknown = result.Item;
  if (!isInquiry(inquiry)) return json(404, { message: '問い合わせが見つかりません' });

  await doc.send(
    new UpdateCommand({
      TableName: INQUIRIES_TABLE,
      Key: { inquiryId },
      UpdateExpression: 'SET #st = :reviewed',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':reviewed': 'reviewed' },
    }),
  );
  return json(200, { status: 'reviewed' });
};

const adminReplyInquiry = async (
  inquiryId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  const messageRaw = data?.['message'];
  if (typeof messageRaw !== 'string' || messageRaw.trim() === '') {
    return json(400, { message: '返信内容を入力してください' });
  }
  if (messageRaw.trim().length > INQUIRY_MESSAGE_MAX_LENGTH) {
    return json(400, {
      message: `返信内容は${INQUIRY_MESSAGE_MAX_LENGTH}文字以内で入力してください`,
    });
  }

  const result = await doc.send(new GetCommand({ TableName: INQUIRIES_TABLE, Key: { inquiryId } }));
  const inquiry: unknown = result.Item;
  if (!isInquiry(inquiry)) return json(404, { message: '問い合わせが見つかりません' });

  const repliedAt = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: INQUIRIES_TABLE,
      Key: { inquiryId },
      UpdateExpression: 'SET #st = :reviewed, replyMessage = :reply, repliedAt = :repliedAt',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':reviewed': 'reviewed',
        ':reply': messageRaw.trim(),
        ':repliedAt': repliedAt,
      },
    }),
  );
  return json(200, { status: 'reviewed', replyMessage: messageRaw.trim(), repliedAt });
};

const buildNewItem = (input: AdminItemInput, org: Organization): LostItem => {
  const itemId = `i-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
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
};

const applyItemUpdate = (existing: LostItem, input: AdminItemInput): LostItem => ({
  ...existing,
  ...input,
  currentPrice: existing.bidCount === 0 ? input.startPrice : existing.currentPrice,
  noticeDate: addDays(input.foundDate, NOTICE_WINDOW_DAYS),
  custodyEndDate: addDays(input.foundDate, CUSTODY_PERIOD_DAYS),
});

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

  const item = buildNewItem(input, org);
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

  const updated = applyItemUpdate(existing, input);
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
  return json(200, { item: updated });
};

// 出品元(org)アカウント自身による出品の作成・編集。管理者による代理登録（adminCreateItem/adminUpdateItem）と
// 同じ入力バリデーション・データ形状を使うが、出品元IDはリクエスト値ではなくログインユーザーのorgIdから決める。
const orgCreateItem = async (
  user: AuthUser,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminItemInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const orgResult = await doc.send(
    new GetCommand({ TableName: ORGANIZATIONS_TABLE, Key: { orgId: user.orgId } }),
  );
  const org: unknown = orgResult.Item;
  if (!isOrganization(org)) return json(404, { message: '出品元が見つかりません' });

  const item = buildNewItem(input, org);
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: item }));
  return json(201, { item });
};

const orgUpdateItem = async (
  user: AuthUser,
  itemId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  if (user.orgId === undefined) {
    return json(403, { message: 'このアカウントには出品元が紐づいていません' });
  }
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminItemInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const itemResult = await doc.send(
    new GetCommand({ TableName: ITEMS_TABLE, Key: { itemId } }),
  );
  const existing: unknown = itemResult.Item;
  if (!isLostItem(existing)) return json(404, { message: '出品が見つかりません' });
  if (existing.orgId !== user.orgId) {
    return json(403, { message: 'この出品元が登録した商品ではありません' });
  }
  if (existing.status !== 'active') {
    return json(409, { message: '終了済みの出品は編集できません' });
  }
  if (existing.bidCount > 0 && input.startPrice !== existing.startPrice) {
    return json(409, { message: '入札がある出品の開始価格は変更できません' });
  }

  const updated = applyItemUpdate(existing, input);
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
  return json(200, { item: updated });
};

const queryBidsDesc = async (itemId: string, limit: number): Promise<Bid[]> => {
  const bidsResult = await doc.send(
    new QueryCommand({
      TableName: BIDS_TABLE,
      KeyConditionExpression: 'itemId = :id',
      ExpressionAttributeValues: { ':id': itemId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (bidsResult.Items ?? []).filter(
    (b): b is Bid =>
      isRecord(b) && typeof b['amount'] === 'number' && typeof b['bidderSub'] === 'string',
  );
};

// 入札から落札者を決定し、落札済み状態のアイテムを組み立てる（手動確定・自動確定の両方から利用）
export const finalizeSoldItem = (item: LostItem, bids: readonly Bid[], now: Date): LostItem | null => {
  const winner = bids.find((b) => b.amount === item.currentPrice) ?? bids[0];
  if (winner === undefined) return null;

  const deadline = new Date(now.getTime() + PICKUP_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  return {
    ...item,
    status: 'sold',
    endTime: now.toISOString(),
    soldAt: now.toISOString(),
    winnerSub: winner.bidderSub,
    winnerNickname: winner.bidderName,
    paymentStatus: 'unpaid',
    pickupStatus: 'awaiting',
    pickupDeadline: deadline.toISOString(),
  };
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

  const bids = await queryBidsDesc(itemId, 50);
  const updated = finalizeSoldItem(item, bids, new Date());
  if (updated === null) {
    return json(409, { message: '入札情報が見つかりません' });
  }
  await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
  return json(200, { item: updated });
};

// EventBridge スケジュールから直接起動される自動終了ジョブ（API Gateway を経由しない）
export const autoCloseHandler = async (): Promise<{ closed: number }> => {
  const items = await scanAllItems();
  const nowIso = new Date().toISOString();
  const expired = items.filter(
    (item) => item.status === 'active' && item.endTime <= nowIso && item.bidCount > 0,
  );

  let closed = 0;
  for (const item of expired) {
    const bids = await queryBidsDesc(item.itemId, 50);
    const updated = finalizeSoldItem(item, bids, new Date());
    if (updated !== null) {
      await doc.send(new PutCommand({ TableName: ITEMS_TABLE, Item: updated }));
      closed += 1;
    }
  }
  if (closed > 0) {
    console.log(`auto-closed ${closed} item(s)`);
  }
  return { closed };
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

// ---------- 出品画像のAI解析 ----------

// 1枚あたりの画像サイズ上限。フロント側で長辺1024pxへ縮小してから送る想定。
const ANALYZE_IMAGE_MAX_BASE64_LENGTH = 3_000_000;
// 1リクエスト（複数枚合計）の上限。API Gatewayのペイロード上限とAI解析コストの両方を抑える。
const ANALYZE_IMAGES_MAX_TOTAL_BASE64_LENGTH = 10_000_000;

const ITEM_SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    category: { type: 'string', enum: [...ITEM_CATEGORIES] },
    conditionRank: { type: 'string', enum: [...CONDITION_ORDER] },
    description: { type: 'string' },
    color: { type: 'string' },
    brand: { type: 'string' },
    size: { type: 'string' },
    accessories: { type: 'string' },
  },
  required: ['title', 'category', 'conditionRank', 'description', 'color', 'brand', 'size', 'accessories'],
  additionalProperties: false,
};

const ANALYZE_SYSTEM_PROMPT = `あなたは遺失物オークション「めぐりモノ」の出品担当者です。
落とし物の写真から、出品フォームの各項目を日本語で埋めてください。
同一の落とし物を複数アングルから撮った写真が渡されることがあります。その場合は
すべての写真を突き合わせて1つの落とし物についての情報として統合し、写真ごとに
矛盾する内容があれば全体として最も妥当な1つの値にまとめてください。

- title: 検索されやすい具体的な品名。40文字以内。「黒 折りたたみ傘（自動開閉）」のように特徴を含める。
- category: 選択肢から最も近いものを1つ選ぶ。
- conditionRank: 写真から見て取れる状態。like_new=ほぼ未使用、good=良好、used=使用感あり、damaged=傷や汚れが明確。
- description: 落札を検討する人が知りたい情報（素材・形状・使用感・目立つ傷や汚れ）を200文字以内で客観的に。断定できない点は書かない。
- color: 主な色。例「ネイビー」「ブラック×シルバー」。
- brand: ロゴや型番から確実に読み取れる場合のみ記入。推測しない。
- size: 寸法や規格が判断できる場合のみ。例「約60cm」「Mサイズ」。
- accessories: 写真に一緒に写っている付属品。例「専用ケース」「充電ケーブル」。

写真から判断できない項目は必ず空文字にしてください。推測で埋めないこと。
遺失物なので所有者を特定しうる情報（氏名・住所・口座番号・書類の記載内容など）は一切書かないでください。`;

let cachedAnthropicApiKey: string | null = null;

const getAnthropicApiKey = async (): Promise<string> => {
  if (cachedAnthropicApiKey !== null) return cachedAnthropicApiKey;
  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: ANTHROPIC_API_KEY_SECRET_ARN }),
  );
  const value = result.SecretString;
  if (value === undefined || value.trim() === '') {
    throw new Error('Anthropic APIキーが未設定です');
  }
  cachedAnthropicApiKey = value.trim();
  return cachedAnthropicApiKey;
};

const isItemSuggestion = (value: unknown): value is ItemSuggestion =>
  isRecord(value) &&
  typeof value['title'] === 'string' &&
  isItemCategory(value['category']) &&
  isConditionRank(value['conditionRank']) &&
  typeof value['description'] === 'string' &&
  typeof value['color'] === 'string' &&
  typeof value['brand'] === 'string' &&
  typeof value['size'] === 'string' &&
  typeof value['accessories'] === 'string';

const clip = (value: string, max: number): string => value.trim().slice(0, max);

type AnalyzableMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const isAnalyzableMediaType = (value: unknown): value is AnalyzableMediaType =>
  value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';

type AnalyzableImage = { imageBase64: string; mediaType: AnalyzableMediaType };

const isAnalyzableImage = (value: unknown): value is AnalyzableImage =>
  isRecord(value) &&
  typeof value['imageBase64'] === 'string' &&
  value['imageBase64'] !== '' &&
  isAnalyzableMediaType(value['mediaType']);

// 出品画像（1〜複数枚）をClaudeに渡し、出品フォームの各項目を推定して返す。管理者・出品元の双方が利用する。
const analyzeItemImage = async (body: string | null): Promise<APIGatewayProxyResult> => {
  if (ANTHROPIC_API_KEY_SECRET_ARN === '') {
    return json(503, { message: 'AI解析は現在利用できません' });
  }
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });

  const imagesRaw = data['images'];
  if (!Array.isArray(imagesRaw) || imagesRaw.length === 0) {
    return json(400, { message: '画像が指定されていません' });
  }
  if (imagesRaw.length > MAX_ITEM_IMAGES) {
    return json(400, { message: `画像は${MAX_ITEM_IMAGES}枚まで指定できます` });
  }
  if (!imagesRaw.every(isAnalyzableImage)) {
    return json(400, { message: '画像形式はJPEG・PNG・WEBPのいずれかにしてください' });
  }
  const images = imagesRaw as AnalyzableImage[];
  if (images.some((image) => image.imageBase64.length > ANALYZE_IMAGE_MAX_BASE64_LENGTH)) {
    return json(413, { message: '画像サイズが大きすぎます' });
  }
  const totalBase64Length = images.reduce((sum, image) => sum + image.imageBase64.length, 0);
  if (totalBase64Length > ANALYZE_IMAGES_MAX_TOTAL_BASE64_LENGTH) {
    return json(413, { message: '画像サイズの合計が大きすぎます' });
  }

  let apiKey: string;
  try {
    apiKey = await getAnthropicApiKey();
  } catch {
    return json(503, { message: 'AI解析は現在利用できません（APIキー未設定）' });
  }

  const anthropic = new Anthropic({ apiKey });
  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: ANALYZE_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: ITEM_SUGGESTION_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((image) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: image.mediaType, data: image.imageBase64 },
            })),
            {
              type: 'text',
              text:
                images.length > 1
                  ? `この${images.length}枚は同じ落とし物を複数アングルから撮った写真です。出品フォームの各項目を埋めてください。`
                  : 'この写真の落とし物について、出品フォームの各項目を埋めてください。',
            },
          ],
        },
      ],
    });
  } catch (err: unknown) {
    console.error('AI解析に失敗しました', err);
    // 認証エラーならキャッシュを捨てる。APIキーを差し替えた直後に、
    // 古い値を掴んだままのコンテナが失敗し続けるのを防ぐ。
    if (isRecord(err) && err['status'] === 401) {
      cachedAnthropicApiKey = null;
      return json(503, { message: 'AI解析は現在利用できません（APIキーが無効です）' });
    }
    return json(502, { message: 'AI解析に失敗しました。時間をおいて再度お試しください' });
  }

  if (response.stop_reason === 'refusal') {
    return json(422, { message: 'この画像は解析できませんでした。別の写真をお試しください' });
  }
  const textBlock = response.content.find((block) => block.type === 'text');
  if (textBlock === undefined || textBlock.type !== 'text') {
    return json(502, { message: 'AI解析の結果を取得できませんでした' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return json(502, { message: 'AI解析の結果を解釈できませんでした' });
  }
  if (!isItemSuggestion(parsed)) {
    return json(502, { message: 'AI解析の結果が想定した形式ではありませんでした' });
  }

  const suggestion: ItemSuggestion = {
    title: clip(parsed.title, 60),
    category: parsed.category,
    conditionRank: parsed.conditionRank,
    description: clip(parsed.description, 300),
    color: clip(parsed.color, 40),
    brand: clip(parsed.brand, 40),
    size: clip(parsed.size, 40),
    accessories: clip(parsed.accessories, 60),
  };
  return json(200, { suggestion });
};

// 画像アップロード用の署名付きURL発行。管理者・出品元の双方が自分の出品に対して利用する。
const requestImageUploadUrl = async (body: string | null): Promise<APIGatewayProxyResult> => {
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
  // キー自体に配信パス（uploads/）を含めておく。ランダムサフィックスは、
  // 複数画像を連続アップロードする際に同一ミリ秒でキーが衝突するのを防ぐため。
  const key = `uploads/items/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

const adminGetCloudFormation = async (): Promise<APIGatewayProxyResult> => {
  const stackName = 'MeguriMonoStack';
  try {
    const stackResult = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = stackResult.Stacks?.[0];
    if (!stack) return json(404, { message: 'スタックが見つかりません' });

    const resourcesResult = await cfn.send(
      new DescribeStackResourcesCommand({ StackName: stackName }),
    );
    const resources = (resourcesResult.StackResources ?? []).map((r) => ({
      logicalId: r.LogicalResourceId,
      physicalId: r.PhysicalResourceId,
      type: r.ResourceType,
      status: r.ResourceStatus,
      timestamp: r.Timestamp?.toISOString(),
    }));

    const eventsResult = await cfn.send(
      new DescribeStackEventsCommand({ StackName: stackName }),
    );
    const events = (eventsResult.StackEvents ?? [])
      .slice(0, 10)
      .map((e) => ({
        timestamp: e.Timestamp?.toISOString(),
        logicalId: e.LogicalResourceId,
        status: e.ResourceStatus,
        reason: e.ResourceStatusReason,
      }));

    return json(200, {
      stack: {
        name: stack.StackName,
        status: stack.StackStatus,
        creationTime: stack.CreationTime?.toISOString(),
        lastUpdatedTime: stack.LastUpdatedTime?.toISOString(),
      },
      resources,
      events,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CloudFormation 取得エラー';
    return json(500, { message });
  }
};

// ---------- ルーティング ----------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const segments = event.path.split('/').filter((s) => s.length > 0);
    const method = event.httpMethod.toUpperCase();

    if (segments[0] !== 'api') return json(404, { message: 'Not Found' });

    // 商品詳細のisFavorited等、公開ルートでも「ログイン済みなら」の付加情報を返したいため、
    // 認証状態はここで一度だけ確定させる（未ログインなら user は null のまま公開ルートも処理される）。
    const authHeader = event.headers['Authorization'] ?? event.headers['authorization'];
    const user = await authenticate(authHeader);

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
      return await getItemDetail(decodeURIComponent(itemId), user);
    }
    if (segments[1] === 'partner-applications' && segments.length === 2 && method === 'POST') {
      return await submitPartnerApplication(event.body);
    }
    // --- ここから認証必須 ---

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
      segments[3] === 'pay' &&
      method === 'POST'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await payForItem(decodeURIComponent(itemId), user);
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

    if (
      segments[1] === 'me' &&
      segments[2] === 'bids' &&
      segments.length === 3 &&
      method === 'GET'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      return await getMyActiveBids(user);
    }

    if (
      segments[1] === 'me' &&
      segments[2] === 'favorites' &&
      segments.length === 3 &&
      method === 'GET'
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      return await getMyFavorites(user);
    }

    if (
      segments[1] === 'items' &&
      segments.length === 4 &&
      segments[3] === 'favorite' &&
      (method === 'POST' || method === 'DELETE')
    ) {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return method === 'POST'
        ? await putFavorite(decodeURIComponent(itemId), user)
        : await deleteFavorite(decodeURIComponent(itemId), user);
    }

    // --- 出品元（org） ---
    if (segments[1] === 'org') {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      if (!user.isOrg) return json(403, { message: '出品元権限がありません' });

      if (segments[2] === 'items' && segments.length === 3) {
        if (method === 'GET') return await getOrgItems(user);
        if (method === 'POST') return await orgCreateItem(user, event.body);
      }
      if (
        segments[2] === 'items' &&
        segments.length === 4 &&
        segments[3] !== undefined &&
        method === 'PUT'
      ) {
        return await orgUpdateItem(user, decodeURIComponent(segments[3]), event.body);
      }
      if (
        segments[2] === 'items' &&
        segments.length === 5 &&
        segments[4] === 'handover' &&
        method === 'POST'
      ) {
        const itemId = segments[3];
        if (itemId === undefined) return json(404, { message: 'Not Found' });
        return await orgConfirmHandover(decodeURIComponent(itemId), user);
      }
      if (segments[2] === 'stats' && segments.length === 3 && method === 'GET') {
        return await getOrgStats(user);
      }
      if (segments[2] === 'inquiries' && segments.length === 3) {
        if (method === 'GET') return await getOrgInquiries(user);
        if (method === 'POST') return await submitOrgInquiry(event.body, user);
      }
      if (segments[2] === 'images' && segments[3] === 'upload-url' && segments.length === 4 && method === 'POST') {
        return await requestImageUploadUrl(event.body);
      }
      if (segments[2] === 'images' && segments[3] === 'analyze' && segments.length === 4 && method === 'POST') {
        return await analyzeItemImage(event.body);
      }
      return json(404, { message: 'Not Found' });
    }

    // --- 管理者 ---
    if (segments[1] === 'admin') {
      if (user === null) return json(401, { message: 'ログインが必要です' });
      if (!user.isAdmin) return json(403, { message: '管理者権限がありません' });

      if (segments[2] === 'bid-monitor' && segments.length === 3 && method === 'GET') {
        return await adminBidMonitor();
      }
      if (segments[2] === 'stats' && segments.length === 3 && method === 'GET') {
        return await adminGetStats();
      }
      if (segments[2] === 'cloudformation' && segments.length === 3 && method === 'GET') {
        return await adminGetCloudFormation();
      }
      if (segments[2] === 'images' && segments[3] === 'upload-url' && segments.length === 4 && method === 'POST') {
        return await requestImageUploadUrl(event.body);
      }
      if (segments[2] === 'images' && segments[3] === 'analyze' && segments.length === 4 && method === 'POST') {
        return await analyzeItemImage(event.body);
      }
      if (segments[2] === 'organizations' && segments.length === 3) {
        if (method === 'GET') return await adminListOrganizations();
        if (method === 'POST') return await adminCreateOrganization(event.body);
      }
      if (
        segments[2] === 'organizations' &&
        segments.length === 5 &&
        segments[4] === 'login' &&
        method === 'POST'
      ) {
        const orgId = segments[3];
        if (orgId === undefined) return json(404, { message: 'Not Found' });
        return await adminProvisionOrgLogin(decodeURIComponent(orgId), event.body);
      }
      if (segments[2] === 'partner-applications' && segments.length === 3 && method === 'GET') {
        return await adminListPartnerApplications();
      }
      if (
        segments[2] === 'partner-applications' &&
        segments.length === 5 &&
        segments[4] === 'review' &&
        method === 'POST'
      ) {
        const applicationId = segments[3];
        if (applicationId === undefined) return json(404, { message: 'Not Found' });
        return await adminReviewPartnerApplication(decodeURIComponent(applicationId));
      }
      if (segments[2] === 'inquiries' && segments.length === 3 && method === 'GET') {
        return await adminListInquiries();
      }
      if (
        segments[2] === 'inquiries' &&
        segments.length === 5 &&
        segments[4] === 'review' &&
        method === 'POST'
      ) {
        const inquiryId = segments[3];
        if (inquiryId === undefined) return json(404, { message: 'Not Found' });
        return await adminReviewInquiry(decodeURIComponent(inquiryId));
      }
      if (
        segments[2] === 'inquiries' &&
        segments.length === 5 &&
        segments[4] === 'reply' &&
        method === 'POST'
      ) {
        const inquiryId = segments[3];
        if (inquiryId === undefined) return json(404, { message: 'Not Found' });
        return await adminReplyInquiry(decodeURIComponent(inquiryId), event.body);
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
