import { DEPARTMENT_OPTIONS } from '@/types/instruction';

/**
 * 手順書作成フォームで追加された部署名を端末に記録する。
 * 既定の DEPARTMENT_OPTIONS に加えて、ここに保存されたものも選択肢に出す。
 */
const KEY = 'mms-custom-departments';

export function getCustomDepartments(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 部署名を追加して、更新後の一覧を返す（重複・既定値は追加しない）。 */
export function addCustomDepartment(name: string): string[] {
  const trimmed = name.trim();
  const current = getCustomDepartments();
  if (!trimmed) return current;
  if ((DEPARTMENT_OPTIONS as readonly string[]).includes(trimmed) || current.includes(trimmed)) {
    return current;
  }
  const updated = [...current, trimmed];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // 容量超過などは無視
  }
  return updated;
}
