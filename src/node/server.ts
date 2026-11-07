/**
 * A PigeonFS storage server: keeps PeerPigeon storage for every room it is
 * among the closest servers for (any app's, any room's), the way a relay
 * carries their signaling. Peers find it through the relays (it announces the
 * role 'storage'), link to it over WebRTC, and move their records to it.
 *
 *   npm run server -- [--dir pigeonfs-server] [--signal ws://…] [--no-page]
 *
 * It serves the PigeonFS page as well (https, port 5173), unless --no-page.
 *
 * It never sees a room, a key or a value: each record is the room's own
 * ciphertext under a hashed slot. Records are kept in --dir, one folder per room (rooms/), and file chunks, sealed, under blobs/.
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PeerPigeonNode, type ServerRecord, type ServerRecordStore } from 'peerpigeon';
import { installWebRtc } from './webrtc.ts';
import { dataDir } from './where.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const HEX = /^[0-9a-f]{64}$/;

/**
 * Records in a folder: <dir>/rooms/<room>/<slot>.json, written whole or not at
 * all. An index of every room is kept in memory, read once at start.
 */
export async function fsRecordStore(dir: string): Promise<ServerRecordStore> {
  const roomsDir = path.join(dir, 'rooms');
  await mkdir(roomsDir, { recursive: true });
  const index = new Map<string, Map<string, ServerRecord>>();
  const blobsDir = path.join(dir, 'blobs');
  await mkdir(blobsDir, { recursive: true });
  const blobSizes = new Map<string, number>();
  for (const sub of await readdir(blobsDir).catch(() => [] as string[])) {
    for (const name of await readdir(path.join(blobsDir, sub)).catch(() => [] as string[])) {
      if (HEX.test(name)) blobSizes.set(name, (await stat(path.join(blobsDir, sub, name)).catch(() => null))?.size ?? 0);
    }
  }
  for (const room of await readdir(roomsDir).catch(() => [] as string[])) {
    if (!HEX.test(room)) continue;
    const m = new Map<string, ServerRecord>();
    for (const name of await readdir(path.join(roomsDir, room)).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue;
      try { const rec = JSON.parse(await readFile(path.join(roomsDir, room, name), 'utf8')) as ServerRecord; m.set(rec.slot, rec); } catch { /* a torn file: skipped */ }
    }
    index.set(room, m);
  }
  return {
    async get(room, slot) { return index.get(room)?.get(slot) ?? null; },
    async put(rec) {
      if (!HEX.test(rec.room) || !HEX.test(rec.slot)) throw new Error('bad record');
      const folder = path.join(roomsDir, rec.room);
      await mkdir(folder, { recursive: true });
      const file = path.join(folder, `${rec.slot}.json`), tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(rec));
      await rename(tmp, file);
      let m = index.get(rec.room);
      if (!m) index.set(rec.room, (m = new Map()));
      m.set(rec.slot, rec);
    },
    async list(room, tag) { return [...(index.get(room)?.values() ?? [])].filter((r) => !tag || r.tag === tag); },
    async rooms() { return [...index.keys()]; },
    // Blobs (file chunks, model parts), sealed: <dir>/blobs/<first two of the address>/<address>.
    async getBlob(address) {
      if (!HEX.test(address)) return null;
      try { return new Uint8Array(await readFile(path.join(blobsDir, address.slice(0, 2), address))); } catch { return null; }
    },
    async putBlob(address, sealed) {
      if (!HEX.test(address)) throw new Error('bad address');
      if (blobSizes.has(address)) return;
      const folder = path.join(blobsDir, address.slice(0, 2));
      await mkdir(folder, { recursive: true });
      const file = path.join(folder, address), tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, sealed);
      await rename(tmp, file);
      blobSizes.set(address, sealed.length);
    },
    async blobs() { return [...blobSizes.keys()]; },
    async blobUsage() { let bytes = 0; for (const n of blobSizes.values()) bytes += n; return { count: blobSizes.size, bytes }; },
  };
}

async function main(): Promise<void> {
  const dir = dataDir(arg('dir'), 'pigeonfs-server');
  await installWebRtc();
  const signal = arg('signal');
  const server = PeerPigeonNode.storageServer(signal ? { signalingServer: signal, automaticSignalingServer: false } : {}, await fsRecordStore(dir));
  await server.start();
  console.log(`PigeonFS storage server is up; keeping records in ${dir}.`);
  // The page too, from the same command (--no-page to leave it out).
  if (!process.argv.includes('--no-page')) {
    try {
      const { createServer } = await import('vite');
      const page = await createServer({ configFile: path.resolve(import.meta.dirname, '../../vite.config.ts') });
      await page.listen();
      const urls = page.resolvedUrls;
      // This machine (localhost) and its addresses on the network; not the other names for this machine.
      const local = (urls?.local ?? []).filter((u) => new URL(u).hostname === 'localhost');
      for (const u of [...local, ...(urls?.network ?? [])]) console.log(`Page: ${u}?network=pigeonfs&room=main`);
    } catch (e) {
      console.log(`The page could not start (${(e as Error).message}); the server runs without it.`);
    }
  }
  let last = '';
  setInterval(async () => {
    const s = await server.stats();
    const line = `${s.rooms} room${s.rooms === 1 ? '' : 's'}, ${s.records} record${s.records === 1 ? '' : 's'}, ${s.blobs} chunk${s.blobs === 1 ? '' : 's'} (${(s.blobBytes / 1e6).toFixed(1)} MB); linked to ${s.servers} server${s.servers === 1 ? '' : 's'} and ${s.clients} peer${s.clients === 1 ? '' : 's'}`;
    if (line !== last) { console.log(line); last = line; }
  }, 3000).unref();
  const stop = async () => { console.log('Stopping…'); await server.close(); process.exit(0); };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
