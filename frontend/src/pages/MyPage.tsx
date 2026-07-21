import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { ApiError, fetchMyWins, postPickupReservation } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { yen } from '../format';
import { useLoadable } from '../hooks';
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
  pickupStatus: 'reserved';
  pickupDate: string;
  pickupCode: string;
};

const WinCard = ({ item }: { item: LostItem }): JSX.Element => {
  const [reservation, setReservation] = useState<ReservationState | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = reservation?.pickupStatus ?? item.pickupStatus ?? 'awaiting';
  const pickupDate = reservation?.pickupDate ?? item.pickupDate;
  const pickupCode = reservation?.pickupCode ?? item.pickupCode;
  const deadlineDay = dayOf(item.pickupDeadline);
  const today = new Date().toISOString().slice(0, 10);

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
        <CategoryIcon category={item.category} size={40} />
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
          <p className="pickup-done">受け渡し完了。ご利用ありがとうございました。</p>
        ) : status === 'reserved' && pickupCode !== undefined ? (
          <div className="pickup-panel">
            <p className="pickup-panel__label">受取予約日: {pickupDate}</p>
            <p className="pickup-panel__label">
              受取拠点でこのコードまたはQRを提示してください
            </p>
            <p className="pickup-code" aria-label={`受取コード ${pickupCode}`}>
              {pickupCode}
            </p>
            <PickupQr itemId={item.itemId} code={pickupCode} />
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

export const MyPage = (): JSX.Element => {
  const { state } = useAuth();
  const [result, reload] = useLoadable(fetchMyWins, []);
  const nickname = state.status === 'authed' ? state.user.nickname : '';

  return (
    <div className="container section">
      <h1 className="page-title">マイページ</h1>
      <p className="page-lead">
        {nickname} さんの落札した品物と受取手続きの状況です。
      </p>

      {result.state === 'loading' ? (
        <div className="tiles" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="tile tile--skeleton" aria-hidden="true" />
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
        result.data.items.length === 0 ? (
          <div className="notice">
            <p>まだ落札した品物はありません。</p>
            <Link className="btn btn--ghost" to="/">
              出品一覧を見る
            </Link>
          </div>
        ) : (
          <div className="win-list">
            {result.data.items.map((item) => (
              <WinCard key={item.itemId} item={item} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
};
