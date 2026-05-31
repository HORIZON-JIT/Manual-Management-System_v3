'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkInstruction } from '@/types/instruction';
import { downloadDriveFile, getTargetFolder, listJsonFilesInFolder, saveFileToDrive } from '@/lib/googleDrive';
import { addAuthListener, getAuthState, GoogleAuthState, initGoogleAuth, isGoogleConfigured, signIn } from '@/lib/googleAuth';
import { VIEWER_ONLY } from '@/lib/appMode';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';

type Setting = 'on' | 'off';

interface Row {
  id: string;
  name: string;
  title: string;
  sequential: boolean;
  modifiedTime?: string;
  selected: boolean;
}

function BulkSequentialTool() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [rows, setRows] = useState<Row[]>([]);
  const [setting, setSetting] = useState<Setting>('on');
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; ng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = isGoogleConfigured();
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
          let sequential = false;
          try {
            const json = JSON.parse(await downloadDriveFile(file.id)) as WorkInstruction;
            title = json.title?.trim() || title;
            sequential = !!json.sequential;
          } catch {}
          return { id: file.id, name: file.name, title, sequential, modifiedTime: file.modifiedTime, selected: false };
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

  const apply = async () => {
    if (selectedRows.length === 0) return alert('対象の手順書を選択してください。');
    if (!confirm(`選択した ${selectedRows.length} 件の読み飛ばし防止モードを ${setting === 'on' ? 'ON' : 'OFF'} にします。更新日は保持します。よろしいですか？`)) return;

    setApplying(true);
    setResult(null);
    setProgress({ done: 0, total: selectedRows.length });
    let ok = 0;
    let ng = 0;
    for (const row of selectedRows) {
      try {
        const json = JSON.parse(await downloadDriveFile(row.id)) as WorkInstruction;
        if (setting === 'on') json.sequential = true;
        else delete json.sequential;
        const buffer = new TextEncoder().encode(JSON.stringify(json, null, 2)).buffer;
        await saveFileToDrive(buffer, row.name, 'application/json', { modifiedTime: row.modifiedTime });
        ok += 1;
        setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, sequential: setting === 'on', selected: false } : item));
      } catch (err) {
        console.error('Failed to update sequential mode', row.name, err);
        ng += 1;
      }
      setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }
    setApplying(false);
    setResult({ ok, ng });
  };

  if (configured && !auth.isSignedIn) {
    return <div className="mx-auto max-w-5xl px-4 py-8"><BackLink /><div className="mt-6 rounded-lg border border-slate-200 bg-white p-6"><p className="text-sm font-semibold text-slate-900">Google Drive にログインしてください</p><button onClick={signIn} className="mt-4 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Googleでログイン</button></div></div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <BackLink />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">読み飛ばし防止モードを一括変更</h1>
      <p className="mt-2 text-sm text-slate-500">選択した手順書の読み飛ばし防止モードをまとめて ON/OFF します。更新日は変更しません。{folderName && `（フォルダ: ${folderName}）`}</p>
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div><span className="mb-1.5 block text-xs font-medium text-slate-500">読み飛ばし防止モード</span><select value={setting} onChange={(event) => setSetting(event.target.value as Setting)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"><option value="on">ON</option><option value="off">OFF</option></select></div>
        <div className="flex flex-wrap gap-2"><ToolButton onClick={() => setAll(true)}>全選択</ToolButton><ToolButton onClick={() => setAll(false)}>全解除</ToolButton></div>
        <button onClick={apply} disabled={applying || selectedRows.length === 0} className="ml-auto rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{applying ? `変更中... (${progress.done}/${progress.total})` : `選択した ${selectedRows.length} 件を変更`}</button>
      </div>
      {result && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">完了しました。成功 {result.ok} 件{result.ng > 0 && `／失敗 ${result.ng} 件`}。</div>}
      {error && <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500"><span>{loading ? '読み込み中...' : `${rows.length} 件（選択 ${selectedRows.length} 件）`}</span><button onClick={load} disabled={loading || applying}>再読み込み</button></div><ul className="divide-y divide-slate-100">{rows.map((row) => <li key={row.id}><label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50"><input type="checkbox" checked={row.selected} onChange={() => toggle(row.id)} disabled={applying} /><span className="min-w-0 flex-1 truncate text-sm text-slate-900">{row.title}</span><span className={`rounded-full border px-2.5 py-0.5 text-xs ${row.sequential ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>読み飛ばし防止 {row.sequential ? 'ON' : 'OFF'}</span></label></li>)}</ul></div>
    </div>
  );
}

function BackLink() {
  return <Link href="/" className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← ホームへ戻る</Link>;
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">{children}</button>;
}

export default function BulkSequentialPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <BulkSequentialTool />;
}
