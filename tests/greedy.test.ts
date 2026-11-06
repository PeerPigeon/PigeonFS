import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimMesh } from '../src/core/sim.ts';
import { PigeonFS } from '../src/core/pigeonfs.ts';
import { Greedy } from '../src/core/greedy.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';
import { CHUNK_BYTES } from '../src/core/manifest.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const random = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
};

async function mesh(n: number, quota = 10 * CHUNK_BYTES * 10) {
  const sim = new SimMesh();
  const peers = [];
  for (let i = 0; i < n; i++) {
    const fs = new PigeonFS(sim.add(), new MemoryChunks(), new MemoryLibrary(), { searchMs: 50, chunkTimeoutMs: 500 });
    await fs.start();
    // Fresh for 600 ms; said again every 100 ms while up.
    const greedy = new Greedy(fs, { quota, staleMs: 600, heartbeatMs: 100, intervalMs: 1e9 });
    peers.push({ fs, greedy });
  }
  for (const p of peers) p.greedy.start();
  return { sim, peers };
}

/** Rounds of looking, everyone in turn, until nothing changes. */
async function settle(peers: { greedy: Greedy }[], rounds = 6) {
  for (let r = 0; r < rounds; r++) {
    await sleep(150);
    let changed = false;
    for (const p of peers) { const t = await p.greedy.tick(); if (t.fetched || t.dropped.length) changed = true; }
    if (!changed && r > 1) return;
  }
}

const holdersOf = async (peers: { fs: PigeonFS }[], id: string) => {
  const out: number[] = [];
  for (let i = 0; i < peers.length; i++) if (await peers[i].fs.library.get(id)) out.push(i);
  return out;
};

test('a file with one copy gets three, from the first peers in its order, not from everyone', async () => {
  const { peers } = await mesh(6);
  try {
    const data = random(CHUNK_BYTES * 3, 3);
    const entry = await peers[0].fs.share(data, 'only here.bin');
    await settle(peers);
    const holders = await holdersOf(peers, entry.id);
    assert.equal(holders.length, 3, `held by ${holders}`);
    assert.ok(holders.includes(0));
    for (const i of holders.filter((x) => x !== 0)) {
      assert.deepEqual(await peers[i].fs.read(entry.id), data);
      assert.equal((await peers[i].fs.library.get(entry.id))?.forMesh, true, 'held for the mesh');
    }
  } finally { for (const p of peers) p.greedy.stop(); }
});

test('a holder gone: another peer takes a copy; back to three', async () => {
  const { sim, peers } = await mesh(6);
  try {
    const entry = await peers[0].fs.share(random(CHUNK_BYTES * 2, 5), 'keep me.bin');
    await settle(peers);
    const before = await holdersOf(peers, entry.id);
    assert.equal(before.length, 3);
    // One of the lenders leaves (its record goes stale).
    const gone = before.find((i) => i !== 0)!;
    peers[gone].greedy.stop();
    sim.cut.add(peers[gone].fs.self);
    await sleep(800);
    const rest = peers.filter((_, i) => i !== gone);
    await settle(rest);
    const after = (await holdersOf(peers, entry.id)).filter((i) => i !== gone);
    assert.equal(after.length, 3, `live holders now ${after}`);
  } finally { for (const p of peers) p.greedy.stop(); }
});

test('copies to spare are given back by the last in the order; a peer\'s own files never are', async () => {
  const { peers } = await mesh(5);
  try {
    const entry = await peers[0].fs.share(random(CHUNK_BYTES, 7), 'popular.bin');
    await settle(peers);
    assert.equal((await holdersOf(peers, entry.id)).length, 3);
    // Two more peers fetch it for themselves: five holders, two lenders now spare.
    const lenders = (await holdersOf(peers, entry.id)).filter((i) => i !== 0);
    const others = [1, 2, 3, 4].filter((i) => !lenders.includes(i));
    for (const i of others) await peers[i].fs.fetch(entry.id);
    await settle(peers);
    const now = await holdersOf(peers, entry.id);
    assert.deepEqual(now.sort(), [0, ...others].sort(), 'the lenders gave theirs back; the owners kept theirs');
    for (const i of others) assert.equal((await peers[i].fs.library.get(entry.id))?.forMesh, undefined);
  } finally { for (const p of peers) p.greedy.stop(); }
});

test('a quota lowered (or none) gives the space back; fetching a lent copy makes it this peer\'s own', async () => {
  const { peers } = await mesh(4);
  try {
    const a = await peers[0].fs.share(random(CHUNK_BYTES * 2, 9), 'a.bin');
    const b = await peers[0].fs.share(random(CHUNK_BYTES * 2, 10), 'b.bin');
    await settle(peers);
    const held = async (i: number) => (await peers[i].fs.files()).filter((e) => e.forMesh).length;
    let busiest = 1;
    for (const i of [1, 2, 3]) if ((await held(i)) > (await held(busiest))) busiest = i;
    assert.ok((await held(busiest)) >= 1, 'some peer lends');
    // Asked for here: it is this peer's own from now on.
    const one = (await peers[busiest].fs.files()).find((e) => e.forMesh)!;
    await peers[busiest].fs.fetch(one.id);
    assert.equal((await peers[busiest].fs.library.get(one.id))?.forMesh, false);
    // No space lent: everything still held for the mesh is given back, its own file stays.
    peers[busiest].greedy.setQuota(0);
    await peers[busiest].greedy.tick();
    assert.equal(await held(busiest), 0);
    assert.ok(await peers[busiest].fs.library.get(one.id), 'its own copy stays');
    void a; void b;
  } finally { for (const p of peers) p.greedy.stop(); }
});

test('a device short of space lends less', async () => {
  const sim = new SimMesh();
  const owner = new PigeonFS(sim.add(), new MemoryChunks(), new MemoryLibrary(), { searchMs: 50 });
  const lender = new PigeonFS(sim.add(), new MemoryChunks(), new MemoryLibrary(), { searchMs: 50 });
  await owner.start(); await lender.start();
  const g = new Greedy(lender, { quota: 1e9, staleMs: 10_000, intervalMs: 1e9, freeSpace: async () => CHUNK_BYTES, reserve: CHUNK_BYTES });
  await owner.share(random(CHUNK_BYTES * 2, 12), 'too big here.bin');
  await sleep(100);
  const t = await g.tick();
  assert.equal(t.fetched, null, 'no room on the device');
  assert.equal(g.status().room, 0);
  g.stop();
});
