// Greedy storage on real PeerPigeon: four Node peers through a FreeRTC relay on this machine (federation
// off; the relay only signals). One shares a file; the others lend space; the file ends up with three
// copies, not four.   node --import tsx tests/e2e-greedy.mjs <port>
import { installWebRtc } from '../src/node/webrtc.ts';
import { joinMesh } from '../src/core/peerpigeon.ts';
import { PigeonFS } from '../src/core/pigeonfs.ts';
import { Greedy } from '../src/core/greedy.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await installWebRtc();
const opts = { signal: `ws://127.0.0.1:${process.argv[2]}/ws`, automatic: false, room: `greedy-${Date.now()}` };
const peers = [];
for (let i = 0; i < 4; i++) {
  const mesh = await joinMesh(opts);
  const fs = new PigeonFS(mesh, new MemoryChunks(), new MemoryLibrary());
  await fs.start();
  const greedy = new Greedy(fs, { quota: i === 0 ? 0 : 1e9, intervalMs: 1000, heartbeatMs: 2000 });
  greedy.start();
  peers.push({ mesh, fs, greedy });
}
const data = new Uint8Array(2 * 1024 * 1024).map((_, i) => (i * 13 + (i >> 10)) & 255);
const entry = await peers[0].fs.share(data, 'needs copies.bin');
const t0 = Date.now();
const count = async () => { let n = 0; for (const p of peers) if (await p.fs.library.get(entry.id)) n++; return n; };
while (Date.now() - t0 < 60000 && (await count()) < 3) await sleep(500);
const reached = await count();
console.log(`copies: ${reached} after ${Date.now() - t0} ms`);
await sleep(5000);
console.log(`copies 5 s later: ${await count()} (expect 3, not 4)`);
let ok = reached === 3 && (await count()) === 3;
for (const p of peers.slice(1)) {
  const e = await p.fs.library.get(entry.id);
  if (e) { const got = await p.fs.read(entry.id); ok &&= got.every((x, i) => x === data[i]) && e.forMesh === true; }
}
console.log('lent copies intact and marked for the mesh:', ok);
for (const p of peers) { p.greedy.stop(); await p.mesh.stop(); }
process.exit(ok ? 0 : 1);
