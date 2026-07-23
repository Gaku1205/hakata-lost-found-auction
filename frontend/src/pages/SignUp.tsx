import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthError } from '../auth/cognito';

type Step = 'form' | 'confirm';

export const SignUp = (): JSX.Element => {
  const { signUp, confirmSignUp, signIn } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('form');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSignUp = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const name = nickname.trim();
    if (name.length < 1 || name.length > 20) {
      setError('ニックネームは1〜20文字で入力してください');
      return;
    }
    if (email.trim() === '' || password === '') {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    setSubmitting(true);
    signUp(email.trim(), password, name)
      .then(() => {
        setStep('confirm');
        setSubmitting(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof AuthError ? err.message : '登録に失敗しました');
        setSubmitting(false);
      });
  };

  const handleConfirm = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (code.trim() === '') {
      setError('確認コードを入力してください');
      return;
    }
    setSubmitting(true);
    confirmSignUp(email.trim(), code.trim())
      .then(() => signIn(email.trim(), password))
      .then(() => navigate('/', { replace: true }))
      .catch((err: unknown) => {
        setError(err instanceof AuthError ? err.message : '確認に失敗しました');
        setSubmitting(false);
      });
  };

  return (
    <div className="container section">
      <div className="auth-card">
        {step === 'form' ? (
          <>
            <h1 className="page-title">新規登録</h1>
            <p className="page-lead">
              メールアドレスに確認コードが届きます。実在するメールアドレスをご利用ください。
            </p>
            <form onSubmit={handleSignUp} noValidate>
              <div className="field">
                <label htmlFor="signup-nickname">ニックネーム（入札時に表示されます）</label>
                <input
                  id="signup-nickname"
                  type="text"
                  maxLength={20}
                  autoComplete="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="signup-email">メールアドレス</label>
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="signup-password">パスワード</label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="field__help">8文字以上・大文字・小文字・数字を含む</p>
              </div>
              {error !== null ? (
                <p className="field__error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? '送信中…' : '確認コードを送信'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="page-title">確認コードの入力</h1>
            <p className="page-lead">
              {email} 宛に送信された6桁の確認コードを入力してください。
            </p>
            <form onSubmit={handleConfirm} noValidate>
              <div className="field">
                <label htmlFor="signup-code">確認コード</label>
                <input
                  id="signup-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error !== null ? (
                <p className="field__error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? '確認中…' : '登録を完了する'}
              </button>
            </form>
          </>
        )}
        <p className="auth-alt">
          すでにアカウントをお持ちの方は <Link to="/login">ログイン</Link>
        </p>
        <p className="auth-alt auth-alt--muted">
          警察・JRなど「出品元」としてのご利用には、運営による本人確認のうえアカウント発行が必要です。
          <Link to="/partners/apply">申し込みフォーム</Link>よりお問い合わせください。
        </p>
      </div>
    </div>
  );
};
