import { useState } from 'react';
import { ApiError, adminListPartnerApplications, adminReviewPartnerApplication } from '../../api';
import { useLoadable } from '../../hooks';
import type { PartnerApplication } from '../../types';
import { ORG_TYPE_LABELS, PARTNER_APPLICATION_STATUS_LABELS } from '../../types';
import { AdminTabs } from './AdminTabs';

const dateTimeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

type RowProps = {
  application: PartnerApplication;
  onChanged: () => void;
  onError: (message: string) => void;
};

const AdminRow = ({ application, onChanged, onError }: RowProps): JSX.Element => {
  const [busy, setBusy] = useState(false);

  const handleReview = (): void => {
    setBusy(true);
    adminReviewPartnerApplication(application.applicationId)
      .then(() => onChanged())
      .catch((err: unknown) => {
        onError(err instanceof ApiError ? err.message : '操作に失敗しました');
      })
      .finally(() => setBusy(false));
  };

  return (
    <tr>
      <td data-label="申込日時">{dateTimeLabel(application.createdAt)}</td>
      <td data-label="法人・団体名">
        {application.name}
        <span className={`org-badge org-badge--${application.type}`}>
          {ORG_TYPE_LABELS[application.type]}
        </span>
      </td>
      <td data-label="担当者">{application.contactName}</td>
      <td data-label="連絡先">
        <span className="table-sub">{application.contactEmail}</span>
        {application.contactPhone !== undefined ? (
          <span className="table-sub">{application.contactPhone}</span>
        ) : null}
      </td>
      <td data-label="内容">{application.message ?? '—'}</td>
      <td data-label="状態">
        <span className={`status-chip status-chip--${application.status}`}>
          {PARTNER_APPLICATION_STATUS_LABELS[application.status]}
        </span>
      </td>
      <td data-label="操作">
        {application.status === 'new' ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            onClick={handleReview}
          >
            確認済みにする
          </button>
        ) : (
          <span className="table-sub">—</span>
        )}
      </td>
    </tr>
  );
};

export const AdminPartnerApplications = (): JSX.Element => {
  const [result, reload] = useLoadable(() => adminListPartnerApplications(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="container section">
      <h1 className="page-title">管理画面 — 出品元申し込み</h1>
      <p className="page-lead">
        企業・自治体からの出品元申し込みを確認します。実際の出品元登録は「出品元管理」から行ってください。
      </p>
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
        result.data.applications.length === 0 ? (
          <p className="empty">申し込みはまだありません。</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>申込日時</th>
                  <th>法人・団体名</th>
                  <th>担当者</th>
                  <th>連絡先</th>
                  <th>内容</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {result.data.applications.map((application) => (
                  <AdminRow
                    key={application.applicationId}
                    application={application}
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
