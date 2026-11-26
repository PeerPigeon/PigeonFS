/**
 * Where a Node peer or server keeps its data: --dir, else PIGEONFS_DIR, else
 * a folder here (a server's first start in a terminal suggests one on the largest drive). `~` is the home folder. A folder on a drive that is not
 * mounted (/Volumes/<drive> missing) is refused rather than created on the
 * startup disk in its place.
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';

export function dataDir(flag: string | undefined, fallback: string): string {
  const raw = flag ?? process.env.PIGEONFS_DIR ?? fallback;
  const dir = path.resolve(raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw);
  const drive = /^\/Volumes\/[^/]+/.exec(dir)?.[0];
  if (drive && !existsSync(drive)) {
    throw new Error(`${drive} is not mounted; plug the drive in (or pick another folder with --dir) and start again`);
  }
  return dir;
}

/** Whether `dir` holds a server's data (its rooms and chunks folders). */
function isServerData(dir: string): boolean {
  return existsSync(path.join(dir, 'rooms')) && existsSync(path.join(dir, 'blobs'));
}

/** What a server's data folder holds, in words. */
function contents(dir: string): string {
  if (!existsSync(dir)) return 'does not exist yet: it will be made';
  if (!isServerData(dir)) return 'no PigeonFS server data in it yet';
  const count = (sub: string) => { try { return readdirSync(path.join(dir, sub)).length; } catch { return 0; } };
  let chunks = 0;
  try { for (const s of readdirSync(path.join(dir, 'blobs'))) chunks += readdirSync(path.join(dir, 'blobs', s)).length; } catch { /* unreadable */ }
  return `${count('rooms')} room${count('rooms') === 1 ? '' : 's'}, ${chunks} chunk${chunks === 1 ? '' : 's'}`;
}

/** Server data folders on this machine's drives (/Volumes/<drive>, two levels down) and here. */
function findServerData(): string[] {
  const out: string[] = [];
  const look = (dir: string, depth: number) => {
    if (isServerData(dir)) { out.push(dir); return; }
    if (depth === 0) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.') || n === 'node_modules') continue;
      const p = path.join(dir, n);
      try { if (statSync(p).isDirectory()) look(p, depth - 1); } catch { /* unreadable */ }
    }
  };
  look(path.resolve('pigeonfs-server'), 0);
  try { for (const v of readdirSync('/Volumes')) look(path.join('/Volumes', v), 2); } catch { /* not a Mac */ }
  return [...new Set(out)];
}

const remembered = path.join(os.homedir(), '.pigeonfs', 'server-dir');

/** A drive this machine has, and where on it a server's folder would go. */
export interface Drive { mount: string; total: number; free: number; folder: string }

/** Filesystems that are not drives (memory, kernel, containers' layers, network shares). */
const NOT_DRIVES = new Set(['proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'ramfs', 'cgroup', 'cgroup2', 'pstore', 'bpf',
  'securityfs', 'debugfs', 'tracefs', 'configfs', 'fusectl', 'mqueue', 'hugetlbfs', 'autofs', 'binfmt_misc', 'overlay',
  'squashfs', 'nsfs', 'efivarfs', 'rpc_pipefs', 'nfsd', 'nfs', 'nfs4', 'cifs', 'smbfs', 'fuse.portal', 'fuse.gvfsd-fuse', 'iso9660', 'devfs']);

const writable = (dir: string): boolean => { try { accessSync(dir, constants.W_OK); return true; } catch { return false; } };

/**
 * This machine's drives, largest first: Linux's mounts, a Mac's startup disk and /Volumes, Windows' drive
 * letters. On the startup disk the folder goes in the home folder (its root is the system's); a drive this
 * user can't write to is left out.
 */
