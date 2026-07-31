import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fetchOrgItems, postOrgHandover } from '../../api';
import { handoverStatus, yen } from '../../format';
import { useLoadable } from '../../hooks';
import type { LostItem } from '../../types';
import { CATEGORY_LABELS } from '../../types';
import { OrgTabs } from './OrgTabs';

const endTimeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

type RowProps = {
  item: LostItem;
  onChanged: () => void;
  onError: (message: string) => void;
};

const OrgRow = ({ item, onChanged, onError }: RowProps): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const isSold = item.status === 'sold';
  const status = isSold ? handoverStatus(item) : null;

  const handleHandover = (): void => {
    setBusy(true);
    postOrgHandover(item.itemId)
      .then(() => onChanged())
      .catch((err: unknown) => {
        onError(err instanceof ApiError ? err.message : '操作に失敗しました');
      })
      .finally(() => setBusy(false));
  };

  return (
    <tr>
      <td data-label="品名">
        <Link to={`/items/${item.itemId}`}>{item.title}</Link>
        <span className="table-sub">{CATEGORY_LABELS[item.category]}</span>
      </td>
      <td data-label="状態">
        <span className={`status-chip status-chip--${item.status}`}>
          {isSold ? '落札済み' : '販売中'}
        </span>
      </td>
      <td data-label="現在価格 / 落札価格" className="table-num">
        {yen(item.currentPrice)}
      </td>
      <td data-label="入札" className="table-num">
        {item.bidCount}件
      </td>
      <td data-label="終了日時">{endTimeLabel(item.endTime)}</td>
      <td data-label="購入者">{isSold ? (item.winnerNickname ?? '—') : '—'}</td>
      <td data-label="受け取り日時">{isSold ? (item.pickupDate ?? '—') : '—'}</td>
      <td data-label="受け取りBOX番号">
        {isSold && item.pickupBoxNumber !== undefined ? `${item.pickupBoxNumber}番` : '—'}
      </td>
      <td data-label="受け取り状態">
        {status !== null ? (
          <span className={`status-chip ${status.chipClass}`}>{status.label}</span>
        ) : (
          '—'
        )}
      </td>
      <td data-label="納品">
        {!isSold ? (
          '—'
        ) : item.orgHandoverAt !== undefined ? (
          <span className="table-sub">納品済み</span>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            onClick={handleHandover}
          >
            納品完了にする
          </button>
        )}
      </td>
    </tr>
  );
};

export const OrgItems = (): JSX.Element => {
  const [result, reload] = useLoadable(fetchOrgItems, []);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="container section">
      <h1 className="page-title">出品元管理画面 — 出品一覧</h1>
      <p className="page-lead">
        自分の出品元が登録した出品と、その落札・受け渡し状況を確認できます。落札後は受け取り拠点へ現物を納品したら「納品完了にする」を押してください。
      </p>
      <OrgTabs />

      {actionError !== null ? (
        <div className="notice notice--error" role="alert">
          <p>{actionError}</p>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setActionError(null)}
          >
            閉じる
          </button>
        </div>
      ) : null}

      {result.state === 'loading' ? (
        <div className="tiles" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
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
          <p className="empty">まだ出品がありません。出品の登録は運営にお問い合わせください。</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>品名</th>
                  <th>状態</th>
                  <th>現在価格 / 落札価格</th>
                  <th>入札</th>
                  <th>終了日時</th>
                  <th>購入者</th>
                  <th>受け取り日時</th>
                  <th>受け取りBOX番号</th>
                  <th>受け取り状態</th>
                  <th>納品</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((item) => (
                  <OrgRow
                    key={item.itemId}
                    item={item}
                    onChanged={() => {
                      setActionError(null);
                      reload();
                    }}
                    onError={setActionError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
};
