export type ItemStatus = 'active' | 'sold';

export type PickupStatus = 'awaiting' | 'reserved' | 'completed';

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
  topBidderSub?: string;
  // 落札後のみ設定されるフィールド
  winnerSub?: string;
  winnerNickname?: string;
  soldAt?: string;
  pickupStatus?: PickupStatus;
  pickupDate?: string;
  pickupCode?: string;
  pickupDeadline?: string;
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
};
