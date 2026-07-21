import { getCurrentIdToken } from './auth/tokenStore';
import type {
  AdminItemInput,
  AdminOrgInput,
  Bid,
  BidMonitor,
  BidderSummary,
  LostItem,
  MonitorBid,
  Organization,
  PickupStatus,
  SearchQuery,
  Stats,
} from './types';
import { isItemCategory, isOrgType } from './types';

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

export type AuthConfig = { userPoolId: string; clientId: string; region: string };

const isAuthConfig = (value: unknown): value is AuthConfig =>
  isRecord(value) &&
  typeof value.userPoolId === 'string' &&
  typeof value.clientId === 'string' &&
  typeof value.region === 'string';

type ItemsResponse = { items: LostItem[] };
type ItemDetailResponse = { item: LostItem; bids: Bid[] };
type BidResponse = { currentPrice: number; bid: Bid; extended?: boolean; endTime?: string };
type ItemResponse = { item: LostItem };
type PickupReservationResponse = {
  pickupStatus: PickupStatus;
  pickupDate: string;
  pickupCode: string;
  pickupBoxNumber: number;
};
type PickupCompleteResponse = { pickupStatus: PickupStatus };
type OrganizationsResponse = { organizations: Organization[] };
type OrganizationResponse = { organization: Organization };

const isItemsResponse = (value: unknown): value is ItemsResponse =>
  isRecord(value) && Array.isArray(value.items) && value.items.every(isLostItem);

const isItemDetailResponse = (value: unknown): value is ItemDetailResponse =>
  isRecord(value) &&
  isLostItem(value.item) &&
  Array.isArray(value.bids) &&
  value.bids.every(isBid);

const isBidResponse = (value: unknown): value is BidResponse =>
  isRecord(value) && typeof value.currentPrice === 'number' && isBid(value.bid);

const isBidderSummary = (value: unknown): value is BidderSummary =>
  isRecord(value) &&
  typeof value.bidderSub === 'string' &&
  typeof value.bidderName === 'string' &&
  typeof value.bidCount === 'number' &&
  typeof value.itemCount === 'number' &&
  Array.isArray(value.ips) &&
  value.ips.every((ip) => typeof ip === 'string') &&
  typeof value.lastBidAt === 'string' &&
  isRecord(value.flags) &&
  typeof value.flags.sharedIp === 'boolean' &&
  typeof value.flags.rapidBids === 'boolean';

const isMonitorBid = (value: unknown): value is MonitorBid =>
  isRecord(value) &&
  typeof value.bidId === 'string' &&
  typeof value.itemId === 'string' &&
  typeof value.itemTitle === 'string' &&
  typeof value.bidderName === 'string' &&
  typeof value.bidderSub === 'string' &&
  typeof value.amount === 'number' &&
  typeof value.createdAt === 'string' &&
  typeof value.sourceIp === 'string';

const isBidMonitor = (value: unknown): value is BidMonitor =>
  isRecord(value) &&
  Array.isArray(value.bidders) &&
  value.bidders.every(isBidderSummary) &&
  Array.isArray(value.recentBids) &&
  value.recentBids.every(isMonitorBid);

const isItemResponse = (value: unknown): value is ItemResponse =>
  isRecord(value) && isLostItem(value.item);

const isPickupReservationResponse = (value: unknown): value is PickupReservationResponse =>
  isRecord(value) &&
  (value.pickupStatus === 'reserved' || value.pickupStatus === 'completed') &&
  typeof value.pickupDate === 'string' &&
  typeof value.pickupCode === 'string' &&
  typeof value.pickupBoxNumber === 'number';

const isPickupCompleteResponse = (value: unknown): value is PickupCompleteResponse =>
  isRecord(value) &&
  (value.pickupStatus === 'reserved' || value.pickupStatus === 'completed');

const isOrganization = (value: unknown): value is Organization =>
  isRecord(value) &&
  typeof value.orgId === 'string' &&
  typeof value.name === 'string' &&
  isOrgType(value.type) &&
  typeof value.createdAt === 'string';

const isOrganizationsResponse = (value: unknown): value is OrganizationsResponse =>
  isRecord(value) && Array.isArray(value.organizations) && value.organizations.every(isOrganization);

const isOrganizationResponse = (value: unknown): value is OrganizationResponse =>
  isRecord(value) && isOrganization(value.organization);

const isAnything = (_value: unknown): _value is unknown => true;

