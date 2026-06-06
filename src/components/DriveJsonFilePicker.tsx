'use client';

import { useEffect, useState } from 'react';
import { DriveFileInfo, downloadDriveFile, getTargetFolder, listJsonFilesInFolder } from '@/lib/googleDrive';
import { getApprovalStatus, getCategoryLabel, WorkInstruction } from '@/types/instruction';

interface DriveJsonFilePickerProps {
  open: boolean;
  onClose: () => void;
  onFileLoaded: (content: string, file: DriveFileInfo) => void;
}

type SortOrder = 'updated-desc' | 'updated-asc';

interface FileListItem extends DriveFileInfo {
  createdBy?: string;
  updatedBy?: string;
  category?: string;
  department?: string;
  searchableText?: string;
  approvalStatus?: 'approved' | 'needs_reapproval' | 'unapproved';
  approvalApprovedAt?: string;
}

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

function formatSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function approvalBadgeClass(status?: string): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'needs_reapproval') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-neutral-200 bg-neutral-50 text-neutral-500';
}

function approvalBadgeLabel(status?: string): string {
  if (status === 'approved') return '承認済み';
  if (status === 'needs_reapproval') return '要再承認';
  return '未承認';
}

function buildSearchableText(instruction: WorkInstruction): string {
  const parts: string[] = [
    instruction.title,
    instruction.description,
    instruction.department,
    instruction.category,
    ...(instruction.keywords ?? []),
  ].filter((value): value is string => !!value);

  for (const step of instruction.steps ?? []) {
    parts.push(...[
      step.title,
      step.description,
      step.caution,
      step.detailDescription,
      ...(step.checkItems ?? []).map((check) => check.label),
      ...(step.links ?? []).flatMap((link) => [link.label, link.url]),
      ...(step.imageCaptions ?? []),
    ].filter((value): value is string => !!value));
  }

  for (const condition of instruction.conditions ?? []) {
    parts.push(condition.label);
  }

  return parts.filter(Boolean).join('\n').toLowerCase();
}

