import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5678,
    proxy: {
      '/api': 'http://localhost:4001',
      '/storage': 'http://localhost:4001',
      '/data': 'http://182.92.129.222',
      '/lt': 'http://182.92.129.222',
    },
  },
});
