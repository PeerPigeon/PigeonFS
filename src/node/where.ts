/**
 * Where a Node peer or server keeps its data: --dir, else PIGEONFS_DIR, else
 * a folder here. `~` is the home folder. A folder on a drive that is not
 * mounted (/Volumes/<drive> missing) is refused rather than created on the
 * startup disk in its place.
 */
import { existsSync } from 'node:fs';
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
