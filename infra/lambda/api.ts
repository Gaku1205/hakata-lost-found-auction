import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { Bid, LostItem, Stats } from './types';

const ITEMS_TABLE = process.env.ITEMS_TABLE ?? '';
const BIDS_TABLE = process.env.BIDS_TABLE ?? '';

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

const isLostItem = (value: unknown): value is LostItem => {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec['itemId'] === 'string' &&
    typeof rec['title'] === 'string' &&
    typeof rec['currentPrice'] === 'number' &&
    typeof rec['status'] === 'string' &&
    typeof rec['endTime'] === 'string'
  );
};

type BidRequest = { bidderName: string; amount: number };

const parseBidRequest = (body: string | null): BidRequest | null => {
  if (body === null) return null;
  try {
    const data: unknown = JSON.parse(body);
    if (typeof data !== 'object' || data === null) return null;
    const rec = data as Record<string, unknown>;
    const bidderName = rec['bidderName'];
    const amount = rec['amount'];
    if (typeof bidderName !== 'string' || typeof amount !== 'number') return null;
    return { bidderName: bidderName.trim(), amount };
  } catch {
    return null;
  }
};

const getItems = async (): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new ScanCommand({ TableName: ITEMS_TABLE }));
  const items = (result.Items ?? []).filter(isLostItem);
  const sorted = [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.endTime.localeCompare(b.endTime);
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

const placeBid = async (
  itemId: string,
  body: string | null,
): Promise<APIGatewayProxyResult> => {
  const request = parseBidRequest(body);
  if (request === null) {
    return json(400, { message: 'ニックネームと入札金額を正しく入力してください' });
  }
  const { bidderName, amount } = request;
  if (bidderName.length < 1 || bidderName.length > 20) {
    return json(400, { message: 'ニックネームは1〜20文字で入力してください' });
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    return json(400, { message: '入札金額は1〜1,000,000円の整数で入力してください' });
  }

  const now = new Date().toISOString();
  const bid: Bid = {
    itemId,
    bidId: `${now}#${Math.random().toString(36).slice(2, 8)}`,
    bidderName,
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

const getStats = async (): Promise<APIGatewayProxyResult> => {
  const result = await doc.send(new ScanCommand({ TableName: ITEMS_TABLE }));
  const items = (result.Items ?? []).filter(isLostItem);
  const stats = items.reduce<Stats>(
    (acc, item) => {
      const bidCount = typeof item.bidCount === 'number' ? item.bidCount : 0;
      const isSold = item.status === 'sold';
      const hasBids = bidCount > 0;
      return {
        itemCount: acc.itemCount + 1,
        activeCount: acc.activeCount + (isSold ? 0 : 1),
        soldCount: acc.soldCount + (isSold ? 1 : 0),
        totalBids: acc.totalBids + bidCount,
        soldTotal: acc.soldTotal + (isSold ? item.currentPrice : 0),
        activeBidTotal: acc.activeBidTotal + (!isSold && hasBids ? item.currentPrice : 0),
      };
    },
    { itemCount: 0, activeCount: 0, soldCount: 0, totalBids: 0, soldTotal: 0, activeBidTotal: 0 },
  );
  return json(200, stats);
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const segments = event.path.split('/').filter((s) => s.length > 0);
    const method = event.httpMethod.toUpperCase();

    if (segments[0] !== 'api') {
      return json(404, { message: 'Not Found' });
    }

    if (segments[1] === 'items' && segments.length === 2 && method === 'GET') {
      return await getItems();
    }
    if (segments[1] === 'items' && segments.length === 3 && method === 'GET') {
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await getItemDetail(decodeURIComponent(itemId));
    }
    if (
      segments[1] === 'items' &&
      segments.length === 4 &&
      segments[3] === 'bids' &&
      method === 'POST'
    ) {
      const itemId = segments[2];
      if (itemId === undefined) return json(404, { message: 'Not Found' });
      return await placeBid(decodeURIComponent(itemId), event.body);
    }
    if (segments[1] === 'stats' && segments.length === 2 && method === 'GET') {
      return await getStats();
    }

    return json(404, { message: 'Not Found' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Unhandled error:', message, error);
    return json(500, { message: 'サーバー内部でエラーが発生しました' });
  }
};
