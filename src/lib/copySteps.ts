import { v4 as uuidv4 } from 'uuid';
import { Step } from '@/types/instruction';

/**
 * 別の手順書のステップを今の手順書へ取り込むための複製。
 * - id（ステップ・チェック項目・リンク・答え）はすべて新しくする
 * - 画像・注釈・注意・チェック項目・関連リンクは丸ごとコピー
 * - 選んだ範囲の中を指す分岐（答えの進み先・明示の次）は新 id に付け替え、範囲の外を指すものは未設定にする
 * - 元の手順書の条件（conditionIds）や「ここで終了」は引き継がない
 * - orderIndex は呼び出し側で振り直す
 */
export function cloneStepsForCopy(source: Step[], selectedIds: string[]): Step[] {
  const wanted = new Set(selectedIds);
  const picked = [...source].sort((a, b) => a.orderIndex - b.orderIndex).filter((s) => wanted.has(s.id));
  const idMap = new Map(picked.map((s) => [s.id, uuidv4()]));
  return picked.map((s, index) => {
    const copy: Step = {
      id: idMap.get(s.id)!,
      orderIndex: index,
      title: s.title,
      description: s.description,
    };
    if (s.detailDescription) copy.detailDescription = s.detailDescription;
    if (s.caution) copy.caution = s.caution;
    const images = s.imageDataUrls && s.imageDataUrls.length > 0 ? [...s.imageDataUrls] : s.imageDataUrl ? [s.imageDataUrl] : [];
    if (images.length > 0) copy.imageDataUrls = images;
    if (s.imageCaptions) copy.imageCaptions = [...s.imageCaptions];
    if (s.imageAnnotations) copy.imageAnnotations = s.imageAnnotations.map((list) => (list ? list.map((a) => ({ ...a })) : list));
    if (s.imageDisplaySizes) copy.imageDisplaySizes = [...s.imageDisplaySizes];
    if (s.originalImageDataUrls) copy.originalImageDataUrls = [...s.originalImageDataUrls];
    if (s.checkItems && s.checkItems.length > 0) copy.checkItems = s.checkItems.map((c) => ({ ...c, id: uuidv4() }));
    const links = (s.links ?? [])
      // 端末内の id だけで指すリンクは、別の手順書では意味を持たないので外す
      .filter((l) => !(l.type === 'instruction' && !l.driveFileId))
      .map((l) => ({ ...l, id: uuidv4() }));
    if (links.length > 0) copy.links = links;
    if (s.jumps && s.jumps.length > 0) {
      copy.jumps = s.jumps.map((j) => ({ ...j, id: uuidv4(), targetStepId: remapTarget(j.targetStepId, idMap) }));
      if (s.branchQuestion !== undefined) copy.branchQuestion = s.branchQuestion;
      if (s.jumpDefaultLabel) copy.jumpDefaultLabel = s.jumpDefaultLabel;
    }
    if (s.nextStepId && idMap.has(s.nextStepId)) copy.nextStepId = idMap.get(s.nextStepId)!;
    return copy;
  });
}

/** 範囲内なら新 id、「終了」はそのまま、範囲外は未設定 */
function remapTarget(target: string, idMap: Map<string, string>): string {
  if (target === '__end__') return target;
  return idMap.get(target) ?? '';
}

/** steps の afterIndex の後ろ（null なら末尾）に挿入し、orderIndex を振り直す */
export function insertSteps(steps: Step[], incoming: Step[], afterIndex: number | null): Step[] {
  const next = [...steps];
  const at = afterIndex === null ? next.length : Math.min(Math.max(afterIndex + 1, 0), next.length);
  next.splice(at, 0, ...incoming);
  return next.map((s, i) => ({ ...s, orderIndex: i }));
}
