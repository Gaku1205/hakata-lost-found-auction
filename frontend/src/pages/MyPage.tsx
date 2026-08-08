import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  ApiError,
  deleteFavorite,
  fetchItemDetail,
  fetchMyActiveBids,
  fetchMyFavorites,
  fetchMyWins,
  postPayment,
  postPickupReservation,
} from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { ItemCard } from '../components/ItemCard';
import { yen } from '../format';
import { useLoadable, useNow, type Loadable } from '../hooks';
import type { LostItem } from '../types';

const dayOf = (iso: string | undefined): string => (iso ?? '').slice(0, 10);

const PickupQr = ({ itemId, code }: { itemId: string; code: string }): JSX.Element | null => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(JSON.stringify({ itemId, code }), { width: 180, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // QR生成失敗時はコード表示のみにフォールバック
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, code]);

  if (dataUrl === null) return null;
  return <img className="pickup-qr" src={dataUrl} alt="受取用QRコード" width={180} height={180} />;
};

type ReservationState = {
  pickupStatus: 'reserved' | 'completed';
  pickupDate: string;
  pickupCode: string;
  pickupBoxNumber: number;
};

// デモ決済用のカード情報をブラウザ内(localStorage)にだけ保存し、次回以降の入力を省略する
const SAVED_CARD_KEY = 'megurimono-demo-card';

// 決済API(postPayment)はitemIdしか送らずカード情報をサーバーへ渡さない。再表示にも
// 下4桁しか使わないため、カード番号そのものは保存せず下4桁と有効期限だけを持つ。
type SavedCard = { last4: string; expiry: string };

const loadSavedCard = (): SavedCard | null => {
  try {
    const raw = window.localStorage.getItem(SAVED_CARD_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SavedCard).last4 === 'string' &&
      typeof (parsed as SavedCard).expiry === 'string'
    ) {
      return parsed as SavedCard;
    }
    // カード番号をそのまま保存していた頃の値が残っている場合はここで消す
    window.localStorage.removeItem(SAVED_CARD_KEY);
    return null;
  } catch {
    return null;
  }
};

const saveCard = (card: SavedCard): void => {
  try {
    window.localStorage.setItem(SAVED_CARD_KEY, JSON.stringify(card));
  } catch {
    // 保存に失敗しても支払い自体には影響しないため無視する
  }
};

const maskCardNumber = (last4: string): string => `**** **** **** ${last4}`;

// 入力中のカード番号を4桁ごとにスペース区切りで表示する(最大19桁までのカード番号を想定)
const formatCardNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
};

// 入力中の有効期限を MM/YY 形式にスラッシュ自動挿入で整形する
const formatExpiry = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

