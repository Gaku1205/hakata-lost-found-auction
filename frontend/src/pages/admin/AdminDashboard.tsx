import { useMemo } from 'react';
import { adminFetchStats, fetchItems } from '../../api';
import { AllocationBar, StatTile } from '../../components/StatTiles';
import { yen } from '../../format';
import { useLoadable } from '../../hooks';
import type { ItemCategory, LostItem } from '../../types';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../types';
import { AdminTabs } from './AdminTabs';

type CategoryCount = { category: ItemCategory; count: number };

const countByCategory = (items: readonly LostItem[]): CategoryCount[] => {
  const counts = new Map<ItemCategory, number>();
  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
};

const CategoryBars = ({ items }: { items: readonly LostItem[] }): JSX.Element => {
  const counts = useMemo(() => countByCategory(items), [items]);
  const max = counts.reduce((acc, c) => Math.max(acc, c.count), 0);

  return (
    <section className="panel" aria-label="カテゴリ別の出品数">
      <h2 className="panel__heading">カテゴリ別出品数</h2>
      {counts.length === 0 ? (
        <p className="empty">出品データがありません。</p>
      ) : (
        <ul className="cat-bars">
          {counts.map(({ category, count }) => (
            <li key={category} className="cat-bars__row">
              <span className="cat-bars__label">{CATEGORY_LABELS[category]}</span>
              <span className="cat-bars__track" aria-hidden="true">
                <span
                  className="cat-bars__fill"
                  style={{ width: `${max === 0 ? 0 : (count / max) * 100}%` }}
                />
              </span>
              <span className="cat-bars__value">{count}件</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const AdminDashboard = (): JSX.Element => {
  const [statsResult, reloadStats] = useLoadable(adminFetchStats, []);
  const [itemsResult, reloadItems] = useLoadable(fetchItems, []);

  if (statsResult.state === 'loading' || itemsResult.state === 'loading') {
    return (
      <div className="container section" aria-busy="true">
        <h1 className="page-title">管理画面 — 収益ダッシュボード</h1>
        <AdminTabs />
        <div className="tiles">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="tile tile--skeleton" aria-hidden="true" />
          ))}
        </div>
      </div>
    );
  }

  if (statsResult.state === 'error' || itemsResult.state === 'error') {
    const message =
      statsResult.state === 'error' ? statsResult.message : itemsResult.state === 'error' ? itemsResult.message : '';
    return (
      <div className="container section">
        <h1 className="page-title">管理画面 — 収益ダッシュボード</h1>
        <AdminTabs />
        <div className="notice notice--error" role="alert">
          <p>{message}</p>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              reloadStats();
              reloadItems();
            }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  const stats = statsResult.data;
  const items = itemsResult.data.items;

  return (
    <div className="container section">
      <h1 className="page-title">管理画面 — 収益ダッシュボード</h1>
      <p className="page-lead">
        落札実績と収益配分の状況を確認できます（運営担当者専用）。
      </p>
      <AdminTabs />

      <div className="tiles">
        <StatTile
          label="落札総額"
          value={yen(stats.soldTotal)}
          note={`落札済み ${stats.soldCount}件の合計`}
        />
        <StatTile
          label="入札中の総額"
          value={yen(stats.activeBidTotal)}
          note="現在入札が入っている出品の合計"
        />
        <StatTile
          label="累計入札数"
          value={`${stats.totalBids}件`}
          note="すべての出品への入札数"
        />
        <StatTile
          label="出品数"
          value={`${stats.itemCount}件`}
          note={`販売中 ${stats.activeCount}件 / 落札済み ${stats.soldCount}件`}
        />
      </div>

      <div className="dashboard-grid">
        <AllocationBar stats={stats} />
        <CategoryBars items={items} />
      </div>
    </div>
  );
};
