const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.65;
const TARGET_SIZE = 150_000; // target ~150KB per image for localStorage friendliness

/** 縮小後のサイズ（長辺 MAX_DIMENSION 以内）を返す */
export function fitDimensions(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  if (width > height) return { width: max, height: Math.round(height * (max / width)) };
  return { width: Math.round(width * (max / height)), height: max };
}

/**
 * 画像ソース（img / video / canvas）を 1280px 以内に縮小して JPEG の data URL にする。
 * 150KB を超える場合は品質を段階的に下げる。
 */
export function compressImageSource(source: CanvasImageSource, srcWidth: number, srcHeight: number): string {
  const { width, height } = fitDimensions(srcWidth, srcHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Fill white background to prevent transparent areas becoming black in JPEG
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  // First pass at default quality
  let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

  // If still too large, progressively lower quality
  let quality = JPEG_QUALITY;
  while (dataUrl.length > TARGET_SIZE * 1.37 && quality > 0.3) {
    // 1.37 accounts for Base64 overhead (~37%)
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

/**
 * Compress an image file using Canvas API.
 * Resizes to fit within MAX_DIMENSION on longest side and converts to JPEG.
 * If the result exceeds TARGET_SIZE, re-compresses at lower quality.
 */
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
