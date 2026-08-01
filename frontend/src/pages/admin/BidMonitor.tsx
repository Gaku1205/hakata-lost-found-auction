import { Link } from 'react-router-dom';
import { adminFetchBidMonitor } from '../../api';
import { relativeTime, yen } from '../../format';
import { useLoadable, useNow } from '../../hooks';
import type { BidderSummary } from '../../types';
import { AdminTabs } from './AdminTabs';

const FlagBadges = ({ flags }: { flags: BidderSummary['flags'] }): JSX.Element => {
  if (!flags.sharedIp && !flags.rapidBids) {
    return <span className="flag flag--ok">問題なし</span>;
  }
  return (
    <span className="flag-group">
      {flags.sharedIp ? (
        <span className="flag flag--warn" title="同一IPアドレスから複数のアカウントが入札しています">
          同一IP複数アカウント
        </span>
      ) : null}
      {flags.rapidBids ? (
        <span className="flag flag--warn" title="短時間に連続した入札が検出されました">
          短時間の連続入札
        </span>
      ) : null}
    </span>
  );
};

export const BidMonitor = (): JSX.Element => {
  const [result, reload] = useLoadable(adminFetchBidMonitor, []);
  const nowMs = useNow();

  return (
    <div className="container section">
      <h1 className="page-title">管理画面 — 入札監視</h1>
      <p className="page-lead">
        吊り上げ行為・サクラアカウントの兆候を自動検知します（同一IPの複数アカウント / 短時間の連続入札）。
      </p>
      <AdminTabs />

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
        <>
          <section className="panel monitor-panel" aria-label="入札者別サマリー">
            <h2 className="panel__heading">入札者別サマリー</h2>
            <div className="table-wrap table-wrap--flat">
              <table className="admin-table admin-table--monitor">
                <thead>
                  <tr>
                    <th>入札者</th>
                    <th>検知フラグ</th>
                    <th>入札数</th>
                    <th>対象出品</th>
                    <th>利用IP</th>
                    <th>最終入札</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.bidders.map((bidder) => (
                    <tr
                      key={bidder.bidderSub}
                      className={
                        bidder.flags.sharedIp || bidder.flags.rapidBids
                          ? 'monitor-row--flagged'
                          : undefined
                      }
                    >
                      <td data-label="入札者">{bidder.bidderName}</td>
                      <td data-label="検知フラグ">
                        <FlagBadges flags={bidder.flags} />
                      </td>
                      <td data-label="入札数" className="table-num">
                        {bidder.bidCount}件
                      </td>
                      <td data-label="対象出品" className="table-num">
                        {bidder.itemCount}件
                      </td>
                      <td data-label="利用IP">
                        {bidder.ips.length === 0 ? '—' : bidder.ips.join(', ')}
                      </td>
                      <td data-label="最終入札">
                        {bidder.lastBidAt === '' ? '—' : relativeTime(bidder.lastBidAt, nowMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel__footnote">
              ※ フラグは自動検知による参考情報です。実運用ではアカウント停止・入札取消などの措置フローに接続します。
            </p>
          </section>

          <section className="panel monitor-panel" aria-label="直近の入札">
            <h2 className="panel__heading">直近の入札（最新20件）</h2>
            <ul className="monitor-feed">
              {result.data.recentBids.map((bid) => (
                <li key={`${bid.itemId}-${bid.bidId}`} className="monitor-feed__row">
                  <span className="monitor-feed__name">{bid.bidderName}</span>
                  <Link className="monitor-feed__item" to={`/items/${bid.itemId}`}>
                    {bid.itemTitle}
                  </Link>
                  <span className="monitor-feed__amount">{yen(bid.amount)}</span>
                  <span className="monitor-feed__meta">
                    {bid.sourceIp === '' ? '—' : bid.sourceIp} ・ {relativeTime(bid.createdAt, nowMs)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
};
