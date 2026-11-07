import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** The commit this page is built from, shown on it, so a stale page is plain to see. */
function commit(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}

/**
 * https (a self-signed certificate: accept it once per device): other devices on
 * the network get a secure page (WebCrypto, WebRTC) by this machine's name too.
 * Relays are PeerPigeon's choice: local ones first.
 *
 * Nothing the dev server sends may be cached (Safari keeps an old page and old
 * modules otherwise, on every device that opened it).
 */
export default defineConfig({
  root: 'src/app',
  plugins: [basicSsl({ name: 'pigeonfs-dev' })],
  define: { 'import.meta.env.PFS_VERSION': JSON.stringify(commit()) },
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    headers: { 'Cache-Control': 'no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
  },
});
