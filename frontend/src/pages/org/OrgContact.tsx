import { useState } from 'react';
import { ApiError, fetchOrgInquiries, postOrgInquiry } from '../../api';
import { useLoadable } from '../../hooks';
import { INQUIRY_STATUS_LABELS } from '../../types';
import { OrgTabs } from './OrgTabs';

const MESSAGE_MAX_LENGTH = 1000;

const dateTimeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const OrgContact = (): JSX.Element => {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, reload] = useLoadable(fetchOrgInquiries, []);

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
        reload();
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

      <h2 className="panel__heading inquiry-history-heading">これまでの問い合わせ</h2>

      {result.state === 'loading' ? (
        <div className="tiles" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="tile tile--skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : null}

      {result.state === 'error' ? (
        <div className="notice notice--error" role="alert">
          <p>{result.message}</p>
          <button type="button" className="btn btn--ghost" onClick={reload}>
            再読み込み
          </button>
        </div>
      ) : null}

      {result.state === 'ready' ? (
        result.data.inquiries.length === 0 ? (
          <p className="empty">まだ問い合わせはありません。</p>
        ) : (
          <ul className="inquiry-history">
            {result.data.inquiries.map((inquiry) => (
              <li key={inquiry.inquiryId} className="inquiry-history__item">
                <div className="inquiry-history__row">
                  <span className="table-sub">{dateTimeLabel(inquiry.createdAt)}</span>
                  <span className={`status-chip status-chip--${inquiry.status}`}>
                    {INQUIRY_STATUS_LABELS[inquiry.status]}
                  </span>
                </div>
                <p className="inquiry-history__message">{inquiry.message}</p>
                {inquiry.replyMessage !== undefined ? (
                  <div className="inquiry-history__reply">
                    <p className="inquiry-history__reply-label">運営からの返信</p>
                    <p>{inquiry.replyMessage}</p>
                    {inquiry.repliedAt !== undefined ? (
                      <p className="table-sub">{dateTimeLabel(inquiry.repliedAt)}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="table-sub">運営からの返信をお待ちください。</p>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
};
