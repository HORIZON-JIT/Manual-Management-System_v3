import { WorkInstruction, getApprovalStatus, ApprovalStatus } from '@/types/instruction';

/**
 * 一覧表示に必要な情報を Drive ファイルの appProperties / description に持たせる。
 * これにより一覧画面は各 JSON（画像込み）をダウンロードせずに、タイトル・部署・カテゴリ・承認状態・検索文を得られる。
 * Drive の制限: プロパティはキー＋値で 124 バイト（UTF-8）まで。
 */
export const DRIVE_META_VERSION = '1';
const MAX_PROP_BYTES = 124;
export const SEARCH_TEXT_LIMIT = 6000;

export interface DriveInstructionMeta {
  title: string;
  category: string;
  department: string;
  createdBy: string;
  updatedBy: string;
  approvalStatus: ApprovalStatus;
  approvalApprovedAt?: string;
  approvalUserName?: string;
  sequential: boolean;
}

const KEYS = {
  version: 'mms_v',
  title: 'mms_title',
  category: 'mms_cat',
  department: 'mms_dept',
  createdBy: 'mms_cby',
  updatedBy: 'mms_uby',
  approval: 'mms_appr',
  approvedAt: 'mms_apprat',
  approvedBy: 'mms_apprby',
  sequential: 'mms_seq',
} as const;

const encoder = new TextEncoder();

/** キー＋値が 124 バイトに収まるよう、値を文字単位で切り詰める */
export function fitProperty(key: string, value: string): string {
  const budget = MAX_PROP_BYTES - encoder.encode(key).length;
  if (budget <= 0) return '';
  if (encoder.encode(value).length <= budget) return value;
  let out = '';
  for (const ch of value) {
    if (encoder.encode(out + ch).length > budget) break;
    out += ch;
  }
  return out;
}

export function buildDriveMeta(instruction: WorkInstruction): Record<string, string> {
  const props: Record<string, string> = { [KEYS.version]: DRIVE_META_VERSION };
  const set = (key: string, value: string | undefined) => {
    const v = (value ?? '').trim();
    props[key] = v ? fitProperty(key, v) : '';
  };
  set(KEYS.title, instruction.title);
  set(KEYS.category, instruction.category);
  set(KEYS.department, instruction.department);
  set(KEYS.createdBy, instruction.createdBy);
  set(KEYS.updatedBy, instruction.updatedBy);
  props[KEYS.approval] = getApprovalStatus(instruction);
  set(KEYS.approvedAt, instruction.approval?.current?.approvedAt);
  set(KEYS.approvedBy, instruction.approval?.current?.userName);
  props[KEYS.sequential] = instruction.sequential ? '1' : '0';
  return props;
}

export function parseDriveMeta(appProperties?: Record<string, string> | null): DriveInstructionMeta | null {
  if (!appProperties || appProperties[KEYS.version] !== DRIVE_META_VERSION) return null;
  const approval = appProperties[KEYS.approval];
  return {
    title: appProperties[KEYS.title] ?? '',
    category: appProperties[KEYS.category] ?? '',
    department: appProperties[KEYS.department] ?? '',
    createdBy: appProperties[KEYS.createdBy] ?? '',
    updatedBy: appProperties[KEYS.updatedBy] ?? '',
    approvalStatus: approval === 'approved' || approval === 'needs_reapproval' ? approval : 'unapproved',
    approvalApprovedAt: appProperties[KEYS.approvedAt] || undefined,
    approvalUserName: appProperties[KEYS.approvedBy] || undefined,
    sequential: appProperties[KEYS.sequential] === '1',
  };
}

/**
 * 本文検索用のテキスト（画像データは含めない）。ビューアとピッカーで共通に使う。
 * Drive の description に入れるため上限を設ける。
 */
export function buildSearchText(instruction: WorkInstruction, limit = SEARCH_TEXT_LIMIT): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  };
  push(instruction.title);
  push(instruction.description);
  push(instruction.department);
  push(instruction.category);
  (instruction.keywords ?? []).forEach(push);
  (instruction.conditions ?? []).forEach((c) => push(c.label));
  for (const step of instruction.steps ?? []) {
    push(step.title);
    push(step.description);
    push(step.detailDescription);
    push(step.caution);
    push(step.branchQuestion);
    (step.imageCaptions ?? []).forEach(push);
    (step.checkItems ?? []).forEach((ci) => push(ci.label));
    (step.links ?? []).forEach((l) => { push(l.label); push(l.url); push(l.path); });
    (step.jumps ?? []).forEach((j) => push(j.label));
  }
  return parts.join('\n').toLowerCase().slice(0, limit);
}
