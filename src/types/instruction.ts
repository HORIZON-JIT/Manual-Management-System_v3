export interface CheckItem {
  id: string;
  label: string;
}

export interface StepLink {
  id: string;
  type: 'instruction' | 'url';
  instructionId?: string;
  driveFileId?: string;
  url?: string;
  label: string;
}

export interface StepJump {
  id: string;
  label: string;
  targetStepId: string;
}

export interface Condition {
  id: string;
  label: string;
  group?: string;
}

/** 画像注釈エディタの注釈オブジェクト（座標は 0–1 正規化）。再編集で移動・調整できるよう保持する。 */
export type ImageAnnotation =
  | { type: 'circle'; cx: number; cy: number; radiusX: number; radiusY: number; color: string }
  | { type: 'rectangle'; x: number; y: number; width: number; height: number; color: string }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; scale: number; color: string }
  | { type: 'number'; x: number; y: number; value: number; scale: number; color: string; mode?: 'auto' | 'manual' }
  | { type: 'text'; x: number; y: number; value: string; scale: number; color: string };

export interface Step {
  id: string;
  orderIndex: number;
  title: string;
  description: string;
  detailDescription?: string;
  /** @deprecated Use imageDataUrls instead */
  imageDataUrl?: string;
  imageDataUrls?: string[];
  imageCaptions?: string[];
  /** 画像ごとの注釈オブジェクト。index は imageDataUrls と対応。 */
  imageAnnotations?: (ImageAnnotation[] | null)[];
  caution?: string;
  checkItems?: CheckItem[];
  conditionId?: string;
  conditionIds?: string[];
  originalImageDataUrls?: string[];
  links?: StepLink[];
  jumps?: StepJump[];
  jumpDefaultLabel?: string;
  nextStepId?: string;
  endsBranch?: boolean;
}

export function getStepConditionIds(step: Step): string[] {
  if (step.conditionIds && step.conditionIds.length > 0) return step.conditionIds;
  if (step.conditionId) return [step.conditionId];
  return [];
}

/** Get all image data URLs for a step (handles legacy single-image field) */
export function getStepImages(step: Step): string[] {
  if (step.imageDataUrls && step.imageDataUrls.length > 0) return step.imageDataUrls;
  if (step.imageDataUrl) return [step.imageDataUrl];
  return [];
}

/** Get caption for image at index */
export function getImageCaption(step: Step, index: number): string {
  return step.imageCaptions?.[index] ?? '';
}

export type Category = string;

export const DEFAULT_CATEGORIES = ['事務作業', '現場作業'] as const;

/** 手順書を担当する部署の選択肢 */
export const DEPARTMENT_OPTIONS = [
  '生産管理課',
  '資材課_資材係',
  '資材課_部品統制係',
  '資材課_物流係',
] as const;

export interface InstructionSnapshot {
  title: string;
  category: Category;
  description: string;
  steps: Step[];
  keywords?: string[];
  createdBy?: string;
}

export interface UpdateHistoryEntry {
  updatedBy: string;
  updatedAt: string;
  note?: string;
  snapshot?: InstructionSnapshot;
}

export type ApprovalAction = 'approved' | 'revoked';

export interface ApprovalRecord {
  approvedAt: string;
  revision: number;
  userName?: string;
  userEmail?: string;
}

export interface ApprovalHistoryEntry {
  action: ApprovalAction;
  actedAt: string;
  revision: number;
  userName?: string;
  userEmail?: string;
  reason?: string;
}

export interface ApprovalState {
  current?: ApprovalRecord;
  history?: ApprovalHistoryEntry[];
}

export type ApprovalStatus = 'approved' | 'needs_reapproval' | 'unapproved';

export function getInstructionRevision(instruction: Pick<WorkInstruction, 'updateHistory'>): number {
  return instruction.updateHistory?.length ?? 0;
}

export function getApprovalStatus(instruction: Pick<WorkInstruction, 'approval' | 'updateHistory'>): ApprovalStatus {
  const current = instruction.approval?.current;
  if (!current) return 'unapproved';
  return current.revision === getInstructionRevision(instruction) ? 'approved' : 'needs_reapproval';
}

export type InstructionStatus = 'draft' | 'completed';

export interface ConditionGroup {
  id: string;
  parentConditionId?: string;
}

export interface WorkInstruction {
  id: string;
  title: string;
  category: Category;
  /** 担当部署（DEPARTMENT_OPTIONS のいずれか） */
  department?: string;
  description: string;
  steps: Step[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  updateHistory?: UpdateHistoryEntry[];
  approval?: ApprovalState;
  status?: InstructionStatus;
  keywords?: string[];
  driveFileId?: string;
  sequential?: boolean;
  conditions?: Condition[];
  conditionGroups?: ConditionGroup[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  pc_work: 'PC事務作業',
  packing: '梱包作業',
  事務作業: '事務作業',
  現場作業: '現場作業',
  '菠句漁菴應･ｍ': '事務作業',
  '迄ｿ蜃ｲ菴應･ｍ': '現場作業',
};

/** Get display label for a category (falls back to the raw value for custom categories) */
export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category;
}
