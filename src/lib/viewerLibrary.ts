/**
 * 閲覧専用版（手順書ビューア）のためのローカル保存ユーティリティ。
 *
 * - 閲覧回数の記録（「よく見る順」並び替え用）
 * - 手順書メタ情報（タイトル・カテゴリ）のキャッシュ
 *   一覧表示のたびに全ファイルをDriveから読み直さずに済むよう、
 *   ファイルIDと更新日時をキーにキャッシュする。
 *
 * すべて端末ローカル（localStorage）に閉じる。サーバーへは送らない。
 */

const STATS_KEY = 'mms-viewer-stats';
const META_KEY = 'mms-viewer-meta';
const DEPT_FILTER_KEY = 'mms-viewer-dept';

export interface ViewStat {
  /** 開いた回数 */
  count: number;
  /** 最後に開いた時刻（epoch ms） */
  lastViewedAt: number;
}

export interface CachedMeta {
  title: string;
  category: string;
  /** 担当部署 */
  department: string;
  /** 本文検索用に抽出・小文字化したテキスト（画像データは含めない） */
  searchText: string;
  /** Drive上の更新日時。これが変わったらキャッシュを無効化する */
  modifiedTime?: string;
}

function readJson<T>(key: string): Record<string, T> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 容量超過などは黙って無視（閲覧自体は妨げない）
  }
}

/* ---- 閲覧回数 ---- */

export function getViewStats(): Record<string, ViewStat> {
  return readJson<ViewStat>(STATS_KEY);
}

/** 手順書を開いたことを記録する。 */
export function recordView(fileId: string): void {
  const stats = getViewStats();
  const prev = stats[fileId];
  stats[fileId] = {
    count: (prev?.count ?? 0) + 1,
    lastViewedAt: Date.now(),
  };
  writeJson(STATS_KEY, stats);
}

/* ---- メタ情報キャッシュ ---- */

export function getMetaCache(): Record<string, CachedMeta> {
  return readJson<CachedMeta>(META_KEY);
}

export function saveMetaCache(map: Record<string, CachedMeta>): void {
  writeJson(META_KEY, map);
}

/* ---- 部署フィルタ（端末ごとに一度設定すれば記憶する） ---- */

/** 記録された部署フィルタ。未設定なら空文字（=すべて）。 */
export function getSavedDepartment(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(DEPT_FILTER_KEY) || '';
  } catch {
    return '';
  }
}

/** 部署フィルタを記録する（空文字でクリア）。 */
export function saveDepartment(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(DEPT_FILTER_KEY, value);
    else window.localStorage.removeItem(DEPT_FILTER_KEY);
  } catch {
    // 容量超過などは無視
  }
}
