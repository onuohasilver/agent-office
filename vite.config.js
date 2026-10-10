import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: {
    port: 5317,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4317',
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
