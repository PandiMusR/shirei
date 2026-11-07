import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { pwaRegisterType, pwaWorkbox } from './src/swUpdate';

const appUrl = process.env.SHIREI_APP_URL ?? 'http://127.0.0.1:3099';
const webPort = Number(process.env.SHIREI_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: pwaRegisterType,
      injectRegister: null,
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Shirei',
        short_name: 'Shirei',
        theme_color: '#16130f',
        background_color: '#16130f',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: pwaWorkbox,
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': { target: appUrl, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      '/healthz': { target: appUrl, changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
