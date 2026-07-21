export type ItemStatus = 'active' | 'sold';

export type PickupStatus = 'awaiting' | 'reserved' | 'completed';

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
};

export type AdminOrgInput = {
  name: string;
  type: OrgType;
  contactNote?: string;
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
  pickupLocation?: string;
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
  winnerSub?: string;
  winnerNickname?: string;
  soldAt?: string;
  pickupStatus?: PickupStatus;
  pickupDate?: string;
  pickupCode?: string;
  pickupDeadline?: string;
  pickupBoxNumber?: number;
};

export type Bid = {
  itemId: string;
  bidId: string;
  bidderName: string;
  amount: number;
  createdAt: string;
};

export type Stats = {
  itemCount: number;
  activeCount: number;
  soldCount: number;
  totalBids: number;
  soldTotal: number;
  activeBidTotal: number;
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

export type MonitorBid = {
  bidId: string;
  itemId: string;
  itemTitle: string;
  bidderName: string;
  bidderSub: string;
  amount: number;
  createdAt: string;
  sourceIp: string;
};

export type BidMonitor = {
  bidders: BidderSummary[];
  recentBids: MonitorBid[];
};

export type SortKey = 'end_asc' | 'price_asc' | 'price_desc' | 'bids_desc';

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'end_asc', label: '終了が近い順' },
  { value: 'price_asc', label: '価格が安い順' },
  { value: 'price_desc', label: '価格が高い順' },
  { value: 'bids_desc', label: '入札が多い順' },
];

export const isSortKey = (value: unknown): value is SortKey =>
  typeof value === 'string' && SORT_OPTIONS.some((o) => o.value === value);

export type SearchQuery = {
  q: string;
  category: ItemCategory | '';
  status: '' | 'active' | 'sold';
  minPrice: string;
  maxPrice: string;
  sort: SortKey;
};

export const EMPTY_QUERY: SearchQuery = {
  q: '',
  category: '',
  status: '',
  minPrice: '',
  maxPrice: '',
  sort: 'end_asc',
};

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

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  umbrella: '傘',
  wallet: '財布',
  watch: '腕時計',
  audio: 'イヤホン・音響',
  bicycle: '自転車',
  bag: 'バッグ',
  clothing: '衣類',
  accessory: 'アクセサリー',
  book: '本・雑貨',
};

export const CATEGORY_ORDER: readonly ItemCategory[] = [
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
  typeof value === 'string' && value in CATEGORY_LABELS;

export const PICKUP_STATUS_LABELS: Record<PickupStatus, string> = {
  awaiting: '受取予約待ち',
  reserved: '受取予約済み',
  completed: '受け渡し完了',
};

export const PICKUP_LOCATION_PRESETS: readonly string[] = [
  '博多区役所 1F 受取窓口',
  '上川端商店街 受取ステーション',
  '博多市民センター 受付',
];
