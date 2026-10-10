'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthErrorNotice, { AuthChecking, driveErrorMessage } from '@/components/AuthErrorNotice';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { FEATURES, VIEWER_ONLY } from '@/lib/appMode';
import { addAuthListener, getAuthState, GoogleAuthState, initGoogleAuth, isGoogleConfigured, signIn } from '@/lib/googleAuth';
import { DriveFileInfo, getTargetFolder, listJsonFilesInFolder } from '@/lib/googleDrive';
import { viewerInstructionUrl } from '@/lib/viewerUrl';
import {
  TaskMaster,
  classifyUrl,
  driveFileIdOf,
  getTaskMasterSpreadsheetId,
  matchTitle,
  parseSpreadsheetId,
  readTaskMaster,
  setTaskMasterSpreadsheetId,
  spreadsheetUrl,
  upgradeToViewerUrl,
  writeManualUrls,
} from '@/lib/taskMaster';
import { TaskMasterVisibility, clearTaskMasterMemberCache, getTaskMasterVisibility, setTaskMasterVisibility } from '@/lib/taskMasterAccess';

interface ManualOption {
  id: string;
  title: string;
}

const KIND_LABEL: Record<string, string> = { K: '計画管理', T: '手配', J: '受注管理', B: 'BOMメンテナンス', S: '打合せ・問い合わせ', Z: '改善', O: 'その他', α: 'アフター管理' };

function urlBadge(kind: ReturnType<typeof classifyUrl>) {
  if (kind === 'v3') return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">v3 ビューア</span>;
  if (kind === 'v2') return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">旧 URL</span>;
  if (kind === 'other') return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">外部</span>;
  return <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-400">未設定</span>;
}

