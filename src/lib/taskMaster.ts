import { ensureAccessToken, throwForResponse } from '@/lib/googleAuth';
import { viewerInstructionUrl } from '@/lib/viewerUrl';

/**
 * タスク管理アプリ（Google スプレッドシート）の「タスクマスタ」シートとの連携。
 * 手順書URL 列を、手順書アプリの v3 ビューア URL で更新する。
 * 列は見出し名で探すので、列の順番が変わっても動く。
 */

export const DEFAULT_TASK_MASTER_SPREADSHEET_ID = '1IHxotYypyQkGyskunDMrN2i_v_GU2brQvGlZeAS0UgM';
export const TASK_MASTER_SHEET = 'タスクマスタ';
const STORAGE_KEY = 'task_master_spreadsheet_id';

const HEADERS = {
  taskId: 'タスクID',
  name: 'タスク名',
  kindId: '種別ID',
  manualUrl: '手順書URL',
  active: '有効',
} as const;

export interface TaskMasterRow {
  /** シート上の行番号（1 始まり。見出し行が 1） */
  rowNumber: number;
  taskId: string;
  name: string;
  kindId: string;
  manualUrl: string;
  active: boolean;
}

export interface TaskMaster {
  spreadsheetId: string;
  sheetName: string;
  /** 手順書URL 列の列記号（例: 'E'） */
  urlColumn: string;
  rows: TaskMasterRow[];
}

export function getTaskMasterSpreadsheetId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_TASK_MASTER_SPREADSHEET_ID;
  } catch {
    return DEFAULT_TASK_MASTER_SPREADSHEET_ID;
  }
}

export function setTaskMasterSpreadsheetId(id: string): void {
  try {
    if (id && id !== DEFAULT_TASK_MASTER_SPREADSHEET_ID) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無視
  }
}

/** URL でも ID でも受け付けて、スプレッドシート ID を取り出す */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export type UrlKind = 'empty' | 'v3' | 'v2' | 'other';

/** 手順書URL の種類。v3 はこのアプリのビューア、v2 は旧アプリ */
export function classifyUrl(url: string): UrlKind {
  const u = url.trim();
  if (!u) return 'empty';
  if (/Manual-Management-System_v3\/viewer\/instructions\/view\?/.test(u)) return 'v3';
  if (/Manual-Management-System(_v2)?\/instructions\/view\?/.test(u)) return 'v2';
  if (/Manual-Management-System_v3\/instructions\/view\?/.test(u)) return 'v2'; // v3 の作成アプリ側 URL もビューアに揃える
  return 'other';
}

/** 手順書アプリの URL から Drive の fileId を取り出す */
export function driveFileIdOf(url: string): string | null {
  const m = url.match(/[?&]driveFileId=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 旧 URL を v3 ビューアの URL に直せるなら返す */
export function upgradeToViewerUrl(url: string): string | null {
  const kind = classifyUrl(url);
  if (kind !== 'v2') return null;
  const id = driveFileIdOf(url);
  return id ? viewerInstructionUrl(id) : null;
}

function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function readTaskMaster(spreadsheetId: string): Promise<TaskMaster> {
  const token = await ensureAccessToken();
  const range = encodeURIComponent(`${TASK_MASTER_SHEET}!A1:Z`);
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}/values/${range}?majorDimension=ROWS`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await throwForResponse(res, 'Sheets API');
  const data = (await res.json()) as { values?: string[][] };
  const values = data.values ?? [];
  if (values.length === 0) throw new Error(`「${TASK_MASTER_SHEET}」シートが空です。`);
  const header = values[0].map((h) => (h ?? '').trim());
  const col = (name: string) => header.indexOf(name);
  const cTask = col(HEADERS.taskId), cName = col(HEADERS.name), cKind = col(HEADERS.kindId), cUrl = col(HEADERS.manualUrl), cActive = col(HEADERS.active);
  if (cTask < 0 || cName < 0 || cUrl < 0) {
    throw new Error(`「${TASK_MASTER_SHEET}」の見出しに「${HEADERS.taskId}」「${HEADERS.name}」「${HEADERS.manualUrl}」が見つかりません。`);
  }
  const rows: TaskMasterRow[] = [];
  values.slice(1).forEach((r, i) => {
    const taskId = (r[cTask] ?? '').trim();
    const name = (r[cName] ?? '').trim();
    if (!taskId && !name) return;
    const activeRaw = cActive >= 0 ? String(r[cActive] ?? '').trim().toUpperCase() : 'TRUE';
    rows.push({
      rowNumber: i + 2,
      taskId,
      name,
      kindId: cKind >= 0 ? (r[cKind] ?? '').trim() : '',
      manualUrl: (r[cUrl] ?? '').trim(),
      active: activeRaw === '' || activeRaw === 'TRUE' || activeRaw === '1',
    });
  });
  return { spreadsheetId, sheetName: TASK_MASTER_SHEET, urlColumn: columnLetter(cUrl), rows };
}

export interface ManualUrlUpdate {
  rowNumber: number;
  url: string;
}

/** 手順書URL 列だけを書き換える（他の列には触らない） */
export async function writeManualUrls(master: Pick<TaskMaster, 'spreadsheetId' | 'sheetName' | 'urlColumn'>, updates: ManualUrlUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;
  const token = await ensureAccessToken();
  const body = {
    valueInputOption: 'RAW',
    data: updates.map((u) => ({ range: `${master.sheetName}!${master.urlColumn}${u.rowNumber}`, values: [[u.url]] })),
  };
  const res = await fetch(`${SHEETS_BASE}/${master.spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwForResponse(res, 'Sheets API batchUpdate');
  const result = (await res.json()) as { totalUpdatedCells?: number };
  return result.totalUpdatedCells ?? updates.length;
}

/** タスク名と手順書タイトルの照合（完全一致 → 片方がもう片方を含む） */
export function matchTitle(taskName: string, titles: { id: string; title: string }[]): string | null {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[＿_]/g, '_').toLowerCase();
  const t = norm(taskName);
  if (!t) return null;
  const exact = titles.find((x) => norm(x.title) === t);
  if (exact) return exact.id;
  const partial = titles.filter((x) => { const n = norm(x.title); return n.length >= 3 && (n.includes(t) || t.includes(n)); });
  return partial.length === 1 ? partial[0].id : null;
}
