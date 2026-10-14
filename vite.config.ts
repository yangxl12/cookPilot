import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const revision = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
})();
const builtAt = new Date().toISOString();
const appBuild = { version, revision, builtAt, id: `${revision}.${builtAt}` };

export default defineConfig({
  // Pages supplies /<repo>/; local development and root deployments default to /.
  base: process.env.VITE_BASE_PATH || '/',
  define: { __APP_BUILD__: JSON.stringify(appBuild) },
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
      name: 'app-version',
      generateBundle() {
        // Keep this outside the offline precache so update checks always reach the server.
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify(appBuild),
        });
      },
    },
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
      // App owns registration after initialization; avoid a second injected registration.
      injectRegister: false,
      includeAssets: ['fonts/*', 'favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'CookPilot 烹饪助手',
        short_name: 'CookPilot',
        lang: 'zh-CN',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#28664e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
});
