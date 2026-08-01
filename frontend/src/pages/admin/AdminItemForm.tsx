import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  adminAnalyzeItemImage,
  adminCreateItem,
  adminListOrganizations,
  adminRequestImageUploadUrl,
  adminUpdateItem,
  fetchItemDetail,
} from '../../api';
import { prepareImageForAnalysis } from '../../imageAnalysis';
import type {
  AdminItemInput,
  ConditionRank,
  ItemCategory,
  ItemSuggestion,
  OrgType,
  Organization,
} from '../../types';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONDITION_LABELS,
  CONDITION_ORDER,
  MAX_ITEM_IMAGES,
  ORG_TYPE_LABELS,
  PICKUP_LOCATION_PRESETS,
  isConditionRank,
  isItemCategory,
} from '../../types';

type ImageSlot =
  | { kind: 'existing'; url: string }
  | { kind: 'new'; file: File; previewUrl: string };

type FormState = {
  title: string;
  category: ItemCategory;
  description: string;
  foundLocation: string;
  foundMonth: string;
  pickupLocation: string;
  startPrice: string;
  endTimeLocal: string;
  conditionRank: ConditionRank;
  quantity: string;
  foundDate: string;
  accessories: string;
  size: string;
  color: string;
  brand: string;
  orgId: string;
};

