/**
 * A file is its manifest: its name, size and type, and the SHA-256 of each of
 * its chunks in order. Its id is the SHA-256 of the manifest itself, so a file
 * is found by what it holds, any copy of a chunk is as good as any other, and
 * every chunk and manifest fetched from a peer is checked against its hash.
 */
import { sha256Hex, utf8 } from './bytes.ts';

/** 128 KB: one message each (base64, a third more), small enough to come from many peers at once. */
export const CHUNK_BYTES = 128 * 1024;

export interface Manifest {
  v: 1;
  name: string;
  size: number;
  type: string;
  chunkBytes: number;
  /** SHA-256 of each chunk, in order (an empty file has none). */
  chunks: string[];
}

/** What a peer says about a file it holds, without its chunk list. */
export interface FileSummary {
  id: string;
  name: string;
  size: number;
  type: string;
}

/** The manifest in a fixed form (keys in order), so every peer hashes it alike. */
export function canonical(m: Manifest): string {
  return JSON.stringify({ v: 1, name: m.name, size: m.size, type: m.type, chunkBytes: m.chunkBytes, chunks: m.chunks });
}

export async function fileId(m: Manifest): Promise<string> {
  return sha256Hex(utf8(canonical(m)));
}

export function summary(id: string, m: Manifest): FileSummary {
  return { id, name: m.name, size: m.size, type: m.type };
}

/** Whether something is a well-formed manifest (from another peer: checked before use). */
export function isManifest(x: unknown): x is Manifest {
  const m = x as Manifest;
  return !!m && m.v === 1 && typeof m.name === 'string' && Number.isSafeInteger(m.size) && m.size >= 0
    && typeof m.type === 'string' && Number.isSafeInteger(m.chunkBytes) && m.chunkBytes > 0
    && Array.isArray(m.chunks) && m.chunks.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))
    && m.chunks.length === Math.ceil(m.size / m.chunkBytes);
}

/** Something to read a file's bytes from: a Blob (a browser's File) or bytes in memory. */
export type Source = Blob | Uint8Array;

export function sourceSize(s: Source): number {
  return s instanceof Uint8Array ? s.length : s.size;
}

export async function readSlice(s: Source, start: number, end: number): Promise<Uint8Array> {
  if (s instanceof Uint8Array) return s.subarray(start, end);
  return new Uint8Array(await s.slice(start, end).arrayBuffer());
}
