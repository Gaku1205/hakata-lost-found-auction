import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAdmin, RequireAuth } from './components/RequireAdmin';
import { AdminItemForm } from './pages/admin/AdminItemForm';
import { AdminItems } from './pages/admin/AdminItems';
import { AdminOrganizations } from './pages/admin/AdminOrganizations';
import { BidMonitor } from './pages/admin/BidMonitor';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { ItemDetail } from './pages/ItemDetail';
import { Login } from './pages/Login';
import { MyPage } from './pages/MyPage';
import { SignUp } from './pages/SignUp';

const ScrollToTop = (): null => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

type ImageCredit = {
  item: string;
  title: string;
  author: string;
  license: string;
  url: string;
};

const IMAGE_CREDITS: readonly ImageCredit[] = [
  { item: '折りたたみ傘', title: 'Folding umbrella 01', author: 'Kritzolina', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Folding_umbrella_01.jpg' },
  { item: 'ビニール傘', title: 'Umbrella', author: 'Jennifer Feuchter', license: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Umbrella_(2297730832).jpg' },
  { item: '二つ折り財布', title: 'Leather Wallet with a Strap Closure', author: 'Cooper Hewitt, Smithsonian Design Museum (DPLA)', license: 'No restrictions', url: 'https://commons.wikimedia.org/wiki/File:Leather_Wallet_with_a_Strap_Closure_-_DPLA_-_01e1cfae03bc0ce9106a5a7d5e4a9981_(page_1).jpg' },
  { item: '腕時計（アナログ）', title: 'Citizen Quartz two-tone wristwatch with date window', author: 'A S M Jobaer', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Citizen_Quartz_two-tone_wristwatch_with_date_window.jpg' },
  { item: 'ワイヤレスイヤホン', title: 'Technics EAH-AZ60M2', author: 'RuinDig / Yuki Uchida', license: 'CC BY 4.0', url: 'https://commons.wikimedia.org/wiki/File:Technics-EAH-AZ60M2_13.jpg' },
  { item: 'シティサイクル', title: 'Brosen city bicycle', author: 'Brosen', license: 'CC BY 2.5', url: 'https://commons.wikimedia.org/wiki/File:Brosen_city_bicycle.jpg' },
  { item: 'キャリーケース', title: 'Samsonite Pro-DLX 4 Rolling Tote 16.4 Inch Black', author: 'Florian Fuchs', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Samsonite_Pro-DLX_4_Rolling_Tote_16.4_Inch_Black.jpg' },
  { item: 'トートバッグ', title: 'Canvas two-tone tote Navy and Natural', author: 'Tom Beatty', license: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Canvas_two-tone_tote_Navy_and_Natural7_(9038437258).jpg' },
  { item: 'カーディガン', title: 'Brown Wool Knit Cardigan Sweater of Charles Lindbergh', author: 'Piqua Hosiery Co (DPLA)', license: 'Public domain', url: 'https://commons.wikimedia.org/wiki/File:Brown_Wool_Knit_Cardigan_Sweater_of_Charles_Lindbergh_-_DPLA_-_c76bd59b2824736409a2eb2dbbfb58b3_(page_2).jpg' },
  { item: 'ネックレス', title: "Magpie's Nest - silver necklace side view", author: 'W.carter', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Magpie%27s_Nest_-_silver_necklace_side_view.jpg' },
  { item: '文庫本セット', title: 'Book sale loot', author: 'Ginny (USA)', license: 'CC BY-SA 2.0', url: 'https://commons.wikimedia.org/wiki/File:Book_sale_loot_(4552277923).jpg' },
  { item: '折りたたみ自転車', title: 'Brompton1', author: 'Wikimedia Commons', license: 'Copyrighted free use', url: 'https://commons.wikimedia.org/wiki/File:Brompton1.jpeg' },
  { item: '腕時計（クロノグラフ）', title: 'Certina DS Podium', author: 'NobleK', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:Certina_DS_Podium.jpg' },
  { item: 'ショルダーバッグ', title: 'Black Leather Hermes Shoulder Bag', author: 'Indianapolis Museum of Art (DPLA)', license: 'No restrictions', url: 'https://commons.wikimedia.org/wiki/File:Black_Leather_Hermes_Shoulder_Bag_-_DPLA_-_0b27d01782af4c0fe73446eebd53b05a_(page_1).jpg' },
];

const NotFound = (): JSX.Element => (
  <div className="container section">
    <h1 className="page-title">ページが見つかりません</h1>
    <p className="page-lead">お探しのページは存在しないか、移動した可能性があります。</p>
    <Link className="btn btn--primary btn--fit" to="/">
      出品一覧へ戻る
    </Link>
  </div>
);

const UserMenu = (): JSX.Element => {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  if (state.status === 'loading') {
    return <span className="user-menu" aria-hidden="true" />;
  }

  if (state.status === 'anon') {
    return (
      <div className="user-menu">
        <NavLink to="/login" className="site-nav__link">
          ログイン
        </NavLink>
      </div>
    );
  }

  return (
    <div className="user-menu">
      <span className="user-menu__name" title={state.user.email}>
        {state.user.nickname} さん
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => {
          signOut();
          navigate('/');
        }}
      >
        ログアウト
      </button>
    </div>
  );
};

const Header = (): JSX.Element => {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthed = state.status === 'authed';
  const isAdmin = isAuthed && state.user.isAdmin;

  // ページ遷移でドロワーを閉じる
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label="めぐりモノ ホーム">
          <span className="brand__mark" aria-hidden="true">
            め
          </span>
          <span className="brand__name">めぐりモノ</span>
        </Link>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>

        <div id="site-menu" className={`site-menu${menuOpen ? ' site-menu--open' : ''}`}>
          <nav className="site-nav" aria-label="メインナビゲーション">
            <NavLink to="/" end className="site-nav__link">
              出品一覧
            </NavLink>
            <NavLink to="/dashboard" className="site-nav__link">
              収益ダッシュボード
            </NavLink>
            {isAuthed ? (
              <NavLink to="/mypage" className="site-nav__link">
                マイページ
              </NavLink>
            ) : null}
            {isAdmin ? (
              <NavLink to="/admin" className="site-nav__link site-nav__link--admin">
                管理画面
              </NavLink>
            ) : null}
          </nav>
          <UserMenu />
          <span className="demo-badge">デモ環境・模擬データ</span>
        </div>
      </div>
    </header>
  );
};

export const App = (): JSX.Element => (
  <>
    <a href="#main" className="skip-link">
      本文へスキップ
    </a>
    <ScrollToTop />
    <Header />

    <main id="main">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/items/:itemId" element={<ItemDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route
          path="/mypage"
          element={
            <RequireAuth>
              <MyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminItems />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/organizations"
          element={
            <RequireAdmin>
              <AdminOrganizations />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/monitor"
          element={
            <RequireAdmin>
              <BidMonitor />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/items/new"
          element={
            <RequireAdmin>
              <AdminItemForm />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/items/:itemId/edit"
          element={
            <RequireAdmin>
              <AdminItemForm />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>

    <footer className="site-footer">
      <div className="container">
        <p>
          めぐりモノ — 警察の遺失物を、地域の「欲しい」へつなぐオークション（コンテスト応募用デモ）
        </p>
        <p className="site-footer__note">
          掲載されている物品・入札・金額はすべて架空のデータです。実在の遺失物は取り扱っていません。
        </p>
        <details className="credits">
          <summary>出品イメージ画像クレジット（Wikimedia Commons）</summary>
          <ul className="credits__list">
            {IMAGE_CREDITS.map((c) => (
              <li key={c.url}>
                {c.item}: 「{c.title}」by {c.author}（
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.license}
                </a>
                ）
              </li>
            ))}
          </ul>
        </details>
      </div>
    </footer>
  </>
);
