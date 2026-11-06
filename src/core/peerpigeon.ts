/**
 * PigeonFS on a PeerPigeon node. Relays are PeerPigeon's own choice
 * (automaticSignalingServer): the FreeRTC client prefers healthy local
 * relays, and falls back to the nearest public ones; `signal` names one
 * relay to start from instead. Relays carry signaling only: peer data goes
 * over WebRTC between peers.
 *
 * Its storage is PeerPigeon's (encrypted sync, in IndexedDB in a browser,
 * in memory in Node). This node replicates PigeonFS's holdings records (each
 * peer's, in the user space: small) and keeps other PigeonFS records only
 * when it asked for them (manifests, in the frozen space: a big file's runs
 * to hundreds of kilobytes).
 */
import { PeerPigeonNode, type PeerPigeonKeyPair } from 'peerpigeon';
import type { Mesh, MeshStorage, Space } from './mesh.ts';
import { HOLDINGS_PREFIX } from './pigeonfs.ts';

export interface JoinOptions {
  /** Peers must share the network and the room to find each other. */
  network?: string;
  room?: string;
  /** A relay to start from (ws:// or wss://); PeerPigeon chooses otherwise. */
  signal?: string;
  minPeers?: number;
  maxPeers?: number;
  /** PeerPigeon chooses relays (FreeRTC: local first, then the nearest public ones); false: only `signal`. */
  automatic?: boolean;
  /** This peer's key pair (its storage identity); a browser keeps its own, a Node peer passes the one it saved. */
  keyPair?: PeerPigeonKeyPair;
  /** IndexedDB name for the storage (browser). */
  dbName?: string;
}

export interface PeerPigeonMesh extends Mesh {
  keyPair(): PeerPigeonKeyPair | null;
}

export async function joinMesh(o: JoinOptions = {}): Promise<PeerPigeonMesh> {
  const node: PeerPigeonNode = new PeerPigeonNode({
    networkId: o.network ?? 'pigeonfs',
    sessionId: o.room ?? 'main',
    automaticSignalingServer: o.automatic ?? true,
    ...(o.automatic === false ? { signalingServers: [], relayDirectory: false } : {}),
    ...(o.signal ? { signalingServer: o.signal } : {}),
    minPeers: o.minPeers ?? 2,
    maxPeers: o.maxPeers ?? 8,
    crypto: o.keyPair ? { keyPair: o.keyPair } : {},
    storage: {
      dbName: o.dbName ?? 'pigeonfs-storage',
      // Holdings records: kept in full, and a newly linked peer is sent all of them. Anything else only when asked for.
      replicate: [HOLDINGS_PREFIX],
    },
  });
  await node.start();
  const self = node.getClientId();
  if (!self) throw new Error('the mesh node has no id');
  const s = node.storage!;
  const storage: MeshStorage = {
    // Who owns this node's user records: its signing key (records are signed).
    owner: s.ownerIdentity(),
    get: async (space, key) => (await s.get(space, key))?.value ?? null,
    retrieve: async (space, key, timeoutMs = 3000) => (await s.retrieve(space, key, { timeoutMs }))?.value ?? null,
    put: async (space, key, value, options = {}) => { await s.put(space, key, value, options); },
    list: async (space, prefix) => (await s.list(space)).filter((r) => r.key.startsWith(prefix))
      .map((r) => ({ key: r.key, value: r.value, owner: r.ownerId, updatedAt: r.updatedAt })),
    onChange: (listener) => s.on('change', (e) => listener(e.space as Space, e.key)),
  };
  return {
    self,
    storage,
    keyPair: () => node.crypto?.getKeyPair() ?? null,
    peers: () => node.getConnectedPeers(),
    broadcast: (data) => { node.broadcast(data); },
    sendDirect: (peer, data) => node.sendDirect(peer, data) !== null,
    onMessage: (listener) => node.on('message', (m) => {
      if (m.local || !m.fromPeerId) return;
      listener(m.fromPeerId, m.data);
    }),
    onPeersChanged: (listener) => {
      node.on('peerConnected', () => listener());
      node.on('peerDisconnected', () => listener());
    },
    relay: () => {
      const client = (node.mesh as unknown as { signalingClient?: { currentSignalUrl?: string } }).signalingClient;
      return String(client?.currentSignalUrl ?? '');
    },
    stop: () => node.destroy(),
  };
}
