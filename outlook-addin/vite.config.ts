import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Outlook Add-in Vite 配置
 *
 * 端口：3004 (与 Excel=3001 / Word=3002 / PowerPoint=3003 并列)
 * manifest.xml 由 start-tunnel.mjs 自动生成（公网 HTTPS URL）
 *
 * 关键约束：
 * - Office.js 通过 CDN 加载，遵循项目既有模式
 * - /api 代理到 server 端口 3000（与 word/ppt/excel 一致）
 * - strictPort: true 启动失败立即报错（端口被占用时）
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3004,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
