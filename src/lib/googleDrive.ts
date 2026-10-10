import { WorkInstruction } from '@/types/instruction';
import { ensureAccessToken, throwForResponse, withGoogleAuth } from '@/lib/googleAuth';
import { DriveInstructionMeta, parseDriveMeta } from '@/lib/driveMeta';

const DEFAULT_FOLDER_NAME = 'WorkInstructions';
const FILE_NAME = 'work_instructions.json';
const STORAGE_KEY_FOLDER = 'drive_target_folder';

export interface DriveFolder {
  id: string;
  name: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  owners?: Array<{ displayName?: string }>;
  lastModifyingUser?: { displayName?: string };
  appProperties?: Record<string, string>;
  description?: string;
}

interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

interface SharedDrive {
  id: string;
  name: string;
}

interface SharedDriveList {
  drives: SharedDrive[];
  nextPageToken?: string;
}

const PAGE_SIZE = '1000';

/** Drive の一覧 API を nextPageToken が尽きるまで読み、全件つなげて返す（100 件制限の解消） */
async function listAllPages<T extends { nextPageToken?: string }, R>(
  path: string,
  params: Record<string, string>,
  pick: (page: T) => R[],
): Promise<R[]> {
  const out: R[] = [];
  let pageToken: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const res = await gapiRequest<T>({ path, params: pageToken ? { ...params, pageToken } : params });
    out.push(...pick(res.result));
    pageToken = res.result.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

const childFolderRequests = new Map<string, Promise<DriveFolder>>();

/** gapi 経由の呼び出し。事前に有効なトークンを確保し、401 なら更新して 1 回やり直す */
function gapiRequest<T>(args: Parameters<typeof gapi.client.request>[0]): Promise<{ result: T; body: string; status: number }> {
  return withGoogleAuth(() => gapi.client.request<T>(args));
}

// --- Target folder management ---

export function getTargetFolder(): DriveFolder | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FOLDER);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setTargetFolder(folder: DriveFolder | null): void {
  if (folder) {
    localStorage.setItem(STORAGE_KEY_FOLDER, JSON.stringify(folder));
  } else {
    localStorage.removeItem(STORAGE_KEY_FOLDER);
  }
}

// --- Recent / pinned folders (よく使うフォルダ) ---

const STORAGE_KEY_RECENT = 'drive_recent_folders';
const RECENT_LIMIT = 8;

export interface RecentFolder extends DriveFolder {
  /** 「共有ドライブ / 資材課 / 手順書」のような場所の表記 */
  path?: string;
  pinned?: boolean;
  lastUsedAt: number;
}

export function getRecentFolders(): RecentFolder[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_RECENT);
    const list: RecentFolder[] = stored ? JSON.parse(stored) : [];
    return Array.isArray(list) ? sortRecent(list) : [];
  } catch {
    return [];
  }
}

function sortRecent(list: RecentFolder[]): RecentFolder[] {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.lastUsedAt - a.lastUsedAt);
}

function saveRecent(list: RecentFolder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(list));
  } catch {
    // 容量超過などは無視（履歴は利便性のためだけの情報）
  }
}

/** 選んだフォルダを履歴に残す。ピン留め分は上限に数えない。 */
export function rememberFolder(folder: DriveFolder, path?: string): RecentFolder[] {
  const list = getRecentFolders();
  const existing = list.find((f) => f.id === folder.id);
  const entry: RecentFolder = { ...folder, path: path ?? existing?.path, pinned: existing?.pinned, lastUsedAt: Date.now() };
  const rest = list.filter((f) => f.id !== folder.id);
  const pinned = rest.filter((f) => f.pinned);
  const unpinned = rest.filter((f) => !f.pinned);
  const next = sortRecent([entry, ...pinned, ...unpinned.slice(0, Math.max(0, RECENT_LIMIT - 1))]);
  saveRecent(next);
  return next;
}

export function removeRecentFolder(id: string): RecentFolder[] {
  const next = getRecentFolders().filter((f) => f.id !== id);
  saveRecent(next);
  return next;
}

