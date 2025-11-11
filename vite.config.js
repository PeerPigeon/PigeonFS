import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    hmr: {
      overlay: true
    },
    watch: {
      usePolling: true
    },
    port: 8765
  }
})