const PaymentPanel = ({
  itemId,
  amount,
  onPaid,
}: {
  itemId: string;
  amount: number;
  onPaid: () => void;
}): JSX.Element => {
  const [savedCard, setSavedCard] = useState<SavedCard | null>(() => loadSavedCard());
  const [useNewCard, setUseNewCard] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [rememberCard, setRememberCard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pay = (): void => {
    setSubmitting(true);
    postPayment(itemId)
      .then(() => onPaid())
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '支払い処理に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  const handlePayWithSavedCard = (): void => {
    setError(null);
    pay();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (cardNumber.trim() === '' || expiry.trim() === '' || cvv.trim() === '') {
      setError('カード情報を入力してください(デモのため実在のカードは不要です)');
      return;
    }
    if (rememberCard) {
      const card = {
        last4: cardNumber.replace(/\D/g, '').slice(-4),
        expiry: expiry.trim(),
      };
      saveCard(card);
      setSavedCard(card);
    }
    pay();
  };

  if (savedCard !== null && !useNewCard) {
    return (
      <div className="payment-panel">
        <p className="payment-panel__amount">
          お支払い金額 <strong>{yen(amount)}</strong>
        </p>
        <p className="payment-panel__note">
          ※デモ環境のため実際の決済は発生しません。カード情報はこの端末内にのみ保存されます。
        </p>
        <div className="saved-card">
          <span className="saved-card__number">{maskCardNumber(savedCard.last4)}</span>
          <span className="saved-card__expiry">有効期限 {savedCard.expiry}</span>
        </div>
        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          onClick={handlePayWithSavedCard}
          disabled={submitting}
        >
          {submitting ? '処理中…' : `${yen(amount)} を支払う`}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--fit"
          onClick={() => setUseNewCard(true)}
          disabled={submitting}
        >
          別のカード情報を使う
        </button>
      </div>
    );
  }

  return (
    <div className="payment-panel">
      <p className="payment-panel__amount">
        お支払い金額 <strong>{yen(amount)}</strong>
      </p>
      <p className="payment-panel__note">
        ※デモ環境のため実際の決済は発生しません。カード情報はサーバーに送信されず、この端末内にのみ保存されます。
      </p>
      <form className="payment-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={`card-number-${itemId}`}>カード番号</label>
          <input
            id={`card-number-${itemId}`}
            type="text"
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            autoComplete="off"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            required
          />
        </div>
        <div className="payment-form__row">
          <div className="field">
            <label htmlFor={`card-expiry-${itemId}`}>有効期限</label>
            <input
              id={`card-expiry-${itemId}`}
              type="text"
              inputMode="numeric"
              placeholder="MM/YY"
              autoComplete="off"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`card-cvv-${itemId}`}>セキュリティコード</label>
            <input
              id={`card-cvv-${itemId}`}
              type="text"
              inputMode="numeric"
              placeholder="123"
              autoComplete="off"
              value={cvv}
              onChange={(e) => setCvv(e.target.value)}
              required
            />
          </div>
        </div>
        <label className="payment-form__remember">
          <input
            type="checkbox"
            checked={rememberCard}
            onChange={(e) => setRememberCard(e.target.checked)}
          />
          次回から入力を省略する(この端末に保存)
        </label>
        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? '処理中…' : `${yen(amount)} を支払う`}
        </button>
        {savedCard !== null ? (
          <button
            type="button"
            className="btn btn--ghost btn--fit"
            onClick={() => setUseNewCard(false)}
            disabled={submitting}
          >
            保存済みのカードを使う
          </button>
        ) : null}
      </form>
    </div>
  );
};

// 出品元・管理者がQRを読み取って受け渡し完了にするまでの間、この間隔で状態をポーリングする
// (解錠されたことをできるだけ早く画面に反映したいため短めの間隔にしている)
const PICKUP_STATUS_POLL_MS = 1500;
// 受け渡しは受取窓口でその場で完了するため、画面を開いたまま放置された場合に
// 無期限で問い合わせ続ける必要はない。この時間を過ぎたら止め、再訪時にまた回す。
const PICKUP_STATUS_POLL_MAX_MS = 10 * 60 * 1000;

