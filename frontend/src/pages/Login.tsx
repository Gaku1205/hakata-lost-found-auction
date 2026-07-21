import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthError } from '../auth/cognito';

const DEMO_ACCOUNTS = [
  {
    label: '一般ユーザーでお試しログイン',
    email: 'demo@example.com',
    password: 'REDACTED_DEMO_PASSWORD',
  },
  {
    label: '管理者でお試しログイン',
    email: 'admin@example.com',
    password: 'REDACTED_ADMIN_PASSWORD',
  },
] as const;

const returnToOf = (state: unknown): string => {
  if (typeof state === 'object' && state !== null) {
    const returnTo = (state as Record<string, unknown>).returnTo;
    if (typeof returnTo === 'string') return returnTo;
  }
  return '/';
};

export const Login = (): JSX.Element => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToOf(location.state);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const doSignIn = (targetEmail: string, targetPassword: string): void => {
    setError(null);
    setSubmitting(true);
    signIn(targetEmail, targetPassword)
      .then(() => navigate(returnTo, { replace: true }))
      .catch((err: unknown) => {
        setError(err instanceof AuthError ? err.message : 'ログインに失敗しました');
        setSubmitting(false);
      });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (email.trim() === '' || password === '') {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    doSignIn(email.trim(), password);
  };

  return (
    <div className="container section">
      <div className="auth-card">
        <h1 className="page-title">ログイン</h1>
        <p className="page-lead">入札や受取手続きにはログインが必要です。</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">メールアドレス</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">パスワード</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <div className="demo-login">
          <p className="demo-login__heading">審査用デモアカウント</p>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="btn btn--ghost"
              disabled={submitting}
              onClick={() => doSignIn(account.email, account.password)}
            >
              {account.label}
            </button>
          ))}
        </div>

        <p className="auth-alt">
          アカウントをお持ちでない方は <Link to="/signup">新規登録</Link>
        </p>
      </div>
    </div>
  );
};
