import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',  // Bind to all interfaces, not just localhost
    hmr: false,       // Disable HMR completely to avoid WebSocket conflicts
    port: 8765        // Keep your existing port
  }
})
