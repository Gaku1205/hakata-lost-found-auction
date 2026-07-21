import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchItems } from '../api';
import { ItemCard } from '../components/ItemCard';
import { useLoadable, useNow } from '../hooks';
import type { ItemCategory, SearchQuery } from '../types';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EMPTY_QUERY,
  SORT_OPTIONS,
  isItemCategory,
  isSortKey,
} from '../types';

const queryFromParams = (params: URLSearchParams): SearchQuery => {
  const category = params.get('category');
  const status = params.get('status');
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    category: isItemCategory(category) ? category : '',
    status: status === 'active' || status === 'sold' ? status : '',
    minPrice: params.get('minPrice') ?? '',
    maxPrice: params.get('maxPrice') ?? '',
    sort: isSortKey(sort) ? sort : 'end_asc',
  };
};

const paramsFromQuery = (query: SearchQuery): URLSearchParams => {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.category !== '') params.set('category', query.category);
  if (query.status !== '') params.set('status', query.status);
  if (query.minPrice !== '') params.set('minPrice', query.minPrice);
  if (query.maxPrice !== '') params.set('maxPrice', query.maxPrice);
  if (query.sort !== 'end_asc') params.set('sort', query.sort);
  return params;
};

const hasActiveFilter = (query: SearchQuery): boolean =>
  query.q !== '' ||
  query.category !== '' ||
  query.status !== '' ||
  query.minPrice !== '' ||
  query.maxPrice !== '' ||
  query.sort !== 'end_asc';

export const Home = (): JSX.Element => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => queryFromParams(searchParams), [searchParams]);

  // テキスト系はローカル状態で持ち、デバウンスしてURLへ反映する
  const [qInput, setQInput] = useState(query.q);
  const [minInput, setMinInput] = useState(query.minPrice);
  const [maxInput, setMaxInput] = useState(query.maxPrice);

  useEffect(() => {
    setQInput(query.q);
    setMinInput(query.minPrice);
    setMaxInput(query.maxPrice);
  }, [query.q, query.minPrice, query.maxPrice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (qInput === query.q && minInput === query.minPrice && maxInput === query.maxPrice) {
        return;
      }
      setSearchParams(
        paramsFromQuery({ ...query, q: qInput, minPrice: minInput, maxPrice: maxInput }),
        { replace: true },
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [qInput, minInput, maxInput, query, setSearchParams]);

  const applyQuery = (next: SearchQuery): void => {
    setSearchParams(paramsFromQuery(next), { replace: true });
  };

  const [result, reload] = useLoadable(
    () => fetchItems(query),
    [searchParams.toString()],
  );
  const nowMs = useNow();

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
            落札品は郵送ではなく、まちの受取拠点でのお渡しです。
          </p>
        </div>
      </section>

      <section className="container section" aria-label="出品一覧">
        <div className="search-bar" role="search" aria-label="出品を検索">
          <div className="search-bar__keyword">
            <label className="sr-only" htmlFor="search-q">
              キーワード検索
            </label>
            <input
              id="search-q"
              type="search"
              placeholder="品名・説明・場所で検索（例: 博多駅 傘）"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <div className="search-bar__prices">
            <label className="sr-only" htmlFor="search-min">
              下限価格
            </label>
            <input
              id="search-min"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="下限¥"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
            />
            <span aria-hidden="true">〜</span>
            <label className="sr-only" htmlFor="search-max">
              上限価格
            </label>
            <input
              id="search-max"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="上限¥"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
            />
          </div>
          <div className="search-bar__selects">
            <label className="sr-only" htmlFor="search-status">
              販売状況
            </label>
            <select
              id="search-status"
              value={query.status}
              onChange={(e) => {
                const value = e.target.value;
                applyQuery({
                  ...query,
                  status: value === 'active' || value === 'sold' ? value : '',
                });
              }}
            >
              <option value="">すべての状況</option>
              <option value="active">販売中のみ</option>
              <option value="sold">落札済みのみ</option>
            </select>
            <label className="sr-only" htmlFor="search-sort">
              並び替え
            </label>
            <select
              id="search-sort"
              value={query.sort}
              onChange={(e) => {
                const value = e.target.value;
                applyQuery({ ...query, sort: isSortKey(value) ? value : 'end_asc' });
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="chips-row" role="group" aria-label="カテゴリで絞り込み">
          <button
            type="button"
            className="chip-filter"
            aria-pressed={query.category === ''}
            onClick={() => applyQuery({ ...query, category: '' })}
          >
            すべて
          </button>
          {CATEGORY_ORDER.map((category: ItemCategory) => (
            <button
              key={category}
              type="button"
              className="chip-filter"
              aria-pressed={query.category === category}
              onClick={() => applyQuery({ ...query, category })}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

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
            <div className="result-row">
              <p className="result-count" aria-live="polite">
                {result.data.items.length}件の出品
              </p>
              {hasActiveFilter(query) ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => applyQuery(EMPTY_QUERY)}
                >
                  条件をクリア
                </button>
              ) : null}
            </div>
            <div className="grid">
              {result.data.items.map((item, index) => (
                <ItemCard key={item.itemId} item={item} nowMs={nowMs} index={index} />
              ))}
            </div>
            {result.data.items.length === 0 ? (
              <p className="empty">条件に合う出品が見つかりません。条件を変えてお試しください。</p>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
};
