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
import { authenticate, type AuthUser } from './auth';
import {
  isItemCategory,
  isSortKey,
  type AdminItemInput,
  type Bid,
  type LostItem,
  type SortKey,
  type Stats,
} from './types';

const ITEMS_TABLE = process.env.ITEMS_TABLE ?? '';
const BIDS_TABLE = process.env.BIDS_TABLE ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const PICKUP_DEADLINE_DAYS = 14;

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

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

const placeBid = async (
  itemId: string,
  body: string | null,
  user: AuthUser,
): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  const amount = data?.['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    return json(400, { message: '入札金額は1〜1,000,000円の整数で入力してください' });
  }

  const now = new Date().toISOString();
  const bid: Bid = {
    itemId,
    bidId: `${now}#${Math.random().toString(36).slice(2, 8)}`,
    bidderName: user.nickname,
    bidderSub: user.sub,
    amount,
    createdAt: now,
  };

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: ITEMS_TABLE,
              Key: { itemId },
              UpdateExpression: 'SET currentPrice = :amount, bidCount = bidCount + :one',
              ConditionExpression:
                '#st = :active AND endTime > :now AND currentPrice < :amount',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: {
                ':amount': amount,
                ':one': 1,
                ':active': 'active',
                ':now': now,
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
      return json(409, {
        message: `入札額は現在価格（${item.currentPrice.toLocaleString('ja-JP')}円）より高い金額を指定してください`,
        currentPrice: item.currentPrice,
      });
    }
    throw error;
  }

  return json(201, { currentPrice: amount, bid });
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
  await doc.send(
    new UpdateCommand({
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression:
        'SET pickupStatus = :reserved, pickupDate = :date, pickupCode = :code',
      ExpressionAttributeValues: {
        ':reserved': 'reserved',
        ':date': date,
        ':code': pickupCode,
      },
    }),
  );

  return json(200, { pickupStatus: 'reserved', pickupDate: date, pickupCode });
};

// ---------- 管理者API ----------

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
  return {
    title: title.trim(),
    category,
    description,
    foundLocation: foundLocation.trim(),
    foundMonth,
    pickupLocation: pickupLocation.trim(),
    startPrice,
    endTime: new Date(endTime).toISOString(),
  };
};

const adminCreateItem = async (body: string | null): Promise<APIGatewayProxyResult> => {
  const data = parseBody(body);
  if (data === null) return json(400, { message: 'リクエスト形式が不正です' });
  const input = parseAdminItemInput(data);
  if (typeof input === 'string') return json(400, { message: input });

  const item: LostItem = {
    itemId: `i-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...input,
    currentPrice: input.startPrice,
    bidCount: 0,
    status: 'active',
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
      return await placeBid(decodeURIComponent(itemId), event.body, user);
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
