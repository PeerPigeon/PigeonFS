/**
 * A PigeonFS peer that stays up: it holds what it fetched or was given, serves
 * it to the mesh, and shares every file in a folder (and new ones as they
 * appear there).
 *
 *   npm run peer -- [--dir pigeonfs-data] [--share <folder>] [--network pigeonfs] [--room main] [--signal ws://…]
 *
 * Its chunks and library are kept in --dir; the shared folder defaults to <dir>/share.
 */
import { mkdir, readFile, readdir, stat, writeFile, openAsBlob } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { watch } from 'node:fs';
import { installWebRtc } from './webrtc.ts';
import { fsStores } from './store-fs.ts';
import { joinMesh } from '../core/peerpigeon.ts';
import type { PeerPigeonKeyPair } from 'peerpigeon';
import { PigeonFS } from '../core/pigeonfs.ts';

const mkdirP = promisify(mkdir), readFileP = promisify(readFile), readdirP = promisify(readdir), statP = promisify(stat), writeFileP = promisify(writeFile);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MIME: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.zip': 'application/zip', '.html': 'text/html',
};

async function main(): Promise<void> {
  const dir = path.resolve(arg('dir') ?? 'pigeonfs-data');
  const shareDir = path.resolve(arg('share') ?? path.join(dir, 'share'));
  await mkdirP(shareDir, { recursive: true });
  await installWebRtc();
  const { chunks, library } = await fsStores(dir);
  console.log(`Joining the mesh (network ${arg('network') ?? 'pigeonfs'}, room ${arg('room') ?? 'main'})…`);
  // Its key pair (its identity in the mesh's storage: its holdings record is its own), kept in --dir.
  const keyFile = path.join(dir, 'keypair.json');
  let keyPair: PeerPigeonKeyPair | undefined;
  try { keyPair = JSON.parse(await readFileP(keyFile, 'utf8')) as PeerPigeonKeyPair; } catch { keyPair = undefined; }
  const mesh = await joinMesh({ network: arg('network'), room: arg('room'), signal: arg('signal'), keyPair });
  if (!keyPair && mesh.keyPair()) await writeFileP(keyFile, JSON.stringify(mesh.keyPair()), { mode: 0o600 });
  const fs = new PigeonFS(mesh, chunks, library);
  await fs.start();
  console.log(`PigeonFS peer ${mesh.self.slice(0, 8)} is up${mesh.relay() ? ` (relay ${mesh.relay()})` : ''}; holding what is in ${dir}, sharing ${shareDir}.`);

  // Files in the shared folder: shared once each (again if changed), remembered by path, size and time.
  const indexFile = path.join(dir, 'shared.json');
  let index: Record<string, { size: number; mtimeMs: number; id: string }> = {};
  try { index = JSON.parse(await readFileP(indexFile, 'utf8')); } catch { /* none yet */ }
  let scanning: Promise<void> | null = null;
  const scan = () => (scanning ??= (async () => {
    try {
      for (const name of await readdirP(shareDir)) {
        const file = path.join(shareDir, name);
        const s = await statP(file).catch(() => null);
        if (!s?.isFile() || name.startsWith('.')) continue;
        const known = index[name];
        if (known && known.size === s.size && known.mtimeMs === s.mtimeMs && await library.get(known.id)) continue;
        const entry = await fs.share(await openAsBlob(file), name, MIME[path.extname(name).toLowerCase()] ?? '');
        index[name] = { size: s.size, mtimeMs: s.mtimeMs, id: entry.id };
        await writeFileP(indexFile, JSON.stringify(index, null, 2));
        console.log(`Sharing ${name} (${s.size} bytes, ${entry.id.slice(0, 12)})`);
      }
    } finally { scanning = null; }
  })());
  await scan();
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(shareDir, () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void scan().catch((e) => console.error(e)), 500); });

  fs.on('offer', (o) => console.log(`${o.from.slice(0, 8)} offers ${o.file.name} (${o.file.size} bytes)`));
  let lastPeers = -1;
  setInterval(async () => {
    const n = mesh.peers().length;
    if (n !== lastPeers) {
      const u = await fs.usage();
      console.log(`${n} peer${n === 1 ? '' : 's'} linked; holding ${u.files} files, ${u.chunks} chunks (${(u.bytes / 1e6).toFixed(1)} MB)`);
      lastPeers = n;
    }
  }, 2000).unref();

  const stop = async () => { console.log('Leaving the mesh…'); await mesh.stop().catch(() => {}); process.exit(0); };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => { console.error(e); process.exit(1); });
