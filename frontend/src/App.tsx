import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { ItemDetail } from './pages/ItemDetail';

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
    <Link className="btn btn--primary" to="/">
      出品一覧へ戻る
    </Link>
  </div>
);

export const App = (): JSX.Element => (
  <>
    <a href="#main" className="skip-link">
      本文へスキップ
    </a>
    <ScrollToTop />
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
        </nav>
        <span className="demo-badge">デモ環境・模擬データ</span>
      </div>
    </header>

    <main id="main">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/items/:itemId" element={<ItemDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
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
