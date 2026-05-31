'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DEFAULT_CATEGORIES, WorkInstruction, getCategoryLabel } from '@/types/instruction';
import { downloadDriveFile, getTargetFolder, listJsonFilesInFolder, saveFileToDrive } from '@/lib/googleDrive';
import { addAuthListener, getAuthState, GoogleAuthState, initGoogleAuth, isGoogleConfigured, signIn } from '@/lib/googleAuth';
import { VIEWER_ONLY } from '@/lib/appMode';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';

interface Row {
  id: string;
  name: string;
  title: string;
  category: string;
  modifiedTime?: string;
  selected: boolean;
}

function BulkCategoryTool() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; ng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = isGoogleConfigured();
  const categoryOptions = Array.from(new Set([...DEFAULT_CATEGORIES, ...rows.map((row) => row.category).filter(Boolean)]));
  const selectedRows = rows.filter((row) => row.selected);

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
        const loaded = await Promise.all(files.map(async (file) => {
          let title = file.name.replace(/\.json$/i, '');
          let currentCategory = '';
          try {
            const json = JSON.parse(await downloadDriveFile(file.id)) as WorkInstruction;
            title = json.title?.trim() || title;
            currentCategory = json.category?.trim() || '';
          } catch {}
          return { id: file.id, name: file.name, title, category: currentCategory, modifiedTime: file.modifiedTime, selected: false };
        }));
        setRows(loaded);
        if (loaded.length === 0) setError('このフォルダに手順書がありません。');
      })
      .catch(() => setError('一覧の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [auth.isSignedIn, configured, load]);

  const toggle = (id: string) => setRows((prev) => prev.map((row) => row.id === id ? { ...row, selected: !row.selected } : row));
  const setAll = (selected: boolean) => setRows((prev) => prev.map((row) => ({ ...row, selected })));
  const selectUnassigned = () => setRows((prev) => prev.map((row) => ({ ...row, selected: !row.category })));

  const apply = async () => {
    const value = (showCustomCategory ? customCategory : category).trim();
    if (!value) return alert('設定するカテゴリを選択または入力してください。');
    if (selectedRows.length === 0) return alert('対象の手順書を選択してください。');
    if (!confirm(`選択した ${selectedRows.length} 件にカテゴリ「${value}」を設定します。更新日は保持します。よろしいですか？`)) return;

    setApplying(true);
    setResult(null);
    setProgress({ done: 0, total: selectedRows.length });
    let ok = 0;
    let ng = 0;
    for (const row of selectedRows) {
      try {
        const json = JSON.parse(await downloadDriveFile(row.id)) as WorkInstruction;
        json.category = value;
        const buffer = new TextEncoder().encode(JSON.stringify(json, null, 2)).buffer;
        await saveFileToDrive(buffer, row.name, 'application/json', { modifiedTime: row.modifiedTime });
        ok += 1;
        setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, category: value, selected: false } : item));
      } catch (err) {
        console.error('Failed to update category', row.name, err);
        ng += 1;
      }
      setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }
    setApplying(false);
    setResult({ ok, ng });
  };

  if (configured && !auth.isSignedIn) {
    return <SignInNotice />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <BackLink />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">カテゴリを一括設定</h1>
      <p className="mt-2 text-sm text-slate-500">既存の手順書にカテゴリをまとめて設定します。更新日は変更しません。{folderName && `（フォルダ: ${folderName}）`}</p>
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-500">設定するカテゴリ</span>
          {showCustomCategory ? (
            <input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="カテゴリ名を入力" className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400" />
          ) : (
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400">
              <option value="">選択してください</option>
              {categoryOptions.map((item) => <option key={item} value={item}>{getCategoryLabel(item)}</option>)}
            </select>
          )}
        </div>
        <button onClick={() => setShowCustomCategory((value) => !value)} className="text-xs font-medium text-slate-500 hover:text-slate-950">
          {showCustomCategory ? '既存カテゴリから選ぶ' : '+ カテゴリを追加'}
        </button>
        <div className="flex flex-wrap gap-2">
          <ToolButton onClick={() => setAll(true)}>全選択</ToolButton>
          <ToolButton onClick={() => setAll(false)}>全解除</ToolButton>
          <ToolButton onClick={selectUnassigned}>カテゴリ未設定のみ選択</ToolButton>
        </div>
        <button onClick={apply} disabled={applying || selectedRows.length === 0} className="ml-auto rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {applying ? `設定中... (${progress.done}/${progress.total})` : `選択した ${selectedRows.length} 件に設定`}
        </button>
      </div>
      <Result result={result} error={error} />
      <FileList rows={rows} loading={loading} applying={applying} selectedCount={selectedRows.length} onReload={load} onToggle={toggle} />
    </div>
  );
}

function BackLink() {
  return <Link href="/" className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← ホームへ戻る</Link>;
}

function SignInNotice() {
  return <div className="mx-auto max-w-5xl px-4 py-8"><BackLink /><div className="mt-6 rounded-lg border border-slate-200 bg-white p-6"><p className="text-sm font-semibold text-slate-900">Google Drive にログインしてください</p><button onClick={signIn} className="mt-4 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Googleでログイン</button></div></div>;
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">{children}</button>;
}

function Result({ result, error }: { result: { ok: number; ng: number } | null; error: string | null }) {
  return <>{result && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">完了しました。成功 {result.ok} 件{result.ng > 0 && `／失敗 ${result.ng} 件`}。</div>}{error && <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}</>;
}

function FileList({ rows, loading, applying, selectedCount, onReload, onToggle }: { rows: Row[]; loading: boolean; applying: boolean; selectedCount: number; onReload: () => void; onToggle: (id: string) => void }) {
  return <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500"><span>{loading ? '読み込み中...' : `${rows.length} 件（選択 ${selectedCount} 件）`}</span><button onClick={onReload} disabled={loading || applying}>再読み込み</button></div><ul className="divide-y divide-slate-100">{rows.map((row) => <li key={row.id}><label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50"><input type="checkbox" checked={row.selected} onChange={() => onToggle(row.id)} disabled={applying} /><span className="min-w-0 flex-1 truncate text-sm text-slate-900">{row.title}</span><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">{row.category ? getCategoryLabel(row.category) : '未設定'}</span></label></li>)}</ul></div>;
}

export default function BulkCategoryPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <BulkCategoryTool />;
}
