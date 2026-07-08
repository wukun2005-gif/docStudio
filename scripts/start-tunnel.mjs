#!/usr/bin/env node

/**
 * start-tunnel.mjs — 为 Excel Add-in 启动公网隧道
 *
 * 优先使用 Microsoft Dev Tunnels（免费、无广告、微软官方），
 * 不可用时降级为 localhost-only 模式。
 *
 * 输出文件：
 *   office-addin/.tunnel-url  — 公网 URL（localhost 模式为空）
 *   office-addin/manifest.xml  — 从模板生成（替换 {{ADDIN_BASE_URL}}）
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDIN_DIR = resolve(__dirname, '..', 'office-addin');
const TEMPLATE = resolve(ADDIN_DIR, 'manifest.xml.template');
const MANIFEST = resolve(ADDIN_DIR, 'manifest.xml');
const TUNNEL_URL_FILE = resolve(ADDIN_DIR, '.tunnel-url');
const LOCALHOST_URL = 'https://localhost:3001';
const ADDIN_PORT = 3001;

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成 manifest.xml（从模板替换占位符）
 */
function generateManifest(baseUrl) {
  if (!existsSync(TEMPLATE)) {
    // 没有模板就用当前 manifest（兼容旧流程）
    console.log('[tunnel] 模板不存在，使用现有 manifest.xml');
    return;
  }
  let content = readFileSync(TEMPLATE, 'utf-8');
  content = content.replaceAll('{{ADDIN_BASE_URL}}', baseUrl);
  writeFileSync(MANIFEST, content, 'utf-8');
  console.log(`[tunnel] manifest.xml 已生成 (base URL: ${baseUrl})`);
}

/**
 * 启动 Dev Tunnels
 * devtunnel host -p 3001 --allow-anonymous
 * 成功后输出类似: https://abc123.usw2.devtunnels.ms
 */
function startDevTunnel() {
  return new Promise((resolveUrl, reject) => {
    const args = ['host', '-p', String(ADDIN_PORT), '--allow-anonymous'];
    console.log(`[tunnel] 启动 Dev Tunnels: devtunnel ${args.join(' ')}`);

    const child = spawn('devtunnel', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    let error = '';
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // 解析隧道 URL
      const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.devtunnels\.ms/);
      if (match) {
        const url = match[0];
        console.log(`[tunnel] Dev Tunnels URL: ${url}`);
        writeFileSync(TUNNEL_URL_FILE, url + '\n');
        generateManifest(url);
        resolveUrl(url);
      }
    });

    child.stderr.on('data', (data) => {
      error += data.toString();
    });

    // 超时 30 秒
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Dev Tunnels 启动超时（30s）'));
    }, 30_000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !output.includes('devtunnels.ms')) {
        reject(new Error(`devtunnel 退出码 ${code}: ${error || output}`));
      }
    });
  });
}

/**
 * 降级模式：仅 localhost
 */
function startLocalhost() {
  console.log('[tunnel] Dev Tunnels / ngrok 均不可用，降级为 localhost 模式');
  console.log('[tunnel] ⚠️  Excel Online 无法使用，仅支持 Excel 桌面版');
  console.log('[tunnel] 安装 Dev Tunnels: brew install --cask devtunnel');
  writeFileSync(TUNNEL_URL_FILE, '');
  generateManifest(LOCALHOST_URL);
}

// ── 主流程 ──
async function main() {
  console.log('=== i-Write Add-in Tunnel ===');

  if (hasCommand('devtunnel')) {
    try {
      await startDevTunnel();
      return; // 成功启动隧道，进程保持运行
    } catch (err) {
      console.warn(`[tunnel] Dev Tunnels 启动失败: ${err.message}`);
      console.log('[tunnel] 降级为 localhost 模式');
    }
  }

  // 没有找到 devtunnel 或启动失败
  startLocalhost();
}

main().catch((err) => {
  console.error('[tunnel] 致命错误:', err);
  startLocalhost();
});
