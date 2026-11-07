/**
 * Where a Node peer or server keeps its data: --dir, else PIGEONFS_DIR, else
 * a folder here. `~` is the home folder. A folder on a drive that is not
 * mounted (/Volumes/<drive> missing) is refused rather than created on the
 * startup disk in its place.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * The server's data folder, chosen on start: --dir, else PIGEONFS_DIR, else the
 * one used last time, else one found on this machine's drives, else
 * `pigeonfs-server` here. It is printed with what it holds, and (in a
 * terminal) asked: Enter uses it, or type another folder. The choice is
 * remembered for next time.
 */
export async function chooseServerDir(flag: string | undefined): Promise<string> {
  const given = flag ?? process.env.PIGEONFS_DIR;
  let last: string | undefined;
  try { last = readFileSync(remembered, 'utf8').trim() || undefined; } catch { /* first start */ }
  const found = findServerData();
  let dir = dataDir(given ?? last ?? found[0], 'pigeonfs-server');
  const why = flag ? '--dir' : process.env.PIGEONFS_DIR ? 'PIGEONFS_DIR' : last ? 'used last time' : found.length ? 'found on this machine' : 'default';
  console.log(`Data folder: ${dir} (${why}; ${contents(dir)})`);
  for (const f of found) if (f !== dir) console.log(`  Also found: ${f} (${contents(f)})`);
  if (process.stdin.isTTY && process.stdout.isTTY) {
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
