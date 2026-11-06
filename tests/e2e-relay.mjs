// Two Node peers on current PeerPigeon, through a FreeRTC relay on this machine (federation off: no
// public relay; the relay only signals, data goes over WebRTC between the peers).
//   node --import tsx tests/e2e-relay.mjs <port>
import { installWebRtc } from '../src/node/webrtc.ts';
import { joinMesh } from '../src/core/peerpigeon.ts';
import { PigeonFS } from '../src/core/pigeonfs.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';
const port = process.argv[2];
const signal = `ws://127.0.0.1:${port}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await installWebRtc();
const opts = { signal, automatic: false, room: `e2e-${Date.now()}` };
const [ma, mb] = await Promise.all([joinMesh(opts), joinMesh(opts)]);
const a = new PigeonFS(ma, new MemoryChunks(), new MemoryLibrary());
const b = new PigeonFS(mb, new MemoryChunks(), new MemoryLibrary());
await a.start(); await b.start();
const t0 = Date.now();
while (!ma.peers().includes(mb.self) && Date.now() - t0 < 40000) await sleep(250);
console.log('linked:', ma.peers().includes(mb.self), `${Date.now() - t0} ms`);
const data = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31 + (i >> 9)) & 255);
const entry = await a.share(data, 'e2e test file.bin');
// A's holdings record (user space) reaches B.
let seen = null;
for (let i = 0; i < 40 && !seen; i++) { seen = (await b.holdings()).find((h) => h.peer === ma.self && h.files.some((f) => f.id === entry.id)); if (!seen) await sleep(250); }
console.log('holdings record from A at B:', !!seen, seen ? `${seen.files.length} file, owner ${seen.owner.slice(0, 10)}…` : '');
// B fetches with no search: holders from holdings, the manifest from the frozen space.
const t1 = Date.now();
await b.fetch(entry.id);
const got = await b.read(entry.id);
const same = got.length === data.length && got.every((x, i) => x === data[i]);
console.log('fetched 3 MB:', same, `${Date.now() - t1} ms`);
console.log('manifest in B\'s frozen space:', !!(await mb.storage.get('frozen', `pfs/m/${entry.id}`)));
await ma.stop(); await mb.stop();
process.exit(same && seen ? 0 : 1);
