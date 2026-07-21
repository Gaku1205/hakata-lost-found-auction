import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError, fetchItemDetail, postBid } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { formatFoundMonth, relativeTime, timeLeft, yen } from '../format';
import { useLoadable, useNow } from '../hooks';
import type { Bid, LostItem } from '../types';
import { CATEGORY_LABELS } from '../types';

type BidFormProps = {
  item: LostItem;
  currentPrice: number;
  onBidPlaced: (bid: Bid, currentPrice: number) => void;
};

const BidForm = ({ item, currentPrice, onBidPlaced }: BidFormProps): JSX.Element => {
  const { state } = useAuth();
  const location = useLocation();
  const [amountText, setAmountText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (state.status !== 'authed') {
    return (
      <div className="bid-login-cta">
        <h2 className="panel__heading">入札する</h2>
        <p className="bid-login-cta__text">
          入札にはログインが必要です。なりすまし防止のため、入札者名はアカウントのニックネームが使われます。
        </p>
        <Link
          className="btn btn--primary"
          to="/login"
          state={{ returnTo: `${location.pathname}${location.search}` }}
        >
          ログインして入札する
        </Link>
      </div>
    );
  }

  const suggested = currentPrice + 100;

  const applyDelta = (delta: number): void => {
    setAmountText(String(currentPrice + delta));
    setError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const amount = Number.parseInt(amountText, 10);
    if (Number.isNaN(amount) || String(amount) !== amountText.trim()) {
      setError('入札金額は整数で入力してください');
      return;
    }
    if (amount <= currentPrice) {
      setError(`現在価格（${yen(currentPrice)}）より高い金額を入力してください`);
      return;
    }

    setSubmitting(true);
    postBid(item.itemId, amount)
      .then((result) => {
        setSuccess('入札を受け付けました。現在価格が更新されました。');
        setAmountText('');
        onBidPlaced(result.bid, result.currentPrice);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError ? err.message : '入札に失敗しました。再度お試しください';
        setError(message);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form className="bid-form" onSubmit={handleSubmit} noValidate>
      <h2 className="panel__heading">入札する</h2>
      <p className="bid-as">
        <span className="bid-as__name">{state.user.nickname}</span> さんとして入札します
      </p>
      <div className="field">
        <label htmlFor="bid-amount">
          入札金額（円） <span className="req">必須</span>
        </label>
        <input
          id="bid-amount"
          type="number"
          inputMode="numeric"
          min={currentPrice + 1}
          step={1}
          placeholder={`${suggested} 以上を推奨`}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          required
        />
        <div className="quick-bids" role="group" aria-label="入札額をすばやく入力">
          <button type="button" className="btn btn--ghost" onClick={() => applyDelta(100)}>
            +100円
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => applyDelta(500)}>
            +500円
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => applyDelta(1000)}>
            +1,000円
          </button>
        </div>
      </div>
      {error !== null ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--primary" disabled={submitting}>
        {submitting ? '送信中…' : 'この金額で入札する'}
      </button>
      <div aria-live="polite">
        {success !== null ? <p className="bid-success">{success}</p> : null}
      </div>
    </form>
  );
};

export const ItemDetail = (): JSX.Element => {
  const { itemId } = useParams<{ itemId: string }>();
  const { state: authState } = useAuth();
  const [result, reload] = useLoadable(
    () => fetchItemDetail(itemId ?? ''),
    [itemId],
  );
  const nowMs = useNow(15_000);
  const [localBids, setLocalBids] = useState<readonly Bid[]>([]);
  const [localPrice, setLocalPrice] = useState<number | null>(null);
  const [localBidCount, setLocalBidCount] = useState(0);

  if (result.state === 'loading') {
    return (
      <div className="container section" aria-busy="true">
        <div className="detail-skeleton" aria-hidden="true" />
      </div>
    );
  }

  if (result.state === 'error') {
    return (
      <div className="container section">
        <div className="notice notice--error" role="alert">
          <p>{result.message}</p>
          <div className="notice__actions">
            <button type="button" className="btn btn--ghost" onClick={reload}>
              再読み込み
            </button>
            <Link className="btn btn--ghost" to="/">
              出品一覧へ戻る
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { item } = result.data;
  const currentPrice = localPrice ?? item.currentPrice;
  const bidCount = item.bidCount + localBidCount;
  const bids: readonly Bid[] = [...localBids, ...result.data.bids];
  const remaining = timeLeft(item.endTime, nowMs);
  const isClosed = item.status === 'sold' || remaining.ended;
  const isWinner =
    authState.status === 'authed' &&
    item.status === 'sold' &&
    item.winnerSub === authState.user.sub;

  const handleBidPlaced = (bid: Bid, price: number): void => {
    setLocalBids((prev) => [bid, ...prev]);
    setLocalPrice(price);
    setLocalBidCount((n) => n + 1);
  };

  return (
    <div className="container section">
      <nav className="breadcrumb" aria-label="パンくず">
        <Link to="/">出品一覧</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{item.title}</span>
      </nav>

      <div className="detail">
        <div className="detail__main">
          <div
            className={`detail__media${isClosed ? ' detail__media--closed' : ''}`}
            aria-hidden="true"
          >
            <CategoryIcon category={item.category} size={96} />
            {isClosed ? <span className="card__badge">落札済み</span> : null}
          </div>
          <span className="chip">{CATEGORY_LABELS[item.category]}</span>
          <h1 className="detail__title">{item.title}</h1>
          <p className="detail__description">{item.description}</p>

          <dl className="meta">
            <div className="meta__row">
              <dt>発見場所</dt>
              <dd>{item.foundLocation}</dd>
            </div>
            <div className="meta__row">
              <dt>拾得時期</dt>
              <dd>{formatFoundMonth(item.foundMonth)}</dd>
            </div>
            <div className="meta__row">
              <dt>受取拠点</dt>
              <dd>
                {item.pickupLocation ?? '後日ご案内します'}
                <span className="meta__note">
                  郵送は行わず、落札後にまちの受取拠点でお渡しします
                </span>
              </dd>
            </div>
            <div className="meta__row">
              <dt>開始価格</dt>
              <dd>{yen(item.startPrice)}</dd>
            </div>
            <div className="meta__row">
              <dt>出品者</dt>
              <dd>福岡県（遺失物法に基づき県に帰属した物品）</dd>
            </div>
          </dl>

          <section className="bid-history" aria-label="入札履歴">
            <h2 className="panel__heading">入札履歴（{bidCount}件）</h2>
            {bids.length === 0 ? (
              <p className="empty">まだ入札はありません。最初の入札者になりませんか？</p>
            ) : (
              <ul className="bid-list">
                {bids.map((bid) => (
                  <li key={bid.bidId} className="bid-list__row">
                    <span className="bid-list__name">{bid.bidderName}</span>
                    <span className="bid-list__amount">{yen(bid.amount)}</span>
                    <span className="bid-list__time">
                      {relativeTime(bid.createdAt, nowMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="detail__side">
          <div className="panel">
            <p className="price-block">
              <span className="price-block__label">
                {isClosed ? '落札価格' : '現在価格'}
              </span>
              <span className="price-block__value">{yen(currentPrice)}</span>
              <span
                className={`price-block__time${
                  !isClosed && remaining.urgent ? ' price-block__time--urgent' : ''
                }`}
              >
                {isClosed ? 'このオークションは終了しました' : remaining.label}
              </span>
            </p>
            {isClosed ? (
              isWinner ? (
                <div className="winner-cta">
                  <p className="closed-note">
                    おめでとうございます！あなたが落札しました。受取拠点でのお受け取り手続きへお進みください。
                  </p>
                  <Link className="btn btn--primary" to="/mypage">
                    受取手続きへ（マイページ）
                  </Link>
                </div>
              ) : (
                <p className="closed-note">
                  売上は自治体の歳入・地域振興事業に充てられます。ご参加ありがとうございました。
                </p>
              )
            ) : (
              <BidForm item={item} currentPrice={currentPrice} onBidPlaced={handleBidPlaced} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
