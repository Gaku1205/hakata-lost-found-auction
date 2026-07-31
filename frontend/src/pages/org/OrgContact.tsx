import { useState } from 'react';
import { ApiError, postOrgInquiry } from '../../api';
import { OrgTabs } from './OrgTabs';

const MESSAGE_MAX_LENGTH = 1000;

export const OrgContact = (): JSX.Element => {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (message.trim() === '') {
      setError('お問い合わせ内容を入力してください');
      return;
    }
    setSubmitting(true);
    postOrgInquiry(message.trim())
      .then(() => {
        setSent(true);
        setMessage('');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '送信に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="container section">
      <h1 className="page-title">出品元管理画面 — 運営への問い合わせ</h1>
      <p className="page-lead">
        出品内容の相談や不明点など、運営事務局への問い合わせをこちらから送信できます。
      </p>
      <OrgTabs />

      <div className="auth-card">
        {sent ? (
          <p className="bid-success">送信しました。運営にて内容を確認のうえ、必要に応じてご連絡します。</p>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="org-inquiry-message">お問い合わせ内容</label>
            <textarea
              id="org-inquiry-message"
              rows={6}
              maxLength={MESSAGE_MAX_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </div>
          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? '送信中…' : '送信する'}
          </button>
        </form>
      </div>
    </div>
  );
};