function TaskLinksContent() {
  const searchParams = useSearchParams();
  const presetFileId = searchParams.get('driveFileId');
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [sheetInput, setSheetInput] = useState('');
  const [master, setMaster] = useState<TaskMaster | null>(null);
  const [manuals, setManuals] = useState<ManualOption[]>([]);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  /** 行番号 → 新しい URL（空文字はクリア） */
  const [pending, setPending] = useState<Record<number, string>>({});
  /** 自動で当てた候補（まだ確定していない） */
  const [suggested, setSuggested] = useState<Set<number>>(new Set());
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<TaskMasterVisibility>('auto');

  const configured = isGoogleConfigured();

  useEffect(() => {
    setSheetInput(getTaskMasterSpreadsheetId());
    setVisibility(getTaskMasterVisibility());
    if (!configured) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, [configured]);

  const load = useCallback(async () => {
    const id = parseSpreadsheetId(sheetInput) ?? getTaskMasterSpreadsheetId();
    setError(null);
    setResult(null);
    setPending({});
    setSuggested(new Set());
    setLoading(true);
    try {
      setTaskMasterSpreadsheetId(id);
      setSheetInput(id);
      clearTaskMasterMemberCache();
      const [m, files] = await Promise.all([
        readTaskMaster(id),
        (async () => {
          const folder = getTargetFolder();
          if (!folder) return [] as DriveFileInfo[];
          setFolderName(folder.name);
          return listJsonFilesInFolder(folder.id);
        })(),
      ]);
      setMaster(m);
      setManuals(
        files
          .map((f) => ({ id: f.id, title: f.meta?.title || f.name.replace(/\.json$/i, '') }))
          .sort((a, b) => a.title.localeCompare(b.title, 'ja')),
      );
    } catch (err) {
      console.error('task master load failed', err);
      setError(driveErrorMessage(err, err instanceof Error ? err.message : 'タスクマスタを読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [sheetInput]);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    if (master) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
    // 初回だけ自動で読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isSignedIn, configured]);

  const manualById = useMemo(() => new Map(manuals.map((m) => [m.id, m])), [manuals]);
  const manualByUrlId = (url: string) => { const id = driveFileIdOf(url); return id ? manualById.get(id) : undefined; };

  const rows = useMemo(() => {
    if (!master) return [];
    const q = query.trim().toLowerCase();
    return master.rows.filter((r) => {
      if (onlyActive && !r.active) return false;
      if (onlyEmpty && classifyUrl(r.manualUrl) !== 'empty' && pending[r.rowNumber] === undefined) return false;
      if (q && !(`${r.taskId} ${r.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [master, onlyActive, onlyEmpty, query, pending]);

  const changes = useMemo(() => {
    if (!master) return [];
    return master.rows
      .filter((r) => pending[r.rowNumber] !== undefined && pending[r.rowNumber] !== r.manualUrl)
      .map((r) => ({ row: r, url: pending[r.rowNumber] }));
  }, [master, pending]);

  const setRowManual = (rowNumber: number, fileId: string) => {
    setSuggested((prev) => { const n = new Set(prev); n.delete(rowNumber); return n; });
    setPending((prev) => {
      const next = { ...prev };
      if (fileId === '__keep__') delete next[rowNumber];
      else if (fileId === '__clear__') next[rowNumber] = '';
      else next[rowNumber] = viewerInstructionUrl(fileId);
      return next;
    });
  };

  const autoAssign = () => {
    if (!master) return;
    const next: Record<number, string> = { ...pending };
    const sug = new Set(suggested);
    let upgraded = 0, matched = 0;
    for (const r of master.rows) {
      if (next[r.rowNumber] !== undefined) continue;
      const up = upgradeToViewerUrl(r.manualUrl);
      if (up) { next[r.rowNumber] = up; sug.add(r.rowNumber); upgraded += 1; continue; }
      if (classifyUrl(r.manualUrl) === 'empty' && r.active) {
        const id = matchTitle(r.name, manuals);
        if (id) { next[r.rowNumber] = viewerInstructionUrl(id); sug.add(r.rowNumber); matched += 1; }
      }
    }
    setPending(next);
    setSuggested(sug);
    setResult(`自動で当てました: 旧 URL の置き換え ${upgraded} 件、名前の一致 ${matched} 件。内容を確認してから「シートに書き込む」を押してください。`);
  };

  // 完成保存から来たとき（?driveFileId=）: 対象の手順書を強調して案内する
  const preset = presetFileId ? manualById.get(presetFileId) : undefined;

  const write = async () => {
    if (!master || changes.length === 0) return;
    const lines = changes.slice(0, 15).map((c) => `・${c.row.taskId} ${c.row.name} → ${c.url ? (manualByUrlId(c.url)?.title ?? c.url) : '（クリア）'}`);
    if (changes.length > 15) lines.push(`…ほか ${changes.length - 15} 件`);
    if (!confirm(`タスクマスタの手順書URL を ${changes.length} 件書き換えます。\n\n${lines.join('\n')}\n\nよろしいですか？`)) return;
    setWriting(true);
    setError(null);
    try {
      await writeManualUrls(master, changes.map((c) => ({ rowNumber: c.row.rowNumber, url: c.url })));
      setResult(`${changes.length} 件を書き込みました。`);
      setPending({});
      setSuggested(new Set());
      const m = await readTaskMaster(master.spreadsheetId);
      setMaster(m);
    } catch (err) {
      console.error('task master write failed', err);
      setError(driveErrorMessage(err, err instanceof Error ? err.message : '書き込みに失敗しました。'));
    } finally {
      setWriting(false);
    }
  };

  if (configured && !auth.isInitialized) return <div className="mx-auto max-w-6xl px-4 py-8"><BackLink /><AuthChecking /></div>;
  if (configured && !auth.isSignedIn) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <BackLink />
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-900">Google にログインしてください</p>
          <p className="mt-1 text-sm text-slate-500">タスク管理アプリのスプレッドシートを読み書きするためにログインが必要です。</p>
          <button onClick={signIn} className="mt-4 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Googleでログイン</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <BackLink />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">タスクの手順書URLを更新</h1>
      <p className="mt-2 text-sm text-slate-500">
        タスク管理アプリの「タスクマスタ」シートにある手順書URL を、このアプリのビューアの URL に更新します。書き換えるのは手順書URL の列だけです。
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-xs font-semibold text-slate-500">スプレッドシート（URL または ID）</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input
            value={sheetInput}
            onChange={(e) => setSheetInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-400"
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
          <button onClick={() => void load()} disabled={loading || writing} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? '読み込み中...' : '読み込む'}</button>
          {master && (
            <a href={spreadsheetUrl(master.spreadsheetId)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">シートを開く</a>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {master ? `「${master.sheetName}」 ${master.rows.length} 件（手順書URL は ${master.urlColumn} 列）` : '既定はタスク管理アプリのコピーです。本番のシートに切り替える場合は URL を貼って「読み込む」を押してください（この端末に記憶されます）。'}
          {folderName && ` ／ 手順書の候補: ${folderName} の ${manuals.length} 件`}
          {!folderName && master && ' ／ 手順書を当てるには右上のフォルダボタンで保存先フォルダを選んでください。'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-500">トップのメニューに表示:</span>
          {([
            ['auto', '自動（従業員マスタに登録された人）'],
            ['on', '常に表示'],
            ['off', '表示しない'],
          ] as [TaskMasterVisibility, string][]).map(([v, label]) => (
            <label key={v} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="tm-visibility" checked={visibility === v} onChange={() => { setVisibility(v); setTaskMasterVisibility(v); }} className="accent-slate-900" />
              {label}
            </label>
          ))}
          <span className="text-slate-400">（この端末だけの設定）</span>
        </div>
      </div>

      {preset && (
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          保存した手順書「{preset.title}」を登録するタスクの「新しい手順書」で選んで、「シートに書き込む」を押してください。
        </div>
      )}
      {result && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{result}</div>}
      <AuthErrorNotice error={error} onRetry={() => void load()} className="mt-4" />

      {master && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タスクID・タスク名で検索" className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-400" />
            <label className="flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-slate-900" />有効なタスクのみ</label>
            <label className="flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="accent-slate-900" />未設定のみ</label>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={autoAssign} disabled={writing} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50" title="旧 URL をビューアの URL に置き換え、未設定のタスクはタスク名と一致する手順書を候補にします">自動で当てる</button>
              <button onClick={write} disabled={writing || changes.length === 0} className="rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">{writing ? '書き込み中...' : `${changes.length} 件をシートに書き込む`}</button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">タスク</th>
                  <th className="px-3 py-2 font-semibold">現在の手順書URL</th>
                  <th className="px-3 py-2 font-semibold">新しい手順書</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const kind = classifyUrl(r.manualUrl);
                  const current = manualByUrlId(r.manualUrl);
                  const pend = pending[r.rowNumber];
                  const pendManual = pend ? manualByUrlId(pend) : undefined;
                  const selectValue = pend === undefined ? '__keep__' : pend === '' ? '__clear__' : (driveFileIdOf(pend) ?? '__keep__');
                  const changed = pend !== undefined && pend !== r.manualUrl;
                  const isSug = suggested.has(r.rowNumber);
                  return (
                    <tr key={r.rowNumber} className={changed ? (isSug ? 'bg-amber-50/70' : 'bg-emerald-50/50') : !r.active ? 'opacity-50' : ''}>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{r.taskId}</span>
                          <span className="font-semibold text-slate-900">{r.name}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{KIND_LABEL[r.kindId] ?? r.kindId}{!r.active && '・無効'}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">{urlBadge(kind)}{current && <span className="text-xs text-slate-700">{current.title}</span>}</div>
                        {r.manualUrl && <a href={r.manualUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 block max-w-[28rem] truncate text-[11px] text-slate-400 underline-offset-2 hover:underline">{r.manualUrl}</a>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select
                          value={selectValue}
                          onChange={(e) => setRowManual(r.rowNumber, e.target.value)}
                          disabled={writing}
                          className={`w-full max-w-md rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-slate-400 ${changed ? (isSug ? 'border-amber-300 bg-white' : 'border-emerald-300 bg-white') : 'border-slate-200 bg-white'} ${preset && pend && driveFileIdOf(pend) === preset.id ? 'ring-2 ring-sky-300' : ''}`}
                        >
                          <option value="__keep__">（変更しない）</option>
                          {r.manualUrl && <option value="__clear__">（URL を消す）</option>}
                          {manuals.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                        </select>
                        {changed && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            {isSug && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">候補</span>}
                            {pend ? `→ ${pendManual?.title ?? pend}` : '→ URL を消します'}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-400">該当するタスクがありません。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return <Link href="/" className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← ホームへ戻る</Link>;
}

export default function TaskLinksPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  if (!FEATURES.taskMasterLink) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <BackLink />
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">
          この機能はこの版では使えません。
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><p className="text-slate-500">読み込み中...</p></div>}>
      <TaskLinksContent />
    </Suspense>
  );
}
