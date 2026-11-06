/**
 * PigeonFS on a PeerPigeon node. Relays are PeerPigeon's own choice
 * (automaticSignalingServer): the FreeRTC client prefers healthy local
 * relays, and falls back to the nearest public ones; `signal` names one
 * relay to start from instead.
 */
import { PeerPigeonNode } from 'peerpigeon';
import type { Mesh } from './mesh.ts';

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
}

/** PigeonFS messages carry this tag (other users of the same node ignore them). */
export const TAG = 'pfs';

export async function joinMesh(o: JoinOptions = {}): Promise<Mesh> {
  const node = new PeerPigeonNode({
    networkId: o.network ?? 'pigeonfs',
    sessionId: o.room ?? 'main',
    automaticSignalingServer: o.automatic ?? true,
    ...(o.automatic === false ? { signalingServers: [], relayDirectory: false } : {}),
    ...(o.signal ? { signalingServer: o.signal } : {}),
    minPeers: o.minPeers ?? 2,
    maxPeers: o.maxPeers ?? 8,
    crypto: {},
  });
  await node.start();
  const self = node.getClientId();
  if (!self) throw new Error('the mesh node has no id');
  return {
    self,
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
