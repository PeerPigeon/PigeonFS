// Storage servers on real PeerPigeon, through a FreeRTC relay on this machine (federation off;
// the relay only signals). A peer writes while a server is up and leaves; a peer that joins later,
// with nobody else in the room, reads it from the server. Then records kept by a peer before any
// server existed move to a server that comes up.   node --import tsx tests/e2e-server.mjs <port>
import { PeerPigeonNode } from 'peerpigeon';
import { installWebRtc } from '../src/node/webrtc.ts';
import { fsRecordStore } from '../src/node/server.ts';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await installWebRtc();
const signaling = { signalingServer: `ws://127.0.0.1:${process.argv[2]}/ws`, automaticSignalingServer: false };
const room = `servers-${Date.now()}`;
const peer = async (name) => {
  const node = new PeerPigeonNode({ ...signaling, networkId: 'e2e', sessionId: room, storage: { dbName: name } });
  await node.start();
  return node;
};
const waitFor = async (what, check, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return Date.now() - t0; await sleep(250); }
  throw new Error(`timed out: ${what}`);
};
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`); if (!cond) ok = false; };

// 1. A server first.
const dir = await mkdtemp(path.join(os.tmpdir(), 'pfs-server-'));
const server = PeerPigeonNode.storageServer(signaling, await fsRecordStore(dir));
await server.start();

const a = await peer('a');
console.log(`a found the room's server in ${await waitFor('a links to the server', () => a.storage.serverCount() > 0)} ms`);
await a.storage.put('public', 'greeting', { text: 'kept by the server' });
await waitFor('server holds it', async () => (await server.stats()).records >= 1);
await a.destroy();
await sleep(500);

const b = await peer('b');
const bl = b.serverLink;
await waitFor('b links to the server', () => b.storage.serverCount() > 0).catch(async (e) => {
  const n = bl.node;
  const { DatabaseSync } = await import('node:sqlite');
  console.log('db', JSON.stringify(new DatabaseSync(process.env.RELAY_DB).prepare('select network, substr(peer_id,1,8) p, role from psp_announcements').all()));
  console.log('b link known', await bl.knownServers(), 'discovered', n.getDiscoveredPeers().map((p) => [p.slice(0, 8), n.getPeerRole(p)]), 'connected', n.getConnectedPeers().map((p) => p.slice(0, 8)));
  console.log('server', server.node.getClientId()?.slice(0, 8), 'connected', server.node.getConnectedPeers().map((p) => p.slice(0, 8)), 'discovered', server.node.getDiscoveredPeers().map((p) => [p.slice(0,8), server.node.getPeerRole(p)]));
  throw e;
});
const t0 = Date.now();
const got = await b.storage.get('public', 'greeting');
check(got?.value?.text === 'kept by the server', `a peer alone in the room read what a peer that left wrote (${Date.now() - t0} ms)`);
await b.destroy();

// 2. Records first, a server later.
await server.close();
const room2 = `${room}-late`;
const c = new PeerPigeonNode({ ...signaling, networkId: 'e2e', sessionId: room2, storage: { dbName: 'c' } });
await c.start();
await c.storage.put('public', 'early', 'before any server');
await c.storage.put('frozen', 'manifest/1', { parts: 3 });
await sleep(1000);
check(c.storage.serverCount() === 0, 'no server yet: storage as before');
const dir2 = await mkdtemp(path.join(os.tmpdir(), 'pfs-server-'));
const later = PeerPigeonNode.storageServer(signaling, await fsRecordStore(dir2));
await later.start();
console.log(`the late server took both records in ${await waitFor('moved', async () => (await later.stats()).records >= 2)} ms`);
await c.destroy();
await sleep(500);
const d = new PeerPigeonNode({ ...signaling, networkId: 'e2e', sessionId: room2, storage: { dbName: 'd' } });
await d.start();
await waitFor('d links', () => d.storage.serverCount() > 0);
check((await d.storage.get('frozen', 'manifest/1'))?.value?.parts === 3, 'moved records are read back from the server');
// And what is on disk: no plaintext.
const { execSync } = await import('node:child_process');
check(!execSync(`grep -rl "before any server" ${dir2} || true`).toString().trim(), 'the server keeps no plaintext');
await d.destroy();
await later.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
