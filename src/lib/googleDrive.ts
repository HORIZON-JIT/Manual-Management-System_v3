import { WorkInstruction } from '@/types/instruction';

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
}

interface DriveFileList {
  files: DriveFile[];
}

interface SharedDrive {
  id: string;
  name: string;
}

interface SharedDriveList {
  drives: SharedDrive[];
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

// --- Drive location types ---

export type DriveLocation = 'my-drive' | 'shared-drives' | 'shared-with-me';

// --- Shared drives ---

export async function listSharedDrives(): Promise<DriveFolder[]> {
  const res = await gapi.client.request<SharedDriveList>({
    path: 'https://www.googleapis.com/drive/v3/drives',
    params: {
      pageSize: '100',
      fields: 'drives(id,name)',
    },
  });
  return (res.result.drives || []).map((d) => ({ id: d.id, name: d.name }));
}

// --- Folder browsing ---

export async function listFolders(parentId?: string, options?: { driveId?: string }): Promise<DriveFolder[]> {
  const parentQuery = parentId
    ? `'${parentId}' in parents and`
    : `'root' in parents and`;

  const params: Record<string, string> = {
    q: `${parentQuery} mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  };

  if (options?.driveId) {
    params.corpora = 'drive';
    params.driveId = options.driveId;
  }

  const res = await gapi.client.request<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params,
  });
  return res.result.files.map((f) => ({ id: f.id, name: f.name }));
}

export async function listSharedWithMeFolders(): Promise<DriveFolder[]> {
  const res = await gapi.client.request<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: "sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  return res.result.files.map((f) => ({ id: f.id, name: f.name }));
}

export async function createNewFolder(name: string, parentId?: string): Promise<DriveFolder> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const res = await gapi.client.request<DriveFile>({
    path: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    params: { supportsAllDrives: 'true' },
    body,
  });
  return { id: res.result.id, name: res.result.name };
}

// --- Internal helpers ---

async function findDefaultFolder(): Promise<string | null> {
  const res = await gapi.client.request<DriveFileList>({
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
  const res = await gapi.client.request<DriveFile>({
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
  const res = await gapi.client.request<DriveFileList>({
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
}

export async function listJsonFilesInFolder(folderId: string): Promise<DriveFileInfo[]> {
  const res = await gapi.client.request<DriveFileList>({
    path: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q: `'${folderId}' in parents and mimeType='application/json' and trashed=false`,
      fields: 'files(id,name,modifiedTime,size,owners(displayName),lastModifyingUser(displayName))',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    },
  });
  return res.result.files.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    size: f.size ? Number(f.size) : undefined,
    ownerName: f.owners?.[0]?.displayName,
    lastModifyingUserName: f.lastModifyingUser?.displayName,
  }));
}

export async function downloadDriveFile(fileId: string): Promise<string> {
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  return res.text();
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
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

  const folderId = await getTargetFolderId();
  const escapedName = sheetName.replace(/'/g, "\\'");

  // Check for existing Google Sheets file with same name
  const existingRes = await gapi.client.request<DriveFileList>({
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

  if (!initRes.ok) {
    const errorText = await initRes.text();
    throw new Error(`Drive API ${initRes.status}: ${errorText}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('アップロードURLを取得できませんでした');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': XLSX_MIME, 'Content-Length': String(buffer.byteLength) },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Drive API ${uploadRes.status}: ${errorText}`);
  }

  const file = await uploadRes.json() as { id: string };
  if (!file.id) throw new Error('Google SheetsファイルのIDを取得できませんでした');
  return file.id;
}

export async function saveFileToDrive(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  options?: { modifiedTime?: string },
): Promise<string> {
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

  const folderId = await getTargetFolderId();

  // Check if file already exists in the folder
  const escapedName = fileName.replace(/'/g, "\\'");
  const existingRes = await gapi.client.request<DriveFileList>({
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

  if (!initRes.ok) {
    const errorText = await initRes.text();
    throw new Error(`Drive API ${initRes.status}: ${errorText}`);
  }

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

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Drive API ${uploadRes.status}: ${errorText}`);
  }

  if (existingFileId) return existingFileId;
  const result = await uploadRes.json() as { id: string };
  if (!result.id) throw new Error('ファイルIDを取得できませんでした');
  return result.id;
}

export async function saveInstructionsToDrive(
  instructions: WorkInstruction[],
): Promise<void> {
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

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

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Drive API ${res.status}: ${errorText}`);
  }
}

export async function loadInstructionsFromDrive(): Promise<WorkInstruction[] | null> {
  const target = getTargetFolder();
  const folderId = target ? target.id : await findDefaultFolder();
  if (!folderId) return null;

  const fileId = await findFile(folderId);
  if (!fileId) return null;

  const res = await gapi.client.request<WorkInstruction[]>({
    path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
    params: { alt: 'media', supportsAllDrives: 'true' },
  });

  return res.result;
}