export function drives(): Drive[] {
  const home = os.homedir();
  const mounts: string[] = [];
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) { const m = `${String.fromCharCode(c)}:\\`; if (existsSync(m)) mounts.push(m); }
  } else if (process.platform === 'darwin') {
    mounts.push('/');
    try { for (const v of readdirSync('/Volumes')) mounts.push(path.join('/Volumes', v)); } catch { /* none */ }
  } else {
    try {
      for (const line of readFileSync('/proc/mounts', 'utf8').split('\n')) {
        const [, mount, type] = line.split(' ');
        // fuse.* is a network or virtual mount (sshfs, rclone, s3fs…); a local disk through FUSE is fuseblk.
        if (!mount || !type || NOT_DRIVES.has(type) || type.startsWith('fuse.')) continue;
        const where = mount.replace(/\\040/g, ' ');
        if (/^\/(proc|sys|dev|snap|boot)(\/|$)/.test(where) || (/^\/run(\/|$)/.test(where) && !/^\/run\/media\//.test(where))) continue;
        mounts.push(where);
      }
    } catch { mounts.push('/'); }
  }
  const startup = (() => { try { return statfsSync(home); } catch { return null; } })();
  const seen = new Set<string>();
  const out: Drive[] = [];
  for (const mount of mounts) {
    let real = mount;
    try { real = realpathSync(mount); } catch { continue; }
    let s: ReturnType<typeof statfsSync>;
    try { s = statfsSync(real); } catch { continue; }
    const total = Number(s.blocks) * Number(s.bsize);
    if (!total) continue;
    // The same drive by another name (Macintosh HD is /, a bind mount): once.
    const key = `${s.type}:${s.blocks}:${s.bsize}:${s.files}`;
    if (seen.has(key) || seen.has(real)) continue;
    seen.add(key); seen.add(real);
    const isStartup = !!startup && Number(startup.blocks) === Number(s.blocks) && Number(startup.bsize) === Number(s.bsize) && startup.type === s.type && startup.files === s.files;
    const base = isStartup ? home : real;
    if (!writable(base)) continue;
    out.push({ mount: real, total, free: Number(s.bavail) * Number(s.bsize), folder: path.join(base, 'PigeonFS') });
  }
  return out.sort((a, b) => b.total - a.total);
}

const size = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = bytes; let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return `${n >= 100 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
};

/**
 * The server's data folder, chosen on start: --dir, else PIGEONFS_DIR, else the
 * one used last time, else one found on this machine's drives, else (in a
 * terminal) a PigeonFS folder on the largest drive, else `pigeonfs-server` here. It is printed with what it holds, and (in a
 * terminal) asked: Enter uses it, or type another folder. The choice is
 * remembered for next time.
 */
export async function chooseServerDir(flag: string | undefined): Promise<string> {
  const given = flag ?? process.env.PIGEONFS_DIR;
  let last: string | undefined;
  try { last = readFileSync(remembered, 'utf8').trim() || undefined; } catch { /* first start */ }
  const found = findServerData();
  const asking = !!(process.stdin.isTTY && process.stdout.isTTY);
  // A first start, in a terminal: the largest drive's PigeonFS folder is suggested (and made only if taken).
  const disks = !given && !last && !found.length && asking ? drives() : [];
  if (disks.length) {
    console.log('Drives on this machine:');
    for (const d of disks) console.log(`  ${d.mount}  ${size(d.total)} (${size(d.free)} free)  -> ${d.folder}`);
  }
  let dir = dataDir(given ?? last ?? found[0] ?? disks[0]?.folder, 'pigeonfs-server');
  const why = flag ? '--dir' : process.env.PIGEONFS_DIR ? 'PIGEONFS_DIR' : last ? 'used last time' : found.length ? 'found on this machine' : disks.length ? 'on the largest drive' : 'default';
  console.log(`Data folder: ${dir} (${why}; ${contents(dir)})`);
  for (const f of found) if (f !== dir) console.log(`  Also found: ${f} (${contents(f)})`);
  if (asking) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (await rl.question('Use it? Enter = yes, or type another folder: ')).trim();
        if (!answer || /^y(es)?$/i.test(answer)) break;
        try {
          dir = dataDir(answer, 'pigeonfs-server');
          console.log(`Data folder: ${dir} (${contents(dir)})`);
        } catch (e) { console.log((e as Error).message); }
      }
    } finally { rl.close(); }
  }
  try { mkdirSync(path.dirname(remembered), { recursive: true }); writeFileSync(remembered, `${dir}\n`); } catch { /* not remembered */ }
  console.log(`Using ${dir}`);
  return dir;
}
