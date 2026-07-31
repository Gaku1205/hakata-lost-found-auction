import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const LoadingPane = (): JSX.Element => (
  <div className="container section" aria-busy="true">
    <div className="detail-skeleton" aria-hidden="true" />
  </div>
);

export const RequireAuth = ({ children }: { children: JSX.Element }): JSX.Element => {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingPane />;
  if (state.status === 'anon') {
    return (
      <Navigate
        to="/login"
        state={{ returnTo: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }
  return children;
};

export const RequireAdmin = ({ children }: { children: JSX.Element }): JSX.Element => {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingPane />;
  if (state.status === 'anon') {
    return (
      <Navigate
        to="/login"
        state={{ returnTo: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }
  if (!state.user.isAdmin) {
    return (
      <div className="container section">
        <h1 className="page-title">管理者権限がありません</h1>
        <p className="page-lead">
          このページは運営担当者専用です。一般アカウントではアクセスできません。
        </p>
      </div>
    );
  }
  return children;
};

export const RequireOrg = ({ children }: { children: JSX.Element }): JSX.Element => {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingPane />;
  if (state.status === 'anon') {
    return (
      <Navigate
        to="/login"
        state={{ returnTo: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }
  if (!state.user.isOrg) {
    return (
      <div className="container section">
        <h1 className="page-title">出品元権限がありません</h1>
        <p className="page-lead">
          このページは出品元（警察・自治体／企業）アカウント専用です。一般アカウントではアクセスできません。
        </p>
      </div>
    );
  }
  return children;
};
