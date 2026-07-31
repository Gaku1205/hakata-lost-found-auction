import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  fetchItemDetail,
  orgCreateItem,
  orgRequestImageUploadUrl,
  orgUpdateItem,
} from '../../api';
import type { AdminItemInput, ConditionRank, ItemCategory } from '../../types';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONDITION_LABELS,
  CONDITION_ORDER,
  PICKUP_LOCATION_PRESETS,
  isConditionRank,
  isItemCategory,
} from '../../types';

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
};

export const OrgItemForm = (): JSX.Element => {
  const { itemId } = useParams<{ itemId: string }>();
  const isEdit = itemId !== undefined;
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [originalImageUrl, setOriginalImageUrl] = useState<string | undefined>(undefined);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

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
        });
        setOriginalImageUrl(item.imageUrl);
        setImagePreview(item.imageUrl ?? null);
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

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setImageError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError('JPEG・PNG・WEBP形式の画像を選択してください');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('画像サイズは5MB以内にしてください');
      return;
    }
    if (imagePreview !== null && imageFile !== null) {
      URL.revokeObjectURL(imagePreview);
    }
    setImageFile(file);
    setImageRemoved(false);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleRemoveImage = (): void => {
    if (imagePreview !== null && imageFile !== null) {
      URL.revokeObjectURL(imagePreview);
    }
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
    setImageError(null);
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
          const { item: created } = await orgCreateItem(baseInput);
          currentItemId = created.itemId;
        }
        if (currentItemId === undefined) {
          throw new Error('出品IDの取得に失敗しました');
        }

        let resolvedImageUrl = imageRemoved ? undefined : originalImageUrl;
        if (imageFile !== null) {
          setUploadingImage(true);
          const { uploadUrl, imageUrl } = await orgRequestImageUploadUrl(
            currentItemId,
            imageFile.type,
          );
          const putResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': imageFile.type },
            body: imageFile,
          });
          if (!putResponse.ok) {
            throw new Error('画像のアップロードに失敗しました');
          }
          resolvedImageUrl = imageUrl;
          setUploadingImage(false);
        }

        if (isEdit || imageFile !== null || imageRemoved) {
          await orgUpdateItem(currentItemId, { ...baseInput, imageUrl: resolvedImageUrl });
        }

        navigate('/org', { replace: true });
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
        <Link to="/org">出品一覧</Link>
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
            <label htmlFor="form-image">商品画像</label>
            <div className="image-upload">
              {imagePreview !== null ? (
                <img src={imagePreview} alt="" className="image-upload__preview" />
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
                  onChange={handleFileChange}
                />
                {imagePreview !== null ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={handleRemoveImage}
                  >
                    画像を削除
                  </button>
                ) : null}
              </div>
            </div>
            {imageError !== null ? (
              <p className="field__error" role="alert">
                {imageError}
              </p>
            ) : null}
            <p className="field__help">
              JPEG・PNG・WEBP、5MBまで。未設定の場合はカテゴリアイコンが表示されます
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
