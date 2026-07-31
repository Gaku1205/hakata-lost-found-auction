import type { Stats } from '../types';
import { yen } from '../format';

const MUNICIPAL_RATE = 0.6;

type TileProps = { label: string; value: string; note: string };

export const StatTile = ({ label, value, note }: TileProps): JSX.Element => (
  <div className="tile">
    <p className="tile__label">{label}</p>
    <p className="tile__value">{value}</p>
    <p className="tile__note">{note}</p>
  </div>
);

export const AllocationBar = ({ stats }: { stats: Stats }): JSX.Element => {
  const municipal = Math.round(stats.soldTotal * MUNICIPAL_RATE);
  const regional = stats.soldTotal - municipal;
  const municipalPct = Math.round(MUNICIPAL_RATE * 100);
  const regionalPct = 100 - municipalPct;

  return (
    <section className="panel" aria-label="収益の配分">
      <h2 className="panel__heading">落札総額の配分</h2>
      {stats.soldTotal === 0 ? (
        <p className="empty">まだ落札された物品がありません。</p>
      ) : (
        <>
          <div
            className="alloc-bar"
            role="img"
            aria-label={`自治体歳入 ${municipalPct}%（${yen(municipal)}）、地域振興事業 ${regionalPct}%（${yen(regional)}）`}
          >
            <div className="alloc-bar__seg alloc-bar__seg--municipal" style={{ flexBasis: `${municipalPct}%` }} />
            <div className="alloc-bar__seg alloc-bar__seg--regional" style={{ flexBasis: `${regionalPct}%` }} />
          </div>
          <ul className="legend">
            <li className="legend__item">
              <span className="legend__swatch legend__swatch--municipal" aria-hidden="true" />
              <span className="legend__label">自治体歳入（{municipalPct}%）</span>
              <span className="legend__value">{yen(municipal)}</span>
            </li>
            <li className="legend__item">
              <span className="legend__swatch legend__swatch--regional" aria-hidden="true" />
              <span className="legend__label">地域振興事業（{regionalPct}%）</span>
              <span className="legend__value">{yen(regional)}</span>
            </li>
          </ul>
          <p className="panel__footnote">※ 配分比率はデモ用の想定値です。</p>
        </>
      )}
    </section>
  );
};