export default function DriveJsonFilePicker({ open, onClose, onFileLoaded }: DriveJsonFilePickerProps) {
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated-desc');
  const [createdByFilter, setCreatedByFilter] = useState('all');
  const [updatedByFilter, setUpdatedByFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [approvalFilter, setApprovalFilter] = useState('all');
  const [includeContentSearch, setIncludeContentSearch] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    const folder = getTargetFolder();
    if (!folder) {
      setError('保存先の Drive フォルダが設定されていません。右上のフォルダボタンから設定してください。');
      setFolderName('');
      setFiles([]);
      return;
    }

    setFolderName(folder.name);
    setError(null);
    setLoading(true);

    listJsonFilesInFolder(folder.id)
      .then((jsonFiles) => {
        setFiles(jsonFiles);
        if (jsonFiles.length === 0) {
          setError('このフォルダに JSON ファイルがありません。');
        }
      })
      .catch((err) => {
        console.error('Failed to list files:', err);
        setError('JSON ファイル一覧の取得に失敗しました。');
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || files.length === 0) return;

    let cancelled = false;
    const pending = files.filter(
      (file) =>
        file.createdBy === undefined &&
        file.updatedBy === undefined &&
        file.category === undefined &&
        file.department === undefined &&
        file.searchableText === undefined &&
        file.approvalStatus === undefined,
    );
    if (pending.length === 0) return;

    setMetadataLoading(true);

    Promise.all(
      pending.map(async (file) => {
        try {
          const content = await downloadDriveFile(file.id);
          const json = JSON.parse(content) as WorkInstruction;
          return {
            id: file.id,
            createdBy: json.createdBy?.trim() || file.ownerName || '',
            updatedBy: json.updatedBy?.trim() || file.lastModifyingUserName || '',
            category: json.category || '',
            department: json.department || '',
            searchableText: buildSearchableText(json),
            approvalStatus: getApprovalStatus(json),
            approvalApprovedAt: json.approval?.current?.approvedAt,
          };
        } catch (err) {
          console.error('Failed to load file metadata:', err);
          return {
            id: file.id,
            createdBy: file.ownerName || '',
            updatedBy: file.lastModifyingUserName || '',
            category: '',
            department: '',
            searchableText: '',
            approvalStatus: 'unapproved' as const,
          };
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const metaMap = new Map(results.map((item) => [item.id, item]));
        setFiles((prev) =>
          prev.map((file) => {
            const meta = metaMap.get(file.id);
            return meta
              ? {
                  ...file,
                  createdBy: meta.createdBy || undefined,
                  updatedBy: meta.updatedBy || undefined,
                  category: meta.category || undefined,
                  department: meta.department || undefined,
                  searchableText: meta.searchableText || undefined,
                  approvalStatus: meta.approvalStatus,
                  approvalApprovedAt: meta.approvalApprovedAt,
                }
              : file;
          }),
        );
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, files]);

  const handleFileSelect = async (file: DriveFileInfo) => {
    setDownloading(file.id);
    setError(null);

    try {
      const content = await downloadDriveFile(file.id);
      handleClose();
      onFileLoaded(content, file);
    } catch (err) {
      console.error('Failed to download file:', err);
      setError('ファイルの読み込みに失敗しました。');
    } finally {
      setDownloading(null);
    }
  };

  const handleClose = () => {
    setFiles([]);
    setError(null);
    setDownloading(null);
    setQuery('');
    setSortOrder('updated-desc');
    setCreatedByFilter('all');
    setUpdatedByFilter('all');
    setCategoryFilter('all');
    setDepartmentFilter('all');
    setApprovalFilter('all');
    setIncludeContentSearch(false);
    onClose();
  };

  const createdByOptions = Array.from(
    new Set(files.map((file) => file.createdBy).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  const updatedByOptions = Array.from(
    new Set(files.map((file) => file.updatedBy).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  const categoryOptions = Array.from(
    new Set(files.map((file) => file.category).filter((value): value is string => !!value)),
  ).sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b), 'ja'));

  const departmentOptions = Array.from(
    new Set(files.map((file) => file.department).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  const filteredFiles = [...files]
    .filter((file) => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return true;
      if (file.name.toLowerCase().includes(normalizedQuery)) return true;
      if (!includeContentSearch) return false;
      return (file.searchableText ?? '').includes(normalizedQuery);
    })
    .filter((file) => (createdByFilter === 'all' ? true : file.createdBy === createdByFilter))
    .filter((file) => (updatedByFilter === 'all' ? true : file.updatedBy === updatedByFilter))
    .filter((file) => (categoryFilter === 'all' ? true : file.category === categoryFilter))
    .filter((file) => (departmentFilter === 'all' ? true : file.department === departmentFilter))
    .filter((file) => (approvalFilter === 'all' ? true : file.approvalStatus === approvalFilter))
    .sort((a, b) => {
      const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return sortOrder === 'updated-desc' ? bTime - aTime : aTime - bTime;
    });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 sm:p-5">
      <div className="brand-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-200 shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-6 border-b border-neutral-200 px-5 py-4 sm:px-6">
          <div>
            <p className="brand-text-muted text-[11px] font-semibold tracking-[0.22em]">DRIVE FILES</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">手順書ファイルを選択</h3>
            {folderName && (
              <p className="mt-2 text-sm text-neutral-500">
                保存先フォルダ: <span className="font-medium text-neutral-700">{folderName}</span>
              </p>
            )}
          </div>

          <button
            onClick={handleClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 transition hover:text-neutral-700"
            aria-label="閉じる"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          <div className="mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_repeat(3,minmax(0,1fr))]">
              <div className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">ファイル名で検索</span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ファイル名を入力"
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                />
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-500">
                  <input
                    type="checkbox"
                    checked={includeContentSearch}
                    onChange={(e) => setIncludeContentSearch(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-neutral-300 accent-blue-600"
                  />
                  手順書の中身も検索
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">更新日で並び替え</span>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="updated-desc">新しい順</option>
                  <option value="updated-asc">古い順</option>
                </select>
              </label>

              <div className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">カテゴリで絞り込み</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="all">すべて</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {getCategoryLabel(category)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">部署で絞り込み</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="all">すべて</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>

              <div className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">承認で絞り込み</span>
                <select
                  value={approvalFilter}
                  onChange={(e) => setApprovalFilter(e.target.value)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="all">すべて</option>
                  <option value="approved">承認済み</option>
                  <option value="needs_reapproval">要再承認</option>
                  <option value="unapproved">未承認</option>
                </select>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">作成者で絞り込み</span>
                <select
                  value={createdByFilter}
                  onChange={(e) => setCreatedByFilter(e.target.value)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="all">すべて</option>
                  {createdByOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">更新者で絞り込み</span>
                <select
                  value={updatedByFilter}
                  onChange={(e) => setUpdatedByFilter(e.target.value)}
                  className="brand-panel w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#c9b188] focus:bg-white"
                >
                  <option value="all">すべて</option>
                  {updatedByOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <span>{filteredFiles.length} 件表示</span>
              {metadataLoading && <span>作成者・更新者を読み込み中...</span>}
            </div>
          </div>

          {loading ? (
            <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
              読み込み中...
            </div>
          ) : filteredFiles.length === 0 && !error ? (
            <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white text-sm text-neutral-400">
              条件に合うファイルがありません
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredFiles.map((file) => {
                const updatedAt = formatDate(file.modifiedTime);
                const size = formatSize(file.size);
                const isLoading = downloading === file.id;

                return (
                  <li key={file.id}>
                    <button
                      onClick={() => handleFileSelect(file)}
                      disabled={downloading !== null}
                      className="brand-hover-border brand-hover-surface group flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left transition disabled:cursor-wait disabled:opacity-60"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
                        {isLoading ? (
                          <span className="inline-block h-5 w-5 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
                        ) : (
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586A2 2 0 0114 3.586L18.414 8A2 2 0 0119 9.414V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900">{file.name}</p>
                          {file.approvalStatus && (
                            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${approvalBadgeClass(file.approvalStatus)}`}>
                              {file.approvalStatus === 'approved' && (
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              {approvalBadgeLabel(file.approvalStatus)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-neutral-400">
                          {updatedAt && <span>更新: {updatedAt}</span>}
                          {size && <span>サイズ: {size}</span>}
                          {file.createdBy && <span>作成者: {file.createdBy}</span>}
                          {file.updatedBy && <span>更新者: {file.updatedBy}</span>}
                        </div>
                      </div>

                      <div className="group-hover-brand-text shrink-0 text-neutral-300 transition">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end border-t border-neutral-200 px-5 py-3 sm:px-6">
          <button
            onClick={handleClose}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-800"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
