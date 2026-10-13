import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  build: {
    // The offline catalog is ~650 KB raw / ~83 KB gzip. Keep app/vendor warnings meaningful.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/assets/recipes/')) return 'catalog';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'private-local-model',
      // Developer convenience only. Never bundled or served by preview/production.
      configureServer(server) {
        server.middlewares.use('/__local-model', async (req, res) => {
          const remote = req.socket.remoteAddress;
          const origin = req.headers.origin;
          const host = req.headers.host;
          if (
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '') ||
            (origin && new URL(origin).host !== host) ||
            req.headers['sec-fetch-site'] === 'cross-site' ||
            req.headers['x-cookpilot-local'] !== '1'
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          try {
            const config = await readFile(new URL('./.local/model.json', import.meta.url), 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(config);
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['fonts/*', 'favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'CookPilot 烹饪助手',
        short_name: 'CookPilot',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#28664e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
});