export function toggleFolderPin(id: string): RecentFolder[] {
  const next = sortRecent(getRecentFolders().map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f)));
  saveRecent(next);
  return next;
}

// --- Drive location types ---

export type DriveLocation = 'my-drive' | 'shared-drives' | 'shared-with-me';

// --- Shared drives ---

export async function listSharedDrives(): Promise<DriveFolder[]> {
  const drives = await listAllPages<SharedDriveList, SharedDrive>(
    'https://www.googleapis.com/drive/v3/drives',
    { pageSize: '100', fields: 'nextPageToken,drives(id,name)' },
    (page) => page.drives || [],
  );
  return drives.map((d) => ({ id: d.id, name: d.name }));
}

// --- Folder browsing ---

export async function listFolders(parentId?: string, options?: { driveId?: string }): Promise<DriveFolder[]> {
  const parentQuery = parentId
    ? `'${parentId}' in parents and`
    : `'root' in parents and`;

  const params: Record<string, string> = {
    q: `${parentQuery} mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'nextPageToken,files(id,name)',
    orderBy: 'name',
    pageSize: PAGE_SIZE,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  };

  if (options?.driveId) {
    params.corpora = 'drive';
    params.driveId = options.driveId;
  }

  const files = await listAllPages<DriveFileList, DriveFile>('https://www.googleapis.com/drive/v3/files', params, (page) => page.files || []);
  return files.map((f) => ({ id: f.id, name: f.name }));
}

export async function listSharedWithMeFolders(): Promise<DriveFolder[]> {
  const files = await listAllPages<DriveFileList, DriveFile>(
    'https://www.googleapis.com/drive/v3/files',
    {
      q: "sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'nextPageToken,files(id,name)',
      orderBy: 'name',
      pageSize: PAGE_SIZE,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
    (page) => page.files || [],
  );
  return files.map((f) => ({ id: f.id, name: f.name }));
}

export async function createNewFolder(name: string, parentId?: string): Promise<DriveFolder> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const res = await gapiRequest<DriveFile>({
    path: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    params: { supportsAllDrives: 'true' },
    body,
  });
  return { id: res.result.id, name: res.result.name };
}

export async function findOrCreateChildFolder(parentId: string, name: string): Promise<DriveFolder> {
  const key = `${parentId}:${name}`;
  const pending = childFolderRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const escapedName = name.replace(/'/g, "\\'");
    const res = await gapiRequest<DriveFileList>({
      path: 'https://www.googleapis.com/drive/v3/files',
      params: {
        q: `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
        pageSize: '1',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      },
    });
    const existing = res.result.files[0];
    if (existing) return { id: existing.id, name: existing.name };
    return createNewFolder(name, parentId);
  })();

  childFolderRequests.set(key, request);
  try {
    return await request;
  } catch (error) {
    childFolderRequests.delete(key);
    throw error;
  }
}

