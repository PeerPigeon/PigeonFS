/**
 * A Node peer's chunks and library, in a folder:
 *   <dir>/chunks/ab/<sha256>   each chunk
 *   <dir>/files/<id>.json      each file held whole (its library entry)
 */
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ChunkStore, Library, LibraryEntry } from '../core/store.ts';

export async function fsStores(dir: string): Promise<{ chunks: ChunkStore; library: Library }> {
  const chunkDir = path.join(dir, 'chunks'), fileDir = path.join(dir, 'files');
  await mkdir(chunkDir, { recursive: true });
  await mkdir(fileDir, { recursive: true });
  const where = (h: string) => {
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('not a chunk hash');
    return path.join(chunkDir, h.slice(0, 2), h);
  };
  // Chunk sizes, counted once at start (for usage()).
  const sizes = new Map<string, number>();
  for (const sub of await readdir(chunkDir).catch(() => [] as string[])) {
    for (const name of await readdir(path.join(chunkDir, sub)).catch(() => [] as string[])) {
      if (/^[0-9a-f]{64}$/.test(name)) sizes.set(name, (await stat(path.join(chunkDir, sub, name))).size);
    }
  }
  // Written whole or not at all (a crash mid-write leaves no half chunk).
  const writeWhole = async (file: string, data: string | Uint8Array) => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  };
  const chunks: ChunkStore = {
    has: async (h) => sizes.has(h),
    get: async (h) => (sizes.has(h) ? new Uint8Array(await readFile(where(h)).catch(() => null) ?? []) : null),
    put: async (h, bytes) => { await writeWhole(where(h), bytes); sizes.set(h, bytes.length); },
    delete: async (h) => { await rm(where(h), { force: true }); sizes.delete(h); },
    usage: async () => ({ chunks: sizes.size, bytes: [...sizes.values()].reduce((a, b) => a + b, 0) }),
  };
  const entryFile = (id: string) => {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('not a file id');
    return path.join(fileDir, `${id}.json`);
  };
  const library: Library = {
    list: async () => {
      const out: LibraryEntry[] = [];
      for (const name of await readdir(fileDir)) {
        if (!name.endsWith('.json')) continue;
        try { out.push(JSON.parse(await readFile(path.join(fileDir, name), 'utf8')) as LibraryEntry); } catch { /* a bad entry: skipped */ }
      }
      return out.sort((a, b) => b.added - a.added);
    },
    get: async (id) => {
      try { return JSON.parse(await readFile(entryFile(id), 'utf8')) as LibraryEntry; } catch { return null; }
    },
    put: async (entry) => { await writeWhole(entryFile(entry.id), JSON.stringify(entry)); },
    delete: async (id) => { await rm(entryFile(id), { force: true }); },
  };
  return { chunks, library };
}
