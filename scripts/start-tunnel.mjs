#!/usr/bin/env node

/**
 * start-tunnel.mjs — 为 Add-in 启动公网隧道
 *
 * 使用 Microsoft Dev Tunnels（持久化隧道 iwrite-addin，URL 固定 30 天）。
 * Excel/Word Online 在云端运行，iframe 无法访问 localhost，必须通过隧道。
 *
 * 隧道端口映射：
 *   3001 → Excel Add-in (office-addin)
 *   3002 → Word Add-in (word-addin)
 *   3003 → PowerPoint Add-in (ppt-addin)
 *
 * 前置步骤（只需一次）：
 *   devtunnel user login
 *   devtunnel create iwrite-addin --description "i-Write Add-ins"
 *   devtunnel port create iwrite-addin -p 3001
 *   devtunnel port create iwrite-addin -p 3002
 *   devtunnel port create iwrite-addin -p 3003
 *
 * 输出：
 *   office-addin/.tunnel-url + manifest.xml（端口 3001）
 *   word-addin/.tunnel-url + manifest.xml（端口 3002）
 *   ppt-addin/.tunnel-url + manifest.xml（端口 3003）
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ADDINS = [
  {
    name: 'Excel',
    dir: resolve(ROOT, 'office-addin'),
    port: 3001,
    localhostUrl: 'https://localhost:3001',
  },
  {
    name: 'Word',
    dir: resolve(ROOT, 'word-addin'),
    port: 3002,
    localhostUrl: 'https://localhost:3002',
  },
  {
    name: 'PowerPoint',
    dir: resolve(ROOT, 'ppt-addin'),
    port: 3003,
    localhostUrl: 'https://localhost:3003',
  },
];

const TUNNEL_NAME = 'iwrite-addin';
const DEV_TUNNEL_EXTRACT_DIR = '/tmp/devtunnel_extract';

function generateManifest(addin, baseUrl) {
  const TEMPLATE = resolve(addin.dir, 'manifest.xml.template');
  const MANIFEST = resolve(addin.dir, 'manifest.xml');
  const TUNNEL_URL_FILE = resolve(addin.dir, '.tunnel-url');

  if (!existsSync(TEMPLATE)) {
    console.log(`[tunnel] ${addin.name}: 模板不存在，使用现有 manifest.xml`);
    return;
  }
  let content = readFileSync(TEMPLATE, 'utf-8');
  content = content.replaceAll('{{ADDIN_BASE_URL}}', baseUrl);
  writeFileSync(MANIFEST, content, 'utf-8');
  console.log(`[tunnel] ${addin.name}: manifest.xml 已生成 (base URL: ${baseUrl})`);

  // 写入 tunnel URL 文件
  writeFileSync(TUNNEL_URL_FILE, baseUrl + '\n');
}

function startLocalhost() {
  console.log('[tunnel] 隧道不可用，降级为 localhost 模式');
  console.log('[tunnel] Online 无法使用，仅支持桌面版');
  for (const addin of ADDINS) {
    generateManifest(addin, addin.localhostUrl);
  }
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
      // devtunnel 输出格式：
      //   Connect via browser: https://g5jbt6lx.use.devtunnels.ms:3001, https://g5jbt6lx-3001.use.devtunnels.ms
      // 端口 URL 格式: {tunnel-name}-{port}.use.devtunnels.ms
      // 需要从中提取 tunnel name，再为每个 add-in 构造正确的端口 URL
      const portUrlMatch = text.match(/https:\/\/([a-zA-Z0-9]+)-(\d+)\.use\.devtunnels\.ms/);
      if (!portUrlMatch) return;
      const tunnelName = portUrlMatch[1];
      const suffix = '.use.devtunnels.ms';
      resolved = true;
      console.log(`[tunnel] Dev Tunnels tunnel name: ${tunnelName}`);

      // 为每个 add-in 生成 manifest
      for (const addin of ADDINS) {
        const addinUrl = `https://${tunnelName}-${addin.port}${suffix}`;
        generateManifest(addin, addinUrl);
      }
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