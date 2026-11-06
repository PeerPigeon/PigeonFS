/**
 * What PigeonFS needs from a mesh: who it is, who it is linked to, messages
 * to everyone (gossip) or to one peer, and the mesh's storage spaces. A
 * PeerPigeon node gives it (peerpigeon.ts); tests use a mesh in memory
 * (sim.ts).
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
  /** The mesh's storage (PeerPigeon's spaces), if it has one. */
  readonly storage: MeshStorage | null;
  /** Storage servers (content kept by its hash, sealed), if this mesh uses them. */
  readonly servers?: MeshServers | null;
  stop(): Promise<void>;
}

/**
 * PeerPigeon's storage spaces, as PigeonFS uses them:
 *  - public: anyone writes;
 *  - user: the first writer owns a key, and only it can change it;
 *  - frozen: written once, never changed (content-addressed records);
 *  - private: this peer's alone, never sent.
 */
export type Space = 'public' | 'user' | 'frozen' | 'private';

export interface StoredRecord {
  key: string;
  value: unknown;
  /** Its owner (user space), or null. */
  owner: string | null;
  updatedAt: number;
}

export interface MeshStorage {
  /** This peer's storage identity: what owns its user-space records. */
  readonly owner: string;
  /** A record as held here (null if not). */
  get(space: Space, key: string): Promise<unknown | null>;
  /** A record from here, or else from any peer holding it (null if none answers in time). */
  retrieve(space: Space, key: string, timeoutMs?: number): Promise<unknown | null>;
  /** silent: stored and served on request, but not announced to the room. */
  put(space: Space, key: string, value: unknown, options?: { silent?: boolean }): Promise<void>;
  /** The records held here in a space whose keys start with `prefix`. */
  list(space: Space, prefix: string): Promise<StoredRecord[]>;
  onChange(listener: (space: Space, key: string) => void): void;
}

/** Storage servers: content kept by its SHA-256, there when every peer is gone. */
export interface MeshServers {
  /** Whether any server is known now. */
  available(): Promise<boolean>;
  /** How many linked servers keep this room's records now. */
  count(): number;
  /** Keeps content (at most 160 KB) on the servers; how many took it. */
  put(bytes: Uint8Array): Promise<number>;
  /** Content by its SHA-256, checked; null if no server has it. */
  get(hash: string): Promise<Uint8Array | null>;
}
