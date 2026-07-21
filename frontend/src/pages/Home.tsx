import { useMemo, useState } from 'react';
import { fetchItems } from '../api';
import { ItemCard } from '../components/ItemCard';
import { useLoadable, useNow } from '../hooks';
import type { ItemCategory, LostItem } from '../types';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../types';

type Filter = ItemCategory | 'all';

const filterItems = (items: readonly LostItem[], filter: Filter): LostItem[] =>
  filter === 'all' ? [...items] : items.filter((item) => item.category === filter);

export const Home = (): JSX.Element => {
  const [result, reload] = useLoadable(fetchItems, []);
  const [filter, setFilter] = useState<Filter>('all');
  const nowMs = useNow();

  const categories = useMemo<readonly ItemCategory[]>(() => {
    if (result.state !== 'ready') return [];
    const present = new Set(result.data.items.map((item) => item.category));
    return CATEGORY_ORDER.filter((category) => present.has(category));
  }, [result]);

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">
            落とし物に、
            <br className="hero__break" />
            二度目の物語を。
          </h1>
          <p className="hero__lead">
            博多エリアで警察に届けられ、持ち主が見つからなかった品々。
            地域のオークションで次の使い手へつなぎ、売上は自治体の歳入と地域振興に還元されます。
          </p>
        </div>
      </section>

      <section className="container section" aria-label="出品一覧">
        {result.state === 'loading' ? (
          <div className="grid" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card card--skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : null}

        {result.state === 'error' ? (
          <div className="notice notice--error" role="alert">
            <p>{result.message}</p>
            <button type="button" className="btn btn--ghost" onClick={reload}>
              再読み込み
            </button>
          </div>
        ) : null}

        {result.state === 'ready' ? (
          <>
            <div className="chips-row" role="group" aria-label="カテゴリで絞り込み">
              <button
                type="button"
                className="chip-filter"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                すべて
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="chip-filter"
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
            <div className="grid">
              {filterItems(result.data.items, filter).map((item, index) => (
                <ItemCard key={item.itemId} item={item} nowMs={nowMs} index={index} />
              ))}
            </div>
            {filterItems(result.data.items, filter).length === 0 ? (
              <p className="empty">このカテゴリの出品は現在ありません。</p>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
};