export async function copyDriveFile(
  fileId: string,
  parentId: string,
  options: { name: string; modifiedTime?: string },
): Promise<DriveFileInfo> {
  const body: Record<string, unknown> = {
    name: options.name,
    parents: [parentId],
  };
  if (options.modifiedTime) body.modifiedTime = options.modifiedTime;

  const res = await gapiRequest<DriveFile>({
    path: `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    method: 'POST',
    params: {
      fields: 'id,name,modifiedTime',
      supportsAllDrives: 'true',
    },
    body,
  });
  return {
    id: res.result.id,
    name: res.result.name,
    modifiedTime: res.result.modifiedTime,
  };
}

// --- Internal helpers ---

async function findDefaultFolder(): Promise<string | null> {
  const res = await gapiRequest<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: `name='${DEFAULT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  const files = res.result.files;
  return files.length > 0 ? files[0].id : null;
}

async function createDefaultFolder(): Promise<string> {
  const res = await gapiRequest<DriveFile>({
    path: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    params: { supportsAllDrives: 'true' },
    body: {
      name: DEFAULT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
  });
  return res.result.id;
}

async function getTargetFolderId(): Promise<string> {
  const target = getTargetFolder();
  if (target) return target.id;
  const existing = await findDefaultFolder();
  if (existing) return existing;
  return createDefaultFolder();
}

async function findFile(folderId: string): Promise<string | null> {
  const res = await gapiRequest<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  const files = res.result.files;
  return files.length > 0 ? files[0].id : null;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: number;
  ownerName?: string;
  lastModifyingUserName?: string;
  /** 保存時に付けた一覧用の情報。無ければ旧ファイル（本文をダウンロードして取る） */
  meta?: DriveInstructionMeta | null;
  /** 本文検索用のテキスト（description）。meta がある場合のみ */
  searchText?: string;
}

export async function listJsonFilesInFolder(folderId: string): Promise<DriveFileInfo[]> {
  const files = await listAllPages<DriveFileList, DriveFile>(
    'https://www.googleapis.com/drive/v3/files',
    {
      q: `'${folderId}' in parents and mimeType='application/json' and trashed=false`,
      fields: 'nextPageToken,files(id,name,modifiedTime,size,owners(displayName),lastModifyingUser(displayName),appProperties,description)',
      orderBy: 'modifiedTime desc',
      pageSize: PAGE_SIZE,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
    (page) => page.files || [],
  );
  return files.map((f) => {
    const meta = parseDriveMeta(f.appProperties);
    return {
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      size: f.size ? Number(f.size) : undefined,
      ownerName: f.owners?.[0]?.displayName,
      lastModifyingUserName: f.lastModifyingUser?.displayName,
      meta,
      searchText: meta ? (f.description ?? '') : undefined,
    };
  });
}

/** 一覧用の情報だけを書き換える（本文は送らない）。旧ファイルへの後追い付与に使う */
export async function updateDriveFileMeta(
  fileId: string,
  meta: { appProperties: Record<string, string>; description?: string; modifiedTime?: string },
): Promise<void> {
  const body: Record<string, unknown> = { appProperties: meta.appProperties };
  if (meta.description !== undefined) body.description = meta.description;
  if (meta.modifiedTime) body.modifiedTime = meta.modifiedTime;
  await gapiRequest<DriveFile>({
    path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
    method: 'PATCH',
    params: { supportsAllDrives: 'true', fields: 'id' },
    body,
  });
}

export async function downloadDriveFile(fileId: string): Promise<string> {
  return withGoogleAuth(async (token) => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) await throwForResponse(res, 'Drive API');
    return res.text();
  });
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Upload an XLSX buffer to Drive and convert it to native Google Sheets format.
 * Returns the Google Sheets spreadsheet ID for subsequent Sheets API calls.
 */
export async function uploadAsGoogleSheet(
  buffer: ArrayBuffer,
  sheetName: string,
): Promise<string> {
  const token = await ensureAccessToken();

  const folderId = await getTargetFolderId();
  const escapedName = sheetName.replace(/'/g, "\\'");

  // Check for existing Google Sheets file with same name
  const existingRes = await gapiRequest<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: `name='${escapedName}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  const existingFileId = existingRes.result.files.length > 0 ? existingRes.result.files[0].id : null;

  // Metadata: target mimeType = Google Sheets triggers conversion on Drive side
  const metadata = existingFileId
    ? { name: sheetName, mimeType: 'application/vnd.google-apps.spreadsheet' }
    : { name: sheetName, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folderId] };

  const initUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable&supportsAllDrives=true&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id';

  const initRes = await fetch(initUrl, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': XLSX_MIME,
      'X-Upload-Content-Length': String(buffer.byteLength),
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) await throwForResponse(initRes, 'Drive API');

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('アップロードURLを取得できませんでした');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': XLSX_MIME, 'Content-Length': String(buffer.byteLength) },
    body: buffer,
  });

  if (!uploadRes.ok) await throwForResponse(uploadRes, 'Drive API');

  const file = await uploadRes.json() as { id: string };
  if (!file.id) throw new Error('Google SheetsファイルのIDを取得できませんでした');
  return file.id;
}

export interface SaveFileOptions {
  modifiedTime?: string;
  /** 一覧用の情報（driveMeta.buildDriveMeta） */
  appProperties?: Record<string, string>;
  /** 本文検索用テキスト（driveMeta.buildSearchText） */
  description?: string;
}

export async function saveFileToDrive(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  options?: SaveFileOptions,
): Promise<string> {
  try {
    return await saveFileToDriveOnce(buffer, fileName, mimeType, options);
  } catch (e) {
    // 一覧用の情報が原因で 400 になった場合は、情報なしでもう一度保存する（保存そのものは落とさない）
    const hasMeta = options?.appProperties || options?.description !== undefined;
    if (hasMeta && e instanceof Error && /Drive API 400/.test(e.message)) {
      console.warn('metadata rejected, retrying without appProperties/description', e.message);
      return saveFileToDriveOnce(buffer, fileName, mimeType, { modifiedTime: options?.modifiedTime });
    }
    throw e;
  }
}

async function saveFileToDriveOnce(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  options?: SaveFileOptions,
): Promise<string> {
  const token = await ensureAccessToken();

  const folderId = await getTargetFolderId();

  // Check if file already exists in the folder
  const escapedName = fileName.replace(/'/g, "\\'");
  const existingRes = await gapiRequest<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: `name='${escapedName}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  const existingFileId = existingRes.result.files.length > 0 ? existingRes.result.files[0].id : null;

  const metadata: Record<string, unknown> = existingFileId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [folderId] };
  // 更新日時を据え置きたい場合は明示指定する（指定しないとDriveが現在時刻に更新する）
  if (options?.modifiedTime) metadata.modifiedTime = options.modifiedTime;
  if (options?.appProperties) metadata.appProperties = options.appProperties;
  if (options?.description !== undefined) metadata.description = options.description;

  // Use resumable upload for reliability with large files
  // For new files, include fields=id so the upload response returns the file ID
  const initUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id';

  const initRes = await fetch(initUrl, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(buffer.byteLength),
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) await throwForResponse(initRes, 'Drive API');

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('アップロードURLを取得できませんでした');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(buffer.byteLength),
    },
    body: buffer,
  });

  if (!uploadRes.ok) await throwForResponse(uploadRes, 'Drive API');

  if (existingFileId) return existingFileId;
  const result = await uploadRes.json() as { id: string };
  if (!result.id) throw new Error('ファイルIDを取得できませんでした');
  return result.id;
}

