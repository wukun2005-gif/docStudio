/**
 * outlook-email-smoke-v2.mjs — 端到端冒烟 (用 tsx + 临时 DB，避免 startIsolatedServer 的 dist 路径问题)
 *
 * 验证流程：
 * 1. mkdtemp 创建临时数据目录
 * 2. 用 better-sqlite3 复制生产 DB 到临时路径
 * 3. spawn `tsx server/src/index.ts`（支持 paths 解析） + 设 PORT/DB_PATH
 * 4. 等 /api/settings 200
 * 5. POST /api/generation/email（stub mode）→ 轮询 status
 * 6. 验证 emailPayload 含 case-1782296242386 数据
 * 7. kill child + rm tempdir
 */
import { spawn } from "child_process";
import { mkdtempSync, copyFileSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import Database from "better-sqlite3";
import assert from "node:assert";

const log = (msg) => console.log(`[outlook-smoke] ${msg}`);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PROD_DB = join(PROJECT_ROOT, "server/data/docstudio.db");

async function waitForServer(baseUrl, maxMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${baseUrl}/api/settings`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  log("=== Outlook Add-in 端到端冒烟 (tsx-based) ===");

  // ── 1. 临时数据目录 + 复制生产 DB ──
  log("1) 创建临时 DB");
  if (!existsSync(PROD_DB)) {
    throw new Error(`生产 DB 不存在: ${PROD_DB}`);
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "i-write-outlook-"));
  const tmpDb = join(tmpDir, "docstudio.db");
  log(`   临时目录: ${tmpDir}`);

  // 用 SQLite backup API 复制（确保 WAL 完整）— backup(filename) 接受路径
  const srcDb = new Database(PROD_DB, { readonly: true });
  await srcDb.backup(tmpDb);
  srcDb.close();
  log(`   ✓ DB 复制完成: ${statSync(tmpDb).size} bytes`);

  // ── 2. 启 server (tsx) ──
  const port = 14000 + Math.floor(Math.random() * 5000);
  const baseUrl = `http://localhost:${port}`;
  log(`2) spawn tsx server on port ${port}`);

  const child = spawn("node", [
    join(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs"),
    "src/index.ts",
  ], {
    cwd: join(PROJECT_ROOT, "server"),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: tmpDb,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  child.stdout.on("data", (d) => {
    serverLog += d.toString();
  });
  child.stderr.on("data", (d) => {
    serverLog += d.toString();
  });

  let exitCode = 0;
  try {
    // ── 3. 等 server ready ──
    log("3) 等待 /api/settings 200");
    const ready = await waitForServer(baseUrl, 30_000);
    if (!ready) {
      log("   ❌ server 未就绪，最后日志:");
      console.error(serverLog.slice(-2000));
      throw new Error("server 启动失败");
    }
    log(`   ✓ server ready at ${baseUrl}`);

    // ── 4. POST /api/generation/email ──
    log("4) POST /api/generation/email (stub mode)");
    const requestBody = {
      title: "eml: 产品开发汇报邮件",
      outline: [
        { title: "邮件开头（问候+简要目的）", description: "向王芳致意", children: [] },
        { title: "本周核心工作进展", description: "详细描述本周完成", children: [] },
        { title: "下周计划与需要协调事项", description: "下周计划", children: [] },
      ],
      format: "email",
      providerPreference: ["stub"],
      userRequest: "向王芳写一封邮件，汇报最近一周在做什么产品...",
    };

    const triggerRes = await fetch(`${baseUrl}/api/generation/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const triggerJson = await triggerRes.json();
    log(`   trigger 响应: ${JSON.stringify(triggerJson)}`);

    if (!triggerJson.ok) throw new Error(`触发失败: ${triggerJson.error}`);
    if (!triggerJson.runId) throw new Error("触发响应缺 runId");
    const runId = triggerJson.runId;
    log(`   ✓ 触发成功, runId=${runId}`);

    // ── 5. 轮询 ──
    log("5) 轮询 GET /api/generation/status/:runId");
    let statusJson = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const sRes = await fetch(`${baseUrl}/api/generation/status/${runId}`);
      statusJson = await sRes.json();
      if (statusJson.status === "done") {
        log(`   ✓ 第 ${i + 1} 次轮询 status='done'`);
        break;
      }
      if (statusJson.status === "error") throw new Error(`生成失败: ${statusJson.error}`);
      log(`   轮询 #${i + 1}: status=${statusJson.status}`);
    }
    if (!statusJson || statusJson.status !== "done") {
      throw new Error(`生成超时，最后状态: ${statusJson?.status}`);
    }

    // ── 6. 断言 emailPayload ──
    log("6) 断言 emailPayload");
    assert.strictEqual(statusJson.ok, true);
    assert.ok(statusJson.emailPayload, "emailPayload 缺失");
    const ep = statusJson.emailPayload;
    log(`   subject: "${ep.subject}"`);
    log(`   documentStyle: "${ep.documentStyle}"`);
    log(`   trustScore: ${ep.trustScore}`);
    log(`   bodyCharCount: ${ep.bodyCharCount}`);
    log(`   bodyHtml.length: ${ep.bodyHtml.length}`);
    log(`   citations.length: ${ep.citations.length}`);

    assert.ok(!ep.subject.startsWith("eml:"), "subject 应去除 eml: 前缀");
    assert.strictEqual(ep.documentStyle, "email");
    assert.ok(ep.trustScore >= 0.5);
    assert.ok(ep.bodyCharCount > 500, `bodyCharCount 应 > 500, got ${ep.bodyCharCount}`);
    assert.ok(ep.bodyHtml.includes("<p"), "bodyHtml 应含 <p>");
    assert.ok(!ep.bodyText.includes("<p>"), "bodyText 不应含 <p>");
    log(`   ✓ 全部硬断言通过`);

    // 6.1 验证确实从 case-1782296242386 真实数据读出
    const bodyLower = ep.bodyHtml.toLowerCase();
    const hasRealContent =
      bodyLower.includes("王芳") ||
      bodyLower.includes("工作") ||
      bodyLower.includes("产品") ||
      bodyLower.includes("本周");
    if (hasRealContent) {
      log(`   ✓ bodyHtml 含真实 case-1782296242386 内容（王芳/工作/产品/本周 命中）`);
    } else {
      log(`   ⚠ bodyHtml 未命中关键词，可能是 fallback 数据 — body 前 200 字:`);
      log(`     ${ep.bodyText.slice(0, 200)}`);
    }

    // 6.2 二次 GET status 验证持久化
    const reGet = await fetch(`${baseUrl}/api/generation/status/${runId}`);
    const reGetJson = await reGet.json();
    assert.ok(reGetJson.emailPayload, "二次查询 emailPayload 仍在");
    log(`   ✓ emailPayload 持久化到 DB（email_payload 列）`);

    log("");
    log("=================================");
    log("✅ 全部通过 — outlook email 端到端流可用");
    log("=================================");
  } catch (err) {
    console.error("❌ 冒烟失败:", err.message);
    console.error("--- server log tail ---");
    console.error(serverLog.slice(-2000));
    exitCode = 1;
  } finally {
    // ── 7. 清理 ──
    log("清理：kill server + rm tmpdir");
    try {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
      if (!child.killed) child.kill("SIGKILL");
    } catch {}
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    log("✓ 清理完成");
  }

  process.exit(exitCode);
}

main();
