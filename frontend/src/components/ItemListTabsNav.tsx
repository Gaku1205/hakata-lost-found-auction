import { ITEM_LIST_TABS, type ItemListTab } from '../itemListTabs';

type ItemListTabsNavProps = {
  tab: ItemListTab;
  counts: Record<ItemListTab, number>;
  onChange: (tab: ItemListTab) => void;
};

export const ItemListTabsNav = ({ tab, counts, onChange }: ItemListTabsNavProps): JSX.Element => (
  <nav className="mypage-tabs" aria-label="出品の表示切り替え">
    {ITEM_LIST_TABS.map((t) => (
      <button
        key={t.value}
        type="button"
        className={`mypage-tabs__tab${tab === t.value ? ' active' : ''}`}
        aria-current={tab === t.value ? 'page' : undefined}
        onClick={() => onChange(t.value)}
      >
        {t.label}（{counts[t.value]}）
      </button>
    ))}
  </nav>
);
