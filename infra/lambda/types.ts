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
