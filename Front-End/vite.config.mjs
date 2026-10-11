import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { assetsInlineLimit: 100_000_000 },
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/ask': 'http://localhost:3000',
      '/quiz': 'http://localhost:3000',
      '/progress': 'http://localhost:3000',
    },
  },
});