export async function saveInstructionsToDrive(
  instructions: WorkInstruction[],
): Promise<void> {
  const token = await ensureAccessToken();

  const folderId = await getTargetFolderId();
  const fileId = await findFile(folderId);
  const content = JSON.stringify(instructions, null, 2);

  const metadata = fileId
    ? { name: FILE_NAME, mimeType: 'application/json' }
    : { name: FILE_NAME, mimeType: 'application/json', parents: [folderId] };

  const boundary = 'boundary' + Date.now();
  const encoder = new TextEncoder();

  const metadataPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const fileHeader = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
  );
  const fileContent = encoder.encode(content);
  const closing = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metadataPart.length + fileHeader.length + fileContent.length + closing.length);
  let offset = 0;
  body.set(metadataPart, offset); offset += metadataPart.length;
  body.set(fileHeader, offset); offset += fileHeader.length;
  body.set(fileContent, offset); offset += fileContent.length;
  body.set(closing, offset);

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';

  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: body.buffer,
  });

  if (!res.ok) await throwForResponse(res, 'Drive API');
}

export async function loadInstructionsFromDrive(): Promise<WorkInstruction[] | null> {
  const target = getTargetFolder();
  const folderId = target ? target.id : await findDefaultFolder();
  if (!folderId) return null;

  const fileId = await findFile(folderId);
  if (!fileId) return null;

  const res = await gapiRequest<WorkInstruction[]>({
    path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
    params: { alt: 'media', supportsAllDrives: 'true' },
  });

  return res.result;
}