const defaultEndTimeLocal = (): string => {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const isoToLocalInput = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return defaultEndTimeLocal();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const defaultFoundDate = (): string => new Date().toISOString().slice(0, 10);

const INITIAL_FORM: FormState = {
  title: '',
  category: 'umbrella',
  description: '',
  foundLocation: '',
  foundMonth: '2026-06',
  pickupLocation: PICKUP_LOCATION_PRESETS[0] ?? '',
  startPrice: '100',
  endTimeLocal: defaultEndTimeLocal(),
  conditionRank: 'good',
  quantity: '1',
  foundDate: defaultFoundDate(),
  accessories: '',
  size: '',
  color: '',
  brand: '',
  orgId: '',
};

export const AdminItemForm = (): JSX.Element => {
  const { itemId } = useParams<{ itemId: string }>();
  const isEdit = itemId !== undefined;
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [existingOrg, setExistingOrg] = useState<{ name: string; type: OrgType } | null>(null);

  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    adminListOrganizations()
      .then(({ organizations: orgs }) => {
        if (cancelled) return;
        setOrganizations(orgs);
        const first = orgs[0];
        if (first !== undefined) {
          setForm((prev) => ({ ...prev, orgId: first.orgId }));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOrgsError(err instanceof ApiError ? err.message : '出品元の取得に失敗しました');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    fetchItemDetail(itemId)
      .then(({ item }) => {
        if (cancelled) return;
        setForm({
          title: item.title,
          category: item.category,
          description: item.description,
          foundLocation: item.foundLocation,
          foundMonth: item.foundMonth,
          pickupLocation: item.pickupLocation ?? PICKUP_LOCATION_PRESETS[0] ?? '',
          startPrice: String(item.startPrice),
          endTimeLocal: isoToLocalInput(item.endTime),
          conditionRank: item.conditionRank,
          quantity: String(item.quantity),
          foundDate: item.foundDate,
          accessories: item.accessories ?? '',
          size: item.size ?? '',
          color: item.color ?? '',
          brand: item.brand ?? '',
          orgId: item.orgId,
        });
        setExistingOrg({ name: item.orgName, type: item.orgType });
        setImageSlots((item.imageUrls ?? []).map((url) => ({ kind: 'existing', url })));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '読み込みに失敗しました');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, itemId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // AIの推定値は、まだ入力されていない欄にだけ入れる（入力済みの内容は上書きしない）。
  // カテゴリと状態ランクは初期値がある選択肢なので、常に推定値を反映する。
  const applySuggestion = (suggestion: ItemSuggestion): void => {
    setForm((prev) => ({
      ...prev,
      category: suggestion.category,
      conditionRank: suggestion.conditionRank,
      title: prev.title.trim() === '' ? suggestion.title : prev.title,
      description: prev.description.trim() === '' ? suggestion.description : prev.description,
      color: prev.color.trim() === '' ? suggestion.color : prev.color,
      brand: prev.brand.trim() === '' ? suggestion.brand : prev.brand,
      size: prev.size.trim() === '' ? suggestion.size : prev.size,
      accessories: prev.accessories.trim() === '' ? suggestion.accessories : prev.accessories,
    }));
  };

  const runAnalysis = (files: File[]): void => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setAnalyzed(false);
    setAnalyzeError(null);
    void (async () => {
      try {
        const prepared = await Promise.all(files.map((file) => prepareImageForAnalysis(file)));
        const images = prepared.map((p) => ({ imageBase64: p.base64, mediaType: p.mediaType }));
        const { suggestion } = await adminAnalyzeItemImage(images);
        applySuggestion(suggestion);
        setAnalyzed(true);
      } catch (err: unknown) {
        setAnalyzeError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'AIによる自動入力に失敗しました',
        );
      } finally {
        setAnalyzing(false);
      }
    })();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setImageError(null);

    const remainingSlots = MAX_ITEM_IMAGES - imageSlots.length;
    if (remainingSlots <= 0) {
      setImageError(`画像は${MAX_ITEM_IMAGES}枚まで登録できます`);
      return;
    }

    const accepted: File[] = [];
    let rejectedByLimit = false;
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        rejectedByLimit = true;
        break;
      }
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setImageError('JPEG・PNG・WEBP形式の画像を選択してください');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError('画像サイズは5MB以内にしてください');
        continue;
      }
      accepted.push(file);
    }
    if (rejectedByLimit) {
      setImageError(`画像は${MAX_ITEM_IMAGES}枚まで登録できます`);
    }
    if (accepted.length === 0) return;

    const newSlots: ImageSlot[] = accepted.map((file) => ({
      kind: 'new',
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    const updatedSlots = [...imageSlots, ...newSlots];
    setImageSlots(updatedSlots);
    runAnalysis(
      updatedSlots.flatMap((slot) => (slot.kind === 'new' ? [slot.file] : [])),
    );
  };

  const handleRemoveSlot = (index: number): void => {
    setImageSlots((prev) => {
      const target = prev[index];
      if (target?.kind === 'new') URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
    setImageError(null);
  };

  const handleMakeThumbnail = (index: number): void => {
    setImageSlots((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return prev;
      next.unshift(moved);
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);

    const startPrice = Number.parseInt(form.startPrice, 10);
    if (Number.isNaN(startPrice) || startPrice < 1) {
      setError('開始価格は1円以上の整数で入力してください');
      return;
    }
    const endDate = new Date(form.endTimeLocal);
    if (Number.isNaN(endDate.getTime())) {
      setError('終了日時を入力してください');
      return;
    }
    if (!isEdit && endDate.getTime() <= Date.now()) {
      setError('終了日時は未来の日時を指定してください');
      return;
    }
    const quantity = Number.parseInt(form.quantity, 10);
    if (Number.isNaN(quantity) || quantity < 1 || quantity > 99) {
      setError('数量は1〜99の整数で入力してください');
      return;
    }
    if (Number.isNaN(new Date(form.foundDate).getTime())) {
      setError('拾得日を入力してください');
      return;
    }
    if (!isEdit && form.orgId === '') {
      setError('出品元を選択してください');
      return;
    }

    const baseInput: AdminItemInput = {
      title: form.title,
      category: form.category,
      description: form.description,
      foundLocation: form.foundLocation,
      foundMonth: form.foundMonth,
      pickupLocation: form.pickupLocation,
      startPrice,
      endTime: endDate.toISOString(),
      conditionRank: form.conditionRank,
      quantity,
      foundDate: form.foundDate,
      accessories: form.accessories.trim() === '' ? undefined : form.accessories.trim(),
      size: form.size.trim() === '' ? undefined : form.size.trim(),
      color: form.color.trim() === '' ? undefined : form.color.trim(),
      brand: form.brand.trim() === '' ? undefined : form.brand.trim(),
    };

    setSubmitting(true);

    void (async () => {
      try {
        let currentItemId = itemId;
        if (!isEdit) {
          const { item: created } = await adminCreateItem(baseInput, form.orgId);
          currentItemId = created.itemId;
        }
        if (currentItemId === undefined) {
          throw new Error('出品IDの取得に失敗しました');
        }

        const hasNewImages = imageSlots.some((slot) => slot.kind === 'new');
        if (hasNewImages) setUploadingImage(true);
        const resolvedUrls: string[] = [];
        for (const slot of imageSlots) {
          if (slot.kind === 'existing') {
            resolvedUrls.push(slot.url);
            continue;
          }
          const { uploadUrl, imageUrl } = await adminRequestImageUploadUrl(
            currentItemId,
            slot.file.type,
          );
          const putResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': slot.file.type },
            body: slot.file,
          });
          if (!putResponse.ok) {
            throw new Error('画像のアップロードに失敗しました');
          }
          resolvedUrls.push(imageUrl);
        }
        if (hasNewImages) setUploadingImage(false);

        if (isEdit || resolvedUrls.length > 0) {
          const imageUrls = resolvedUrls.length > 0 ? resolvedUrls : undefined;
          await adminUpdateItem(currentItemId, { ...baseInput, imageUrls });
        }

        navigate('/admin', { replace: true });
      } catch (err: unknown) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '保存に失敗しました',
        );
        setSubmitting(false);
        setUploadingImage(false);
      }
    })();
  };

  if (loading) {
    return (
      <div className="container section" aria-busy="true">
        <div className="detail-skeleton" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="container section">
      <nav className="breadcrumb" aria-label="パンくず">
        <Link to="/admin">出品管理</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{isEdit ? '出品を編集' : '新規出品'}</span>
      </nav>

      <div className="auth-card auth-card--wide">
        <h1 className="page-title">{isEdit ? '出品を編集' : '新規出品'}</h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="form-title">品名</label>
            <input
              id="form-title"
              type="text"
              maxLength={60}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="form-org">出品元</label>
            {isEdit ? (
              <p className="field__static">
                {existingOrg !== null
                  ? `${existingOrg.name}（${ORG_TYPE_LABELS[existingOrg.type]}）`
                  : '—'}
                <span className="field__help">出品元は作成後に変更できません</span>
              </p>
            ) : (
              <>
                <select
                  id="form-org"
                  value={form.orgId}
                  onChange={(e) => set('orgId', e.target.value)}
                  required
                >
                  {organizations.length === 0 ? <option value="">出品元を選択</option> : null}
                  {organizations.map((org) => (
                    <option key={org.orgId} value={org.orgId}>
                      {org.name}（{ORG_TYPE_LABELS[org.type]}）
                    </option>
                  ))}
                </select>
                {orgsError !== null ? (
                  <p className="field__error" role="alert">
                    {orgsError}（先に「出品元管理」タブから登録してください）
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="field">
            <label htmlFor="form-image">商品画像</label>
            <div className="image-upload">
              {imageSlots.length > 0 ? (
                <div className="image-upload__grid">
                  {imageSlots.map((slot, index) => (
                    <div
                      key={slot.kind === 'existing' ? slot.url : slot.previewUrl}
                      className="image-upload__item"
                    >
                      <img
                        src={slot.kind === 'existing' ? slot.url : slot.previewUrl}
                        alt=""
                        className="image-upload__preview"
                      />
                      {index === 0 ? (
                        <span className="image-upload__badge">サムネイル</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={() => handleMakeThumbnail(index)}
                        >
                          先頭にする
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => handleRemoveSlot(index)}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="image-upload__placeholder" aria-hidden="true">
                  画像未設定
                </div>
              )}
              <div className="image-upload__controls">
                <input
                  id="form-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleFileChange}
                  disabled={imageSlots.length >= MAX_ITEM_IMAGES}
                />
              </div>
            </div>
            {imageError !== null ? (
              <p className="field__error" role="alert">
                {imageError}
              </p>
            ) : null}
            {analyzing ? (
              <p className="ai-status" aria-live="polite">
                AIが画像を読み取って入力欄を補完しています…
              </p>
            ) : null}
            {analyzed ? (
              <p className="ai-status ai-status--done" aria-live="polite">
                AIが未入力の欄を自動入力しました。内容を確認・修正してください。
              </p>
            ) : null}
            {analyzeError !== null ? (
              <p className="ai-status ai-status--error" role="alert">
                {analyzeError}
                {imageSlots.some((slot) => slot.kind === 'new') ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      runAnalysis(
                        imageSlots.flatMap((slot) => (slot.kind === 'new' ? [slot.file] : [])),
                      )
                    }
                  >
                    再試行
                  </button>
                ) : null}
              </p>
            ) : null}
            <p className="field__help">
              複数枚選択できます（最大{MAX_ITEM_IMAGES}枚、先頭がサムネイルになります）。JPEG・PNG・WEBP、1枚5MBまで。画像を選ぶとAIが品名・カテゴリ・状態などを自動入力します
            </p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="form-category">カテゴリ</label>
              <select
                id="form-category"
                value={form.category}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isItemCategory(value)) set('category', value);
                }}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="form-found-month">拾得時期</label>
              <input
                id="form-found-month"
                type="month"
                value={form.foundMonth}
                onChange={(e) => set('foundMonth', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="form-condition">状態ランク</label>
              <select
                id="form-condition"
                value={form.conditionRank}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isConditionRank(value)) set('conditionRank', value);
                }}
              >
                {CONDITION_ORDER.map((rank) => (
                  <option key={rank} value={rank}>
                    {CONDITION_LABELS[rank]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="form-quantity">数量</label>
              <input
                id="form-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                step={1}
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="form-found-date">拾得日</label>
            <input
              id="form-found-date"
              type="date"
              value={form.foundDate}
              onChange={(e) => set('foundDate', e.target.value)}
              required
            />
            <p className="field__help">
              公告日・保管期間満了日・整理番号は拾得日から自動的に算出されます
            </p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="form-size">サイズ・寸法（任意）</label>
              <input
                id="form-size"
                type="text"
                value={form.size}
                onChange={(e) => set('size', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="form-color">色（任意）</label>
              <input
                id="form-color"
                type="text"
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="form-brand">ブランド・メーカー（任意）</label>
              <input
                id="form-brand"
                type="text"
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="form-accessories">付属品（任意）</label>
              <input
                id="form-accessories"
                type="text"
                placeholder="例: 元箱・保証書"
                value={form.accessories}
                onChange={(e) => set('accessories', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="form-description">状態説明</label>
            <textarea
              id="form-description"
              rows={3}
              maxLength={300}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="form-found-location">発見場所</label>
            <input
              id="form-found-location"
              type="text"
              value={form.foundLocation}
              onChange={(e) => set('foundLocation', e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="form-pickup-location">受取拠点</label>
            <input
              id="form-pickup-location"
              type="text"
              list="pickup-presets"
              value={form.pickupLocation}
              onChange={(e) => set('pickupLocation', e.target.value)}
              required
            />
            <datalist id="pickup-presets">
              {PICKUP_LOCATION_PRESETS.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
            <p className="field__help">落札者が現物を受け取りに行く場所です（郵送は行いません）</p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="form-start-price">開始価格（円）</label>
              <input
                id="form-start-price"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form.startPrice}
                onChange={(e) => set('startPrice', e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="form-end-time">終了日時</label>
              <input
                id="form-end-time"
                type="datetime-local"
                value={form.endTimeLocal}
                onChange={(e) => set('endTimeLocal', e.target.value)}
                required
              />
            </div>
          </div>

          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {uploadingImage
              ? '画像アップロード中…'
              : submitting
                ? '保存中…'
                : isEdit
                  ? '変更を保存'
                  : '出品する'}
          </button>
        </form>
      </div>
    </div>
  );
};
