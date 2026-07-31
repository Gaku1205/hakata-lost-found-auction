import { useState } from 'react';
import { ApiError, adminReplyInquiry, adminListInquiries, adminReviewInquiry } from '../../api';
import { useLoadable } from '../../hooks';
import type { Inquiry } from '../../types';
import { INQUIRY_STATUS_LABELS } from '../../types';
import { AdminTabs } from './AdminTabs';

const dateTimeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

type RowProps = {
  inquiry: Inquiry;
  onChanged: () => void;
  onError: (message: string) => void;
};

const AdminRow = ({ inquiry, onChanged, onError }: RowProps): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState('');

  const handleReview = (): void => {
    setBusy(true);
    adminReviewInquiry(inquiry.inquiryId)
      .then(() => onChanged())
      .catch((err: unknown) => {
        onError(err instanceof ApiError ? err.message : '操作に失敗しました');
      })
      .finally(() => setBusy(false));
  };

  const handleReply = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (replyText.trim() === '') {
      onError('返信内容を入力してください');
      return;
    }
    setBusy(true);
    adminReplyInquiry(inquiry.inquiryId, replyText.trim())
      .then(() => {
        setReplyText('');
        onChanged();
      })
      .catch((err: unknown) => {
        onError(err instanceof ApiError ? err.message : '操作に失敗しました');
      })
      .finally(() => setBusy(false));
  };

  return (
    <tr>
      <td data-label="日時">{dateTimeLabel(inquiry.createdAt)}</td>
      <td data-label="出品元">{inquiry.orgName}</td>
      <td data-label="内容">{inquiry.message}</td>
      <td data-label="状態">
        <span className={`status-chip status-chip--${inquiry.status}`}>
          {INQUIRY_STATUS_LABELS[inquiry.status]}
        </span>
      </td>
      <td data-label="返信">
        {inquiry.replyMessage !== undefined ? (
          <>
            <p>{inquiry.replyMessage}</p>
            {inquiry.repliedAt !== undefined ? (
              <p className="table-sub">{dateTimeLabel(inquiry.repliedAt)} 返信済み</p>
            ) : null}
          </>
        ) : (
          <>
            <form className="pickup-verify" onSubmit={handleReply}>
              <label className="sr-only" htmlFor={`reply-${inquiry.inquiryId}`}>
                返信内容
              </label>
              <textarea
                id={`reply-${inquiry.inquiryId}`}
                rows={2}
                maxLength={1000}
                placeholder="返信内容を入力"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <button type="submit" className="btn btn--primary btn--small" disabled={busy}>
                返信する
              </button>
            </form>
            {inquiry.status === 'new' ? (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busy}
                onClick={handleReview}
              >
                返信せず確認済みにする
              </button>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
};

export const AdminInquiries = (): JSX.Element => {
  const [result, reload] = useLoadable(() => adminListInquiries(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="container section">
      <h1 className="page-title">管理画面 — 問い合わせ管理</h1>
      <p className="page-lead">出品元アカウントから運営宛に届いた問い合わせを確認し、返信します。</p>
      <AdminTabs />

      {actionError !== null ? (
        <div className="notice notice--error" role="alert">
          <p>{actionError}</p>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setActionError(null)}
          >
            閉じる
          </button>
        </div>
      ) : null}

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
          <p className="empty">問い合わせはまだありません。</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>出品元</th>
                  <th>内容</th>
                  <th>状態</th>
                  <th>返信</th>
                </tr>
              </thead>
              <tbody>
                {result.data.inquiries.map((inquiry) => (
                  <AdminRow
                    key={inquiry.inquiryId}
                    inquiry={inquiry}
                    onChanged={() => {
                      setActionError(null);
                      reload();
                    }}
                    onError={setActionError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
};
