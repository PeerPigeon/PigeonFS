/**
 * A mesh in memory, every peer linked to every other, for tests: messages
 * arrive a little later, as JSON (as on the wire). Its storage keeps
 * PeerPigeon's rules (user: owner only; frozen: written once; private: never
 * sent) and its replication as PigeonFS sets it up: holdings records reach
 * every peer, anything else stays with its writer until someone asks for it.
 */
import type { Mesh, MeshStorage, Space, StoredRecord } from './mesh.ts';
import { HOLDINGS_PREFIX } from './pigeonfs.ts';

type Rec = { value: unknown; owner: string | null; updatedAt: number };

export class SimMesh {
  private readonly nodes = new Map<string, { listeners: ((from: string, data: unknown) => void)[]; peerListeners: (() => void)[]; store: Map<string, Rec>; changes: ((space: Space, key: string) => void)[] }>();
  private count = 0;
  latencyMs = 1;
  /** Drop direct messages to and from these peers (gone without saying). */
  readonly cut = new Set<string>();

  add(): Mesh {
    const self = `peer${++this.count}`.padEnd(16, '0');
    const entry = { listeners: [] as ((from: string, data: unknown) => void)[], peerListeners: [] as (() => void)[], store: new Map<string, Rec>(), changes: [] as ((space: Space, key: string) => void)[] };
    this.nodes.set(self, entry);
    for (const [id, other] of this.nodes) if (id !== self) for (const f of other.peerListeners) f();
    const deliver = (to: string, data: unknown) => {
      if (this.cut.has(to) || this.cut.has(self)) return;
      const target = this.nodes.get(to);
      if (!target) return;
      const copy = JSON.parse(JSON.stringify(data));
      setTimeout(() => { for (const f of target.listeners) f(self, copy); }, this.latencyMs);
    };
    const owner = `owner-${self}`;
    const pk = (space: Space, key: string) => `${space}\u0000${key}`;
    const reachable = () => [...this.nodes.entries()].filter(([id]) => id !== self && !this.cut.has(id) && !this.cut.has(self));
    const storage: MeshStorage = {
      owner,
      get: async (space, key) => entry.store.get(pk(space, key))?.value ?? null,
      retrieve: async (space, key) => {
        const here = entry.store.get(pk(space, key));
        if (here) return here.value;
        if (space === 'private') return null;
        for (const [, other] of reachable()) {
          const r = other.store.get(pk(space, key));
          if (r) { entry.store.set(pk(space, key), JSON.parse(JSON.stringify(r))); return r.value; }
        }
        return null;
      },
      put: async (space, key, value, options = {}) => {
        const existing = entry.store.get(pk(space, key));
        if (space === 'frozen' && existing) throw new Error('Write denied for frozen space key');
        if (space === 'user' && existing && existing.owner !== owner) throw new Error('Write denied for user space key');
        const rec: Rec = { value: JSON.parse(JSON.stringify(value)), owner: space === 'user' ? owner : null, updatedAt: Date.now() };
        entry.store.set(pk(space, key), rec);
        for (const f of entry.changes) f(space, key);
        if (space === 'private' || options.silent || !key.startsWith(HOLDINGS_PREFIX)) return;
        for (const [, other] of reachable()) {
          const theirs = other.store.get(pk(space, key));
          if (space === 'user' && theirs && theirs.owner !== owner) continue;
          setTimeout(() => { other.store.set(pk(space, key), JSON.parse(JSON.stringify(rec))); for (const f of other.changes) f(space, key); }, this.latencyMs);
        }
      },
      list: async (space, prefix) => {
        const out: StoredRecord[] = [];
        for (const [k, r] of entry.store) {
          const [s, key] = k.split('\u0000');
          if (s === space && key.startsWith(prefix)) out.push({ key, value: r.value, owner: r.owner, updatedAt: r.updatedAt });
        }
        return out;
      },
      onChange: (f) => { entry.changes.push(f); },
    };
    return {
      self,
      storage,
      peers: () => [...this.nodes.keys()].filter((id) => id !== self && !this.cut.has(id)),
      broadcast: (data) => { for (const id of this.nodes.keys()) if (id !== self) deliver(id, data); },
      sendDirect: (peer, data) => { if (!this.nodes.has(peer)) return false; deliver(peer, data); return true; },
      onMessage: (f) => { entry.listeners.push(f); },
      onPeersChanged: (f) => { entry.peerListeners.push(f); },
      relay: () => 'sim',
      stop: async () => {
        this.nodes.delete(self);
        for (const other of this.nodes.values()) for (const f of other.peerListeners) f();
      },
    };
  }
}
