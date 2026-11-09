import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// GitHub Pages serves the app under /<repo>/. BASE is set by the deploy workflow; './' works anywhere.
const base = process.env.BASE ?? './';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version + (process.env.GITHUB_SHA ? '+' + process.env.GITHUB_SHA.slice(0, 7) : '')) },
  worker: { format: 'es' },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 1200, assetsInlineLimit: 0 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Vault Atlas',
        short_name: 'Vault Atlas',
        description: 'Private, on-device dashboard and graph explorer for an Obsidian vault.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b000e',
        theme_color: '#0b000e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,zip,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
});
