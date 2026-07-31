import { Link } from 'react-router-dom';

export const Landing = (): JSX.Element => (
  <>
    {/* ヒーロー: 実物の遺失物保管票を掲げる。配色・角丸・カード影はサイト共通トークンに揃える */}
    <section className="intro" aria-labelledby="landing-hero-heading">
      <div className="container intro__inner intro__inner--hero">
        <div>
          <p className="eyebrow">博多発・遺失物オークション</p>
          <h1 id="landing-hero-heading" className="intro__title">
            落とし物に、
            <br />
            二度目の物語を。
          </h1>
          <p className="intro__lead">
            博多エリアで警察・企業に届けられ、持ち主が見つからなかった品々。地域のオークションで次の使い手へつなぎ、売上は自治体の歳入と地域振興に還元されます。落札品は郵送ではなく、まちの受取拠点でのお渡しです。
          </p>
          <div className="intro__cta-row">
            <Link className="btn btn--primary btn--fit" to="/items">
              出品一覧を見る
            </Link>
            <Link className="btn btn--ghost btn--fit" to="/partners/apply">
              企業・自治体の方へ
            </Link>
          </div>
        </div>

        <div className="claim-tag" aria-hidden="true">
          <span className="claim-tag__stamp">受付済</span>
          <div className="claim-tag__hole" />
          <p className="claim-tag__eyebrow">遺失物 保管票</p>
          <p className="claim-tag__item">腕時計（クロノグラフ・革ベルト）</p>
          <dl className="claim-tag__meta">
            <div>
              <dt>整理番号</dt>
              <dd>JR博多シティ 2025-6998</dd>
            </div>
            <div>
              <dt>発見場所</dt>
              <dd>博多駅 新幹線改札前</dd>
            </div>
            <div>
              <dt>保管期限</dt>
              <dd>2026年2月20日</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    {/* 課題: 台帳の抜粋のように、数字を本文へ組み込む */}
    <section className="container section" aria-labelledby="landing-problem-heading">
      <p className="eyebrow">なぜ、めぐりモノなのか</p>
      <h2 id="landing-problem-heading" className="ledger__heading">
        遺失物の多くは、住民の目に触れないまま処分されています
      </h2>
      <div className="ledger__rows">
        <div className="ledger__row">
          <span className="ledger__stat">33.3%</span>
          <p>
            東京都だけで年間149.9万件の遺失物が「都へ帰属」。届出のあった449.8万件のうち3件に1件は持ち主のもとに戻らず、その多くが単一業者への一括安値売却で処理されており、住民が直接購入できる透明な仕組みがありませんでした。
          </p>
        </div>
        <div className="ledger__row">
          <span className="ledger__stat">13.3%</span>
          <p>
            遺失者への返還はわずか59.7万件。傘は33.2万点の拾得に対し返還率1.4%と、身近な物ほど戻りにくいのが実情です。
          </p>
        </div>
        <div className="ledger__row">
          <span className="ledger__stat">博多発</span>
          <p>博多駅・天神・キャナルシティなど人流の多い交通・商業拠点を抱える博多エリアは、遺失物の取扱件数が多いと想定される地域です。</p>
        </div>
      </div>
      <p className="panel__footnote">
        ※ 出典: 警視庁「遺失物取扱状況（令和7年中）」（東京都・令和7年、計449.8万件）。件数は都道府県により異なります。
      </p>
    </section>

    {/* コンセプト: 3つの掛け算 */}
    <section className="container section" aria-labelledby="landing-concept-heading">
      <p className="eyebrow">コンセプト</p>
      <h2 id="landing-concept-heading" className="ledger__heading">
        3つのアイデアの掛け合わせ
      </h2>
      <div className="equation">
        <div className="equation__card">
          <span className="equation__icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="13" height="18" rx="1.5" />
              <line x1="7" y1="8" x2="14" y2="8" />
              <line x1="7" y1="11.5" x2="14" y2="11.5" />
              <line x1="7" y1="15" x2="11" y2="15" />
              <circle cx="17.5" cy="17.5" r="4" />
              <path d="M15.8 17.6l1.1 1.1 2-2.2" />
            </svg>
          </span>
          <p className="equation__label">官公庁オークション</p>
          <p className="equation__desc">都道府県に帰属した遺失物を、業者への一括安値卸しではなく、住民が直接入札できる形でオンライン公開します。</p>
        </div>
        <span className="equation__op" aria-hidden="true">
          ＋
        </span>
        <div className="equation__card">
          <span className="equation__icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="4" width="14" height="12" rx="4" />
              <line x1="5" y1="10" x2="19" y2="10" />
              <circle cx="9" cy="13.2" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="15" cy="13.2" r="0.6" fill="currentColor" stroke="none" />
              <line x1="8" y1="16" x2="6.5" y2="20" />
              <line x1="16" y1="16" x2="17.5" y2="20" />
              <line x1="4" y1="20" x2="20" y2="20" />
            </svg>
          </span>
          <p className="equation__label">JR博多駅の落とし物配布</p>
          <p className="equation__desc">警察だけでなく、JR博多シティやキャナルシティ博多のような施設占有者拾得の物品も、同じプラットフォーム上で出品できます。</p>
        </div>
        <span className="equation__op" aria-hidden="true">
          ＋
        </span>
        <div className="equation__card equation__card--accent">
          <span className="equation__icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="7" width="16" height="13" rx="1.5" />
              <path d="M4 7l8-4 8 4" />
              <line x1="12" y1="7" x2="12" y2="20" />
              <path d="M8.5 12.5l1.8 1.8 3.2-3.6" />
            </svg>
          </span>
          <p className="equation__label">Amazonの無人宅配ボックス</p>
          <p className="equation__desc">落札後は郵送を待たず、受取拠点の無人ボックスでQR・認証コードを使ってセルフ受け取りができます。</p>
        </div>
      </div>
      <p className="equation__result">
        <span aria-hidden="true">＝</span>めぐりモノ
      </p>
    </section>

    {/* 使い方: 半券のようなタイムライン */}
    <section className="container section" aria-labelledby="landing-steps-heading">
      <p className="eyebrow">使い方</p>
      <h2 id="landing-steps-heading" className="ledger__heading">
        受付から受け渡しまで、4つの半券
      </h2>
      <ol className="ticket-line">
        <li className="ticket-line__stop">
          <span className="ticket-line__num">01</span>
          <p className="ticket-line__title">出品を見る</p>
          <p className="ticket-line__desc">カテゴリ・価格・残り時間で気になる品を探せます。</p>
        </li>
        <li className="ticket-line__stop">
          <span className="ticket-line__num">02</span>
          <p className="ticket-line__title">入札する</p>
          <p className="ticket-line__desc">現在価格を超える金額でオンライン入札。吊り上げ対策も標準搭載です。</p>
        </li>
        <li className="ticket-line__stop">
          <span className="ticket-line__num">03</span>
          <p className="ticket-line__title">支払う</p>
          <p className="ticket-line__desc">落札後はマイページから決済（デモ環境のため実際の課金は発生しません）。</p>
        </li>
        <li className="ticket-line__stop">
          <span className="ticket-line__num">04</span>
          <p className="ticket-line__title">受け取る</p>
          <p className="ticket-line__desc">受取拠点の無人ボックスにコード・QRをかざしてセルフ受け取り。</p>
        </li>
      </ol>
    </section>

    {/* 出品元について: 官の印影 と 民のタグ */}
    <section className="container section" aria-labelledby="landing-org-heading">
      <p className="eyebrow">出品元について</p>
      <h2 id="landing-org-heading" className="ledger__heading">
        公と民、2つの出品元
      </h2>
      <div className="org-row">
        <div className="org-row__card org-row__card--official">
          <span className="org-seal" aria-hidden="true">
            公
          </span>
          <p className="panel__heading">警察・自治体</p>
          <p className="org-row__desc">遺失物法に基づく保管期間の満了により都道府県等に帰属した物品を出品します。</p>
        </div>
        <div className="org-row__card">
          <span className="org-tag" aria-hidden="true">
            民間
          </span>
          <p className="panel__heading">民間施設</p>
          <p className="org-row__desc">
            JR博多シティやキャナルシティ博多のような施設占有者拾得の物品も出品できます。企業・自治体として出品元になるには運営による本人確認の上でのアカウント発行が必要です。
          </p>
          <Link className="btn btn--ghost btn--fit" to="/partners/apply">
            出品元の申し込みはこちら
          </Link>
        </div>
      </div>
    </section>

    {/* 締め: 対象ユーザーとCTA。淡い藍のトーンでページを締めくくる */}
    <section className="intro intro--closing" aria-labelledby="landing-closing-heading">
      <div className="container intro__inner">
        <p className="eyebrow">対象ユーザーと期待される効果</p>
        <h2 id="landing-closing-heading" className="intro__title intro__title--sm">
          誰にとっての、二度目の物語か。
        </h2>
        <div className="closing-list">
          <p>
            <strong>地域住民の方</strong> — 掘り出し物やお得なリユース品との新しい出会い。生活コストの削減にもつながります。
          </p>
          <p>
            <strong>警察・自治体職員の方</strong> —
            出品〜入札〜落札確定までがオンラインで完結し、手作業での一括卸し対応の負担を軽減します。
          </p>
          <p>
            <strong>自治体・地域事業者の方</strong> — 落札収益は自治体の歳入・地域振興事業に充当され、地域経済の活性化に還元されます。
          </p>
        </div>
        <div className="intro__cta-row">
          <Link className="btn btn--primary btn--fit" to="/items">
            出品一覧を見る
          </Link>
          <Link className="btn btn--ghost btn--fit" to="/partners/apply">
            企業の方はこちら
          </Link>
        </div>
      </div>
    </section>
  </>
);
