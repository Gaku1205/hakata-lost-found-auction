import { getCurrentIdToken } from './auth/tokenStore';
import type {
  AdminItemInput,
  AdminOrgInput,
  Bid,
  BidMonitor,
  BidderSummary,
  Inquiry,
  ItemSuggestion,
  LostItem,
  MonitorBid,
  Organization,
  PartnerApplication,
  PartnerApplicationInput,
  PaymentStatus,
  PickupStatus,
  SearchQuery,
  Stats,
} from './types';
import { isConditionRank, isItemCategory, isOrgType } from './types';

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
type ItemDetailResponse = { item: LostItem; bids: Bid[]; isFavorited: boolean };
type FavoriteResponse = { favorited: boolean };
type BidResponse = { currentPrice: number; bid: Bid; extended?: boolean; endTime?: string };
type ItemResponse = { item: LostItem };
type PickupReservationResponse = {
  pickupStatus: PickupStatus;
  pickupDate: string;
  pickupCode: string;
  pickupBoxNumber: number;
};
type PickupCompleteResponse = { pickupStatus: PickupStatus };
type PaymentResponse = { paymentStatus: PaymentStatus; paidAt: string };
type OrganizationsResponse = { organizations: Organization[] };
type OrganizationResponse = { organization: Organization };
type PartnerApplicationsResponse = { applications: PartnerApplication[] };
type PartnerApplicationResponse = { application: PartnerApplication };
type PartnerApplicationReviewResponse = { status: 'reviewed' };

const isItemsResponse = (value: unknown): value is ItemsResponse =>
  isRecord(value) && Array.isArray(value.items) && value.items.every(isLostItem);

const isItemDetailResponse = (value: unknown): value is ItemDetailResponse =>
  isRecord(value) &&
  isLostItem(value.item) &&
  Array.isArray(value.bids) &&
  value.bids.every(isBid) &&
  typeof value.isFavorited === 'boolean';

const isFavoriteResponse = (value: unknown): value is FavoriteResponse =>
  isRecord(value) && typeof value.favorited === 'boolean';

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

const isPaymentResponse = (value: unknown): value is PaymentResponse =>
  isRecord(value) && value.paymentStatus === 'paid' && typeof value.paidAt === 'string';

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

const isPartnerApplication = (value: unknown): value is PartnerApplication =>
  isRecord(value) &&
  typeof value.applicationId === 'string' &&
  typeof value.name === 'string' &&
  isOrgType(value.type) &&
  typeof value.contactName === 'string' &&
  typeof value.contactEmail === 'string' &&
  (value.status === 'new' || value.status === 'reviewed') &&
  typeof value.createdAt === 'string';

const isPartnerApplicationsResponse = (value: unknown): value is PartnerApplicationsResponse =>
  isRecord(value) && Array.isArray(value.applications) && value.applications.every(isPartnerApplication);

const isPartnerApplicationResponse = (value: unknown): value is PartnerApplicationResponse =>
  isRecord(value) && isPartnerApplication(value.application);

const isPartnerApplicationReviewResponse = (value: unknown): value is PartnerApplicationReviewResponse =>
  isRecord(value) && value.status === 'reviewed';

const isInquiry = (value: unknown): value is Inquiry =>
  isRecord(value) &&
  typeof value.inquiryId === 'string' &&
  typeof value.orgId === 'string' &&
  typeof value.orgName === 'string' &&
  typeof value.message === 'string' &&
  (value.status === 'new' || value.status === 'reviewed') &&
  typeof value.createdAt === 'string';

type InquiriesResponse = { inquiries: Inquiry[] };
type InquiryResponse = { inquiry: Inquiry };
type InquiryReviewResponse = { status: 'reviewed' };
type OrgLoginResponse = { loginSub: string; email: string };

const isInquiriesResponse = (value: unknown): value is InquiriesResponse =>
  isRecord(value) && Array.isArray(value.inquiries) && value.inquiries.every(isInquiry);

const isInquiryResponse = (value: unknown): value is InquiryResponse =>
  isRecord(value) && isInquiry(value.inquiry);

const isInquiryReviewResponse = (value: unknown): value is InquiryReviewResponse =>
  isRecord(value) && value.status === 'reviewed';

const isOrgLoginResponse = (value: unknown): value is OrgLoginResponse =>
  isRecord(value) && typeof value.loginSub === 'string' && typeof value.email === 'string';

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

export const postPartnerApplication = (
  input: PartnerApplicationInput,
): Promise<PartnerApplicationResponse> =>
  request('/api/partner-applications', isPartnerApplicationResponse, jsonInit('POST', input));

// ---------- 認証つき（一般） ----------

export const postBid = (itemId: string, amount: number): Promise<BidResponse> =>
  request(
    `/api/items/${encodeURIComponent(itemId)}/bids`,
    isBidResponse,
    jsonInit('POST', { amount }),
  );

export const fetchMyWins = (): Promise<ItemsResponse> =>
  request('/api/me/wins', isItemsResponse);

export const fetchMyActiveBids = (): Promise<ItemsResponse> =>
  request('/api/me/bids', isItemsResponse);

export const fetchMyFavorites = (): Promise<ItemsResponse> =>
  request('/api/me/favorites', isItemsResponse);

export const postFavorite = (itemId: string): Promise<FavoriteResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}/favorite`, isFavoriteResponse, {
    method: 'POST',
  });

export const deleteFavorite = (itemId: string): Promise<FavoriteResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}/favorite`, isFavoriteResponse, {
    method: 'DELETE',
  });

// ---------- 出品元（org） ----------

export const fetchOrgItems = (): Promise<ItemsResponse> => request('/api/org/items', isItemsResponse);

