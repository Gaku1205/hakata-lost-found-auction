// AI解析に送る画像の長辺。Claude Haiku 4.5は長辺1568pxまで扱えるが、
// 物品の識別には1024pxで十分で、トークン数（＝コスト）と転送量を抑えられる。
const MAX_EDGE_PX = 1024;
const JPEG_QUALITY = 0.85;

export type PreparedImage = {
  base64: string;
  mediaType: 'image/jpeg';
};

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    image.src = url;
  });

// 選択された画像を長辺1024pxのJPEGに縮小し、base64（データURLのプレフィックス無し）で返す。
export const prepareImageForAnalysis = async (file: File): Promise<PreparedImage> => {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('画像を変換できませんでした');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.split(',')[1];
  if (base64 === undefined || base64 === '') throw new Error('画像を変換できませんでした');
  return { base64, mediaType: 'image/jpeg' };
};
