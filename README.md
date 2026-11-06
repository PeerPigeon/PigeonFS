# PigeonFS

Files across a [PeerPigeon](https://github.com/PeerPigeon/PeerPigeon) mesh: share them, find them, and fetch them from whoever holds them.

- **By what they hold.** A file is cut into 128 KB chunks; its manifest lists each chunk's SHA-256, and the file's id is the SHA-256 of its manifest. Every chunk and manifest that comes from another peer is checked against its hash, so any copy is as good as any other, and a peer that sends bad bytes is simply passed over.
- **From everyone at once.** A fetch asks all the peers holding the file for its chunks, several at a time; once whole, the fetching peer holds it too and says so, and the next fetch has one more source.
- **On PeerPigeon.** Relays are PeerPigeon's own choice: the FreeRTC client tries healthy local relays first and falls back to the nearest public ones. Messages are PeerPigeon gossip (to everyone) and direct messages (to one peer).

> **2.0 is a rebuild.** The 1.x app (one large Vue component on PeerPigeon 1.0.6) is kept in [`legacy/`](legacy) for reference. The page looks like PigeonAI's: finding on the left; sharing, what this browser holds, and the mesh on the right.

## Use it

```bash
npm install
npm run dev          # the page (https://localhost:5173; a self-signed certificate: accept it once per device) and a storage server, in one command
npm run page         # the page alone
npm run peer         # a peer that stays up, in Node
```

Peers must share a network and a room to find each other: `?network=…&room=…` in the page (default `pigeonfs` / `main`), `--network` and `--room` for a Node peer. `?signal=ws://…` (or `--signal`) starts from a given relay.

### A Node peer

```bash
npm run peer -- --dir pigeonfs-data --share ~/Shared
```

It holds what it fetched or was given in `--dir` (chunks under `chunks/`, its files under `files/`), serves them to the mesh, and shares every file in the `--share` folder (default `<dir>/share`), including ones added while it runs. WebRTC in Node comes from werift.

### A storage server

```bash
npm run server -- --dir pigeonfs-server
```

It serves the page too (https, port 5173; `--no-page` to leave it out), so one command runs both. A server keeps PeerPigeon storage for any app and any room, the way a relay carries its signaling. Every PeerPigeon peer looks for servers and uses them when there are any; with none, storage works across the mesh as before.

- **Found like relays.** A server announces the role `storage` in one scope (`peerpigeon-storage` / `servers`), and relays list it first. A peer dials only the servers it needs, over WebRTC, and the relays only signal.
- **Kademlia placement.** A room's records live on the 3 servers whose ids are closest (XOR of SHA-256) to the room's id. When a server joins or leaves, they are handed to whichever servers are now closest.
- **Moved, not copied.** When a room's servers come up, a peer sends them what it keeps and drops what it does not use (keys it subscribes to or replicates stay). It reads the rest back from them when asked. Writes go to the servers as they happen, and changes come back from them.
- **Signed.** Every change is signed with the writer's key pair, and peers take only signed changes. A user record's owner is its signer's key, and a server takes a user record only from its owner.
- **Blind.** The room's id, each record's slot and its space are hashes of the room's secret, and each record is the room's own ciphertext. A write token from the same secret keeps anyone outside the room off a slot, and a frozen slot is never overwritten.

It keeps records in `--dir`, one folder per room (`rooms/`), and file chunks under `blobs/`.

**Files outlive their peers.** A peer puts every file it holds on the servers too, chunk by chunk, each sealed with a key made from its own hash, so a server can't read it and the same chunk is kept once whoever adds it. Each chunk sits on the 3 servers closest to its address. The file is then listed in the room (public `pfs/files/<id>`). A search finds it there when no peer holding it is up, and a fetch takes its chunks from peers first, then the servers.

**Where data goes.** A server or a Node peer keeps everything in one folder: `--dir`, or the `PIGEONFS_DIR` environment variable, or `pigeonfs-server` / `pigeonfs-data` in the current folder. `~` means your home folder. On a Mac, an external drive is `/Volumes/<drive name>/…`; if that drive is not mounted, it refuses to start rather than filling the startup disk.

## How it works

### Greedy storage

Each peer lends the mesh space, up to a quota (in the page: **Lend space**, 1 GB by default, kept in the `private` space; a Node peer: `--quota`, 10 GB by default), and fills it with copies of files the mesh holds too few of.

- **Three live copies of every file.** A holder is live while its holdings record is fresh: it says so again every 2 minutes, and a record older than 6 minutes is a peer gone.
- **Who takes a file short of copies:** the lending peers with room for it, in an order fixed for that file (SHA-256 of its id and each peer's owner), the first as many as are missing. Every peer works this out from the same records, so they do not all fetch it at once; a peer says it is taking a copy before it starts (`taking` in its record), and decides only once it has heard from every peer it is linked to.
- **Who gives one back:** of a file with more live copies than it needs, the peers holding it for the mesh that come last in its order. A peer also gives back (largest first) whatever no longer fits: its quota lowered, or its device short of free space (a browser: what the browser still allows the site; a Node peer: the disk, leaving 2 GB or a tenth of what is free).
- **Your own files** (shared, or fetched for yourself) never count against the quota and are never given back; fetching a file held for the mesh makes it yours.
- **Cost:** one file at a time, two chunks at once.

### PeerPigeon's storage spaces

| Space | Key | What |
|---|---|---|
| `frozen` | `pfs/m/<file id>` | Each file's manifest: written once (its key is its hash), fetched from any peer holding it, checked against the id. Kept only by peers that use it. |
| `user` | `pfs/holds/<owner>` | What each peer holds (its files, its bytes, its mesh id now): only that peer can change it, and every PigeonFS peer replicates it, so holders are known without asking. |

The holdings namespace is declared to PeerPigeon as replicated (`replicate: ['pfs/holds/']`): each peer keeps every change under it, and a peer that links up is sent every record under it at once. A Node peer keeps its key pair (its storage identity) in its `--dir`; a browser keeps its own.

### Messages

| Message | To | What for |
|---|---|---|
| `have` | everyone | "I hold these files" (on sharing, and on finishing a fetch) |
| `find` → `found` | everyone → the asker | Files whose names hold every word of a query, or one file by id |
| `man?` → `man` | one holder | A file's manifest, when the frozen space has no answer |
| `gone` | everyone | "I no longer hold these" |
| `chunk?` → `chunk` | one holder | A chunk by its SHA-256 (checked on arrival) |
| `offer` | one peer | "Here's a file for you": it fetches it like any other |

Every message carries `pfs: 1`, so PigeonFS can share a node with other uses.

Where things are kept: IndexedDB in a browser (`src/core/store-idb.ts`), a folder in Node (`src/node/store-fs.ts`), memory in tests. Removing a file frees its chunks unless another file held here uses them.

## Code

```
src/core/pigeonfs.ts    share, search, fetch, offer, and answering for what this peer holds
src/core/manifest.ts    chunks, manifests and file ids
src/core/peerpigeon.ts  the mesh: a PeerPigeon node
src/core/sim.ts         a mesh in memory, for tests
src/core/store*.ts      where chunks and files are kept
src/node/               the Node peer (werift WebRTC, a folder store) and the storage server
src/app/                the page
legacy/                 PigeonFS 1.x
```

## Tests

```bash
npm test                                   # the protocol on a simulated mesh, and the folder store
node --import tsx tests/e2e-relay.mjs 8788 # two Node peers on PeerPigeon, through a FreeRTC relay on this machine
node --import tsx tests/e2e-server.mjs 8788 # a storage server: read after the writer left, and records moved to a late server
node --import tsx tests/e2e-server-files.mjs 8788 # a file fetched whole from a server after every peer holding it left
```

For the second, run a FreeRTC relay locally first, with federation off (`FREERTC_FEDERATION=off`), so no public relay is used.
