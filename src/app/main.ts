/**
 * PigeonFS in a browser: find and fetch files across the mesh (left), share
 * files and see what this browser holds and who it is linked to (right).
 * ?network= and ?room= pick the mesh; ?signal=ws://… starts from that relay
 * (with ?auto=0, only that one).
 */
import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import { joinMesh } from '../core/peerpigeon.ts';
import { PigeonFS, type NetworkFile, type Offer } from '../core/pigeonfs.ts';
import { idbStores } from '../core/store-idb.ts';
import { Greedy } from '../core/greedy.ts';
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function button(label: string, onClick: () => void, quiet = false, title = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, className: quiet ? 'quiet' : '', title });
  b.addEventListener('click', onClick);
  return b;
}

/** A file row: its name, a line about it, its buttons, and (while fetching) a bar or (after a failure) why. */
function row(name: string, detail: (Node | string)[], actions: HTMLElement[], progress?: number, error?: string): HTMLLIElement {
  const li = el('li', {},
    el('div', { className: 'name' }, el('b', { textContent: name, title: name }), el('small', {}, ...detail)),
    el('span', { className: 'acts' }, ...actions));
  if (progress !== undefined) { const bar = el('div', { className: 'bar' }, el('i')); (bar.firstChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`; li.append(bar); }
  if (error) li.append(el('p', { className: 'error', textContent: error }));
  return li;
}

async function main(): Promise<void> {
  const network = query.get('network') ?? 'pigeonfs', room = query.get('room') ?? 'main';
  const { chunks, library } = await idbStores();
  const mesh = await joinMesh({ network, room, signal: query.get('signal') ?? undefined, automatic: query.get('auto') !== '0' });
  const fs = new PigeonFS(mesh, chunks, library);
  await fs.start();
  (globalThis as Record<string, unknown>).pigeonfs = fs;

  // Greedy storage: the space lent to the mesh is this browser's setting, kept in the private space.
  const settingsKey = 'pfs/settings';
  const saved = (await mesh.storage?.get('private', settingsKey).catch(() => null)) as { lendGB?: number } | null;
  const lendGB = typeof saved?.lendGB === 'number' ? saved.lendGB : 1;
  const greedy = new Greedy(fs, {
    quota: lendGB * 2 ** 30,
    // What the browser still allows this site (it may clear a site that fills up).
    freeSpace: async () => { const e = await navigator.storage?.estimate?.(); return e?.quota !== undefined ? e.quota - (e.usage ?? 0) : null; },
  });
  greedy.start();
  const lend = $<HTMLInputElement>('lend');
  const showLend = () => { $('lend-value').textContent = Number(lend.value) ? `${lend.value} GB` : 'None'; };
  lend.value = String(lendGB);
  showLend();
  lend.addEventListener('input', showLend);
  lend.addEventListener('change', () => {
    const gb = Number(lend.value);
    greedy.setQuota(gb * 2 ** 30);
    void mesh.storage?.put('private', settingsKey, { lendGB: gb }).catch(() => {});
  });
  const renderLend = () => {
    const st = greedy.status();
    $('s-lent').textContent = `${plural(st.files, 'file')} · ${size(st.used)} of ${size(st.room)}`;
    $('lend-doing').textContent = st.doing;
  };
  renderLend();
  setInterval(renderLend, 2000);
  $<HTMLButtonElement>('find-button').disabled = false;
  $('s-self').textContent = mesh.self.slice(0, 12);
  $('s-self').className = 'id';
  $('s-self').title = mesh.self;
  $('s-room').textContent = `${network} / ${room}`;

  const renderMesh = async () => {
    const peers = mesh.peers();
    $('status').textContent = peers.length ? `${plural(peers.length, 'peer')} linked` : 'Alone so far';
    $('live-dot').hidden = !peers.length;
    $('s-relay').textContent = mesh.relay() || '…';
    $('s-relay').title = mesh.relay();
    // What each linked peer holds, from its holdings record (user space).
    const held = new Map((await fs.holdings()).map((h) => [h.peer, h]));
    $('peers').replaceChildren(...peers.map((p) => {
      const h = held.get(p);
      return el('li', {}, el('b', { textContent: p.slice(0, 12), title: p }), el('span', { textContent: h ? `${plural(h.files.length, 'file')} · ${size(h.bytes)}` : 'linked' }));
    }));
  };

  // Saving a held file: its chunks as a Blob, downloaded under its name.
  const save = async (id: string, name: string, type: string) => {
    const parts: BlobPart[] = [];
    for await (const p of fs.parts(id)) parts.push(p as Uint8Array<ArrayBuffer>);
    const url = URL.createObjectURL(new Blob(parts, { type: type || 'application/octet-stream' }));
    el('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const fetching = new Map<string, number>();
  const failed = new Map<string, string>();
  const fetchFile = async (f: { id: string; name: string; type: string }, holders?: string[]) => {
    if (fetching.has(f.id)) return;
    fetching.set(f.id, 0);
    failed.delete(f.id);
    renderResults();
    try {
      await fs.fetch(f.id, { holders, onProgress: (p) => { fetching.set(f.id, p.size ? p.bytes / p.size : 1); renderResults(); } });
      fetching.delete(f.id);
      await save(f.id, f.name, f.type);
    } catch (e) {
      fetching.delete(f.id);
      failed.set(f.id, `Could not fetch it: ${(e as Error).message}.`);
    }
    renderResults();
  };

  let results: NetworkFile[] | null = null;
  const renderResults = () => {
    if (!results) return;
    const list = results;
    $('results').replaceChildren(...list.map((f) => {
      const here = f.holders.includes(fs.self);
      const share = fetching.get(f.id);
      const others = f.holders.filter((p) => p !== fs.self).length;
      const detail: (Node | string)[] = [`${size(f.size)} · `, here ? el('span', { className: 'here', textContent: 'held here' }) : plural(others, 'holder')];
      if (here && others) detail.push(`, and ${plural(others, 'other')}`);
      const act = here ? button('Save', () => void save(f.id, f.name, f.type))
        : share !== undefined ? Object.assign(button(`${Math.round(share * 100)}%`, () => {}), { disabled: true })
          : button('Fetch', () => void fetchFile(f));
      return row(f.name, detail, [act], share, failed.get(f.id));
    }));
    $('results-note').textContent = list.length ? '' : 'Nothing on the mesh has a name with all those words (peers answer for what they hold now).';
    $('results-note').hidden = !list.length ? false : true;
  };

  const renderOffers = () => {
    $('offers-block').hidden = !fs.offers.length;
    $('offers').replaceChildren(...fs.offers.map((o: Offer) => row(o.file.name, [`${size(o.file.size)} · from ${o.from.slice(0, 8)}`], [
      button('Fetch', () => { fs.dismissOffer(o); results = [...(results ?? []).filter((r) => r.id !== o.file.id), fs.network.get(o.file.id)!]; void fetchFile(o.file, [o.from]); }),
      button('Dismiss', () => fs.dismissOffer(o), true),
    ])));
  };

  const renderMine = async () => {
    const files = await fs.files();
    const u = await fs.usage();
    $('s-files').textContent = String(files.length);
    $('s-bytes').textContent = size(u.bytes);
    $('s-chunks').textContent = String(u.chunks);
    const linked = mesh.peers();
    $('mine').replaceChildren(...files.map((e: LibraryEntry) => row(e.manifest.name, [`${size(e.manifest.size)} · `, e.forMesh ? el('span', { className: 'lent', textContent: 'for the mesh' }) : new Date(e.added).toLocaleDateString()], [
      button('Save', () => void save(e.id, e.manifest.name, e.manifest.type), true),
      ...(linked.length ? [button('Offer', () => { for (const p of mesh.peers()) fs.offer(p, e); }, true, `Tell the ${plural(linked.length, 'linked peer')} about it`)] : []),
      button('Remove', () => void fs.remove(e.id), true, 'Stop holding it here'),
    ])));
  };

  const share = async (files: FileList | File[]) => {
    const bar = $('load-bar'), fill = $('load-bar-fill');
    for (const file of Array.from(files)) {
      bar.hidden = false;
      $('sharing').textContent = `Sharing ${file.name}…`;
      await fs.share(file, file.name, file.type, (done, total) => { fill.style.width = `${Math.round((100 * done) / Math.max(1, total))}%`; });
    }
    bar.hidden = true;
    fill.style.width = '0';
    $('sharing').textContent = `Shared ${plural(files.length, 'file')}. They stay in this browser, and go to whoever on the mesh asks for them.`;
  };

  $<HTMLInputElement>('pick').addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.files?.length) void share(t.files); t.value = ''; });
  addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dragging'); if (e.dataTransfer?.files.length) void share(e.dataTransfer.files); });
  $('find').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $<HTMLButtonElement>('find-button');
    b.disabled = true;
    b.textContent = 'Asking…';
    results = await fs.search($<HTMLInputElement>('query').value.trim());
    b.disabled = false;
    b.textContent = 'Find';
    renderResults();
  });

  fs.on('change', () => { void renderMesh(); renderOffers(); renderResults(); void renderMine(); });
  void renderMesh();
  renderOffers();
  await renderMine();
  setInterval(renderMesh, 3000);
}

main().catch((e) => { $('status').textContent = `Could not start: ${(e as Error).message}`; console.error(e); });
