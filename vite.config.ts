import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', sourcemap: true, rollupOptions: { input: {
    game: fileURLToPath(new URL('./index.html', import.meta.url)),
    balance: fileURLToPath(new URL('./admin/balance/index.html', import.meta.url)),
  } } },
});
