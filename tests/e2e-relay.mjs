// Two Node peers on current PeerPigeon, through a FreeRTC relay on this machine (federation off: no public relay).
//   node --import tsx tests/e2e-relay.mjs <port>
import { installWebRtc } from '../src/node/webrtc.ts';
import { joinMesh } from '../src/core/peerpigeon.ts';
import { PigeonFS } from '../src/core/pigeonfs.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';
const port = process.argv[2];
const signal = `ws://127.0.0.1:${port}/ws`;
await installWebRtc();
const opts = { signal, automatic: false, room: `e2e-${Date.now()}` };
const [ma, mb] = await Promise.all([joinMesh(opts), joinMesh(opts)]);
const a = new PigeonFS(ma, new MemoryChunks(), new MemoryLibrary());
const b = new PigeonFS(mb, new MemoryChunks(), new MemoryLibrary());
const t0 = Date.now();
while (!ma.peers().includes(mb.self) && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 250));
console.log('linked:', ma.peers().includes(mb.self), `${Date.now() - t0} ms`);
const data = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
const entry = await a.share(data, 'e2e test file.bin');
const found = await b.search('e2e test');
console.log('found:', found.map((f) => f.name));
const t1 = Date.now();
await b.fetch(entry.id);
const got = await b.read(entry.id);
const same = got.length === data.length && got.every((x, i) => x === data[i]);
console.log('fetched 3 MB:', same, `${Date.now() - t1} ms`);
await ma.stop(); await mb.stop();
process.exit(same ? 0 : 1);
