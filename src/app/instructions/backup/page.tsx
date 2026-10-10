'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthErrorNotice, { AuthChecking, driveErrorMessage } from '@/components/AuthErrorNotice';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  copyDriveFile,
  downloadDriveFile,
  findOrCreateChildFolder,
  getTargetFolder,
  listJsonFilesInFolder,
} from '@/lib/googleDrive';
import {
  addAuthListener,
  getAuthState,
  GoogleAuthState,
  initGoogleAuth,
  isGoogleConfigured,
  signIn,
} from '@/lib/googleAuth';
import { VIEWER_ONLY } from '@/lib/appMode';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';

interface Row {
  id: string;
  name: string;
  modifiedTime?: string;
  selected: boolean;
}

function formatDateFolder(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function BackupTool() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [rows, setRows] = useState<Row[]>([]);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; ng: number; path: string } | null>(null);
  const [destination, setDestination] = useState<'drive' | 'local'>('drive');
  const [error, setError] = useState<string | null>(null);
  const applyingRef = useRef(false);

  const configured = isGoogleConfigured();
  const selectedRows = rows.filter((row) => row.selected);
  const dateFolderName = formatDateFolder();

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
      .then((files) => {
        setRows(files.map((file) => ({
          id: file.id,
          name: file.name,
          modifiedTime: file.modifiedTime,
          selected: false,
        })));
        if (files.length === 0) setError('このフォルダに手順書がありません。');
      })
      .catch((err) => setError(driveErrorMessage(err, '一覧の取得に失敗しました。')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [auth.isSignedIn, configured, load]);

  const toggle = (id: string) =>
    setRows((prev) => prev.map((row) => row.id === id ? { ...row, selected: !row.selected } : row));

  const setAll = (selected: boolean) =>
    setRows((prev) => prev.map((row) => ({ ...row, selected })));

  // この端末に ZIP（1 件なら JSON そのまま）でダウンロードする
  const downloadLocal = async () => {
    if (applyingRef.current) return;
    if (selectedRows.length === 0) return alert('バックアップする JSON を選択してください。');
    applyingRef.current = true;
    setApplying(true);
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: selectedRows.length });
    try {
      const zip = new JSZip();
      let ok = 0;
      let ng = 0;
      let single: { name: string; text: string } | null = null;
      for (const row of selectedRows) {
        try {
          const text = await downloadDriveFile(row.id);
          const name = row.name.toLowerCase().endsWith('.json') ? row.name : `${row.name}.json`;
          zip.file(name, text, { date: row.modifiedTime ? new Date(row.modifiedTime) : undefined });
          single = { name, text };
          ok += 1;
        } catch (err) {
          console.error('Failed to download', row.name, err);
          ng += 1;
        }
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
      if (ok === 0) {
        setError('ダウンロードできたファイルがありません。ログイン状態を確認してください。');
        return;
      }
      let fileName: string;
      if (ok === 1 && single) {
        saveAs(new Blob([single.text], { type: 'application/json' }), single.name);
        fileName = single.name;
      } else {
        fileName = `手順書バックアップ_${dateFolderName}.zip`;
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, fileName);
      }
      setRows((prev) => prev.map((item) => (item.selected ? { ...item, selected: false } : item)));
      setResult({ ok, ng, path: `この端末のダウンロード先（${fileName}）` });
    } catch (err) {
      console.error('Failed to download backup', err);
      setError(driveErrorMessage(err, 'ダウンロードに失敗しました。'));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const apply = async () => {
    if (destination === 'local') return downloadLocal();
    if (applyingRef.current) return;
    const targetFolder = getTargetFolder();
    if (!targetFolder) return alert('保存先の Drive フォルダを設定してください。');
    if (selectedRows.length === 0) return alert('バックアップする JSON を選択してください。');
    if (!confirm(`選択した ${selectedRows.length} 件を「バックアップ/${dateFolderName}」へコピーします。更新日は保持します。よろしいですか？`)) return;

    applyingRef.current = true;
    setApplying(true);
    setResult(null);
    setProgress({ done: 0, total: selectedRows.length });

    try {
      const backupFolder = await findOrCreateChildFolder(targetFolder.id, 'バックアップ');
      const dateFolder = await findOrCreateChildFolder(backupFolder.id, dateFolderName);
      let ok = 0;
      let ng = 0;

      for (const row of selectedRows) {
        try {
          await copyDriveFile(row.id, dateFolder.id, {
            name: row.name,
            modifiedTime: row.modifiedTime,
          });
          ok += 1;
          setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, selected: false } : item));
        } catch (err) {
          console.error('Failed to create backup', row.name, err);
          ng += 1;
        }
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }

      setResult({ ok, ng, path: `${folderName}/バックアップ/${dateFolderName}` });
    } catch (err) {
      console.error('Failed to prepare backup folder', err);
      setError(driveErrorMessage(err, 'バックアップ先フォルダを作成できませんでした。Drive の権限を確認してください。'));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  if (configured && !auth.isInitialized) {
    return <div className="mx-auto max-w-5xl px-4 py-8"><BackLink /><AuthChecking /></div>;
  }
  if (configured && !auth.isSignedIn) {
    return <SignInNotice />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <BackLink />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">バックアップを作成</h1>
      <p className="mt-2 text-sm text-slate-500">
        選択した JSON を Drive の「バックアップ/{dateFolderName}」へコピーするか、この端末にダウンロードします。元ファイルの更新日は変更しません。
        {folderName && `（フォルダ: ${folderName}）`}
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">バックアップ先</p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="backup-destination" checked={destination === 'drive'} onChange={() => setDestination('drive')} disabled={applying} className="accent-slate-900" />
            Drive の「バックアップ/{dateFolderName}」へコピー
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="backup-destination" checked={destination === 'local'} onChange={() => setDestination('local')} disabled={applying} className="accent-slate-900" />
            この端末にダウンロード（複数は ZIP、1 件は JSON）
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <ToolButton onClick={() => setAll(true)}>全選択</ToolButton>
          <ToolButton onClick={() => setAll(false)}>全解除</ToolButton>
          <button
            onClick={apply}
            disabled={applying || selectedRows.length === 0}
            className="ml-auto rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {applying
              ? `${destination === 'local' ? 'ダウンロード中' : 'コピー中'}... (${progress.done}/${progress.total})`
              : `選択した ${selectedRows.length} 件を${destination === 'local' ? 'ダウンロード' : 'バックアップ'}`}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          バックアップを作成しました。成功 {result.ok} 件{result.ng > 0 && `／失敗 ${result.ng} 件`}。保存先: {result.path}
        </div>
      )}
      <AuthErrorNotice error={error} onRetry={load} className="mt-4" />

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>{loading ? '読み込み中...' : `${rows.length} 件（選択 ${selectedRows.length} 件）`}</span>
          <button onClick={load} disabled={loading || applying}>再読み込み</button>
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <input type="checkbox" checked={row.selected} onChange={() => toggle(row.id)} disabled={applying} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{row.name}</span>
                {row.modifiedTime && <span className="text-xs text-slate-400">更新: {new Date(row.modifiedTime).toLocaleDateString('ja-JP')}</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
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

export default function BackupPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <BackupTool />;
}
