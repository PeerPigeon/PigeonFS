// A file kept on a storage server outlives every peer that held it. Through a FreeRTC relay on this
// machine (federation off; the relay only signals): A shares a file while a server is up and leaves;
// B joins the room alone, finds the file, and fetches it from the server.
//   node --import tsx tests/e2e-server-files.mjs <port>
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PeerPigeonNode } from 'peerpigeon';
import { installWebRtc } from '../src/node/webrtc.ts';
import { fsRecordStore } from '../src/node/server.ts';
import { joinMesh } from '../src/core/peerpigeon.ts';
import { PigeonFS } from '../src/core/pigeonfs.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';

const signal = `ws://127.0.0.1:${process.argv[2]}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`); if (!cond) ok = false; };
await installWebRtc();
const dir = await mkdtemp(path.join(os.tmpdir(), 'pfs-files-'));
const server = PeerPigeonNode.storageServer({ signalingServer: signal, automaticSignalingServer: false }, await fsRecordStore(dir));
await server.start();

const opts = { signal, automatic: false, room: `files-${Date.now()}` };
const ma = await joinMesh(opts);
const a = new PigeonFS(ma, new MemoryChunks(), new MemoryLibrary());
await a.start();
for (let i = 0; i < 60 && !(ma.servers?.count()); i++) await sleep(250);
check((ma.servers?.count() ?? 0) > 0, 'A found the server');
const { randomBytes } = await import('node:crypto');
const data = new Uint8Array(randomBytes(1536 * 1024)); // 12 distinct chunks
const entry = await a.share(data, 'outlives everyone.bin');
const t0 = Date.now();
for (let i = 0; i < 120 && (await server.stats()).blobs < 12; i++) await sleep(250);
const st = await server.stats();
check(st.blobs === 12, `the server holds its 12 chunks (${st.blobs}, ${(st.blobBytes / 1e6).toFixed(2)} MB) after ${Date.now() - t0} ms`);
for (let i = 0; i < 40 && a.serverStatus; i++) await sleep(250);
await sleep(1000);
await ma.stop();
await sleep(1000);

const mb = await joinMesh(opts);
const b = new PigeonFS(mb, new MemoryChunks(), new MemoryLibrary());
await b.start();
for (let i = 0; i < 60 && !(mb.servers?.count()); i++) await sleep(250);
check(mb.peers().length === 0, 'B is alone in the room');
const results = await b.search('outlives');
const found = results.find((f) => f.id === entry.id);
check(!!found?.onServers, `B finds the file, on the servers (${found?.holders.length ?? 0} holders)`);
const t1 = Date.now();
await b.fetch(entry.id);
const got = await b.read(entry.id);
check(got.length === data.length && got.every((x, i) => x === data[i]), `B fetched it whole from the server (${Date.now() - t1} ms), every byte the same`);
const { execSync } = await import('node:child_process');
check(!execSync(`grep -rl "outlives everyone" ${dir} || true`).toString().trim(), 'nothing on the server names the file');
await mb.stop();
await server.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
