import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Apply new versions automatically — no "update available" prompt to
      // dismiss on a study app.
      registerType: 'autoUpdate',
      manifest: {
        name: 'PocketScholar',
        short_name: 'PocketScholar',
        description:
          'Offline-first AI study notes — summaries, flashcards, quizzes and Q&A about your notes. On-device when possible, cloud when needed.',
        theme_color: '#1a73e8',
        background_color: '#f6f7fb',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell AND the whole self-hosted Tesseract stack
        // (worker, LSTM cores, eng+ind language data) so the app opens
        // offline after the first online visit and photo OCR works offline
        // too. Note the .gz language files are NOT matched by the js/css/
        // html pattern — they need the explicit tesseract/** pattern.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}', 'tesseract/**/*'],
        // Workbox skips files over 2 MB by default; the Tesseract LSTM
        // cores are ~4 MB each, so raise the cap (total precache ~12 MB).
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Single-page app: serve index.html for navigations.
        navigateFallback: 'index.html',
        // Firebase / Google APIs must never be served from cache: when
        // offline they fail (and the app handles that), when online they
        // must hit the network.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.googleapis\.com\/.*$/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/.*\.firebaseapp\.com\/.*$/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
