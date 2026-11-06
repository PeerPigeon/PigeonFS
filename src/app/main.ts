/**
 * PigeonFS in a browser: share files, find and fetch them across the mesh,
 * and see what this browser holds. ?network= and ?room= pick the mesh.
 */
import { joinMesh } from '../core/peerpigeon.ts';
import { PigeonFS, type NetworkFile, type Offer } from '../core/pigeonfs.ts';
import { idbStores } from '../core/store-idb.ts';
import type { LibraryEntry } from '../core/store.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function item(name: string, detail: string, ...actions: HTMLElement[]): HTMLLIElement {
  const li = document.createElement('li');
  const text = document.createElement('div');
  text.className = 'name';
  const strong = document.createElement('strong');
  strong.textContent = name;
  strong.title = name;
  const small = document.createElement('small');
  small.textContent = detail;
  text.append(strong, small);
  li.append(text, ...actions);
  return li;
}

function button(label: string, onClick: () => void, quiet = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (quiet) b.className = 'quiet';
  b.addEventListener('click', onClick);
  return b;
}

async function main(): Promise<void> {
  const network = query.get('network') ?? 'pigeonfs', room = query.get('room') ?? 'main';
  const { chunks, library } = await idbStores();
  // ?signal=ws://… starts from that relay; with ?auto=0, only that one.
  const mesh = await joinMesh({ network, room, signal: query.get('signal') ?? undefined, automatic: query.get('auto') !== '0' });
  const fs = new PigeonFS(mesh, chunks, library);
  (globalThis as Record<string, unknown>).pigeonfs = fs;

  const status = () => {
    const n = mesh.peers().length;
    $('status').textContent = `${network} / ${room} · ${n ? `${n} peer${n === 1 ? '' : 's'} linked` : 'no peers linked yet'}${mesh.relay() ? ` · relay ${mesh.relay()}` : ''}`;
  };

  // Saving a held file: its chunks as a Blob, downloaded under its name.
  const save = async (id: string, name: string, type: string) => {
    const parts: BlobPart[] = [];
    for await (const p of fs.parts(id)) parts.push(p as Uint8Array<ArrayBuffer>);
    const url = URL.createObjectURL(new Blob(parts, { type: type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const fetching = new Map<string, number>();
  const fetchFile = async (f: { id: string; name: string; type: string }, holders?: string[]) => {
    if (fetching.has(f.id)) return;
    fetching.set(f.id, 0);
    renderResults();
    try {
      await fs.fetch(f.id, { holders, onProgress: (p) => { fetching.set(f.id, p.size ? p.bytes / p.size : 1); renderResults(); } });
      fetching.delete(f.id);
      await save(f.id, f.name, f.type);
    } catch (e) {
      fetching.delete(f.id);
      alert(`Could not fetch ${f.name}: ${(e as Error).message}`);
    }
    renderResults();
    void renderMine();
  };

  let results: NetworkFile[] = [];
  const renderResults = () => {
    const ul = $('results');
    ul.replaceChildren(...results.map((f) => {
      const share = fetching.get(f.id);
      const here = f.holders.includes(fs.self);
      const li = item(f.name, `${size(f.size)} · ${here ? 'here' : `${f.holders.length} holder${f.holders.length === 1 ? '' : 's'}`}`,
        here ? button('Save', () => void save(f.id, f.name, f.type), true) : button(share !== undefined ? `${Math.round(share * 100)}%` : 'Fetch', () => void fetchFile(f)));
      if (share !== undefined) (li.lastChild as HTMLButtonElement).disabled = true;
      return li;
    }));
  };

  const renderOffers = () => {
    $('offers-section').hidden = !fs.offers.length;
    $('offers').replaceChildren(...fs.offers.map((o: Offer) => item(o.file.name, `${size(o.file.size)} · from ${o.from.slice(0, 8)}`,
      button('Fetch', () => { fs.dismissOffer(o); void fetchFile(o.file, [o.from]); }),
      button('Dismiss', () => fs.dismissOffer(o), true))));
  };

  const renderMine = async () => {
    const files = await fs.files();
    const u = await fs.usage();
    $('usage').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'}, ${size(u.bytes)} in this browser` : 'Nothing held here yet.';
    $('mine').replaceChildren(...files.map((e: LibraryEntry) => {
      const offerTo = mesh.peers();
      return item(e.manifest.name, `${size(e.manifest.size)} · ${new Date(e.added).toLocaleString()}`,
        button('Save', () => void save(e.id, e.manifest.name, e.manifest.type), true),
        ...(offerTo.length ? [button('Offer', () => { for (const p of offerTo) fs.offer(p, e); }, true)] : []),
        button('Remove', () => void fs.remove(e.id), true));
    }));
  };

  const share = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      $('sharing').textContent = `Sharing ${file.name}…`;
      await fs.share(file, file.name, file.type, (done, total) => { $('sharing').textContent = `Sharing ${file.name}: ${Math.round((100 * done) / Math.max(1, total))}%`; });
    }
    $('sharing').textContent = '';
  };

  $<HTMLInputElement>('pick').addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.files) void share(t.files); t.value = ''; });
  addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  addEventListener('dragleave', () => document.body.classList.remove('dragging'));
  addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dragging'); if (e.dataTransfer?.files.length) void share(e.dataTransfer.files); });
  $('find').addEventListener('submit', async (e) => {
    e.preventDefault();
    results = await fs.search($<HTMLInputElement>('query').value.trim());
    renderResults();
  });

  fs.on('change', () => { status(); renderOffers(); renderResults(); void renderMine(); });
  status();
  renderOffers();
  await renderMine();
  setInterval(status, 3000);
}

main().catch((e) => { $('status').textContent = `Could not start: ${(e as Error).message}`; console.error(e); });
