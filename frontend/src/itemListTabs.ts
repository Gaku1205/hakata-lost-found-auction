import { handoverStatus } from './format';
import type { LostItem } from './types';

export type ItemListTab = 'all' | 'active' | 'pending' | 'done';

export const ITEM_LIST_TABS: readonly { value: ItemListTab; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '出品中' },
  { value: 'pending', label: '受け渡し待ち' },
  { value: 'done', label: '受け渡し完了' },
];

export const ITEM_LIST_PAGE_SIZE = 20;

export const matchesItemListTab = (item: LostItem, tab: ItemListTab): boolean => {
  if (tab === 'all') return true;
  if (tab === 'active') return item.status === 'active';
  const isDone = item.status === 'sold' && handoverStatus(item).chipClass === 'status-chip--done';
  return tab === 'done' ? isDone : item.status === 'sold' && !isDone;
};

export const countByTab = (items: readonly LostItem[]): Record<ItemListTab, number> => {
  const counts: Record<ItemListTab, number> = { all: 0, active: 0, pending: 0, done: 0 };
  for (const item of items) {
    for (const t of ITEM_LIST_TABS) {
      if (matchesItemListTab(item, t.value)) counts[t.value] += 1;
    }
  }
  return counts;
};
