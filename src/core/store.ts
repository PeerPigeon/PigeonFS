/**
 * Where a peer keeps what it holds: chunks by their SHA-256, and the
 * manifests of the files it holds whole (its library). In memory here; in a
 * browser, IndexedDB (store-idb.ts); in Node, a folder (../node/store-fs.ts).
 */
import type { Manifest } from './manifest.ts';

export interface ChunkStore {
  has(hash: string): Promise<boolean>;
  get(hash: string): Promise<Uint8Array | null>;
  put(hash: string, bytes: Uint8Array): Promise<void>;
  delete(hash: string): Promise<void>;
  /** How many chunks, and their bytes. */
  usage(): Promise<{ chunks: number; bytes: number }>;
}

export interface LibraryEntry {
  id: string;
  manifest: Manifest;
  /** When this peer came to hold it whole (ms since 1970). */
  added: number;
}

export interface Library {
  list(): Promise<LibraryEntry[]>;
  get(id: string): Promise<LibraryEntry | null>;
  put(entry: LibraryEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MemoryChunks implements ChunkStore {
  private readonly map = new Map<string, Uint8Array>();
  async has(hash: string) { return this.map.has(hash); }
  async get(hash: string) { return this.map.get(hash) ?? null; }
  async put(hash: string, bytes: Uint8Array) { this.map.set(hash, bytes.slice()); }
  async delete(hash: string) { this.map.delete(hash); }
  async usage() {
    let bytes = 0;
    for (const b of this.map.values()) bytes += b.length;
    return { chunks: this.map.size, bytes };
  }
}

export class MemoryLibrary implements Library {
  private readonly map = new Map<string, LibraryEntry>();
  async list() { return [...this.map.values()].sort((a, b) => b.added - a.added); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async put(entry: LibraryEntry) { this.map.set(entry.id, entry); }
  async delete(id: string) { this.map.delete(id); }
}
