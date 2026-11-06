/**
 * PigeonFS: files across a mesh, found and fetched by what they hold.
 *
 *  - share: a file is cut into chunks, kept here, and said to the mesh ("have").
 *  - search: a question goes to every peer ("find"); those holding matching
 *    files answer this peer alone ("found"). A file's holders are the peers
 *    that said they have it.
 *  - fetch: its manifest from one holder, then its chunks from all of them at
 *    once, each checked against its SHA-256 (a holder that sends bad bytes, or
 *    none, is passed over); once whole, this peer holds it too, and says so.
 *  - offer: tell one peer about a file (it fetches it from here, or anyone).
 *
 * Every peer answers for what it holds: chunks ("chunk?"), by their hashes.
 *
 * In the mesh's storage (PeerPigeon's spaces):
 *  - frozen  pfs/m/<id>         each manifest, written once (its key is its
 *                               hash): fetched from any peer holding it, and
 *                               checked against the id;
 *  - user    pfs/holds/<owner>  what each peer holds, and how much: only that
 *                               peer can change it, and every peer replicates
 *                               the whole namespace (PeerPigeon's `replicate`:
 *                               a newcomer gets every record on linking), so
 *                               holders are known without asking.
 * Without storage (or when it has no answer) a holder is asked directly ("man?").
 */
import { fromBase64, randomId, sha256Hex, toBase64 } from './bytes.ts';
import { CHUNK_BYTES, fileId, isManifest, readSlice, sourceSize, summary, type FileSummary, type Manifest, type Source } from './manifest.ts';
import type { Mesh } from './mesh.ts';
import type { ChunkStore, Library, LibraryEntry } from './store.ts';

/** PigeonFS messages carry this key (other users of the same mesh ignore them). */
export const TAG = 'pfs';
/** Storage keys: manifests (frozen), and each peer's holdings (user). */
export const MANIFEST_PREFIX = 'pfs/m/';
export const HOLDINGS_PREFIX = 'pfs/holds/';

/** What a peer holds, as it says in its user-space record. */
export interface Holdings {
  /** Its mesh id now (to ask for chunks). */
  peer: string;
  /** Its files; `mesh: true` on those it holds for the mesh (greedy storage). */
  files: (FileSummary & { mesh?: boolean })[];
  /** Bytes it stores. */
  bytes: number;
  /** When it said so (it says so again every few minutes while up: an old record is a peer gone). */
  at: number;
  /** Space it lends the mesh, and how much of it is used (greedy storage), if it lends any. */
  lends?: { quota: number; used: number };
  /** Files it is taking a copy of for the mesh right now (counted as copies on their way). */
  taking?: string[];
}

export interface NetworkFile extends FileSummary {
  /** Peers that said they hold it whole. */
  holders: string[];
  /** When it was last heard of. */
  seen: number;
}

export interface Offer {
  from: string;
  file: FileSummary;
  at: number;
}

export interface Progress {
  id: string;
  name: string;
  /** Bytes here so far, of the file's size. */
  bytes: number;
  size: number;
  /** Peers chunks came from so far. */
  from: string[];
}

export interface FetchOptions {
  /** Peers known to hold it (besides those heard from). */
  holders?: string[];
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  /** Held for the mesh (greedy storage), not asked for here. */
  forMesh?: boolean;
  /** Chunks asked for at once (default: the PigeonFS's). */
  concurrency?: number;
}

export interface PigeonFsOptions {
  /** Chunks asked for at once (default 6). */
  concurrency?: number;
  /** How long to wait for one chunk (default 20 s). */
  chunkTimeoutMs?: number;
  /** How long to wait for answers to a search (default 1.5 s). */
  searchMs?: number;
}

type Message = { [TAG]: 1; t: string; r?: string; [k: string]: unknown };
type Events = { change: () => void; offer: (offer: Offer) => void };

export class PigeonFS {
  /** Files heard of on the mesh, by id. */
  readonly network = new Map<string, NetworkFile>();
  readonly offers: Offer[] = [];
  private readonly waiting = new Map<string, { done: (from: string, m: Message) => boolean }>();
  private readonly listeners: { [K in keyof Events]: Events[K][] } = { change: [], offer: [] };
  private readonly concurrency: number;
  private readonly chunkTimeoutMs: number;
  private readonly searchMs: number;

