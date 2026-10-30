/*
 * 画像は手順書の JSON に埋め込まれる。多少重くなっても、パソコンで拡大して読める画質を優先する。
 * - 長辺 2560px までは縮小しない（高解像度ノートPCの画面写真もそのまま）
 * - まず劣化のない WebP（対応していないブラウザでは PNG）を試し、約 800KB 以内ならそれを使う。
 *   白地の業務画面や表はこれで軽く、文字もにじまない
 * - 写真などで重くなる場合は JPEG（画質 0.92）。約 600KB を超えるときは画質を 0.85 まで下げ、
 *   それでも超えるなら長辺 1920px まで縮める
 * WebP は Word・Excel に入らないため、出力時に PNG へ変換する（exportImages.ts）。
 */
const MAX_DIMENSION = 2560;
const MIN_DIMENSION = 1920; // 目安を超えても、長辺はここまでしか縮めない
const LOSSLESS_MAX_SIZE = 800_000; // 劣化なし（WebP／PNG）を選ぶ上限（バイト）
const JPEG_QUALITY = 0.92;
const MIN_JPEG_QUALITY = 0.85;
const TARGET_SIZE = 600_000; // JPEG の 1 枚あたりの目安（バイト）
const BASE64_RATIO = 1.37; // data URL は Base64 のため約 37% 大きくなる

/** 縮小後のサイズ（長辺 MAX_DIMENSION 以内）を返す */
export function fitDimensions(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  if (width > height) return { width: max, height: Math.round(height * (max / width)) };
  return { width: Math.round(width * (max / height)), height: max };
}

function draw(source: CanvasImageSource, srcWidth: number, srcHeight: number, max: number): HTMLCanvasElement {
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
  return canvas;
}

function encode(source: CanvasImageSource, srcWidth: number, srcHeight: number, max: number, quality: number): string {
  return draw(source, srcWidth, srcHeight, max).toDataURL('image/jpeg', quality);
}

/**
 * 画像ソース（img / video / canvas）を長辺 2560px 以内の data URL にする。
 * 劣化なし（WebP／PNG）が約 800KB 以内ならそれを、超えるなら JPEG（目安 約 600KB）を返す。
 */
export function compressImageSource(source: CanvasImageSource, srcWidth: number, srcHeight: number): string {
  const losslessLimit = LOSSLESS_MAX_SIZE * BASE64_RATIO;
  const limit = TARGET_SIZE * BASE64_RATIO;
  let max = MAX_DIMENSION;
  const canvas = draw(source, srcWidth, srcHeight, max);

  // 劣化なし。WebP を書き出せないブラウザ（Safari など）は PNG になる
  const webp = canvas.toDataURL('image/webp', 1);
  const lossless = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  if (lossless.length <= losslessLimit) return lossless;

  let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (dataUrl.length <= limit) return dataUrl;
  for (let quality = JPEG_QUALITY - 0.035; quality >= MIN_JPEG_QUALITY - 0.001; quality -= 0.035) {
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

/** 画像ファイルを読み込んで compressImageSource と同じ規則で WebP／PNG／JPEG にする */
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
