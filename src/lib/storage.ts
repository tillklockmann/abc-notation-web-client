import { parse, serialize, slugify } from './frontmatter';
import type { NotationDoc, NotationFile } from './types';

const IDB_NAME = 'notation-app';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'projectFolder';
const EXT = '.notation';

export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Returns the saved folder handle if present, regardless of permission state. */
export async function getSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const h = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  return h ?? null;
}

export async function clearSavedFolder(): Promise<void> {
  await idbDelete(HANDLE_KEY);
}

export async function hasPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const p = await handle.queryPermission({ mode: 'readwrite' });
  return p === 'granted';
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const p = await handle.requestPermission({ mode: 'readwrite' });
  return p === 'granted';
}

/** Show the OS folder picker and persist the handle. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'notation-project', mode: 'readwrite' });
  await idbPut(HANDLE_KEY, handle);
  return handle;
}

export async function listNotations(dir: FileSystemDirectoryHandle): Promise<NotationFile[]> {
  const out: NotationFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith(EXT)) continue;
    const fileHandle = handle as FileSystemFileHandle;
    let title = name.slice(0, -EXT.length);
    let modifiedAt = 0;
    try {
      const file = await fileHandle.getFile();
      modifiedAt = file.lastModified;
      const parsed = parse(await file.text());
      if (parsed.title.trim()) title = parsed.title;
    } catch {
      // Skip unreadable files but still list them
    }
    out.push({ id: name.slice(0, -EXT.length), title, modifiedAt, handle: fileHandle });
  }
  out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}

export async function readNotation(file: NotationFile): Promise<NotationDoc> {
  const f = await file.handle.getFile();
  return parse(await f.text());
}

export async function writeNotation(file: NotationFile, doc: NotationDoc): Promise<void> {
  const writable = await file.handle.createWritable();
  await writable.write(serialize(doc));
  await writable.close();
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function createNotation(
  dir: FileSystemDirectoryHandle,
  doc: NotationDoc
): Promise<NotationFile> {
  const base = slugify(doc.title || 'unbenannt');
  let name = `${base}${EXT}`;
  let i = 2;
  while (await fileExists(dir, name)) {
    name = `${base}-${i}${EXT}`;
    i++;
  }
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(serialize(doc));
  await writable.close();
  return {
    id: name.slice(0, -EXT.length),
    title: doc.title || base,
    modifiedAt: Date.now(),
    handle,
  };
}

export async function deleteNotation(
  dir: FileSystemDirectoryHandle,
  file: NotationFile
): Promise<void> {
  await dir.removeEntry(`${file.id}${EXT}`);
}

export async function renameNotation(
  dir: FileSystemDirectoryHandle,
  file: NotationFile,
  newTitle: string
): Promise<NotationFile> {
  const doc = await readNotation(file);
  doc.title = newTitle;
  const newSlug = slugify(newTitle);
  let target = `${newSlug}${EXT}`;
  let i = 2;
  while (target !== `${file.id}${EXT}` && await fileExists(dir, target)) {
    target = `${newSlug}-${i}${EXT}`;
    i++;
  }
  // Write into a new file, then remove the old one (FSA has no rename).
  if (target !== `${file.id}${EXT}`) {
    const newHandle = await dir.getFileHandle(target, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(serialize(doc));
    await writable.close();
    await dir.removeEntry(`${file.id}${EXT}`);
    return {
      id: target.slice(0, -EXT.length),
      title: newTitle,
      modifiedAt: Date.now(),
      handle: newHandle,
    };
  }
  // Same filename, just rewrite contents
  await writeNotation(file, doc);
  return { ...file, title: newTitle, modifiedAt: Date.now() };
}
