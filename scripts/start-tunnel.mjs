#!/usr/bin/env node

/**
 * start-tunnel.mjs — 为 Excel Add-in 启动公网隧道
 *
 * 使用 Microsoft Dev Tunnels（持久化隧道 iwrite-addin，URL 固定 30 天）。
 * Excel Online 在云端运行，iframe 无法访问 localhost，必须通过隧道。
 *
 * 前置步骤（只需一次）：
 *   devtunnel user login
 *   devtunnel create iwrite-addin --description "i-Write Excel Add-in"
 *   devtunnel port create iwrite-addin -p 3001
 *
 * 输出：
 *   office-addin/.tunnel-url  — 公网 URL
 *   office-addin/manifest.xml  — 从模板生成（替换 {{ADDIN_BASE_URL}}）
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const TUNNEL_NAME = 'iwrite-addin';

const DEV_TUNNEL_EXTRACT_DIR = '/tmp/devtunnel_extract';

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

function startLocalhost() {
  console.log('[tunnel] 隧道不可用，降级为 localhost 模式');
  console.log('[tunnel] Excel Online 无法使用，仅支持 Excel 桌面版');
  writeFileSync(TUNNEL_URL_FILE, '');
  generateManifest(LOCALHOST_URL);
}

async function main() {
  console.log('=== i-Write Add-in Tunnel ===');

  mkdirSync(DEV_TUNNEL_EXTRACT_DIR, { recursive: true });
  const env = {
    ...process.env,
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: DEV_TUNNEL_EXTRACT_DIR,
  };

  try {
    // 尝试启动持久化隧道 iwrite-addin
    const args = ['host', TUNNEL_NAME, '--allow-anonymous'];
    console.log(`[tunnel] 启动 Dev Tunnels: devtunnel ${args.join(' ')}`);

    const child = spawn('devtunnel', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let resolved = false;

    function tryResolveUrl(text) {
      if (resolved) return;
      const matches = text.match(/https:\/\/[a-zA-Z0-9.-]+\.devtunnels\.ms/g);
      if (!matches) return;
      const candidates = matches.filter(u => !u.includes('-inspect.'));
      if (candidates.length === 0) return;
      const url = candidates.reduce((a, b) => a.length > b.length ? a : b);
      resolved = true;
      console.log(`[tunnel] Dev Tunnels 公网 URL: ${url}`);
      writeFileSync(TUNNEL_URL_FILE, url + '\n');
      generateManifest(url);
    }

    child.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(text.trimEnd());
      tryResolveUrl(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      console.error(text.trimEnd());
      tryResolveUrl(text);
    });

    child.on('error', (err) => {
      console.error(`[tunnel] devtunnel 错误: ${err.message}`);
    });

    child.on('close', (code) => {
      console.log(`[tunnel] devtunnel 退出，code=${code}`);
      if (code !== 0) {
        console.log('[tunnel] 隧道异常退出，10秒后尝试重启...');
        setTimeout(() => main(), 10_000);
      }
    });

    // 超时 60 秒未解析到 URL
    setTimeout(() => {
      if (!resolved) {
        console.error('[tunnel] 60 秒内未获取到隧道 URL');
        child.kill();
      }
    }, 60_000);
  } catch (err) {
    console.error(`[tunnel] 启动失败: ${err.message}`);
    if (err.message.includes('login') || err.message.includes('auth')) {
      console.error('[tunnel] 请先登录: devtunnel user login');
    }
    startLocalhost();
  }
}

main();
