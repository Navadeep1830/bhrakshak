'use client';

/**
 * Offline queue — IndexedDB persistence for citizen reports captured
 * without network (photo + text). Synced batch-by-batch when connectivity
 * returns. No external deps: raw IndexedDB API.
 */

export interface QueuedReport {
  id: string;
  category: string;
  notes: string | null;
  lat: number;
  lon: number;
  photoDataUrl: string | null;
  clientCreatedAt: string; // ISO
  zoneHint?: string | null;
}

/** Offline field messages (SOS / help / status / info) — queued like reports. */
export interface QueuedMessage {
  id: string;
  category: string;
  body: string;
  lat: number | null;
  lon: number | null;
  clientCreatedAt: string; // ISO
}

const DB_NAME = 'bhrakshak-offline';
const STORE = 'queue';
const MSG_STORE = 'msgs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2 adds the message store (v1 installs keep their report queue)
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MSG_STORE)) {
        db.createObjectStore(MSG_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked by an old tab'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
        t.oncomplete = () => db.close();
      })
  );
}

function txMsgs<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(MSG_STORE, mode);
        const req = fn(t.objectStore(MSG_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
        t.oncomplete = () => db.close();
      })
  );
}

export async function getMsgQueue(): Promise<QueuedMessage[]> {
  try {
    const rows = await txMsgs<QueuedMessage[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedMessage[]>);
    return rows.sort((a, b) => (a.clientCreatedAt < b.clientCreatedAt ? -1 : 1)); // FIFO
  } catch {
    return [];
  }
}

export async function addMsgToQueue(item: QueuedMessage): Promise<void> {
  await txMsgs('readwrite', (s) => s.put(item));
}

export async function removeMsgFromQueue(id: string): Promise<void> {
  await txMsgs('readwrite', (s) => s.delete(id));
}

export async function getQueue(): Promise<QueuedReport[]> {
  try {
    const rows = await tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>);
    return rows.sort((a, b) => (a.clientCreatedAt < b.clientCreatedAt ? -1 : 1)); // FIFO
  } catch {
    return [];
  }
}

export async function countQueue(): Promise<number> {
  try {
    return await tx<number>('readonly', (s) => s.count());
  } catch {
    return 0;
  }
}

export async function addToQueue(item: QueuedReport): Promise<void> {
  await tx('readwrite', (s) => s.add(item));
}

export async function removeFromQueue(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Compress a photo to ≤1024 px JPEG data-url (keeps the queue small). */
export async function compressPhoto(file: File, maxDim = 1024, quality = 0.78): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image decode failed'));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** data-url → Blob (for multipart upload) */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