const hasMessage = (value: unknown): value is { message: string } =>
  isRecord(value) && typeof value.message === 'string';

const request = async <T>(
  path: string,
  guard: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> => {
  const token = getCurrentIdToken();
  const headers = new Headers(init?.headers);
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
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

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- 公開 ----------

export const fetchConfig = (): Promise<AuthConfig> => request('/api/config', isAuthConfig);

export const buildSearchParams = (query: SearchQuery): string => {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.category !== '') params.set('category', query.category);
  if (query.status !== '') params.set('status', query.status);
  if (query.minPrice !== '') params.set('minPrice', query.minPrice);
  if (query.maxPrice !== '') params.set('maxPrice', query.maxPrice);
  if (query.sort !== 'end_asc') params.set('sort', query.sort);
  return params.toString();
};

export const fetchItems = (query?: SearchQuery): Promise<ItemsResponse> => {
  const qs = query === undefined ? '' : buildSearchParams(query);
  return request(`/api/items${qs === '' ? '' : `?${qs}`}`, isItemsResponse);
};

export const fetchItemDetail = (itemId: string): Promise<ItemDetailResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}`, isItemDetailResponse);

export const fetchStats = (): Promise<Stats> => request('/api/stats', isStats);

// ---------- 認証つき（一般） ----------

export const postBid = (itemId: string, amount: number): Promise<BidResponse> =>
  request(
    `/api/items/${encodeURIComponent(itemId)}/bids`,
    isBidResponse,
    jsonInit('POST', { amount }),
  );

export const fetchMyWins = (): Promise<ItemsResponse> =>
  request('/api/me/wins', isItemsResponse);

export const postPickupReservation = (
  itemId: string,
  date: string,
): Promise<PickupReservationResponse> =>
  request(
    `/api/items/${encodeURIComponent(itemId)}/pickup-reservation`,
    isPickupReservationResponse,
    jsonInit('POST', { date }),
  );

// 無人ボックスでのセルフ受け取り完了（購入者本人の操作）
export const postPickupSelfComplete = (itemId: string): Promise<PickupCompleteResponse> =>
  request(
    `/api/items/${encodeURIComponent(itemId)}/pickup-self-complete`,
    isPickupCompleteResponse,
    { method: 'POST' },
  );

// ---------- 管理者 ----------

export const adminCreateItem = (
  input: AdminItemInput,
  orgId: string,
): Promise<ItemResponse> =>
  request('/api/admin/items', isItemResponse, jsonInit('POST', { ...input, orgId }));

export const adminUpdateItem = (
  itemId: string,
  input: AdminItemInput,
): Promise<ItemResponse> =>
  request(
    `/api/admin/items/${encodeURIComponent(itemId)}`,
    isItemResponse,
    jsonInit('PUT', input),
  );

export const adminCloseItem = (itemId: string): Promise<ItemResponse> =>
  request(`/api/admin/items/${encodeURIComponent(itemId)}/close`, isItemResponse, {
    method: 'POST',
  });

export const adminCompletePickup = (itemId: string, code: string): Promise<unknown> =>
  request(
    `/api/admin/items/${encodeURIComponent(itemId)}/pickup-complete`,
    isAnything,
    jsonInit('POST', { code }),
  );

export const adminDeleteItem = (itemId: string): Promise<unknown> =>
  request(`/api/admin/items/${encodeURIComponent(itemId)}`, isAnything, {
    method: 'DELETE',
  });

export const adminFetchBidMonitor = (): Promise<BidMonitor> =>
  request('/api/admin/bid-monitor', isBidMonitor);

type ImageUploadUrlResponse = { uploadUrl: string; imageUrl: string };

const isImageUploadUrlResponse = (value: unknown): value is ImageUploadUrlResponse =>
  isRecord(value) && typeof value.uploadUrl === 'string' && typeof value.imageUrl === 'string';

export const adminRequestImageUploadUrl = (
  itemId: string,
  contentType: string,
): Promise<ImageUploadUrlResponse> =>
  request(
    '/api/admin/images/upload-url',
    isImageUploadUrlResponse,
    jsonInit('POST', { itemId, contentType }),
  );

export const adminListOrganizations = (): Promise<OrganizationsResponse> =>
  request('/api/admin/organizations', isOrganizationsResponse);

export const adminCreateOrganization = (
  input: AdminOrgInput,
): Promise<OrganizationResponse> =>
  request('/api/admin/organizations', isOrganizationResponse, jsonInit('POST', input));
