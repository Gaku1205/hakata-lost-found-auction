import { useState } from 'react';
import { ApiError, postOrgPickupComplete } from '../../api';
import { QrScannerModal } from '../../components/QrScannerModal';
import { OrgTabs } from './OrgTabs';

type ScanResult =
  | { kind: 'success'; title: string }
  | { kind: 'error'; message: string };

const parseQrPayload = (decodedText: string): { itemId: string; code: string } | null => {
  try {
    const parsed: unknown = JSON.parse(decodedText);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { itemId?: unknown; code?: unknown };
    if (typeof obj.itemId !== 'string' || typeof obj.code !== 'string') return null;
    return { itemId: obj.itemId, code: obj.code };
  } catch {
    return null;
  }
};

export const OrgPickupScan = (): JSX.Element => {
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const handleDetected = (decodedText: string): void => {
    setScanning(false);
    const payload = parseQrPayload(decodedText);
    if (payload === null) {
      setResult({ kind: 'error', message: 'QRコードを読み取れませんでした。受取用QRコードを読み取ってください。' });
      return;
    }
    setBusy(true);
    postOrgPickupComplete(payload.itemId, payload.code)
      .then((res) => {
        setResult({ kind: 'success', title: res.title });
      })
      .catch((err: unknown) => {
        setResult({
          kind: 'error',
          message: err instanceof ApiError ? err.message : '受け渡し完了処理に失敗しました',
        });
      })
      .finally(() => setBusy(false));
  };

  const handleScanNext = (): void => {
    setResult(null);
    setScanning(true);
  };

  return (
    <div className="container section">
      <h1 className="page-title">出品元管理画面 — 受け渡し読み取り</h1>
      <p className="page-lead">
        購入者のマイページに表示されているQRコードを読み取ると、自分の出品元が登録した商品に限り受け渡し完了処理を行います。他の出品元が登録した商品のQRコードを読み取った場合はエラーになります。
      </p>
      <OrgTabs />

      {result !== null ? (
        <div className={`notice ${result.kind === 'error' ? 'notice--error' : ''}`} role="alert">
          {result.kind === 'success' ? (
            <p>「{result.title}」の受け渡しが完了しました。</p>
          ) : (
            <p>{result.message}</p>
          )}
          <button type="button" className="btn btn--primary btn--fit" onClick={handleScanNext}>
            続けて読み取る
          </button>
        </div>
      ) : null}

      {busy ? <p className="page-lead">照合中…</p> : null}

      {scanning ? (
        <QrScannerModal
          title="購入者の受取QRコードを読み取ってください"
          onDetected={handleDetected}
          onClose={() => setScanning(false)}
        />
      ) : null}

      {!scanning && result === null && !busy ? (
        <button type="button" className="btn btn--primary btn--fit" onClick={() => setScanning(true)}>
          QRコードをスキャンする
        </button>
      ) : null}
    </div>
  );
};
