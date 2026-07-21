export type ItemStatus = 'active' | 'sold';

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
  startPrice: number;
  currentPrice: number;
  bidCount: number;
  status: ItemStatus;
  endTime: string;
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
