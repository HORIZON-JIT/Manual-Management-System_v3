'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DriveFolder,
  DriveLocation,
  listFolders,
  listSharedDrives,
  listSharedWithMeFolders,
  createNewFolder,
  getTargetFolder,
  setTargetFolder,
  RecentFolder,
  getRecentFolders,
  rememberFolder,
  removeRecentFolder,
  toggleFolderPin,
} from '@/lib/googleDrive';

interface DriveFolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folder: DriveFolder | null) => void;
}

interface BreadcrumbItem {
  id: string | undefined; // undefined = root
  name: string;
}

const LOCATION_LABELS: Record<DriveLocation, string> = {
  'my-drive': 'マイドライブ',
  'shared-drives': '共有ドライブ',
  'shared-with-me': '共有アイテム',
};

export default function DriveFolderPicker({ open, onClose, onSelect }: DriveFolderPickerProps) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<DriveLocation>('my-drive');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: undefined, name: 'マイドライブ' }]);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Track if we're browsing inside a shared drive (for driveId param)
  const [currentDriveId, setCurrentDriveId] = useState<string | undefined>(undefined);
  // Track if we're at the shared drives list level (not yet inside one)
  const [isSharedDrivesList, setIsSharedDrivesList] = useState(false);
  const currentParentId = breadcrumbs[breadcrumbs.length - 1].id;
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  useEffect(() => {
    if (open) setRecent(getRecentFolders());
  }, [open]);

  const loadFolderList = useCallback(async (parentId?: string, driveId?: string) => {
    setLoading(true);
    try {
      const result = await listFolders(parentId, driveId ? { driveId } : undefined);
      setFolders(result);
    } catch (err) {
      console.error('Failed to list folders:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSharedDrives = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSharedDrives();
      setFolders(result);
    } catch (err) {
      console.error('Failed to list shared drives:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSharedWithMe = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSharedWithMeFolders();
      setFolders(result);
    } catch (err) {
      console.error('Failed to list shared folders:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const switchLocation = useCallback((loc: DriveLocation) => {
    setLocation(loc);
    setCurrentDriveId(undefined);
    setIsSharedDrivesList(false);
    const rootName = LOCATION_LABELS[loc];
    setBreadcrumbs([{ id: undefined, name: rootName }]);

    if (loc === 'my-drive') {
      // Will be loaded by effect
    } else if (loc === 'shared-drives') {
      setIsSharedDrivesList(true);
    }
    // shared-with-me also loaded by effect
  }, []);

  useEffect(() => {
    if (!open) return;
    setLocation('my-drive');
    setCurrentDriveId(undefined);
    setIsSharedDrivesList(false);
    setBreadcrumbs([{ id: undefined, name: 'マイドライブ' }]);
    loadFolderList(undefined);
  }, [open, loadFolderList]);

  // Load folders when location changes
  useEffect(() => {
    if (!open) return;
    if (location === 'my-drive') {
      loadFolderList(undefined);
    } else if (location === 'shared-drives') {
      loadSharedDrives();
    } else if (location === 'shared-with-me') {
      loadSharedWithMe();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const navigateInto = (folder: DriveFolder) => {
    if (isSharedDrivesList) {
      // Entering a shared drive - set driveId and browse its root
      setIsSharedDrivesList(false);
      setCurrentDriveId(folder.id);
      setBreadcrumbs([
        { id: undefined, name: LOCATION_LABELS['shared-drives'] },
        { id: folder.id, name: folder.name },
      ]);
      loadFolderList(folder.id, folder.id);
      return;
    }

    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    loadFolderList(folder.id, currentDriveId);
  };

  const navigateTo = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    const targetId = newBreadcrumbs[newBreadcrumbs.length - 1].id;

    if (location === 'shared-drives' && index === 0) {
      // Back to shared drives list
      setIsSharedDrivesList(true);
      setCurrentDriveId(undefined);
      loadSharedDrives();
    } else if (location === 'shared-with-me' && index === 0) {
      loadSharedWithMe();
    } else {
      loadFolderList(targetId, currentDriveId);
    }
  };

  const handleSelectCurrent = () => {
    const current = breadcrumbs[breadcrumbs.length - 1];
    if (!current.id) {
      // Root selected - clear custom folder
      setTargetFolder(null);
      onSelect(null);
    } else {
      const folder: DriveFolder = { id: current.id, name: current.name };
      const path = [LOCATION_LABELS[location], ...breadcrumbs.slice(1, -1).map((b) => b.name)].join(' / ');
      setTargetFolder(folder);
      rememberFolder(folder, path);
      onSelect(folder);
    }
    onClose();
  };

  const handleSelectRecent = (folder: RecentFolder) => {
    const target: DriveFolder = { id: folder.id, name: folder.name };
    setTargetFolder(target);
    rememberFolder(target, folder.path);
    onSelect(target);
    onClose();
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    try {
      const created = await createNewFolder(newFolderName.trim(), currentParentId);
      setNewFolderName('');
      // Refresh folder list
      if (isSharedDrivesList) {
        await loadSharedDrives();
      } else if (location === 'shared-with-me' && !currentParentId) {
        await loadSharedWithMe();
      } else {
        await loadFolderList(currentParentId, currentDriveId);
      }
      // Navigate into new folder
      navigateInto(created);
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setTargetFolder(null);
    onSelect(null);
    onClose();
  };

  const currentTarget = getTargetFolder();

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">保存先フォルダを選択</h3>
          {currentTarget && (
            <p className="text-xs text-gray-500 mt-1">
              現在の保存先: <span className="font-medium text-yellow-700">{currentTarget.name}</span>
            </p>
          )}
        </div>

        {/* Recent / pinned folders */}
        {recent.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">よく使うフォルダ</p>
            <ul className="mt-1.5 space-y-0.5">
              {recent.map((f) => (
                <li key={f.id} className="group flex items-center gap-1 rounded-lg hover:bg-white">
                  <button
                    type="button"
                    onClick={() => setRecent(toggleFolderPin(f.id))}
                    title={f.pinned ? 'ピン留めを外す' : 'ピン留めして常に上に表示'}
                    aria-label={f.pinned ? 'ピン留めを外す' : 'ピン留め'}
                    className={`shrink-0 rounded px-1.5 py-1 text-sm transition ${f.pinned ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`}
                  >
                    {f.pinned ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectRecent(f)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm transition"
                  >
                    <span className="text-yellow-500">📁</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${currentTarget?.id === f.id ? 'font-semibold text-yellow-700' : 'text-gray-700'}`}>{f.name}</span>
                      {f.path && <span className="block truncate text-[11px] text-gray-400">{f.path}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecent(removeRecentFolder(f.id))}
                    title="一覧から外す"
                    aria-label={`${f.name} を一覧から外す`}
                    className="shrink-0 rounded px-1.5 py-1 text-xs text-gray-300 transition hover:text-red-500"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Location tabs */}
        <div className="px-2 sm:px-4 py-2 border-b border-gray-200 flex gap-1">
          {(['my-drive', 'shared-drives', 'shared-with-me'] as DriveLocation[]).map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocation(loc)}
              className={`px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium transition ${
                location === loc
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {LOCATION_LABELS[loc]}
            </button>
          ))}
        </div>

        {/* Breadcrumbs */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-1 text-sm overflow-x-auto">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-gray-400">/</span>}
              <button
                onClick={() => navigateTo(i)}
                className={`hover:text-blue-600 ${
                  i === breadcrumbs.length - 1
                    ? 'font-medium text-gray-800'
                    : 'text-gray-500 hover:underline'
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              読み込み中...
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              {isSharedDrivesList ? '共有ドライブがありません' : 'フォルダがありません'}
            </div>
          ) : (
            <ul className="space-y-1">
              {folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    onClick={() => navigateInto(folder)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-sm transition"
                  >
                    <span className="text-yellow-500 text-lg">
                      {isSharedDrivesList ? '🖥️' : '📁'}
                    </span>
                    <span className="text-gray-700 truncate">{folder.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* New folder - hide when at shared drives list level */}
        {!isSharedDrivesList && (
          <div className="px-4 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                placeholder="新しいフォルダ名..."
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                onClick={handleCreateFolder}
                disabled={creating || !newFolderName.trim()}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600 transition disabled:opacity-50"
              >
                {creating ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-3 sm:px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
          <button
            onClick={handleReset}
            className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 underline"
          >
            デフォルトに戻す
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-800 transition"
            >
              キャンセル
            </button>
            <button
              onClick={handleSelectCurrent}
              disabled={isSharedDrivesList}
              className="px-3 sm:px-4 py-2 bg-yellow-500 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-yellow-600 transition disabled:opacity-50"
            >
              このフォルダを選択
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
