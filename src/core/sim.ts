/** A mesh in memory, every peer linked to every other, for tests: messages arrive a little later, as JSON (as on the wire). */
import type { Mesh } from './mesh.ts';

export class SimMesh {
  private readonly nodes = new Map<string, { listeners: ((from: string, data: unknown) => void)[]; peerListeners: (() => void)[] }>();
  private count = 0;
  latencyMs = 1;
  /** Drop direct messages to and from these peers (gone without saying). */
  readonly cut = new Set<string>();

  add(): Mesh {
    const self = `peer${++this.count}`.padEnd(16, '0');
    const entry = { listeners: [] as ((from: string, data: unknown) => void)[], peerListeners: [] as (() => void)[] };
    this.nodes.set(self, entry);
    for (const [id, other] of this.nodes) if (id !== self) for (const f of other.peerListeners) f();
    const deliver = (to: string, data: unknown) => {
      if (this.cut.has(to) || this.cut.has(self)) return;
      const target = this.nodes.get(to);
      if (!target) return;
      const copy = JSON.parse(JSON.stringify(data));
      setTimeout(() => { for (const f of target.listeners) f(self, copy); }, this.latencyMs);
    };
    return {
      self,
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
