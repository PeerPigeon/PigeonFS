/**
 * Greedy storage: each peer lends the mesh space, up to a quota, and fills it
 * with the files the mesh holds too few copies of; it gives the space back
 * when the files have copies enough, when its quota goes down, or when its
 * device runs short.
 *
 *  - Copies: every file should have `replicas` live holders (3). A holder is
 *    live while its holdings record is fresh (it says so again every few
 *    minutes; a record older than `staleMs` is a peer gone).
 *  - Who takes a file short of copies: the lending peers with room for it,
 *    in an order fixed for that file (SHA-256 of its id and each peer's
 *    owner): the first as many as are missing. Every peer works out the
 *    same order from the same records, so they do not all fetch it at once.
 *  - Who gives a copy back: of a file with more live holders than it needs,
 *    the peers holding it for the mesh that come last in its order, as many
 *    as are spare. A peer's own files (shared, or fetched for itself) are
 *    never given back, and do not count against what it lends.
 *  - What it costs: one file at a time, a few chunks at once, between the
 *    peer's own work.
 */
import { sha256Hex, utf8 } from './bytes.ts';
import type { Holdings, PigeonFS } from './pigeonfs.ts';
import type { FileSummary } from './manifest.ts';

export interface GreedyOptions {
  /** Live copies each file should have (default 3). */
  replicas?: number;
  /** Bytes lent to the mesh (0: none). */
  quota: number;
  /** How often to look (default 30 s). */
  intervalMs?: number;
  /** A holdings record older than this is a peer gone (default 6 minutes). */
  staleMs?: number;
  /** How often to say what is held here again, so others see this peer as live (default 2 minutes). */
  heartbeatMs?: number;
  /** Bytes the device still has free, if it can tell; greedy storage leaves `reserve` of it. */
  freeSpace?: () => Promise<number | null>;
  /** Bytes of free space to leave the device (default 2 GB, or a tenth of what is free, whichever is less). */
  reserve?: number;
  /** The first look, this long after starting (default 3 s): the others' records come in meanwhile. */
  firstLookMs?: number;
}

export interface GreedyStatus {
  quota: number;
  /** What it may use now (less than the quota when the device is short of space). */
  room: number;
  used: number;
  files: number;
  /** What it is doing, in words. */
  doing: string;
}

type Peer = Holdings & { owner: string };

export class Greedy {
  private quota: number;
  private readonly replicas: number;
  private readonly staleMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private doing = 'Nothing to hold yet.';
  private room = 0;
  private used = 0;
  private count = 0;

  constructor(readonly fs: PigeonFS, private readonly o: GreedyOptions) {
    this.quota = Math.max(0, o.quota);
    this.replicas = Math.max(1, o.replicas ?? 3);
    this.staleMs = o.staleMs ?? 6 * 60_000;
    fs.lending = () => (this.quota > 0 ? { quota: this.quota, used: this.used } : null);
  }

