#!/usr/bin/env node

/**
 * start-tunnel.mjs — 为 Excel Add-in 启动公网隧道
 *
 * 使用 localtunnel（纯 Node.js，无需二进制下载）暴露本地 add-in 到公网。
 * Excel Online 在云端运行，iframe 无法访问 localhost，必须通过隧道。
 *
 * 输出：
 *   office-addin/.tunnel-url  — 公网 URL
 *   office-addin/manifest.xml  — 从模板生成（替换 {{ADDIN_BASE_URL}}）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ADDIN_DIR = resolve(ROOT, 'office-addin');
const TEMPLATE = resolve(ADDIN_DIR, 'manifest.xml.template');
const MANIFEST = resolve(ADDIN_DIR, 'manifest.xml');
const TUNNEL_URL_FILE = resolve(ADDIN_DIR, '.tunnel-url');
const LOCALHOST_URL = 'https://localhost:3001';
const ADDIN_PORT = 3001;

/**
 * 生成 manifest.xml（从模板替换占位符）
 */
function generateManifest(baseUrl) {
  if (!existsSync(TEMPLATE)) {
    console.log('[tunnel] 模板不存在，使用现有 manifest.xml');
    return;
  }
  let content = readFileSync(TEMPLATE, 'utf-8');
  content = content.replaceAll('{{ADDIN_BASE_URL}}', baseUrl);
  writeFileSync(MANIFEST, content, 'utf-8');
  console.log(`[tunnel] manifest.xml 已生成 (base URL: ${baseUrl})`);
}

/**
 * 降级模式：仅 localhost
 */
function startLocalhost() {
  console.log('[tunnel] 隧道不可用，降级为 localhost 模式');
  console.log('[tunnel] Excel Online 无法使用，仅支持 Excel 桌面版');
  writeFileSync(TUNNEL_URL_FILE, '');
  generateManifest(LOCALHOST_URL);
}

// ── 主流程 ──
async function main() {
  console.log('=== i-Write Add-in Tunnel ===');

  try {
    // localtunnel 是纯 JS，动态 import 避免 CI/无网络时报错
    const localtunnel = (await import('localtunnel')).default;

    console.log(`[tunnel] 正在创建隧道 (端口 ${ADDIN_PORT})...`);

    const tunnel = await localtunnel(ADDIN_PORT, { allowInvalidCert: true });

    console.log(`[tunnel] 公网 URL: ${tunnel.url}`);
    writeFileSync(TUNNEL_URL_FILE, tunnel.url + '\n');
    generateManifest(tunnel.url);

    tunnel.on('close', () => {
      console.log('[tunnel] 隧道已关闭');
      process.exit(0);
    });

    tunnel.on('error', (err) => {
      console.error('[tunnel] 隧道错误:', err.message);
    });

    // 进程保持运行
    console.log('[tunnel] 隧道运行中，按 Ctrl+C 停止');
  } catch (err) {
    console.error(`[tunnel] 启动失败: ${err.message}`);
    startLocalhost();
  }
}

main();