export const fetchOrgStats = (): Promise<Stats> => request('/api/org/stats', isStats);

export const postOrgInquiry = (message: string): Promise<InquiryResponse> =>
  request('/api/org/inquiries', isInquiryResponse, jsonInit('POST', { message }));

export const fetchOrgInquiries = (): Promise<InquiriesResponse> =>
  request('/api/org/inquiries', isInquiriesResponse);

type OrgHandoverResponse = { orgHandoverAt: string };

const isOrgHandoverResponse = (value: unknown): value is OrgHandoverResponse =>
  isRecord(value) && typeof value.orgHandoverAt === 'string';

export const postOrgHandover = (itemId: string): Promise<OrgHandoverResponse> =>
  request(
    `/api/org/items/${encodeURIComponent(itemId)}/handover`,
    isOrgHandoverResponse,
    { method: 'POST' },
  );

export const orgCreateItem = (input: AdminItemInput): Promise<ItemResponse> =>
  request('/api/org/items', isItemResponse, jsonInit('POST', input));

export const orgUpdateItem = (
  itemId: string,
  input: AdminItemInput,
): Promise<ItemResponse> =>
  request(
    `/api/org/items/${encodeURIComponent(itemId)}`,
    isItemResponse,
    jsonInit('PUT', input),
  );

export const orgRequestImageUploadUrl = (
  itemId: string,
  contentType: string,
): Promise<ImageUploadUrlResponse> =>
  request(
    '/api/org/images/upload-url',
    isImageUploadUrlResponse,
    jsonInit('POST', { itemId, contentType }),
  );

export const orgAnalyzeItemImage = (
  images: AnalyzableImage[],
): Promise<ItemSuggestionResponse> =>
  request(
    '/api/org/images/analyze',
    isItemSuggestionResponse,
    jsonInit('POST', { images }),
  );

// ダミー決済（実際の課金は発生しない）
export const postPayment = (itemId: string): Promise<PaymentResponse> =>
  request(`/api/items/${encodeURIComponent(itemId)}/pay`, isPaymentResponse, {
    method: 'POST',
  });

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

export const adminFetchStats = (): Promise<Stats> => request('/api/admin/stats', isStats);

type AnalyzableImage = { imageBase64: string; mediaType: string };

type ItemSuggestionResponse = { suggestion: ItemSuggestion };

const isItemSuggestion = (value: unknown): value is ItemSuggestion =>
  isRecord(value) &&
  typeof value.title === 'string' &&
  isItemCategory(value.category) &&
  isConditionRank(value.conditionRank) &&
  typeof value.description === 'string' &&
  typeof value.color === 'string' &&
  typeof value.brand === 'string' &&
  typeof value.size === 'string' &&
  typeof value.accessories === 'string';

const isItemSuggestionResponse = (value: unknown): value is ItemSuggestionResponse =>
  isRecord(value) && isItemSuggestion(value.suggestion);

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

export const adminAnalyzeItemImage = (
  images: AnalyzableImage[],
): Promise<ItemSuggestionResponse> =>
  request(
    '/api/admin/images/analyze',
    isItemSuggestionResponse,
    jsonInit('POST', { images }),
  );

export const adminListOrganizations = (): Promise<OrganizationsResponse> =>
  request('/api/admin/organizations', isOrganizationsResponse);

export const adminCreateOrganization = (
  input: AdminOrgInput,
): Promise<OrganizationResponse> =>
  request('/api/admin/organizations', isOrganizationResponse, jsonInit('POST', input));

export const adminListPartnerApplications = (): Promise<PartnerApplicationsResponse> =>
  request('/api/admin/partner-applications', isPartnerApplicationsResponse);

export const adminReviewPartnerApplication = (
  applicationId: string,
): Promise<PartnerApplicationReviewResponse> =>
  request(
    `/api/admin/partner-applications/${encodeURIComponent(applicationId)}/review`,
    isPartnerApplicationReviewResponse,
    { method: 'POST' },
  );

export const adminListInquiries = (): Promise<InquiriesResponse> =>
  request('/api/admin/inquiries', isInquiriesResponse);

export const adminReviewInquiry = (inquiryId: string): Promise<InquiryReviewResponse> =>
  request(
    `/api/admin/inquiries/${encodeURIComponent(inquiryId)}/review`,
    isInquiryReviewResponse,
    { method: 'POST' },
  );

export const adminReplyInquiry = (
  inquiryId: string,
  message: string,
): Promise<InquiryReviewResponse> =>
  request(
    `/api/admin/inquiries/${encodeURIComponent(inquiryId)}/reply`,
    isInquiryReviewResponse,
    jsonInit('POST', { message }),
  );

export const adminProvisionOrgLogin = (
  orgId: string,
  email: string,
  password: string,
): Promise<OrgLoginResponse> =>
  request(
    `/api/admin/organizations/${encodeURIComponent(orgId)}/login`,
    isOrgLoginResponse,
    jsonInit('POST', { email, password }),
  );

type CloudFormationInfo = {
  stack: {
    name: string;
    status: string;
    creationTime: string;
    lastUpdatedTime?: string;
  };
  resources: Array<{
    logicalId?: string;
    physicalId?: string;
    type?: string;
    status?: string;
    timestamp?: string;
  }>;
  events: Array<{
    timestamp?: string;
    logicalId?: string;
    status?: string;
    reason?: string;
  }>;
};

const isCloudFormationInfo = (value: unknown): value is CloudFormationInfo =>
  isRecord(value) && isRecord(value.stack) && Array.isArray(value.resources) && Array.isArray(value.events);

export const adminFetchCloudFormation = (): Promise<CloudFormationInfo> =>
  request('/api/admin/cloudformation', isCloudFormationInfo);
