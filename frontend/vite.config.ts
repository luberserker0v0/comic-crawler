import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const frontendPort = Number.parseInt(process.env.COMICCRAWLER_FRONTEND_PORT ?? process.env.FRONTEND_PORT ?? '5173', 10);
const frontendHost = process.env.COMICCRAWLER_FRONTEND_HOST ?? process.env.FRONTEND_HOST ?? '127.0.0.1';
const backendHost = process.env.COMICCRAWLER_HOST ?? process.env.HOST ?? '127.0.0.1';
const backendPort = Number.parseInt(process.env.COMICCRAWLER_PORT ?? process.env.PORT ?? '4100', 10);
const backendHttpTarget = process.env.COMICCRAWLER_API_TARGET ?? `http://${backendHost}:${backendPort}`;
const backendWsTarget = process.env.COMICCRAWLER_WS_TARGET ?? backendHttpTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: frontendHost,
    port: frontendPort,
    proxy: {
      '/api': {
        target: backendHttpTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
});
