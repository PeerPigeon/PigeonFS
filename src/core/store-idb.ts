/** A browser's chunks and library, in IndexedDB (they stay across reloads). */
import type { ChunkStore, Library, LibraryEntry } from './store.ts';

const DB = 'pigeonfs-v2';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB would not open'));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbStores(): Promise<{ chunks: ChunkStore; library: Library }> {
  const db = await open();
  const store = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  // Chunk sizes, kept in memory for usage() (counted once at start).
  const sizes = new Map<string, number>();
  await new Promise<void>((resolve, reject) => {
    const req = store('chunks', 'readonly').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      sizes.set(String(c.key), (c.value as Uint8Array).byteLength);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  const chunks: ChunkStore = {
    has: async (h) => sizes.has(h),
    get: async (h) => {
      const v = await done(store('chunks', 'readonly').get(h));
      return v ? new Uint8Array(v as ArrayBuffer | Uint8Array) : null;
    },
    put: async (h, bytes) => { await done(store('chunks', 'readwrite').put(bytes.slice(), h)); sizes.set(h, bytes.length); },
    delete: async (h) => { await done(store('chunks', 'readwrite').delete(h)); sizes.delete(h); },
    usage: async () => ({ chunks: sizes.size, bytes: [...sizes.values()].reduce((a, b) => a + b, 0) }),
  };
  const library: Library = {
    list: async () => ((await done(store('files', 'readonly').getAll())) as LibraryEntry[]).sort((a, b) => b.added - a.added),
    get: async (id) => ((await done(store('files', 'readonly').get(id))) as LibraryEntry | undefined) ?? null,
    put: async (entry) => { await done(store('files', 'readwrite').put(entry)); },
    delete: async (id) => { await done(store('files', 'readwrite').delete(id)); },
  };
  return { chunks, library };
}
