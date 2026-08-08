import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'qr-scanner-region';

type QrScannerModalProps = {
  title: string;
  onDetected: (decodedText: string) => void;
  onClose: () => void;
};

// カメラでQRコードを読み取るための簡易モーダル（仮実装）
export const QrScannerModal = ({ title, onDetected, onClose }: QrScannerModalProps): JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectedRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          onDetected(decodedText);
        },
        () => {
          // 読み取り失敗（QRが枠内にない等）は毎フレーム発生しうるため無視する
        },
      )
      .catch(() => {
        setError('カメラを起動できませんでした。カメラへのアクセスを許可してください。');
      });

    return () => {
      scanner.stop().catch(() => {
        // 既に停止済みの場合は無視
      });
    };
  }, [onDetected]);

  return (
    <div className="qr-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="qr-modal">
        <div className="qr-modal__head">
          <h2 className="qr-modal__title">{title}</h2>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
            閉じる
          </button>
        </div>
        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div id={SCANNER_ELEMENT_ID} className="qr-modal__viewport" />
        <p className="qr-modal__hint">QRコードを枠内に収めてください</p>
      </div>
    </div>
  );
};
