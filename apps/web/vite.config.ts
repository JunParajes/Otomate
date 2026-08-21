import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://api:3001', changeOrigin: true },
      '/health': { target: 'http://api:3001', changeOrigin: true },
      // Product images are served by the API off the uploads volume. Without
      // this, the dev server's SPA fallback returns index.html for every image
      // URL and thumbnails silently render as broken images.
      '/uploads': { target: 'http://api:3001', changeOrigin: true },
    },
  },
})
