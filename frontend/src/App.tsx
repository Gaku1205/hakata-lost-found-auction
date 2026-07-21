import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAdmin, RequireAuth } from './components/RequireAdmin';
import { AdminItemForm } from './pages/admin/AdminItemForm';
import { AdminItems } from './pages/admin/AdminItems';
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
  const isAuthed = state.status === 'authed';
  const isAdmin = isAuthed && state.user.isAdmin;

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label="めぐりモノ ホーム">
          <span className="brand__mark" aria-hidden="true">
            め
          </span>
          <span className="brand__name">めぐりモノ</span>
        </Link>
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
      </div>
    </footer>
  </>
);
