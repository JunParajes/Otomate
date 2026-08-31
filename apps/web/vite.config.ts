import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        /**
         * Vendor code is split from app code so a deploy does not invalidate
         * everything.
         *
         * The app is a PWA with a precache. As one 960 KB file, every deploy —
         * and there are several a day — meant every tablet re-downloading the
         * whole thing, including a copy of React that had not changed in months.
         * Separated, a typical deploy only invalidates the app chunks; Mantine
         * and React stay cached until they are actually upgraded.
         *
         * Grouped rather than one chunk per package: 40 tiny requests is worse
         * than four sensible ones, and these four update on different schedules.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const parts = id.split('node_modules/')
          const after = parts[parts.length - 1]
          const pkg = after.startsWith('@') ? after.split('/').slice(0, 2).join('/') : after.split('/')[0]

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react'

          // BEFORE the generic @mantine rule. @mantine/dropzone matches that
          // rule too, and putting it in the eager vendor chunk drags
          // react-dropzone and file-selector in with it — 60 KB of image-upload
          // code downloaded to render a login box. Only ImageDropzone imports
          // this, and only the product catalogue renders that.
          if (
            pkg === '@mantine/dropzone' || pkg === 'react-dropzone' ||
            pkg === 'file-selector' || pkg === 'attr-accept'
          ) return 'vendor-upload'

          if (pkg.startsWith('@mantine') || pkg.startsWith('@floating-ui')) return 'vendor-mantine'
          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The plugin precaches the manifest icons on its own, so globPatterns
      // below deliberately does NOT match png/svg — otherwise every icon lands
      // in the precache manifest twice. Anything else that has to be cached but
      // is not referenced by the manifest goes here.
      includeAssets: ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Otomate — Bakery Management',
        short_name: 'Otomate',
        description:
          'Daily sales and inventory reporting for the bakery: DSIR entry, product catalogue, employees and branches.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'en',
        // Matches the Mantine AppShell header (--mantine-color-body) so the
        // title bar does not clash with the app in standalone mode. The dark
        // counterpart is a media-scoped meta tag in index.html.
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        // Navigation requests only ever mean "show the app". These paths belong
        // to the API and must never be answered from the cache.
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/, /^\/health/],
        runtimeCaching: [
          {
            // Product photographs only. Filenames are content-unique (uuid.webp),
            // so a cached file can never go stale — the URL changes when the
            // image does.
            urlPattern: /\/uploads\/.*\.(?:webp|png|jpe?g|gif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'otomate-product-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // NOTHING under /api is cached, deliberately, and no rule above matches
        // it. Prices in this app are the authoritative figure the day's sales
        // are derived from, and a shortage is deducted from an employee's wages
        // (see docs/DOMAIN.md). Serving a stale price from a cache would take
        // money off someone's pay. Unmatched requests go straight to the
        // network, which is what we want: no rule is the correct rule here.
      },
      // A service worker in dev caches assets Vite is trying to hot-reload,
      // which produces confusing stale-module bugs. Build-only.
      devOptions: { enabled: false },
    }),
  ],
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
