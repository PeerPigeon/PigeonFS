import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * https (a self-signed certificate: accept it once per device): other devices on
 * the network get a secure page (WebCrypto, WebRTC) by this machine's name too.
 * Relays are PeerPigeon's choice: local ones first.
 */
export default defineConfig({
  root: 'src/app',
  plugins: [basicSsl({ name: 'pigeonfs-dev' })],
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022' },
  server: { host: '0.0.0.0', allowedHosts: true },
});
