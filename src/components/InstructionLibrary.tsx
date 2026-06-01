'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCategoryLabel } from '@/types/instruction';
import {
  DriveFileInfo,
  getTargetFolder,
  listJsonFilesInFolder,
  downloadDriveFile,
} from '@/lib/googleDrive';
import {
  isGoogleConfigured,
  getAuthState,
  addAuthListener,
  GoogleAuthState,
  signIn,
  initGoogleAuth,
} from '@/lib/googleAuth';
import {
  recordView,
  getViewStats,
  getMetaCache,
  saveMetaCache,
  getSavedDepartment,
  saveDepartment,
  getSavedLayout,
  saveLayout,
  LibraryLayout,
  CachedMeta,
  ViewStat,
} from '@/lib/viewerLibrary';

type SortOrder = 'frequent' | 'updated-desc' | 'name-asc';

const ALL = '__all__';
const FREQUENT_THRESHOLD = 3;
const SEARCH_TEXT_LIMIT = 20000;

/** 手順書JSONから検索用テキストを抽出する（画像などのデータは除外）。 */
function buildSearchText(json: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v);
  };
  push(json.title);
  push(json.description);
  if (Array.isArray(json.keywords)) json.keywords.forEach(push);
  if (Array.isArray(json.conditions)) {
    json.conditions.forEach((c) => push((c as { label?: unknown })?.label));
  }
  if (Array.isArray(json.steps)) {
    json.steps.forEach((s) => {
      const step = s as Record<string, unknown>;
      push(step.title);
      push(step.description);
      push(step.caution);
      if (Array.isArray(step.imageCaptions)) step.imageCaptions.forEach(push);
      if (Array.isArray(step.checkItems)) {
        step.checkItems.forEach((ci) => push((ci as { label?: unknown })?.label));
      }
      if (Array.isArray(step.links)) {
        step.links.forEach((l) => push((l as { label?: unknown })?.label));
      }
      if (Array.isArray(step.jumps)) {
        step.jumps.forEach((j) => push((j as { label?: unknown })?.label));
      }
    });
  }
  return parts.join('\n').slice(0, SEARCH_TEXT_LIMIT).toLowerCase();
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export default function InstructionLibrary() {
  const router = useRouter();
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [meta, setMeta] = useState<Record<string, CachedMeta>>({});
  const [stats, setStats] = useState<Record<string, ViewStat>>({});
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('frequent');
  const [category, setCategory] = useState<string>(ALL);
  const [department, setDepartment] = useState<string>(ALL);
  const [contentSearch, setContentSearch] = useState(false);
  const [layout, setLayout] = useState<LibraryLayout>('grid');
  const [opening, setOpening] = useState<string | null>(null);
  const forceMetaRef = useRef(false);

  const configured = isGoogleConfigured();

  useEffect(() => {
    setStats(getViewStats());
    setMeta(getMetaCache());
    const saved = getSavedDepartment();
    if (saved) setDepartment(saved);
    setLayout(getSavedLayout());
  }, []);

  const handleLayoutChange = (value: LibraryLayout) => {
    setLayout(value);
    saveLayout(value);
  };

  // 部署フィルタは端末に記録し、次回以降は自動適用する
  const handleDepartmentChange = (value: string) => {
    setDepartment(value);
    saveDepartment(value === ALL ? '' : value);
  };

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

  // 再読み込みボタン: キャッシュを無視してカテゴリ/部署を全件読み直す
  const handleRefresh = useCallback(() => {
    forceMetaRef.current = true;
    loadFiles();
  }, [loadFiles]);

  // 一覧取得後、各手順書のタイトル・カテゴリを取得（キャッシュ優先）
  useEffect(() => {
    if (files.length === 0) return;
    const cache = getMetaCache();
    // 強制再読み込み時はキャッシュを無視して全件読み直す（一括設定は更新日時を保持するため、
    // 更新日時ベースのキャッシュ判定だけではカテゴリ/部署の変更を検知できないことがある）
    const force = forceMetaRef.current;
    forceMetaRef.current = false;
    const stale = force
      ? files
      : files.filter(
          (f) =>
            !cache[f.id] ||
            cache[f.id].modifiedTime !== f.modifiedTime ||
            cache[f.id].department === undefined ||
            cache[f.id].searchText === undefined,
        );
    if (stale.length === 0) {
      setMeta(cache);
      return;
    }

    let cancelled = false;
    setMetaLoading(true);
    Promise.all(
      stale.map(async (f) => {
        try {
          const content = await downloadDriveFile(f.id);
          const json = JSON.parse(content) as Record<string, unknown>;
          return {
            id: f.id,
            meta: {
              title: (json.title as string)?.trim() || f.name.replace(/\.json$/i, ''),
              category: (json.category as string)?.trim() || '',
              department: (json.department as string)?.trim() || '',
              searchText: buildSearchText(json),
              modifiedTime: f.modifiedTime,
            } as CachedMeta,
          };
        } catch {
          return {
            id: f.id,
            meta: {
              title: f.name.replace(/\.json$/i, ''),
              category: '',
              department: '',
              searchText: f.name.toLowerCase(),
              modifiedTime: f.modifiedTime,
            } as CachedMeta,
          };
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const next = { ...cache };
        results.forEach((r) => {
          next[r.id] = r.meta;
        });
        // 一覧に無いファイルのキャッシュは掃除する
        const validIds = new Set(files.map((f) => f.id));
        Object.keys(next).forEach((id) => {
          if (!validIds.has(id)) delete next[id];
        });
        setMeta(next);
        saveMetaCache(next);
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [files]);

  const handleOpen = (file: DriveFileInfo) => {
    recordView(file.id);
    setStats(getViewStats());
    setOpening(file.id);
    router.push(`/instructions/view?driveFileId=${file.id}`);
  };

  const displayName = (file: DriveFileInfo) =>
    meta[file.id]?.title || file.name.replace(/\.json$/i, '');

  // カテゴリ一覧（チップ用）
  const categories = Array.from(
    new Set(
      files
        .map((f) => meta[f.id]?.category)
        .filter((c): c is string => !!c),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  // 部署一覧（チップ用）
  const departments = Array.from(
    new Set(
      files
        .map((f) => meta[f.id]?.department)
        .filter((d): d is string => !!d),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  const filteredFiles = [...files]
    .filter((f) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      if (displayName(f).toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) return true;
      // 「ファイル内容も検索」がONなら本文(手順の中身)も対象にする
      return contentSearch && (meta[f.id]?.searchText?.includes(q) ?? false);
    })
    .filter((f) => (department === ALL ? true : meta[f.id]?.department === department))
    .filter((f) => (category === ALL ? true : meta[f.id]?.category === category))
    .sort((a, b) => {
      if (sortOrder === 'name-asc') return displayName(a).localeCompare(displayName(b), 'ja');
      if (sortOrder === 'frequent') {
        const sa = stats[a.id];
        const sb = stats[b.id];
        const ca = sa?.count ?? 0;
        const cb = sb?.count ?? 0;
        if (cb !== ca) return cb - ca;
        const la = sa?.lastViewedAt ?? 0;
        const lb = sb?.lastViewedAt ?? 0;
        if (lb !== la) return lb - la;
      }
      const at = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const bt = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return bt - at;
    });

  const needsSignIn = configured && !auth.isSignedIn;

  const chipBase =
    'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition';
  const chipActive = 'border-[#a48149] bg-[#f7f3ec] text-[#8a6a37]';
  const chipIdle = 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-76px)] max-w-7xl flex-col px-4 py-6 sm:px-6 lg:py-8">
      <section className="border-b border-neutral-200 pb-5">
        <div className="mb-4 h-px w-16 bg-[#a48149]" />
        <p className="mb-2 text-xs font-semibold tracking-[0.28em] text-[#8a6a37]">HORIZON JIT</p>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-[-0.02em] text-neutral-950 sm:text-4xl">
          手順書ビューア
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-neutral-600 sm:text-[15px]">
          一覧から手順書を選んで閲覧できます。
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
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-neutral-950 px-6 text-base font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.16)] transition hover:bg-neutral-800"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
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
          {/* 検索・並び替え（タッチ向けに大きめ） */}
          <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="w-full sm:max-w-md">
              <label className="relative block">
                <svg className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="手順書をさがす"
                  className="h-12 w-full rounded-xl border border-neutral-200 bg-white pl-11 pr-3 text-base text-neutral-800 outline-none transition focus:border-[#c9b188]"
                />
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
                <input
                  type="checkbox"
                  checked={contentSearch}
                  onChange={(e) => setContentSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 accent-[#a48149]"
                />
                ファイル内容も検索（手順の中身も対象）
              </label>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="h-12 rounded-xl border border-neutral-200 bg-white px-3 text-base text-neutral-800 outline-none transition focus:border-[#c9b188]"
                aria-label="並び替え"
              >
                <option value="frequent">よく見る順</option>
                <option value="updated-desc">更新が新しい順</option>
                <option value="name-asc">名前順</option>
              </select>

              {/* 表示レイアウト切替（リスト／グリッド） */}
              <div className="flex h-12 shrink-0 items-center rounded-xl border border-neutral-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => handleLayoutChange('list')}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    layout === 'list' ? 'bg-[#f0e9db] text-[#8a6a37]' : 'text-neutral-500 hover:text-neutral-950'
                  }`}
                  title="リスト表示"
                  aria-label="リスト表示"
                  aria-pressed={layout === 'list'}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleLayoutChange('grid')}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    layout === 'grid' ? 'bg-[#f0e9db] text-[#8a6a37]' : 'text-neutral-500 hover:text-neutral-950'
                  }`}
                  title="グリッド表示"
                  aria-label="グリッド表示"
                  aria-pressed={layout === 'grid'}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || metaLoading}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-950 disabled:opacity-50"
                title="一覧を再読み込み（カテゴリ・部署を再スキャン）"
                aria-label="一覧を再読み込み"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </section>

          {/* 部署で絞り込み（選択は端末に記録され、次回以降も自動適用される） */}
          {departments.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-500">部署</span>
                {department !== ALL && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#8a6a37]">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    この端末に記録中
                  </span>
                )}
              </div>
              <section className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                <button
                  type="button"
                  onClick={() => handleDepartmentChange(ALL)}
                  className={`${chipBase} ${department === ALL ? chipActive : chipIdle}`}
                >
                  すべて
                </button>
                {departments.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDepartmentChange(d)}
                    className={`${chipBase} ${department === d ? chipActive : chipIdle}`}
                  >
                    {d}
                  </button>
                ))}
              </section>
            </div>
          )}

          {/* カテゴリ絞り込みチップ */}
          {categories.length > 0 && (
            <div className="mt-3">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-500">カテゴリ</span>
              <section className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                <button
                  type="button"
                  onClick={() => setCategory(ALL)}
                  className={`${chipBase} ${category === ALL ? chipActive : chipIdle}`}
                >
                  すべて
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`${chipBase} ${category === c ? chipActive : chipIdle}`}
                  >
                    {getCategoryLabel(c)}
                  </button>
                ))}
              </section>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
            <span>{folderName && `フォルダ: ${folderName}`}</span>
            <span>{metaLoading ? 'カテゴリ・部署を読み込み中...' : !loading && `${filteredFiles.length} 件`}</span>
          </div>

          <section className="mt-2 flex-1">
            {loading ? (
              <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
                読み込み中...
              </div>
            ) : filteredFiles.length === 0 && !error ? (
              <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
                条件に合う手順書がありません
              </div>
            ) : (
              <ul className={layout === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-2'}>
                {filteredFiles.map((file) => {
                  const updatedAt = formatDate(file.modifiedTime);
                  const isOpening = opening === file.id;
                  const cat = meta[file.id]?.category;
                  const dept = meta[file.id]?.department;
                  const count = stats[file.id]?.count ?? 0;
                  return (
                    <li key={file.id}>
                      <button
                        onClick={() => handleOpen(file)}
                        disabled={opening !== null}
                        className={`group flex h-full w-full items-center gap-4 rounded-xl border border-neutral-200 bg-white text-left shadow-[0_8px_18px_rgba(0,0,0,0.04)] transition active:scale-[0.99] hover:border-[#d7c29b] hover:bg-[#faf7f1] disabled:cursor-wait disabled:opacity-60 ${
                          layout === 'grid' ? 'min-h-[96px] items-start px-4 py-5' : 'px-4 py-3'
                        }`}
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                          {isOpening ? (
                            <span className="inline-block h-5 w-5 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
                          ) : (
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586A2 2 0 0114 3.586L18.414 8A2 2 0 0119 9.414V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-base font-semibold leading-6 text-neutral-900 ${layout === 'grid' ? 'line-clamp-2' : 'line-clamp-1'}`}>{displayName(file)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {dept && (
                              <span className="rounded-full border border-[#e3d6bb] bg-[#f7f3ec] px-2.5 py-0.5 text-xs font-medium text-[#8a6a37]">
                                {dept}
                              </span>
                            )}
                            {cat && (
                              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                                {getCategoryLabel(cat)}
                              </span>
                            )}
                            {count >= FREQUENT_THRESHOLD && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#f7f3ec] px-2.5 py-0.5 text-xs font-medium text-[#8a6a37]">
                                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>
                                よく見る
                              </span>
                            )}
                            {updatedAt && <span className="text-xs text-neutral-400">更新: {updatedAt}</span>}
                          </div>
                        </div>
                        <svg className="mt-1 h-5 w-5 shrink-0 text-neutral-300 transition group-hover:text-[#9a7a45]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
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
