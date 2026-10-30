/*
 * 画像は手順書の JSON に埋め込まれるため、重くなりすぎないように縮小・圧縮する。
 * パソコンで拡大しても文字が読めるよう、フルHDの画面写真（横 1920px）は縮小しない。
 * 目安を超えるときは、まず画質を少し下げ、それでも超えるなら解像度を下げる
 * （画質を下げすぎると文字の輪郭がにじむため、画質には下限を設ける）。
 */
const MAX_DIMENSION = 1920;
const MIN_DIMENSION = 1440; // 目安を超えても、長辺はここまでしか縮めない（細かい表でも拡大して読める）
const JPEG_QUALITY = 0.85;
const MIN_JPEG_QUALITY = 0.75;
const TARGET_SIZE = 300_000; // 1 枚あたりの目安（バイト）
const BASE64_RATIO = 1.37; // data URL は Base64 のため約 37% 大きくなる

/** 縮小後のサイズ（長辺 MAX_DIMENSION 以内）を返す */
export function fitDimensions(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  if (width > height) return { width: max, height: Math.round(height * (max / width)) };
  return { width: Math.round(width * (max / height)), height: max };
}

function encode(source: CanvasImageSource, srcWidth: number, srcHeight: number, max: number, quality: number): string {
  const { width, height } = fitDimensions(srcWidth, srcHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // 透明部分が JPEG で黒くならないよう白で塗る
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 画像ソース（img / video / canvas）を長辺 1920px 以内の JPEG の data URL にする。
 * 約 300KB を超える場合は画質を 0.75 まで下げ、それでも超えるなら長辺 1440px まで段階的に縮める。
 */
export function compressImageSource(source: CanvasImageSource, srcWidth: number, srcHeight: number): string {
  const limit = TARGET_SIZE * BASE64_RATIO;
  let max = MAX_DIMENSION;
  let dataUrl = encode(source, srcWidth, srcHeight, max, JPEG_QUALITY);
  if (dataUrl.length <= limit) return dataUrl;

  for (let quality = JPEG_QUALITY - 0.05; quality >= MIN_JPEG_QUALITY - 0.001; quality -= 0.05) {
    dataUrl = encode(source, srcWidth, srcHeight, max, quality);
    if (dataUrl.length <= limit) return dataUrl;
  }
  while (max > MIN_DIMENSION && Math.max(srcWidth, srcHeight) > MIN_DIMENSION) {
    max = Math.max(MIN_DIMENSION, Math.round(max * 0.85));
    dataUrl = encode(source, srcWidth, srcHeight, max, MIN_JPEG_QUALITY);
    if (dataUrl.length <= limit) return dataUrl;
  }
  return dataUrl;
}

/** 画像ファイルを読み込んで compressImageSource と同じ規則で JPEG にする */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        resolve(compressImageSource(img, img.width, img.height));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