const WinCard = ({ item }: { item: LostItem }): JSX.Element => {
  const [paid, setPaid] = useState(item.paymentStatus === 'paid');
  const [reservation, setReservation] = useState<ReservationState | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const status = reservation?.pickupStatus ?? item.pickupStatus ?? 'awaiting';
  const pickupDate = reservation?.pickupDate ?? item.pickupDate;
  const pickupCode = reservation?.pickupCode ?? item.pickupCode;
  const pickupBoxNumber = reservation?.pickupBoxNumber ?? item.pickupBoxNumber;
  const deadlineDay = dayOf(item.pickupDeadline);
  const today = new Date().toISOString().slice(0, 10);

  // 出品元・管理者が受取QRを読み取って受け渡し完了にすると、ここでそれを検知して自動的に画面を更新する
  useEffect(() => {
    if (status !== 'reserved') return undefined;

    // タブが裏にある間は計測を進めない。裏のまま時間切れにすると、
    // 表に戻ったときに監視が終わっていて解錠に気づけなくなるため。
    let activeSince = Date.now();
    const onVisibilityChange = (): void => {
      if (!document.hidden) activeSince = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - activeSince > PICKUP_STATUS_POLL_MAX_MS) return;
      fetchItemDetail(item.itemId)
        .then((res) => {
          if (res.item.pickupStatus === 'completed') {
            setJustCompleted(true);
            setReservation((prev) =>
              prev !== null
                ? { ...prev, pickupStatus: 'completed' }
                : pickupDate !== undefined && pickupCode !== undefined && pickupBoxNumber !== undefined
                  ? { pickupStatus: 'completed', pickupDate, pickupCode, pickupBoxNumber }
                  : null,
            );
          }
        })
        .catch(() => {
          // ポーリング失敗時は次回に再試行する
        });
    }, PICKUP_STATUS_POLL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status, item.itemId, pickupDate, pickupCode, pickupBoxNumber]);

  const handleReserve = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (date === '') {
      setError('受取日を選択してください');
      return;
    }
    setSubmitting(true);
    postPickupReservation(item.itemId, date)
      .then((result) => {
        setReservation({
          pickupStatus: 'reserved',
          pickupDate: result.pickupDate,
          pickupCode: result.pickupCode,
          pickupBoxNumber: result.pickupBoxNumber,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '予約に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <article className="win-card">
      <div className="win-card__media" aria-hidden="true">
        {item.imageUrls?.[0] !== undefined ? (
          <img className="win-card__media-img" src={item.imageUrls[0]} alt="" loading="lazy" />
        ) : (
          <CategoryIcon category={item.category} size={40} />
        )}
      </div>
      <div className="win-card__body">
        <h2 className="win-card__title">
          <Link to={`/items/${item.itemId}`}>{item.title}</Link>
        </h2>
        <p className="win-card__meta">
          落札価格 <strong>{yen(item.currentPrice)}</strong>
        </p>
        <p className="win-card__meta">
          受取拠点: {item.pickupLocation ?? '後日ご案内します'}
        </p>
        {deadlineDay !== '' ? (
          <p className="win-card__meta">受取期限: {deadlineDay}</p>
        ) : null}

        {status === 'completed' ? (
          <div className="pickup-done">
            <span className="pickup-done__stamp" aria-hidden="true">
              済
            </span>
            <div>
              {justCompleted ? (
                <p>
                  {pickupBoxNumber !== undefined
                    ? `${pickupBoxNumber}番のボックスが解錠されました。`
                    : 'ボックスが解錠されました。'}
                </p>
              ) : null}
              <p>受け渡し完了。ご利用ありがとうございました。</p>
              {justCompleted ? <p>ボックスを施錠しました。</p> : null}
            </div>
          </div>
        ) : !paid ? (
          <PaymentPanel
            itemId={item.itemId}
            amount={item.currentPrice}
            onPaid={() => setPaid(true)}
          />
        ) : status === 'reserved' && pickupCode !== undefined ? (
          <div className="pickup-panel">
            <p className="pickup-panel__label">受取予約日: {pickupDate}</p>
            {pickupBoxNumber !== undefined ? (
              <p className="pickup-panel__label">受取ボックス番号: {pickupBoxNumber}番</p>
            ) : null}
            <p className="pickup-panel__label">
              受取拠点のスタッフにこのコードまたはQRを読み取ってもらってください。読み取られると自動的に受け取り完了になります。
            </p>
            <p className="pickup-code" aria-label={`受取コード ${pickupCode}`}>
              {pickupCode}
            </p>
            <PickupQr itemId={item.itemId} code={pickupCode} />
            {error !== null ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <form className="pickup-form" onSubmit={handleReserve} noValidate>
            <div className="field">
              <label htmlFor={`pickup-date-${item.itemId}`}>受取日を選択</label>
              <input
                id={`pickup-date-${item.itemId}`}
                type="date"
                min={today}
                max={deadlineDay === '' ? undefined : deadlineDay}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            {error !== null ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? '予約中…' : '受取日を予約する'}
            </button>
          </form>
        )}
      </div>
    </article>
  );
};

const FavoriteCard = ({
  item,
  nowMs,
  index,
  onRemove,
}: {
  item: LostItem;
  nowMs: number;
  index: number;
  onRemove: (itemId: string) => void;
}): JSX.Element => (
  <div className="favorite-tile">
    <ItemCard item={item} nowMs={nowMs} index={index} />
    <button
      type="button"
      className="btn btn--ghost btn--fit"
      onClick={() => onRemove(item.itemId)}
    >
      お気に入り解除
    </button>
  </div>
);

type ItemsPanelProps = {
  result: Loadable<{ items: LostItem[] }>;
  emptyText: string;
  onReload: () => void;
  renderCard: (item: LostItem, index: number) => JSX.Element;
};

const ItemsPanel = ({ result, emptyText, onReload, renderCard }: ItemsPanelProps): JSX.Element => {
  if (result.state === 'loading') {
    return (
      <div className="grid" aria-busy="true">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="tile tile--skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }
  if (result.state === 'error') {
    return (
      <div className="notice notice--error" role="alert">
        <p>{result.message}</p>
        <button type="button" className="btn btn--ghost" onClick={onReload}>
          再読み込み
        </button>
      </div>
    );
  }
  if (result.data.items.length === 0) {
    return (
      <div className="notice">
        <p>{emptyText}</p>
        <Link className="btn btn--ghost" to="/items">
          出品一覧を見る
        </Link>
      </div>
    );
  }
  return (
    <div className="grid">{result.data.items.map((item, index) => renderCard(item, index))}</div>
  );
};

type MyPageTab = 'bidding' | 'wins' | 'favorites';

const isMyPageTab = (value: string | null): value is MyPageTab =>
  value === 'bidding' || value === 'wins' || value === 'favorites';

const TABS: readonly { value: MyPageTab; label: string }[] = [
  { value: 'bidding', label: '入札中' },
  { value: 'wins', label: '購入済み' },
  { value: 'favorites', label: 'お気に入り' },
];

export const MyPage = (): JSX.Element => {
  const { state } = useAuth();
  const nowMs = useNow();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: MyPageTab = isMyPageTab(searchParams.get('tab')) ? (searchParams.get('tab') as MyPageTab) : 'bidding';

  const [bidsResult, reloadBids] = useLoadable(fetchMyActiveBids, []);
  const [winsResult, reloadWins] = useLoadable(fetchMyWins, []);
  const [favoritesResult, reloadFavorites] = useLoadable(fetchMyFavorites, []);

  const nickname = state.status === 'authed' ? state.user.nickname : '';

  const handleRemoveFavorite = (itemId: string): void => {
    deleteFavorite(itemId)
      .then(() => reloadFavorites())
      .catch(() => {
        // 失敗時は静かに諦める。再読み込み時に実際の状態と再同期される
      });
  };

  const setTab = (next: MyPageTab): void => {
    setSearchParams(next === 'bidding' ? {} : { tab: next });
  };

  return (
    <div className="container section">
      <h1 className="page-title">マイページ</h1>
      <p className="page-lead">{nickname} さんの入札・購入状況です。</p>

      <nav className="mypage-tabs" aria-label="マイページの表示切り替え">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`mypage-tabs__tab${tab === t.value ? ' active' : ''}`}
            aria-current={tab === t.value ? 'page' : undefined}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'bidding' ? (
        <ItemsPanel
          result={bidsResult}
          emptyText="現在入札中の出品はありません。"
          onReload={reloadBids}
          renderCard={(item, index) => (
            <ItemCard key={item.itemId} item={item} nowMs={nowMs} index={index} />
          )}
        />
      ) : null}

      {tab === 'wins' ? (
        winsResult.state === 'loading' ? (
          <div className="tiles" aria-busy="true">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="tile tile--skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : winsResult.state === 'error' ? (
          <div className="notice notice--error" role="alert">
            <p>{winsResult.message}</p>
            <button type="button" className="btn btn--ghost" onClick={reloadWins}>
              再読み込み
            </button>
          </div>
        ) : winsResult.data.items.length === 0 ? (
          <div className="notice">
            <p>まだ落札した品物はありません。</p>
            <Link className="btn btn--ghost" to="/items">
              出品一覧を見る
            </Link>
          </div>
        ) : (
          <div className="win-list">
            {winsResult.data.items.map((item) => (
              <WinCard key={item.itemId} item={item} />
            ))}
          </div>
        )
      ) : null}

      {tab === 'favorites' ? (
        <ItemsPanel
          result={favoritesResult}
          emptyText="お気に入り登録した出品はありません。"
          onReload={reloadFavorites}
          renderCard={(item, index) => (
            <FavoriteCard
              key={item.itemId}
              item={item}
              nowMs={nowMs}
              index={index}
              onRemove={handleRemoveFavorite}
            />
          )}
        />
      ) : null}
    </div>
  );
};
