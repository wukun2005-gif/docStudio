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
    // 优化构建性能
    target: 'es2020',
    minify: 'esbuild',
  },
  server: {
    host: '0.0.0.0',
    port: 3003,
    strictPort: true,
    // Office Add-in 在 iframe 中运行，HMR WebSocket 在 devtunnel 下经常超时导致白屏
    // 禁用 HMR：代码修改后手动刷新 Task Pane 即可（Cmd+Shift+R）
    hmr: false,
    // 预热常用文件，加速首次加载
    warmup: {
      clientFiles: [
        './main.tsx',
        './components/AppShell.tsx',
        './components/WriteTab.tsx',
        './components/ChatPanel.tsx',
        './components/OutlinePanel.tsx',
        './components/WriteProgress.tsx',
        './components/ResultsPanel.tsx',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@client-components': path.resolve(__dirname, '../client/src/components'),
    },
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      '@fluentui/react-components',
      '@fluentui/react-icons',
      '@tanstack/react-query',
      'axios',
    ],
  },
});
