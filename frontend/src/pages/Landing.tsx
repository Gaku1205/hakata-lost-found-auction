import { Link } from 'react-router-dom';

type ConceptCard = { title: string; body: string };

const CONCEPT_CARDS: readonly ConceptCard[] = [
  {
    title: '官公庁オークション',
    body: '都道府県に帰属した遺失物を、業者への一括安値卸しではなく、住民が直接入札できる形でオンライン公開します。',
  },
  {
    title: 'JR博多駅の落とし物配布',
    body: '警察だけでなく、JR博多シティやキャナルシティ博多のような施設占有者拾得の物品も、同じプラットフォーム上で出品できます。',
  },
  {
    title: 'Amazonの無人宅配ボックス',
    body: '落札後は郵送を待たず、受取拠点の無人ボックスでQR・認証コードを使ってセルフ受け取りができます。',
  },
];

type StepCard = { step: string; title: string; body: string };

const STEP_CARDS: readonly StepCard[] = [
  { step: '01', title: '出品を見る', body: 'カテゴリ・価格・残り時間で気になる品を探せます。' },
  { step: '02', title: '入札する', body: '現在価格を超える金額でオンライン入札。吊り上げ対策も標準搭載です。' },
  { step: '03', title: '支払う', body: '落札後はマイページから決済（デモ環境のため実際の課金は発生しません）。' },
  { step: '04', title: '受け取る', body: '受取拠点の無人ボックスにコード・QRをかざしてセルフ受け取り。' },
];

type AudienceCard = { title: string; body: string };

const AUDIENCE_CARDS: readonly AudienceCard[] = [
  {
    title: '地域住民の方',
    body: '掘り出し物やお得なリユース品との新しい出会い。生活コストの削減にもつながります。',
  },
  {
    title: '警察・自治体職員の方',
    body: '出品〜入札〜落札確定までがオンラインで完結し、手作業での一括卸し対応の負担を軽減します。',
  },
  {
    title: '自治体・地域事業者の方',
    body: '落札収益は自治体の歳入・地域振興事業に充当され、地域経済の活性化に還元されます。',
  },
];

export const Landing = (): JSX.Element => (
  <>
    <section className="hero hero--pattern">
      <div className="container">
        <h1 className="hero__title">
          落とし物に、
          <br className="hero__break" />
          二度目の物語を。
        </h1>
        <p className="hero__lead">
          博多エリアで警察・企業に届けられ、持ち主が見つからなかった品々。
          地域のオークションで次の使い手へつなぎ、売上は自治体の歳入と地域振興に還元されます。
          落札品は郵送ではなく、まちの受取拠点でのお渡しです。
        </p>
        <div className="hero__cta-row">
          <Link className="btn btn--primary btn--fit" to="/items">
            出品一覧を見る
          </Link>
          <Link className="btn btn--ghost btn--fit" to="/partners/apply">
            企業・自治体の方へ
          </Link>
        </div>
      </div>
    </section>

    <section className="container section" aria-labelledby="landing-problem-heading">
      <h2 id="landing-problem-heading" className="section-heading">
        遺失物の多くは、住民の目に触れないまま処分されています
      </h2>
      <div className="panel">
        <ul className="landing-list">
          <li>
            警察に届く遺失物は全国で膨大な件数にのぼり、持ち主に返還されるのは約8割、拾得者への譲渡は約1割。残りは都道府県などに帰属し、処分されています。
          </li>
          <li>
            都道府県に帰属した遺失物の多くは、単一業者への一括安値売却で処理されており、住民が直接購入できる透明な仕組みがありませんでした。
          </li>
          <li>
            博多駅・天神・キャナルシティなど人流の多い交通・商業拠点を抱える博多エリアは、遺失物の取扱件数が多いと想定される地域です。
          </li>
        </ul>
      </div>
    </section>

    <section className="container section" aria-labelledby="landing-concept-heading">
      <h2 id="landing-concept-heading" className="section-heading">
        3つのアイデアの掛け合わせ
      </h2>
      <div className="concept-grid">
        {CONCEPT_CARDS.map((card) => (
          <div key={card.title} className="panel">
            <p className="panel__heading">{card.title}</p>
            <p>{card.body}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="container section" aria-labelledby="landing-steps-heading">
      <h2 id="landing-steps-heading" className="section-heading">
        使い方
      </h2>
      <div className="steps-grid">
        {STEP_CARDS.map((card) => (
          <div key={card.step} className="panel step-card">
            <span className="step-card__number" aria-hidden="true">
              {card.step}
            </span>
            <p className="panel__heading">{card.title}</p>
            <p>{card.body}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="container section" aria-labelledby="landing-org-heading">
      <h2 id="landing-org-heading" className="section-heading">
        出品元について
      </h2>
      <div className="org-type-grid">
        <div className="panel">
          <span className="org-badge org-badge--police">警察・自治体</span>
          <p>
            遺失物法に基づく保管期間の満了により都道府県等に帰属した物品を出品します。
          </p>
        </div>
        <div className="panel">
          <span className="org-badge org-badge--corporate">民間施設</span>
          <p>
            JR博多シティやキャナルシティ博多のような施設占有者拾得の物品も出品できます。企業・自治体として出品元になるには運営による本人確認の上でのアカウント発行が必要です。
          </p>
          <Link className="btn btn--ghost btn--fit" to="/partners/apply">
            出品元の申し込みはこちら
          </Link>
        </div>
      </div>
    </section>

    <section className="container section" aria-labelledby="landing-audience-heading">
      <h2 id="landing-audience-heading" className="section-heading">
        対象ユーザーと期待される効果
      </h2>
      <div className="audience-grid">
        {AUDIENCE_CARDS.map((card) => (
          <div key={card.title} className="panel">
            <p className="panel__heading">{card.title}</p>
            <p>{card.body}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="landing-cta">
      <div className="container landing-cta__inner">
        <div>
          <h2 className="section-heading">めぐりモノをはじめる</h2>
          <p className="page-lead">出品一覧を見るか、出品元としての参加をご検討ください。</p>
        </div>
        <div className="hero__cta-row">
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
