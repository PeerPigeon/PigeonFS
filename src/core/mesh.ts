/**
 * What PigeonFS needs from a mesh: who it is, who it is linked to, and
 * messages to everyone (gossip) or to one peer. A PeerPigeon node gives it
 * (peerpigeon.ts); tests use a mesh in memory (sim.ts).
 */
export interface Mesh {
  readonly self: string;
  /** Peers linked directly now. */
  peers(): string[];
  broadcast(data: unknown): void;
  /** False when the message could not be sent (no route to that peer right now). */
  sendDirect(peer: string, data: unknown): boolean;
  onMessage(listener: (from: string, data: unknown) => void): void;
  onPeersChanged(listener: () => void): void;
  /** The relay in use, for showing (empty if unknown). */
  relay(): string;
  stop(): Promise<void>;
}
