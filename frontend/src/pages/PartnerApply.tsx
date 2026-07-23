import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, postPartnerApplication } from '../api';
import type { OrgType } from '../types';
import { ORG_TYPE_LABELS } from '../types';

type Step = 'form' | 'done';

type FormState = {
  name: string;
  type: OrgType;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  message: string;
};

const INITIAL_FORM: FormState = {
  name: '',
  type: 'corporate',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  message: '',
};

export const PartnerApply = (): JSX.Element => {
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (form.name.trim() === '') {
      setError('法人・団体名を入力してください');
      return;
    }
    if (form.contactName.trim() === '') {
      setError('ご担当者名を入力してください');
      return;
    }
    if (form.contactEmail.trim() === '') {
      setError('メールアドレスを入力してください');
      return;
    }
    setSubmitting(true);
    postPartnerApplication({
      name: form.name.trim(),
      type: form.type,
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim() === '' ? undefined : form.contactPhone.trim(),
      message: form.message.trim() === '' ? undefined : form.message.trim(),
    })
      .then(() => {
        setStep('done');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '送信に失敗しました');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="container section">
      <div className="auth-card">
        {step === 'form' ? (
          <>
            <h1 className="page-title">出品元の申し込み</h1>
            <p className="page-lead">
              警察・自治体、JR・商業施設などの企業様を対象に、めぐりモノへの出品元登録を受け付けています。運営による確認後、担当者よりご連絡します。
            </p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="apply-name">法人・団体名</label>
                <input
                  id="apply-name"
                  type="text"
                  maxLength={40}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="apply-type">種別</label>
                <select
                  id="apply-type"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as OrgType })}
                >
                  {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="apply-contact-name">ご担当者名</label>
                <input
                  id="apply-contact-name"
                  type="text"
                  maxLength={40}
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="apply-email">メールアドレス</label>
                <input
                  id="apply-email"
                  type="email"
                  autoComplete="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="apply-phone">電話番号（任意）</label>
                <input
                  id="apply-phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="apply-message">お問い合わせ内容（任意）</label>
                <textarea
                  id="apply-message"
                  rows={4}
                  maxLength={500}
                  placeholder="想定される出品物や拠点の場所など"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
              </div>
              {error !== null ? (
                <p className="field__error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? '送信中…' : '申し込む'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="page-title">送信しました</h1>
            <p className="page-lead">
              お申し込みありがとうございます。運営にて内容を確認のうえ、担当者より折り返しご連絡します。
            </p>
            <Link className="btn btn--ghost btn--fit" to="/">
              トップページへ戻る
            </Link>
          </>
        )}
      </div>
    </div>
  );
};
