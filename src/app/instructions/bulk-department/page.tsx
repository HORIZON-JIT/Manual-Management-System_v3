'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { WorkInstruction, DEPARTMENT_OPTIONS } from '@/types/instruction';
import {
  DriveFileInfo,
  getTargetFolder,
  listJsonFilesInFolder,
  downloadDriveFile,
  saveFileToDrive,
} from '@/lib/googleDrive';
import {
  isGoogleConfigured,
  getAuthState,
  addAuthListener,
  GoogleAuthState,
  signIn,
  initGoogleAuth,
} from '@/lib/googleAuth';
import { getCustomDepartments } from '@/lib/customDepartments';
import { VIEWER_ONLY } from '@/lib/appMode';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';

interface Row {
  id: string;
  name: string;
  title: string;
  department: string;
  modifiedTime?: string;
  selected: boolean;
}

function BulkDepartmentTool() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [department, setDepartment] = useState('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; ng: number } | null>(null);

  const configured = isGoogleConfigured();
  const departmentOptions = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...getCustomDepartments()]),
  );

  useEffect(() => {
    if (!configured) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, [configured]);

  const load = useCallback(() => {
    const folder = getTargetFolder();
    if (!folder) {
      setError('保存先の Drive フォルダが未設定です。右上のフォルダボタンから設定してください。');
      setRows([]);
      return;
    }
    setFolderName(folder.name);
    setError(null);
    setResult(null);
    setLoading(true);
    listJsonFilesInFolder(folder.id)
      .then(async (files) => {
        const loaded = await Promise.all(
          files.map(async (f) => {
            let title = f.name.replace(/\.json$/i, '');
            let dept = '';
            try {
              const json = JSON.parse(await downloadDriveFile(f.id)) as WorkInstruction;
              title = json.title?.trim() || title;
              dept = json.department?.trim() || '';
            } catch {
              // ignore parse errors; keep filename
            }
            return {
              id: f.id,
              name: f.name,
              title,
              department: dept,
              modifiedTime: f.modifiedTime,
              selected: false,
            } as Row;
          }),
        );
        setRows(loaded);
        if (loaded.length === 0) setError('このフォルダに手順書がありません。');
      })
      .catch(() => setError('一覧の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    load();
  }, [configured, auth.isSignedIn, load]);

  const toggle = (id: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  const setAll = (selected: boolean) =>
    setRows((prev) => prev.map((r) => ({ ...r, selected })));
  const selectUnassigned = () =>
    setRows((prev) => prev.map((r) => ({ ...r, selected: !r.department })));

  const selectedRows = rows.filter((r) => r.selected);

  const apply = async () => {
    if (!department) {
      alert('割り当てる部署を選択してください。');
      return;
    }
    if (selectedRows.length === 0) {
      alert('対象の手順書を選択してください。');
      return;
    }
    if (!confirm(`選択した ${selectedRows.length} 件に部署「${department}」を設定します。よろしいですか？`)) {
      return;
    }

    setApplying(true);
    setResult(null);
    setProgress({ done: 0, total: selectedRows.length });
    let ok = 0;
    let ng = 0;

    for (const row of selectedRows) {
      try {
        const json = JSON.parse(await downloadDriveFile(row.id)) as WorkInstruction;
        json.department = department;
        const buffer = new TextEncoder().encode(JSON.stringify(json)).buffer;
        // 更新日時は据え置く（部署付与だけのため）
        await saveFileToDrive(buffer, row.name, 'application/json', { modifiedTime: row.modifiedTime });
        ok += 1;
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, department, selected: false } : r)),
        );
      } catch (err) {
        console.error('Failed to update', row.name, err);
        ng += 1;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setApplying(false);
    setResult({ ok, ng });
  };

  const needsSignIn = configured && !auth.isSignedIn;

  const fieldClass =
    'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-900">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        ホームへ戻る
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">部署を一括設定</h1>
      <p className="mt-2 text-sm text-slate-500">
        既存の手順書に部署をまとめて割り当てます。{folderName && `（フォルダ: ${folderName}）`}
      </p>

      {needsSignIn ? (
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-900">Google Drive にログインしてください</p>
          <button
            onClick={signIn}
            className="mt-4 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Googleでログイン
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">割り当てる部署</span>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${fieldClass} h-11`}>
                <option value="">選択してください</option>
                {departmentOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setAll(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">全選択</button>
              <button onClick={() => setAll(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">全解除</button>
              <button onClick={selectUnassigned} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">部署未設定のみ選択</button>
            </div>
            <button
              onClick={apply}
              disabled={applying || selectedRows.length === 0 || !department}
              className="ml-auto rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              {applying ? `設定中... (${progress.done}/${progress.total})` : `選択した${selectedRows.length}件に設定`}
            </button>
          </div>

          {result && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              完了しました。成功 {result.ok} 件{result.ng > 0 && `／失敗 ${result.ng} 件`}。
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
          )}

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500">
              <span>{loading ? '読み込み中...' : `${rows.length} 件（選択 ${selectedRows.length} 件）`}</span>
              <button onClick={load} disabled={loading || applying} className="font-medium text-slate-500 transition hover:text-slate-900 disabled:opacity-50">再読み込み</button>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={() => toggle(row.id)}
                      disabled={applying}
                      className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{row.title}</span>
                    {row.department ? (
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">{row.department}</span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">未設定</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function BulkDepartmentPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <BulkDepartmentTool />;
}
