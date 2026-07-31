import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  adminCloseItem,
  adminCompletePickup,
  adminDeleteItem,
  fetchItems,
} from '../../api';
import { handoverStatus, yen } from '../../format';
import { useLoadable } from '../../hooks';
import type { LostItem } from '../../types';
import { CATEGORY_LABELS } from '../../types';
import { AdminTabs } from './AdminTabs';

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

const AdminRow = ({ item, onChanged, onError }: RowProps): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true);
    action()
      .then(() => onChanged())
      .catch((err: unknown) => {
        onError(err instanceof ApiError ? err.message : '操作に失敗しました');
      })
      .finally(() => setBusy(false));
  };

  const handleClose = (): void => {
    if (!window.confirm(`「${item.title}」を終了して落札確定しますか？`)) return;
    run(() => adminCloseItem(item.itemId));
  };

  const handleDelete = (): void => {
    if (!window.confirm(`「${item.title}」を削除しますか？（入札履歴も削除されます）`)) return;
    run(() => adminDeleteItem(item.itemId));
  };

  const handleComplete = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (code.trim() === '') {
      onError('受取コードを入力してください');
      return;
    }
    run(() => adminCompletePickup(item.itemId, code.trim()));
  };

  return (
    <tr>
      <td data-label="品名">
        <Link to={`/items/${item.itemId}`}>{item.title}</Link>
        <span className="table-sub">{CATEGORY_LABELS[item.category]}</span>
      </td>
      <td data-label="状態">
        <span className={`status-chip status-chip--${item.status}`}>
          {item.status === 'active' ? '販売中' : '落札済み'}
        </span>
      </td>
      <td data-label="現在価格" className="table-num">{yen(item.currentPrice)}</td>
      <td data-label="入札" className="table-num">{item.bidCount}件</td>
      <td data-label="終了日時">{endTimeLabel(item.endTime)}</td>
      <td data-label="購入者">{item.status === 'sold' ? (item.winnerNickname ?? '—') : '—'}</td>
      <td data-label="受け取り日時">{item.status === 'sold' ? (item.pickupDate ?? '—') : '—'}</td>
      <td data-label="受け取りBOX番号">
        {item.status === 'sold' && item.pickupBoxNumber !== undefined
          ? `${item.pickupBoxNumber}番`
          : '—'}
      </td>
      <td data-label="受け取り状態">
        {item.status === 'sold' ? (
          <>
            <span className={`status-chip ${handoverStatus(item).chipClass}`}>
              {handoverStatus(item).label}
            </span>
            {item.pickupStatus === 'reserved' ? (
              <>
                <p className="table-sub">
                  窓口での代理照合（通常は購入者が無人ボックスで自己解錠します）
                </p>
                <form className="pickup-verify" onSubmit={handleComplete}>
                  <label className="sr-only" htmlFor={`code-${item.itemId}`}>
                    受取コード
                  </label>
                  <input
                    id={`code-${item.itemId}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="受取コード"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <button type="submit" className="btn btn--ghost btn--small" disabled={busy}>
                    照合して完了
                  </button>
                </form>
              </>
            ) : null}
          </>
        ) : (
          <span className="table-sub">—</span>
        )}
      </td>
      <td data-label="操作">
        <div className="table-actions">
          {item.status === 'active' ? (
            <>
              <Link
                className="btn btn--ghost btn--small"
                to={`/admin/items/${item.itemId}/edit`}
              >
                編集
              </Link>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busy || item.bidCount === 0}
                title={item.bidCount === 0 ? '入札がないため終了できません' : undefined}
                onClick={handleClose}
              >
                終了（落札確定）
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn--danger btn--small"
            disabled={busy}
            onClick={handleDelete}
          >
            削除
          </button>
        </div>
      </td>
    </tr>
  );
};

export const AdminItems = (): JSX.Element => {
  const [result, reload] = useLoadable(() => fetchItems(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="container section">
      <div className="admin-head">
        <div>
          <h1 className="page-title">管理画面 — 出品管理</h1>
          <p className="page-lead">
            出品の作成・編集・落札確定・受け渡し処理を行います（運営担当者専用）。
          </p>
        </div>
        <Link className="btn btn--primary btn--fit" to="/admin/items/new">
          ＋ 新規出品
        </Link>
      </div>
      <AdminTabs />

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
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>品名</th>
                <th>状態</th>
                <th>現在価格</th>
                <th>入札</th>
                <th>終了日時</th>
                <th>購入者</th>
                <th>受け取り日時</th>
                <th>受け取りBOX番号</th>
                <th>受け取り状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((item) => (
                <AdminRow
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
      ) : null}
    </div>
  );
};
