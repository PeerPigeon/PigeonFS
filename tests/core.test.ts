import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SimMesh } from '../src/core/sim.ts';
import { PigeonFS, TAG, matches } from '../src/core/pigeonfs.ts';
import { MemoryChunks, MemoryLibrary } from '../src/core/store.ts';
import { CHUNK_BYTES, fileId } from '../src/core/manifest.ts';
import { sha256Hex, toBase64 } from '../src/core/bytes.ts';
import { fsStores } from '../src/node/store-fs.ts';
import type { Mesh } from '../src/core/mesh.ts';

const peer = (sim: SimMesh, o = {}) => new PigeonFS(sim.add(), new MemoryChunks(), new MemoryLibrary(), { searchMs: 100, chunkTimeoutMs: 500, ...o });
const random = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
};

test('share, search, fetch: the same bytes, from the holder; then the fetcher holds it too', async () => {
  const sim = new SimMesh();
  const [a, b, c] = [peer(sim), peer(sim), peer(sim)];
  const data = random(CHUNK_BYTES * 3 + 1234);
  const entry = await a.share(data, 'Holiday video.mp4', 'video/mp4');
  assert.equal(entry.manifest.chunks.length, 4);
  const found = await c.search('holiday');
  assert.deepEqual(found.map((f) => [f.name, f.holders]), [['Holiday video.mp4', [a.self]]]);
  assert.deepEqual(await c.search('nothing like it'), []);
  let last = 0;
  await c.fetch(found[0].id, { onProgress: (p) => { last = p.bytes; } });
  assert.equal(last, data.length);
  assert.deepEqual(await c.read(entry.id), data);
  // C holds it now: B finds two holders.
  const again = await b.search('video');
  assert.deepEqual(again[0].holders.sort(), [a.self, c.self].sort());
});

test('a holder that sends bad bytes is passed over; chunks come from every good holder', async () => {
  const sim = new SimMesh();
  const [a, b, bad, d] = [peer(sim), peer(sim), peer(sim), peer(sim)];
  const data = random(CHUNK_BYTES * 8, 7);
  const entry = await a.share(data, 'big.bin');
  await b.fetch(entry.id, { holders: [a.self] });
  // `bad` claims the file, and answers every chunk with garbage.
  const meshOf = (bad as unknown as { mesh: Mesh }).mesh;
  meshOf.onMessage((from, m) => {
    const msg = m as Record<string, unknown>;
    if (msg[TAG] === 1 && msg.t === 'man?') meshOf.sendDirect(from, { [TAG]: 1, t: 'man', r: msg.r, m: entry.manifest });
    if (msg[TAG] === 1 && msg.t === 'chunk?') meshOf.sendDirect(from, { [TAG]: 1, t: 'chunk', r: msg.r, h: msg.h, d: toBase64(random(100, 3)) });
  });
  let from: string[] = [];
  await d.fetch(entry.id, { holders: [bad.self, a.self, b.self], onProgress: (p) => { from = p.from; } });
  assert.deepEqual(await d.read(entry.id), data);
  assert.ok(!from.includes(bad.self), 'nothing came from the bad holder');
  assert.deepEqual(from.sort(), [a.self, b.self].sort(), 'chunks from both good holders');
});

test('a holder gone mid-way: the rest come from another; nobody holding it: a clear error', async () => {
  const sim = new SimMesh();
  const [a, b, c] = [peer(sim), peer(sim), peer(sim)];
  const data = random(CHUNK_BYTES * 5, 9);
  const entry = await a.share(data, 'x.bin');
  await b.fetch(entry.id);
  sim.cut.add(a.self);
  await c.fetch(entry.id, { holders: [a.self, b.self] });
  assert.deepEqual(await c.read(entry.id), data);
  const lonely = peer(sim);
  sim.cut.add(b.self); sim.cut.add(c.self);
  await assert.rejects(lonely.fetch(entry.id), /nobody on the mesh holds it/);
});

test('a manifest is checked against its id; offers reach the peer; removing frees chunks no other file uses', async () => {
  const sim = new SimMesh();
  const [a, b] = [peer(sim), peer(sim)];
  const one = await a.share(random(CHUNK_BYTES * 2, 4), 'one.bin');
  const shared = one.manifest.chunks[0];
  // A second file sharing its first chunk.
  const two = await a.share(new Uint8Array([...random(CHUNK_BYTES, 4), 1, 2, 3]), 'two.bin');
  assert.equal(two.manifest.chunks[0], shared);
  assert.equal(await fileId(one.manifest), one.id);
  const got = new Promise<string>((resolve) => b.on('offer', (o) => resolve(o.file.name)));
  assert.ok(a.offer(b.self, one));
  assert.equal(await got, 'one.bin');
  await a.remove(one.id);
  assert.ok(await a.chunks.has(shared), 'still used by two.bin');
  assert.ok(!(await a.chunks.has(one.manifest.chunks[1])), 'freed');
  assert.equal((await a.usage()).files, 1);
});

test('an empty file, and a word search', async () => {
  const sim = new SimMesh();
  const [a, b] = [peer(sim), peer(sim)];
  const empty = await a.share(new Uint8Array(0), 'empty.txt', 'text/plain');
  assert.equal(empty.manifest.chunks.length, 0);
  await b.fetch(empty.id, { holders: [a.self] });
  assert.equal((await b.read(empty.id)).length, 0);
  assert.ok(matches('my VIDEO', 'My holiday video.mp4'));
  assert.ok(!matches('my audio', 'My holiday video.mp4'));
  assert.ok(matches('', 'anything'));
});

test('on disk (a Node peer): chunks and library stay across a restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pigeonfs-'));
  try {
    const sim = new SimMesh();
    const s1 = await fsStores(dir);
    const a = new PigeonFS(sim.add(), s1.chunks, s1.library, { searchMs: 100 });
    const data = random(CHUNK_BYTES + 10, 5);
    const entry = await a.share(data, 'kept.bin');
    const s2 = await fsStores(dir);
    const again = new PigeonFS(sim.add(), s2.chunks, s2.library, { searchMs: 100 });
    assert.deepEqual(await again.read(entry.id), data);
    assert.equal((await s2.chunks.usage()).bytes, data.length);
    assert.equal(await sha256Hex((await s2.chunks.get(entry.manifest.chunks[1]))!), entry.manifest.chunks[1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
