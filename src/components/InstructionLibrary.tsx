'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DriveFileInfo,
  getTargetFolder,
  listJsonFilesInFolder,
} from '@/lib/googleDrive';
import {
  isGoogleConfigured,
  getAuthState,
  addAuthListener,
  GoogleAuthState,
  signIn,
  initGoogleAuth,
} from '@/lib/googleAuth';

type SortOrder = 'updated-desc' | 'updated-asc' | 'name-asc';

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function InstructionLibrary() {
  const router = useRouter();
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated-desc');
  const [opening, setOpening] = useState<string | null>(null);

  const configured = isGoogleConfigured();

  useEffect(() => {
    if (!configured) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, [configured]);

  const loadFiles = useCallback(() => {
    const folder = getTargetFolder();
    if (!folder) {
      setFolderName('');
      setFiles([]);
      setError('閲覧する手順書フォルダが未設定です。右上のフォルダボタンから保存先を選んでください。');
      return;
    }
    setFolderName(folder.name);
    setError(null);
    setLoading(true);
    listJsonFilesInFolder(folder.id)
      .then((jsonFiles) => {
        setFiles(jsonFiles);
        if (jsonFiles.length === 0) {
          setError('このフォルダに手順書がありません。');
        }
      })
      .catch((err) => {
        console.error('Failed to list instructions:', err);
        setError('手順書一覧の取得に失敗しました。通信状況を確認して再読み込みしてください。');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    loadFiles();
  }, [configured, auth.isSignedIn, loadFiles]);

  const handleOpen = (file: DriveFileInfo) => {
    setOpening(file.id);
    router.push(`/instructions/view?driveFileId=${file.id}`);
  };

  const filteredFiles = [...files]
    .filter((file) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return file.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortOrder === 'name-asc') return a.name.localeCompare(b.name, 'ja');
      const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return sortOrder === 'updated-desc' ? bTime - aTime : aTime - bTime;
    });

  const needsSignIn = configured && !auth.isSignedIn;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-76px)] max-w-7xl flex-col px-6 py-8 lg:py-10">
      <section className="border-b border-neutral-200 pb-6">
        <div className="mb-5 h-px w-16 bg-[#a48149]" />
        <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-[#8a6a37]">HORIZON JIT</p>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-[-0.02em] text-neutral-950 sm:text-4xl">
          手順書ビューア
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-neutral-600">
          一覧から手順書を選んで閲覧できます。閲覧専用のため作成・編集はできません。
        </p>
      </section>

      {needsSignIn ? (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-white px-5 py-6 shadow-[0_18px_44px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-950">手順書を表示するにはログインしてください</p>
              <p className="mt-1 text-sm leading-6 text-neutral-500">
                Drive上の手順書を読み込むため、最初に一度だけGoogleアカウントの認証が必要です。
              </p>
            </div>
            <button
              type="button"
              onClick={signIn}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-neutral-950 px-5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.16)] transition hover:bg-neutral-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Googleでログイン
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="block w-full sm:max-w-sm">
              <span className="mb-1.5 block text-xs font-medium text-neutral-500">手順書を検索</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="タイトルで検索"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188]"
              />
            </label>
            <div className="flex items-center gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">並び替え</span>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188]"
                >
                  <option value="updated-desc">更新が新しい順</option>
                  <option value="updated-asc">更新が古い順</option>
                  <option value="name-asc">名前順</option>
                </select>
              </label>
              <button
                type="button"
                onClick={loadFiles}
                disabled={loading}
                className="mt-5 inline-flex h-11 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-950 disabled:opacity-50"
                title="一覧を再読み込み"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                更新
              </button>
            </div>
          </section>

          <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
            <span>{folderName && `フォルダ: ${folderName}`}</span>
            <span>{!loading && `${filteredFiles.length} 件`}</span>
          </div>

          <section className="mt-3 flex-1">
            {loading ? (
              <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
                読み込み中...
              </div>
            ) : filteredFiles.length === 0 && !error ? (
              <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
                条件に合う手順書がありません
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredFiles.map((file) => {
                  const updatedAt = formatDate(file.modifiedTime);
                  const isOpening = opening === file.id;
                  const displayName = file.name.replace(/\.json$/i, '');
                  return (
                    <li key={file.id}>
                      <button
                        onClick={() => handleOpen(file)}
                        disabled={opening !== null}
                        className="group flex h-full w-full items-start gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-4 text-left shadow-[0_8px_18px_rgba(0,0,0,0.04)] transition hover:border-[#d7c29b] hover:bg-[#faf7f1] disabled:cursor-wait disabled:opacity-60"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
                          {isOpening ? (
                            <span className="inline-block h-5 w-5 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
                          ) : (
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586A2 2 0 0114 3.586L18.414 8A2 2 0 0119 9.414V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[15px] font-semibold leading-6 text-neutral-900">{displayName}</p>
                          {updatedAt && <p className="mt-1 text-xs text-neutral-400">更新: {updatedAt}</p>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {error}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-8 text-xs text-neutral-400">
        <p>Developed by Yuma Tani</p>
        <span>閲覧専用エディション</span>
      </footer>
    </div>
  );
}
