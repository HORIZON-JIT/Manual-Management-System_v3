import { WorkInstruction } from '@/types/instruction';

/**
 * 下書き（ローカル保存の手順書）の保存先。
 * 以前は localStorage（約5MBが上限）に入れていたが、画像付きの手順書ですぐ上限に当たるため
 * IndexedDB（ディスク容量に応じて数百MB以上使える）に移した。
 * 初回アクセス時に localStorage の既存データを IndexedDB へ移し、元のデータは消す。
 */

const LEGACY_STORAGE_KEY = 'work_instructions';
const DB_NAME = 'work_instructions_db';
const STORE_NAME = 'instructions';
const DB_VERSION = 1;

function stripSnapshotImages(instruction: WorkInstruction): WorkInstruction {
  if (!instruction.updateHistory) return instruction;
  return {
    ...instruction,
    updateHistory: instruction.updateHistory.map(entry => {
      if (!entry.snapshot) return entry;
      return {
        ...entry,
        snapshot: {
          ...entry.snapshot,
          steps: entry.snapshot.steps.map(step => ({
            ...step,
            imageDataUrls: undefined,
            imageDataUrl: undefined,
          })),
        },
      };
    }),
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

const QUOTA_MESSAGE = 'ブラウザの保存容量が不足しています。下書き一覧から不要な下書きを削除するか、画像の数を減らしてください。';

let migrationPromise: Promise<void> | null = null;

/** localStorage に残っている旧データを IndexedDB へ移す（一度だけ） */
function migrateLegacy(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (typeof window === 'undefined') return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let legacy: WorkInstruction[] = [];
    try {
      legacy = JSON.parse(raw) as WorkInstruction[];
    } catch {
      legacy = [];
    }
    const db = await openDB();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const inst of legacy) {
        if (!inst || !inst.id) continue;
        const existing = await requestToPromise(store.get(inst.id));
        if (!existing) store.put(inst);
      }
      await transactionDone(tx);
    } finally {
      db.close();
    }
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // 削除できなくても動作には影響しない
    }
  })().catch(() => {
    // 移行に失敗しても以降の処理は続ける（次回またやり直す）
    migrationPromise = null;
  });
  return migrationPromise;
}

export async function getAllInstructions(): Promise<WorkInstruction[]> {
  if (typeof window === 'undefined') return [];
  await migrateLegacy();
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const all = await requestToPromise(tx.objectStore(STORE_NAME).getAll());
    return (all as WorkInstruction[]).filter((inst) => !!inst && !!inst.id);
  } finally {
    db.close();
  }
}

export async function getInstruction(id: string): Promise<WorkInstruction | undefined> {
  if (typeof window === 'undefined') return undefined;
  await migrateLegacy();
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const found = await requestToPromise(tx.objectStore(STORE_NAME).get(id));
    return (found as WorkInstruction | undefined) ?? undefined;
  } finally {
    db.close();
  }
}

export async function saveInstruction(instruction: WorkInstruction): Promise<void> {
  await migrateLegacy();
  const toStore = stripSnapshotImages(instruction);
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(toStore.id));
    if (!existing && toStore.status === 'draft' && toStore.title.trim()) {
      // 同じタイトルの古い下書きは置き換える（従来どおり）
      const all = (await requestToPromise(store.getAll())) as WorkInstruction[];
      for (const inst of all) {
        if (inst.status === 'draft' && inst.title.trim() === toStore.title.trim() && inst.id !== toStore.id) {
          store.delete(inst.id);
        }
      }
    }
    store.put(toStore);
    await transactionDone(tx);
  } catch (error) {
    if (isQuotaError(error)) throw new Error(QUOTA_MESSAGE);
    throw error;
  } finally {
    db.close();
  }
}

export async function deleteInstruction(id: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/** 保存されている手順書をすべて置き換える（Drive からの一括読み込み用） */
export async function replaceAllInstructions(instructions: WorkInstruction[]): Promise<void> {
  await migrateLegacy();
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const inst of instructions) if (inst && inst.id) store.put(stripSnapshotImages(inst));
    await transactionDone(tx);
  } catch (error) {
    if (isQuotaError(error)) throw new Error(QUOTA_MESSAGE);
    throw error;
  } finally {
    db.close();
  }
}

export async function importInstruction(instruction: WorkInstruction): Promise<string> {
  const existing = await getInstruction(instruction.id);
  if (existing) {
    const newId = crypto.randomUUID();
    await saveInstruction({ ...instruction, id: newId });
    return newId;
  }
  await saveInstruction(instruction);
  return instruction.id;
}

/** 下書きが使っているおおよその容量（バイト）。一覧での目安表示用。 */
export function estimateInstructionsSize(instructions: WorkInstruction[]): number {
  let total = 0;
  for (const inst of instructions) {
    try {
      total += JSON.stringify(inst).length;
    } catch {
      // 計測できないものは無視
    }
  }
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
