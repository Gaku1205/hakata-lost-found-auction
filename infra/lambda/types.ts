export type ItemStatus = 'active' | 'sold';

export type PickupStatus = 'awaiting' | 'reserved' | 'completed';

export type PaymentStatus = 'unpaid' | 'paid';

export type ConditionRank = 'like_new' | 'good' | 'used' | 'damaged';

export const CONDITION_LABELS: Record<ConditionRank, string> = {
  like_new: '新品同様',
  good: '良好',
  used: '使用感あり',
  damaged: '傷・汚れあり',
};

export const CONDITION_ORDER: readonly ConditionRank[] = ['like_new', 'good', 'used', 'damaged'];

export const isConditionRank = (value: unknown): value is ConditionRank =>
  typeof value === 'string' && value in CONDITION_LABELS;

export type OrgType = 'police' | 'corporate';

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  police: '警察・自治体',
  corporate: '民間施設',
};

export const isOrgType = (value: unknown): value is OrgType =>
  typeof value === 'string' && value in ORG_TYPE_LABELS;

export type Organization = {
  orgId: string;
  name: string;
  type: OrgType;
  contactNote?: string;
  createdAt: string;
  // ログイン(Cognito custom:orgId でこのorgIdに紐づくアカウント)を発行済みなら、そのsub
  loginSub?: string;
};

export type AdminOrgInput = {
  name: string;
  type: OrgType;
  contactNote?: string;
};

export type PartnerApplicationStatus = 'new' | 'reviewed';

export type PartnerApplication = {
  applicationId: string;
  name: string;
  type: OrgType;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  message?: string;
  status: PartnerApplicationStatus;
  createdAt: string;
};

export type PartnerApplicationInput = {
  name: string;
  type: OrgType;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  message?: string;
};

export type ItemCategory =
  | 'umbrella'
  | 'wallet'
  | 'watch'
  | 'audio'
  | 'bicycle'
  | 'bag'
  | 'clothing'
  | 'accessory'
  | 'book';

export type LostItem = {
  itemId: string;
  title: string;
  category: ItemCategory;
  description: string;
  foundLocation: string;
  foundMonth: string;
  pickupLocation: string;
  startPrice: number;
  currentPrice: number;
  bidCount: number;
  status: ItemStatus;
  endTime: string;
  imageUrl?: string;
  conditionRank: ConditionRank;
  quantity: number;
  foundDate: string;
  accessories?: string;
  size?: string;
  color?: string;
  brand?: string;
  caseNumber: string;
  noticeDate: string;
  custodyEndDate: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  pickupBoxNumber?: number;
  topBidderSub?: string;
  // 落札後のみ設定されるフィールド
  winnerSub?: string;
  winnerNickname?: string;
  soldAt?: string;
  paymentStatus?: PaymentStatus;
  paidAt?: string;
  pickupStatus?: PickupStatus;
  pickupDate?: string;
  pickupCode?: string;
  pickupDeadline?: string;
  // 出品元が受け取り拠点へ現物を納品したことを確認した日時（購入者の受け取りとは独立して管理）
  orgHandoverAt?: string;
};

export type Bid = {
  itemId: string;
  bidId: string;
  bidderName: string;
  bidderSub: string;
  amount: number;
  createdAt: string;
  sourceIp?: string;
};

export type Favorite = {
  userSub: string;
  itemId: string;
  createdAt: string;
};

export type InquiryStatus = 'new' | 'reviewed';

// 出品元アカウントから運営への問い合わせ
export type Inquiry = {
  inquiryId: string;
  orgId: string;
  orgName: string;
  fromSub: string;
  message: string;
  status: InquiryStatus;
  createdAt: string;
  replyMessage?: string;
  repliedAt?: string;
};

export type BidderSummary = {
  bidderSub: string;
  bidderName: string;
  bidCount: number;
  itemCount: number;
  ips: string[];
  lastBidAt: string;
  flags: {
    sharedIp: boolean;
    rapidBids: boolean;
  };
};

export type Stats = {
  itemCount: number;
  activeCount: number;
  soldCount: number;
  totalBids: number;
  soldTotal: number;
  activeBidTotal: number;
};

export type SortKey = 'end_asc' | 'price_asc' | 'price_desc' | 'bids_desc';

export const SORT_KEYS: readonly SortKey[] = ['end_asc', 'price_asc', 'price_desc', 'bids_desc'];

export const isSortKey = (value: unknown): value is SortKey =>
  typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);

export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  'umbrella',
  'wallet',
  'watch',
  'audio',
  'bicycle',
  'bag',
  'clothing',
  'accessory',
  'book',
];

export const isItemCategory = (value: unknown): value is ItemCategory =>
  typeof value === 'string' && (ITEM_CATEGORIES as readonly string[]).includes(value);

export type AdminItemInput = {
  title: string;
  category: ItemCategory;
  description: string;
  foundLocation: string;
  foundMonth: string;
  pickupLocation: string;
  startPrice: number;
  endTime: string;
  imageUrl?: string;
  conditionRank: ConditionRank;
  quantity: number;
  foundDate: string;
  accessories?: string;
  size?: string;
  color?: string;
  brand?: string;
};

// 出品画像のAI解析結果。写真から判断できなかった項目は空文字で返る。
export type ItemSuggestion = {
  title: string;
  category: ItemCategory;
  conditionRank: ConditionRank;
  description: string;
  color: string;
  brand: string;
  size: string;
  accessories: string;
};
