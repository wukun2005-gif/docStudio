import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@client-components': path.resolve(__dirname, '../client/src/components'),
    },
  },
});
