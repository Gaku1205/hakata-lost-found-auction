import { Link } from 'react-router-dom';
import type { LostItem } from '../types';
import { CATEGORY_LABELS } from '../types';
import { timeLeft, yen } from '../format';
import { CategoryIcon } from './CategoryIcon';

type Props = {
  item: LostItem;
  nowMs: number;
  index: number;
};

export const ItemCard = ({ item, nowMs, index }: Props): JSX.Element => {
  const remaining = timeLeft(item.endTime, nowMs);
  const isClosed = item.status === 'sold' || remaining.ended;

  return (
    <Link
      to={`/items/${item.itemId}`}
      className={`card${isClosed ? ' card--closed' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="card__media" aria-hidden="true">
        <CategoryIcon category={item.category} />
        {isClosed ? <span className="card__badge">落札済み</span> : null}
      </div>
      <div className="card__body">
        <span className="chip">{CATEGORY_LABELS[item.category]}</span>
        <h3 className="card__title">{item.title}</h3>
        <p className="card__location">{item.foundLocation} で発見</p>
        <div className="card__price-row">
          <div>
            <span className="card__price-label">{isClosed ? '落札価格' : '現在価格'}</span>
            <span className="card__price">{yen(item.currentPrice)}</span>
          </div>
          <span className="card__bids">入札 {item.bidCount}件</span>
        </div>
        <p
          className={`card__time${!isClosed && remaining.urgent ? ' card__time--urgent' : ''}`}
        >
          {isClosed ? 'オークション終了' : remaining.label}
        </p>
      </div>
    </Link>
  );
};
