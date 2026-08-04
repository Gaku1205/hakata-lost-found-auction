import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  adminCreateOrganization,
  adminListOrganizations,
  adminProvisionOrgLogin,
} from '../../api';
import { formatDate } from '../../format';
import { useLoadable } from '../../hooks';
import type { Organization, OrgType } from '../../types';
import { ORG_TYPE_LABELS } from '../../types';
import { AdminTabs } from './AdminTabs';

const OrgLoginCell = ({
  organization,
  onProvisioned,
}: {
  organization: Organization;
  onProvisioned: () => void;
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (organization.loginSub !== undefined) {
    return <span className="status-chip status-chip--sold">発行済み</span>;
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen(true)}>
        ログインを発行
      </button>
    );
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (email.trim() === '' || password.trim() === '') {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    setSubmitting(true);
    adminProvisionOrgLogin(organization.orgId, email.trim(), password)
      .then(() => {
        setOpen(false);
        onProvisioned();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '発行に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form className="org-login-form" onSubmit={handleSubmit} noValidate>
      <input
        type="email"
        placeholder="ログイン用メールアドレス"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="text"
        placeholder="初期パスワード（8文字以上）"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error !== null ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="table-actions">
        <button type="submit" className="btn btn--primary btn--small" disabled={submitting}>
          {submitting ? '発行中…' : '発行する'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          キャンセル
        </button>
      </div>
    </form>
  );
};

type FormState = {
  orgCode: string;
  name: string;
  type: OrgType;
  contactNote: string;
};

const INITIAL_FORM: FormState = { orgCode: '', name: '', type: 'police', contactNote: '' };

const ORG_CODE_PATTERN = /^[A-Z0-9]{2,6}$/;

export const AdminOrganizations = (): JSX.Element => {
  const [result, reload] = useLoadable(() => adminListOrganizations(), []);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (form.name.trim() === '') {
      setError('出品元名を入力してください');
      return;
    }
    const orgCode = form.orgCode.trim().toUpperCase();
    if (!ORG_CODE_PATTERN.test(orgCode)) {
      setError('出品元コードは英大文字・数字2〜6文字で入力してください（例: JRH）');
      return;
    }
    setSubmitting(true);
    adminCreateOrganization({
      orgCode,
      name: form.name.trim(),
      type: form.type,
      contactNote: form.contactNote.trim() === '' ? undefined : form.contactNote.trim(),
    })
      .then(() => {
        setForm(INITIAL_FORM);
        reload();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '登録に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="container section">
      <div className="admin-head">
        <div>
          <h1 className="page-title">管理画面 — 出品元管理</h1>
          <p className="page-lead">
            警察・自治体や企業など、出品元アカウントは運営が本人確認のうえ代理登録します。
          </p>
        </div>
      </div>
      <AdminTabs />

      <div className="admin-org-layout">
        <form className="admin-org-form" onSubmit={handleSubmit} noValidate>
          <h2 className="panel__heading">＋ 出品元を追加</h2>
          <div className="field">
            <label htmlFor="org-code">出品元コード</label>
            <input
              id="org-code"
              type="text"
              maxLength={6}
              placeholder="例: JRH"
              value={form.orgCode}
              onChange={(e) => setForm((f) => ({ ...f, orgCode: e.target.value.toUpperCase() }))}
              required
            />
            <p className="field__help">
              英大文字・数字2〜6文字。整理番号（例: JRH-20260401-1234）の先頭に使われます。
            </p>
          </div>
          <div className="field">
            <label htmlFor="org-name">出品元名</label>
            <input
              id="org-name"
              type="text"
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="org-type">種別</label>
            <select
              id="org-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as OrgType }))}
            >
              {(Object.entries(ORG_TYPE_LABELS) as [OrgType, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="org-contact">本人確認・担当者メモ（任意）</label>
            <textarea
              id="org-contact"
              rows={2}
              value={form.contactNote}
              onChange={(e) => setForm((f) => ({ ...f, contactNote: e.target.value }))}
            />
            <p className="field__help">運営内部の記録用です。一般公開はされません。</p>
          </div>
          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? '登録中…' : '出品元を登録する'}
          </button>
        </form>

        <div className="table-wrap">
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
            <table className="admin-table">
              <thead>
                <tr>
                  <th>コード</th>
                  <th>出品元名</th>
                  <th>種別</th>
                  <th>登録日</th>
                  <th>ログイン</th>
                  <th>出品</th>
                </tr>
              </thead>
              <tbody>
                {result.data.organizations.map((org) => (
                  <tr key={org.orgId}>
                    <td data-label="コード">{org.orgCode}</td>
                    <td data-label="出品元名">{org.name}</td>
                    <td data-label="種別">
                      <span className={`org-badge org-badge--${org.type}`}>
                        {ORG_TYPE_LABELS[org.type]}
                      </span>
                    </td>
                    <td data-label="登録日">{formatDate(org.createdAt.slice(0, 10))}</td>
                    <td data-label="ログイン">
                      <OrgLoginCell organization={org} onProvisioned={reload} />
                    </td>
                    <td data-label="出品">
                      <Link
                        className="btn btn--ghost btn--small"
                        to={`/admin?orgId=${encodeURIComponent(org.orgId)}`}
                      >
                        商品一覧を見る
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
};
