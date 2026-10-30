import type { WorkInstruction } from '@/types/instruction';

/*
 * 手順書の画像は WebP（劣化なし）で保存されていることがある。
 * Word・Excel は WebP を扱えないため、出力の直前に PNG へ変換する。
 */

function isWebp(dataUrl: string | undefined): dataUrl is string {
  return !!dataUrl && dataUrl.startsWith('data:image/webp');
}

/** WebP の data URL を PNG の data URL にする（それ以外はそのまま返す） */
export async function toExportableImage(dataUrl: string): Promise<string> {
  if (!isWebp(dataUrl)) return dataUrl;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    el.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 手順書の全ステップの画像を、Word・Excel に入れられる形式にそろえた複製を返す */
export async function withExportableImages(instruction: WorkInstruction): Promise<WorkInstruction> {
  const needs = instruction.steps.some((s) => isWebp(s.imageDataUrl) || (s.imageDataUrls ?? []).some(isWebp));
  if (!needs) return instruction;
  const steps = await Promise.all(
    instruction.steps.map(async (s) => ({
      ...s,
      imageDataUrl: s.imageDataUrl ? await toExportableImage(s.imageDataUrl) : s.imageDataUrl,
      imageDataUrls: s.imageDataUrls ? await Promise.all(s.imageDataUrls.map(toExportableImage)) : s.imageDataUrls,
    })),
  );
  return { ...instruction, steps };
}
