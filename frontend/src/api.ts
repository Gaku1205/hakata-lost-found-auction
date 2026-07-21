import type { Bid, LostItem, Stats } from './types';
import { isItemCategory } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isLostItem = (value: unknown): value is LostItem =>
  isRecord(value) &&
  typeof value.itemId === 'string' &&
  typeof value.title === 'string' &&
  isItemCategory(value.category) &&
  typeof value.description === 'string' &&
  typeof value.foundLocation === 'string' &&
  typeof value.foundMonth === 'string' &&
  typeof value.startPrice === 'number' &&
  typeof value.currentPrice === 'number' &&
  typeof value.bidCount === 'number' &&
  (value.status === 'active' || value.status === 'sold') &&
  typeof value.endTime === 'string';

export const isBid = (value: unknown): value is Bid =>
  isRecord(value) &&
  typeof value.itemId === 'string' &&
  typeof value.bidId === 'string' &&
  typeof value.bidderName === 'string' &&
  typeof value.amount === 'number' &&
  typeof value.createdAt === 'string';

const isStats = (value: unknown): value is Stats =>
  isRecord(value) &&
  typeof value.itemCount === 'number' &&
  typeof value.activeCount === 'number' &&
  typeof value.soldCount === 'number' &&
  typeof value.totalBids === 'number' &&
  typeof value.soldTotal === 'number' &&
  typeof value.activeBidTotal === 'number';

type ItemsResponse = { items: LostItem[] };
type ItemDetailResponse = { item: LostItem; bids: Bid[] };
type BidResponse = { currentPrice: number; bid: Bid };

const isItemsResponse = (value: unknown): value is ItemsResponse =>
  isRecord(value) && Array.isArray(value.items) && value.items.every(isLostItem);

const isItemDetailResponse = (value: unknown): value is ItemDetailResponse =>
  isRecord(value) &&
  isLostItem(value.item) &&
  Array.isArray(value.bids) &&
  value.bids.every(isBid);

const isBidResponse = (value: unknown): value is BidResponse =>
  isRecord(value) && typeof value.currentPrice === 'number' && isBid(value.bid);

const hasMessage = (value: unknown): value is { message: string } =>
  isRecord(value) && typeof value.message === 'string';

const request = async <T>(
  path: string,
  guard: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('通信に失敗しました。接続を確認して再度お試しください', 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = hasMessage(data)
      ? data.message
      : `リクエストに失敗しました（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  if (!guard(data)) {
    throw new ApiError('サーバー応答の形式が不正です', 500);
  }
  return data;
};

export const fetchItems = (): Promise<ItemsResponse> =>
  request('/api/items', isItemsResponse);

export const fetchItemDetail = (itemId: string): Promise<ItemDetailResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}`, isItemDetailResponse);

export const postBid = (
  itemId: string,
  payload: { bidderName: string; amount: number },
): Promise<BidResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}/bids`, isBidResponse, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const fetchStats = (): Promise<Stats> => request('/api/stats', isStats);