  start(): void {
    const every = (ms: number, f: () => void) => { const t = setInterval(f, ms); (t as { unref?: () => void }).unref?.(); return t; };
    this.timer = every(this.o.intervalMs ?? 30_000, () => void this.tick());
    this.heartbeat = every(this.o.heartbeatMs ?? 2 * 60_000, () => this.fs.holdingsNow());
    // Say at once that this peer lends space; decide only once the others have had time to say so too
    // (a peer that decides first sees no other lenders, and takes what another was to take).
    this.fs.holdingsNow();
    const first = setTimeout(() => void this.tick(), this.o.firstLookMs ?? 3000);
    (first as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = this.heartbeat = null;
  }

  setQuota(bytes: number): void {
    this.quota = Math.max(0, bytes);
    this.fs.holdingsNow();
    void this.tick();
  }

  status(): GreedyStatus {
    return { quota: this.quota, room: this.room, used: this.used, files: this.count, doing: this.doing };
  }

  /** One look: give back what is not needed (or does not fit), then take one file short of copies. Looks asked for meanwhile wait their turn. */
  tick(): Promise<{ fetched: string | null; dropped: string[] }> {
    const next = this.queue.then(() => this.look());
    this.queue = next.catch(() => {});
    return next;
  }

  private queue: Promise<unknown> = Promise.resolve();

  private async look(): Promise<{ fetched: string | null; dropped: string[] }> {
    const dropped: string[] = [];
    let fetched: string | null = null;
    try {
      const me = this.fs.mesh.storage?.owner ?? this.fs.self;
      const mine = await this.fs.files();
      const forMesh = mine.filter((e) => e.forMesh);
      this.used = forMesh.reduce((n, e) => n + e.manifest.size, 0);
      this.count = forMesh.length;
      this.room = await this.roomNow();
      const peers = await this.livePeers();
      const holdersOf = (id: string) => peers.filter((p) => p.files.some((f) => f.id === id));
      // Copies held, and copies on their way (a peer that said it is taking one).
      const copiesOf = (id: string) => peers.filter((p) => p.files.some((f) => f.id === id) || p.taking?.includes(id)).length;

      // 1. Give back: copies held for the mesh that are spare, and then (largest first) whatever does not fit.
      for (const e of forMesh) {
        const holders = holdersOf(e.id);
        const spare = holders.length - this.replicas;
        if (spare <= 0) continue;
        // Of those holding it for the mesh, the last in this file's order give it back.
        const lenders = holders.filter((p) => p.files.some((f) => f.id === e.id && (f as { mesh?: boolean }).mesh));
        const order = await this.order(e.id, lenders.map((p) => p.owner));
        if (order.slice(-spare).includes(me)) { await this.fs.remove(e.id); dropped.push(e.manifest.name); this.used -= e.manifest.size; }
      }
      for (const e of forMesh.filter((x) => !dropped.includes(x.manifest.name)).sort((a, b) => b.manifest.size - a.manifest.size)) {
        if (this.used <= this.room) break;
        await this.fs.remove(e.id);
        dropped.push(e.manifest.name);
        this.used -= e.manifest.size;
      }
      if (dropped.length) this.fs.holdingsNow();

      // 2. Take: the file shortest of copies (then the smallest) that this peer is among the first to take.
      if (this.quota <= 0) { this.doing = 'Lends no space.'; return { fetched, dropped }; }
      // Only with every linked peer's record in hand: without them, this peer may think it comes first when it does not.
      const heard = new Set(peers.map((p) => p.peer));
      const unheard = this.fs.mesh.peers().filter((id) => !heard.has(id));
      if (unheard.length) { this.doing = `Waiting to hear what ${unheard.length} linked ${unheard.length === 1 ? 'peer holds' : 'peers hold'}.`; return { fetched, dropped }; }
      const held = new Set((await this.fs.files()).map((e) => e.id));
      const files = new Map<string, FileSummary & { live: number }>();
      for (const p of peers) for (const f of p.files) {
        const known = files.get(f.id);
        if (known) known.live = copiesOf(f.id);
        else files.set(f.id, { id: f.id, name: f.name, size: f.size, type: f.type, live: copiesOf(f.id) });
      }
      const short = [...files.values()].filter((f) => f.live > 0 && f.live < this.replicas && !held.has(f.id))
        .sort((a, b) => a.live - b.live || a.size - b.size);
      for (const f of short) {
        if (this.used + f.size > this.room) continue;
        // Who could take it: the lending peers with room for it, not holding it yet (this one among them).
        const could = peers.filter((p) => p.lends && p.lends.quota - p.lends.used >= f.size && !p.files.some((x) => x.id === f.id) && !p.taking?.includes(f.id)).map((p) => p.owner);
        if (!could.includes(me)) could.push(me);
        const takers = (await this.order(f.id, could)).slice(0, this.replicas - f.live);
        if (!takers.includes(me)) continue;
        this.doing = `Holding ${f.name} for the mesh (it had ${f.live} ${f.live === 1 ? 'copy' : 'copies'})…`;
        // Said at once, so the others count this copy before it is here.
        this.fs.taking.add(f.id);
        await this.fs.publishHoldings().catch(() => {});
        try {
          await this.fs.fetch(f.id, { forMesh: true, concurrency: 2, holders: holdersOf(f.id).map((p) => p.peer) });
          fetched = f.name;
          this.used += f.size;
          this.count++;
        } catch (e) {
          this.doing = `Could not hold ${f.name}: ${(e as Error).message}.`;
          return { fetched, dropped };
        } finally {
          this.fs.taking.delete(f.id);
          this.fs.holdingsNow();
        }
        break;
      }
      this.doing = fetched ? `Took a copy of ${fetched} for the mesh.`
        : short.length ? `${short.length} ${short.length === 1 ? 'file is' : 'files are'} short of copies; other peers are first in line, or there is no room here.`
          : 'Every file on the mesh has copies enough.';
      return { fetched, dropped };
    } catch (e) {
      this.doing = `Stopped: ${(e as Error).message}.`;
      return { fetched, dropped };
    }
  }

  /** Peers whose holdings record is fresh (this one's too). */
  private async livePeers(): Promise<Peer[]> {
    const since = Date.now() - this.staleMs;
    return (await this.fs.holdings()).filter((h) => h.at >= since);
  }

  /** What may be used now: the quota, less while the device is short of free space. */
  private async roomNow(): Promise<number> {
    const free = await this.o.freeSpace?.().catch(() => null);
    if (free === null || free === undefined) return this.quota;
    const reserve = this.o.reserve ?? Math.min(2e9, free / 10);
    // The space already used here stays usable; what is free beyond the reserve can be added.
    return Math.min(this.quota, this.used + Math.max(0, free - reserve));
  }

  /** The owners in this file's order (SHA-256 of the file id and each owner): the same on every peer. */
  private async order(id: string, owners: string[]): Promise<string[]> {
    const keyed = await Promise.all([...new Set(owners)].map(async (o) => ({ o, k: await sha256Hex(utf8(`${id}:${o}`)) })));
    return keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.o);
  }
}
