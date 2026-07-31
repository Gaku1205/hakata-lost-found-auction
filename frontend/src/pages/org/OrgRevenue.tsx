import { fetchOrgStats } from '../../api';
import { AllocationBar, StatTile } from '../../components/StatTiles';
import { yen } from '../../format';
import { useLoadable } from '../../hooks';
import { OrgTabs } from './OrgTabs';

export const OrgRevenue = (): JSX.Element => {
  const [result, reload] = useLoadable(fetchOrgStats, []);

  return (
    <div className="container section">
      <h1 className="page-title">出品元管理画面 — 収益情報</h1>
      <p className="page-lead">
        自分の出品元が登録した出品の実績です。落札代金は自治体の歳入・地域振興事業に充当されます。
      </p>
      <OrgTabs />

      {result.state === 'loading' ? (
        <div className="tiles" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
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
          <div className="tiles">
            <StatTile
              label="落札総額"
              value={yen(result.data.soldTotal)}
              note={`落札済み ${result.data.soldCount}件の合計`}
            />
            <StatTile
              label="入札中の総額"
              value={yen(result.data.activeBidTotal)}
              note="現在入札が入っている出品の合計"
            />
            <StatTile
              label="累計入札数"
              value={`${result.data.totalBids}件`}
              note="自分の出品への入札数"
            />
            <StatTile
              label="出品数"
              value={`${result.data.itemCount}件`}
              note={`出品中 ${result.data.activeCount}件 / 落札済み ${result.data.soldCount}件`}
            />
          </div>
          <AllocationBar stats={result.data} />
        </>
      ) : null}
    </div>
  );
};
