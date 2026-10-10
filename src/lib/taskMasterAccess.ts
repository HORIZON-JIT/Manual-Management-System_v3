'use client';

import { useEffect, useState } from 'react';
import { addAuthListener, ensureAccessToken, getAuthState, initGoogleAuth, isGoogleConfigured, throwForResponse } from '@/lib/googleAuth';
import { getTaskMasterSpreadsheetId } from '@/lib/taskMaster';

/**
 * タスクマスタ連携を「生産管理の人にだけ」見せるための判定。
 * 配布 URL は 1 つのまま、タスク管理アプリの「従業員マスタ」シート（A 列 メールアドレス）に
 * ログイン中のアカウントがあれば表示する。結果は端末に 24 時間キャッシュする。
 * 端末ごとに「常に表示」「表示しない」で上書きもできる。
 */
export type TaskMasterVisibility = 'auto' | 'on' | 'off';

const VISIBILITY_KEY = 'task_master_visibility';
const CACHE_KEY = 'task_master_member_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EMPLOYEE_SHEET = '従業員マスタ';

export function getTaskMasterVisibility(): TaskMasterVisibility {
  try {
    const v = localStorage.getItem(VISIBILITY_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTaskMasterVisibility(v: TaskMasterVisibility): void {
  try {
    if (v === 'auto') localStorage.removeItem(VISIBILITY_KEY);
    else localStorage.setItem(VISIBILITY_KEY, v);
  } catch {
    // 無視
  }
}

interface CacheEntry { email: string; spreadsheetId: string; member: boolean; at: number }

function readCache(email: string, spreadsheetId: string): boolean | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CacheEntry;
    if (c.email !== email || c.spreadsheetId !== spreadsheetId || Date.now() - c.at > CACHE_TTL_MS) return null;
    return c.member;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // 無視
  }
}

export function clearTaskMasterMemberCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // 無視
  }
}

/** 従業員マスタにメールがあるか。シートが読めない（未共有・権限なし）ときは false */
export async function checkTaskMasterMember(email: string, options: { force?: boolean } = {}): Promise<boolean> {
  const spreadsheetId = getTaskMasterSpreadsheetId();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (!options.force) {
    const cached = readCache(normalized, spreadsheetId);
    if (cached !== null) return cached;
  }
  let member = false;
  try {
    const token = await ensureAccessToken();
    const range = encodeURIComponent(`${EMPLOYEE_SHEET}!A:A`);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=COLUMNS`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) await throwForResponse(res, 'Sheets API');
    const data = (await res.json()) as { values?: string[][] };
    const emails = (data.values?.[0] ?? []).map((v) => (v ?? '').trim().toLowerCase());
    member = emails.includes(normalized);
  } catch {
    member = false;
  }
  writeCache({ email: normalized, spreadsheetId, member, at: Date.now() });
  return member;
}

/** 連携をメニューに出すか（上書き設定 → 従業員マスタの判定） */
export async function isTaskMasterAvailable(): Promise<boolean> {
  const v = getTaskMasterVisibility();
  if (v === 'on') return true;
  if (v === 'off') return false;
  const email = getAuthState().userEmail;
  if (!email) return false;
  return checkTaskMasterMember(email);
}

/** React 用。サインイン後に判定し、結果が分かるまでは false */
export function useTaskMasterAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const evaluate = () => {
      isTaskMasterAvailable().then((ok) => { if (!cancelled) setAvailable(ok); }).catch(() => {});
    };
    if (isGoogleConfigured()) initGoogleAuth().catch(() => {});
    evaluate();
    const unsubscribe = addAuthListener(() => evaluate());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return available;
}
