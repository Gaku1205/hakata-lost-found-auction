import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fetchOrgItems, postOrgHandover } from '../../api';
import { ItemListTabsNav } from '../../components/ItemListTabsNav';
import { Pagination } from '../../components/Pagination';
import { handoverStatus, yen } from '../../format';
import { useLoadable } from '../../hooks';
import { ITEM_LIST_PAGE_SIZE, countByTab, matchesItemListTab, type ItemListTab } from '../../itemListTabs';
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
  showSoldColumns: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
};

const OrgRow = ({ item, showSoldColumns, onChanged, onError }: RowProps): JSX.Element => {
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
      <td data-label="操作">
        {isSold ? (
          <span className="table-sub">—</span>
        ) : (
          <Link className="btn btn--ghost btn--small" to={`/org/items/${item.itemId}/edit`}>
            編集
          </Link>
        )}
      </td>
      {showSoldColumns ? (
        <>
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
        </>
      ) : null}
    </tr>
  );
};

export const OrgItems = (): JSX.Element => {
  const [result, reload] = useLoadable(fetchOrgItems, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<ItemListTab>('all');
  const [page, setPage] = useState(1);

  const allItems = result.state === 'ready' ? result.data.items : [];
  const counts = useMemo(() => countByTab(allItems), [allItems]);
  const filteredItems = useMemo(
    () => allItems.filter((item) => matchesItemListTab(item, tab)),
    [allItems, tab],
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEM_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredItems.slice(
    (currentPage - 1) * ITEM_LIST_PAGE_SIZE,
    currentPage * ITEM_LIST_PAGE_SIZE,
  );
  const showSoldColumns = tab !== 'active';

  const changeTab = (next: ItemListTab): void => {
    setTab(next);
    setPage(1);
  };

  return (
    <div className="container section">
      <div className="admin-head">
        <div>
          <h1 className="page-title">出品元管理画面 — 出品一覧</h1>
          <p className="page-lead">
            自分の出品元が登録した出品と、その落札・受け渡し状況を確認できます。落札後は受け取り拠点へ現物を納品したら「納品完了にする」を押してください。
          </p>
        </div>
        <Link className="btn btn--primary btn--fit" to="/org/items/new">
          ＋ 新規出品
        </Link>
      </div>
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
          <div className="notice">
            <p>まだ出品がありません。「＋ 新規出品」から登録できます。</p>
            <Link className="btn btn--ghost" to="/org/items/new">
              ＋ 新規出品
            </Link>
          </div>
        ) : (
          <>
            <ItemListTabsNav tab={tab} counts={counts} onChange={changeTab} />

            {filteredItems.length === 0 ? (
              <p className="empty">この条件に合う出品はありません。</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>品名</th>
                        <th>状態</th>
                        <th>現在価格 / 落札価格</th>
                        <th>入札</th>
                        <th>終了日時</th>
                        <th>操作</th>
                        {showSoldColumns ? (
                          <>
                            <th>購入者</th>
                            <th>受け取り日時</th>
                            <th>受け取りBOX番号</th>
                            <th>受け取り状態</th>
                            <th>納品</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((item) => (
                        <OrgRow
                          key={item.itemId}
                          item={item}
                          showSoldColumns={showSoldColumns}
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
                <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
              </>
            )}
          </>
        )
      ) : null}
    </div>
  );
};