  constructor(readonly mesh: Mesh, readonly chunks: ChunkStore, readonly library: Library, options: PigeonFsOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 6);
    this.chunkTimeoutMs = options.chunkTimeoutMs ?? 20_000;
    this.searchMs = options.searchMs ?? 1500;
    mesh.onMessage((from, data) => { void this.receive(from, data); });
    mesh.onPeersChanged(() => this.emit('change'));
    mesh.storage?.onChange((space, key) => { if (space === 'user' && key.startsWith(HOLDINGS_PREFIX)) this.emit('change'); });
  }

  /** Put what is held here into the mesh's storage: each file's manifest (if not there yet), and this peer's holdings. */
  async start(): Promise<void> {
    if (!this.mesh.storage) return;
    for (const e of await this.library.list()) await this.keepManifest(e.id, e.manifest);
    await this.publishHoldings();
  }

  private publishing: ReturnType<typeof setTimeout> | null = null;
  /** Say what is held here (soon: several changes in a row make one record). */
  private holdingsChanged(): void {
    if (!this.mesh.storage) return;
    if (this.publishing) clearTimeout(this.publishing);
    this.publishing = setTimeout(() => { this.publishing = null; void this.publishHoldings().catch(() => {}); }, 300);
  }

  /** Files this peer is taking a copy of for the mesh (greedy storage), said in its holdings record. */
  readonly taking = new Set<string>();

  /** What this peer lends the mesh (set by greedy storage), said in its holdings record. */
  lending: (() => { quota: number; used: number } | null) | null = null;

  /** Say what is held here again, now (a heartbeat, or a change made by greedy storage). */
  holdingsNow(): void { void this.publishHoldings().catch(() => {}); }

  async publishHoldings(): Promise<void> {
    const storage = this.mesh.storage;
    if (!storage) return;
    const files = (await this.library.list()).map((e) => ({ ...summary(e.id, e.manifest), ...(e.forMesh ? { mesh: true } : {}) }));
    const lends = this.lending?.();
    const value: Holdings = {
      peer: this.self, files, bytes: (await this.chunks.usage()).bytes, at: Date.now(),
      ...(lends ? { lends } : {}), ...(this.taking.size ? { taking: [...this.taking] } : {}),
    };
    await storage.put('user', HOLDINGS_PREFIX + storage.owner, value);
  }

  /** Every peer's holdings record held here (this one's too), by its owner. */
  async holdings(): Promise<(Holdings & { owner: string })[]> {
    const storage = this.mesh.storage;
    if (!storage) return [];
    const out: (Holdings & { owner: string })[] = [];
    for (const r of await storage.list('user', HOLDINGS_PREFIX)) {
      const h = r.value as Holdings;
      const owner = r.key.slice(HOLDINGS_PREFIX.length);
      // Only its owner's word counts.
      if (r.owner && r.owner !== owner) continue;
      if (!h || typeof h.peer !== 'string' || !Array.isArray(h.files)) continue;
      out.push({
        owner, peer: h.peer, files: h.files.filter(isSummary), bytes: Number(h.bytes) || 0, at: Number(h.at) || 0,
        ...(h.lends && Number.isFinite(h.lends.quota) ? { lends: { quota: Number(h.lends.quota), used: Number(h.lends.used) || 0 } } : {}),
        ...(Array.isArray(h.taking) ? { taking: h.taking.filter((x): x is string => typeof x === 'string') } : {}),
      });
    }
    return out;
  }

  /** The manifest in the frozen space (written once; a peer that already has it there leaves it). */
  private async keepManifest(id: string, manifest: Manifest): Promise<void> {
    const storage = this.mesh.storage;
    if (!storage) return;
    try {
      if (!(await storage.get('frozen', MANIFEST_PREFIX + id))) await storage.put('frozen', MANIFEST_PREFIX + id, manifest, { silent: true });
    } catch { /* written meanwhile by another peer's answer: the same manifest */ }
  }

  get self(): string { return this.mesh.self; }

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    (this.listeners[event] as Events[K][]).push(listener);
    return () => { this.listeners[event] = (this.listeners[event] as Events[K][]).filter((f) => f !== listener) as never; };
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const f of this.listeners[event]) (f as (...a: Parameters<Events[K]>) => void)(...args);
  }

  // ---- What this peer holds ----

  /** Keep a file here, and tell the mesh. */
  async share(source: Source, name: string, type = '', onProgress?: (bytes: number, size: number) => void): Promise<LibraryEntry> {
    const size = sourceSize(source);
    const hashes: string[] = [];
    for (let at = 0; at < size; at += CHUNK_BYTES) {
      const bytes = await readSlice(source, at, Math.min(size, at + CHUNK_BYTES));
      const hash = await sha256Hex(bytes);
      if (!(await this.chunks.has(hash))) await this.chunks.put(hash, bytes);
      hashes.push(hash);
      onProgress?.(Math.min(size, at + CHUNK_BYTES), size);
    }
    const manifest: Manifest = { v: 1, name, size, type, chunkBytes: CHUNK_BYTES, chunks: hashes };
    const entry: LibraryEntry = { id: await fileId(manifest), manifest, added: Date.now() };
    await this.library.put(entry);
    await this.keepManifest(entry.id, manifest);
    this.holdingsChanged();
    this.noteHolder(this.self, summary(entry.id, manifest));
    this.announce([summary(entry.id, manifest)]);
    this.emit('change');
    return entry;
  }

  /** The files held here whole. */
  files(): Promise<LibraryEntry[]> { return this.library.list(); }

  /** A file held here, as bytes (each chunk checked). */
  async read(id: string): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const part of this.parts(id)) parts.push(part);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  /** A file held here, chunk by chunk (for a Blob, or writing to disk, without all of it in memory at once). */
  async *parts(id: string): AsyncGenerator<Uint8Array> {
    const entry = await this.library.get(id);
    if (!entry) throw new Error('not held here');
    for (const hash of entry.manifest.chunks) {
      const bytes = await this.chunks.get(hash);
      if (!bytes) throw new Error(`a chunk of ${entry.manifest.name} is missing here`);
      yield bytes;
    }
  }

  /** Stop holding a file (its chunks go, unless another file held here uses them). */
  async remove(id: string): Promise<void> {
    const entry = await this.library.get(id);
    if (!entry) return;
    await this.library.delete(id);
    const known = this.network.get(id);
    if (known) known.holders = known.holders.filter((p) => p !== this.self);
    this.mesh.broadcast(this.msg('gone', { ids: [id] }));
    const used = new Set<string>();
    for (const other of await this.library.list()) for (const h of other.manifest.chunks) used.add(h);
    for (const h of new Set(entry.manifest.chunks)) if (!used.has(h)) await this.chunks.delete(h);
    this.holdingsChanged();
    this.emit('change');
  }

  // ---- The mesh ----

  /** Files on the mesh whose names hold every word of `query` (all of them for an empty one), here and elsewhere. */
  async search(query: string, ms = this.searchMs): Promise<NetworkFile[]> {
    const r = randomId();
    const found = new Map<string, NetworkFile>();
    const note = (from: string, files: unknown) => {
      for (const f of Array.isArray(files) ? files : []) {
        if (!isSummary(f)) continue;
        this.noteHolder(from, f);
        const n = this.network.get(f.id)!;
        found.set(f.id, n);
      }
    };
    for (const e of await this.library.list()) if (matches(query, e.manifest.name)) note(this.self, [summary(e.id, e.manifest)]);
    // What the holdings records say (at once); live answers follow. A peer's own record outranks
    // what was heard of it before: a file it no longer lists, it no longer holds.
    for (const h of await this.holdings()) {
      if (h.peer === this.self) continue;
      const listed = new Set(h.files.map((f) => f.id));
      for (const n of this.network.values()) if (n.holders.includes(h.peer) && !listed.has(n.id) && n.seen < h.at) n.holders = n.holders.filter((p) => p !== h.peer);
      note(h.peer, h.files.filter((f) => matches(query, f.name)));
    }
    this.waiting.set(r, { done: (from, m) => { if (m.t === 'found') note(from, m.files); return false; } });
    this.mesh.broadcast(this.msg('find', { r, q: query }));
    await sleep(ms);
    this.waiting.delete(r);
    this.emit('change');
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Fetch a file whole from the peers holding it; then it is held here too. */
  async fetch(id: string, o: FetchOptions = {}): Promise<Manifest> {
    const held = await this.library.get(id);
    if (held) {
      // Asked for here, of a file held for the mesh: it is this peer's own now (never given back).
      if (held.forMesh && !o.forMesh) { await this.library.put({ ...held, forMesh: false }); this.holdingsChanged(); this.emit('change'); }
      return held.manifest;
    }
    const holders = new Set([...(o.holders ?? []), ...(this.network.get(id)?.holders ?? [])].filter((p) => p !== this.self));
    for (const h of await this.holdings()) if (h.peer !== this.self && h.files.some((f) => f.id === id)) holders.add(h.peer);
    if (!holders.size) for (const p of await this.whoHolds(id)) holders.add(p);
    if (!holders.size) throw new Error('nobody on the mesh holds it now');
    const manifest = await this.manifestFrom([...holders], id);
    const name = manifest.name;
    const failures = new Map<string, number>();
    const from = new Set<string>();
    // Each distinct chunk once (a chunk that appears twice is fetched once), and the bytes of the file it makes up.
    const bytesOf = new Map<string, number>();
    manifest.chunks.forEach((h, i) => bytesOf.set(h, (bytesOf.get(h) ?? 0) + Math.min(manifest.chunkBytes, manifest.size - i * manifest.chunkBytes)));
    const todo: string[] = [];
    let bytes = 0;
    for (const h of bytesOf.keys()) if (await this.chunks.has(h)) bytes += bytesOf.get(h)!; else todo.push(h);
    const report = () => o.onProgress?.({ id, name, bytes, size: manifest.size, from: [...from] });
    report();
    // Holders in order of fewest failures; one that keeps failing goes to the back.
    const order = () => [...holders].sort((a, b) => (failures.get(a) ?? 0) - (failures.get(b) ?? 0));
    let next = 0, refreshed = false;
    const worker = async (lane: number) => {
      while (next < todo.length) {
        o.signal?.throwIfAborted();
        const hash = todo[next++];
        for (let round = 0; ; round++) {
          const list = order();
          // Spread the lanes over the holders, best first.
          const tryList = [...list.slice(lane % Math.max(1, list.length)), ...list.slice(0, lane % Math.max(1, list.length))];
          let got: Uint8Array | null = null;
          for (const peer of tryList) {
            o.signal?.throwIfAborted();
            const answer = await this.ask(peer, 'chunk?', { h: hash }, this.chunkTimeoutMs);
            if (answer?.t === 'chunk' && typeof answer.d === 'string') {
              const data = fromBase64(answer.d);
              if ((await sha256Hex(data)) === hash) { got = data; from.add(peer); failures.set(peer, 0); break; }
            }
            failures.set(peer, (failures.get(peer) ?? 0) + 1);
          }
          if (got) {
            await this.chunks.put(hash, got);
            bytes += bytesOf.get(hash) ?? got.length;
            report();
            break;
          }
          // Nobody had it: look for holders again, once for the whole fetch.
          if (round === 0 && !refreshed) {
            refreshed = true;
            for (const p of await this.whoHolds(id)) holders.add(p);
            continue;
          }
          throw new Error(`no holder sent a chunk of ${name}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency ?? this.concurrency, Math.max(1, todo.length)) }, (_, lane) => worker(lane)));
    await this.library.put({ id, manifest, added: Date.now(), ...(o.forMesh ? { forMesh: true } : {}) });
    await this.keepManifest(id, manifest);
    this.holdingsChanged();
    this.noteHolder(this.self, summary(id, manifest));
    this.announce([summary(id, manifest)]);
    this.emit('change');
    return manifest;
  }

  /** Tell a peer about a file held here. */
  offer(peer: string, entry: LibraryEntry): boolean {
    return this.mesh.sendDirect(peer, this.msg('offer', { file: summary(entry.id, entry.manifest) }));
  }

  dismissOffer(offer: Offer): void {
    const i = this.offers.indexOf(offer);
    if (i >= 0) this.offers.splice(i, 1);
    this.emit('change');
  }

  /** The peers that say they hold a file (asked now). */
  async whoHolds(id: string, ms = this.searchMs): Promise<string[]> {
    const r = randomId();
    const out = new Set<string>();
    this.waiting.set(r, { done: (from, m) => {
      if (m.t !== 'found') return false;
      for (const f of Array.isArray(m.files) ? m.files : []) if (isSummary(f) && f.id === id) { out.add(from); this.noteHolder(from, f); }
      return false;
    } });
    this.mesh.broadcast(this.msg('find', { r, id }));
    await sleep(ms);
    this.waiting.delete(r);
    return [...out];
  }

  async usage(): Promise<{ chunks: number; bytes: number; files: number }> {
    const u = await this.chunks.usage();
    return { ...u, files: (await this.library.list()).length };
  }

  // ---- Messages ----

  private msg(t: string, body: Record<string, unknown> = {}): Message {
    return { [TAG]: 1, t, ...body };
  }

  private announce(files: FileSummary[]): void {
    if (files.length) this.mesh.broadcast(this.msg('have', { files }));
  }

  /** Ask one peer; its answer (with the same r), or null if none in time. */
  private ask(peer: string, t: string, body: Record<string, unknown>, timeoutMs: number): Promise<Message | null> {
    const r = randomId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(r); resolve(null); }, timeoutMs);
      this.waiting.set(r, { done: (from, m) => {
        if (from !== peer) return false;
        clearTimeout(timer);
        this.waiting.delete(r);
        resolve(m);
        return true;
      } });
      if (!this.mesh.sendDirect(peer, this.msg(t, { r, ...body }))) { clearTimeout(timer); this.waiting.delete(r); resolve(null); }
    });
  }

  private async manifestFrom(holders: string[], id: string): Promise<Manifest> {
    // From the frozen space: here, or any peer holding the record.
    const storage = this.mesh.storage;
    if (storage) {
      const m = await storage.retrieve('frozen', MANIFEST_PREFIX + id, 4000).catch(() => null);
      if (isManifest(m) && (await fileId(m)) === id) return m;
    }
    for (const peer of holders) {
      const answer = await this.ask(peer, 'man?', { id }, 8000);
      if (answer?.t === 'man' && isManifest(answer.m) && (await fileId(answer.m)) === id) return answer.m;
    }
    throw new Error('no holder sent its manifest');
  }

  private noteHolder(peer: string, f: FileSummary): void {
    const known = this.network.get(f.id);
    if (known) {
      if (!known.holders.includes(peer)) known.holders.push(peer);
      known.seen = Date.now();
    } else this.network.set(f.id, { id: f.id, name: f.name, size: f.size, type: f.type, holders: [peer], seen: Date.now() });
  }

  private async receive(from: string, data: unknown): Promise<void> {
    const m = data as Message;
    if (!m || typeof m !== 'object' || m[TAG] !== 1 || typeof m.t !== 'string') return;
    // Answers to something this peer asked.
    if (typeof m.r === 'string' && this.waiting.has(m.r) && ['found', 'man', 'man-', 'chunk', 'chunk-'].includes(m.t)) {
      this.waiting.get(m.r)!.done(from, m);
      return;
    }
    switch (m.t) {
      case 'have':
        for (const f of Array.isArray(m.files) ? m.files : []) if (isSummary(f)) this.noteHolder(from, f);
        this.emit('change');
        return;
      case 'gone':
        for (const id of Array.isArray(m.ids) ? m.ids : []) {
          const known = typeof id === 'string' ? this.network.get(id) : undefined;
          if (known) known.holders = known.holders.filter((p) => p !== from);
        }
        this.emit('change');
        return;
      case 'find': {
        const files: FileSummary[] = [];
        for (const e of await this.library.list()) {
          if (typeof m.id === 'string' ? e.id === m.id : matches(String(m.q ?? ''), e.manifest.name)) files.push(summary(e.id, e.manifest));
          if (files.length >= 200) break;
        }
        if (files.length) this.mesh.sendDirect(from, this.msg('found', { r: m.r, files }));
        return;
      }
      case 'man?': {
        const entry = typeof m.id === 'string' ? await this.library.get(m.id) : null;
        this.mesh.sendDirect(from, entry ? this.msg('man', { r: m.r, m: entry.manifest }) : this.msg('man-', { r: m.r }));
        return;
      }
      case 'chunk?': {
        const bytes = typeof m.h === 'string' ? await this.chunks.get(m.h) : null;
        this.mesh.sendDirect(from, bytes ? this.msg('chunk', { r: m.r, h: m.h, d: toBase64(bytes) }) : this.msg('chunk-', { r: m.r, h: m.h }));
        return;
      }
      case 'offer': {
        if (!isSummary(m.file)) return;
        this.noteHolder(from, m.file);
        const offer: Offer = { from, file: m.file, at: Date.now() };
        this.offers.push(offer);
        this.emit('offer', offer);
        this.emit('change');
        return;
      }
    }
  }
}

function isSummary(x: unknown): x is FileSummary {
  const f = x as FileSummary;
  return !!f && typeof f.id === 'string' && /^[0-9a-f]{64}$/.test(f.id) && typeof f.name === 'string' && Number.isSafeInteger(f.size) && typeof f.type === 'string';
}

/** Every word of the query in the name (any case); an empty query matches everything. */
export function matches(query: string, name: string): boolean {
  const n = name.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
