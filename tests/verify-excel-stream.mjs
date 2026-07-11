/**
 * verify-excel-stream.mjs — 验证 excel-stream SSE 数据流
 *
 * 遵循 CLAUDE.md：
 * - 启动隔离服务器（不碰生产 DB）
 * - 使用 demo provider（不需要真实 API Key）
 * - 测试完成后 kill 隔离 server、删除临时目录
 */
import { spawn } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, openSync, closeSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PORT_RANGE_START = 15000;
const PORT_RANGE_SIZE = 5000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const HEALTH_CHECK_MAX_ATTEMPTS = 30;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startIsolatedServer() {
  const tmpDir = mkdtempSync(join(tmpdir(), "i-write-e2e-"));
  const dataDir = join(tmpDir, "data");
  mkdirSync(dataDir, { recursive: true });

  const port = PORT_RANGE_START + Math.floor(Math.random() * PORT_RANGE_SIZE);
  const dbPath = join(dataDir, "docstudio.db");

  // 复制生产 DB 副本（获取 settings）
  const prodDb = join(PROJECT_ROOT, "server", "data", "docstudio.db");
  if (existsSync(prodDb)) {
    const { execSync } = await import("child_process");
    execSync(`sqlite3 "${prodDb}" ".backup '${dbPath}'"`);
    console.log(`DB 复制完成`);
  }

  // 启动 server 子进程（使用 tsx 处理 TypeScript paths 映射）
  const tsxPath = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
  const serverEntry = resolve(PROJECT_ROOT, "server/src/index.ts");
  const child = spawn(process.execPath, [tsxPath, serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      DB_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: PROJECT_ROOT,
  });

  // 消费 stdout/stderr 避免阻塞，同时捕获错误
  child.stdout.on("data", (d) => {
    process.stdout.write(`[server] ${d}`);
  });
  child.stderr.on("data", (d) => {
    process.stderr.write(`[server:err] ${d}`);
  });

  const baseUrl = `http://localhost:${port}`;

  // 等待就绪
  for (let i = 0; i < HEALTH_CHECK_MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`隔离服务器就绪: ${baseUrl}`);
        return { port, baseUrl, child, tmpDir };
      }
    } catch {}
    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  child.kill("SIGKILL");
  rmSync(tmpDir, { recursive: true, force: true });
  throw new Error("隔离服务器启动失败");
}

async function cleanup(child, tmpDir) {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => { child.kill("SIGKILL"); r(); }, 3000);
      child.on("exit", () => { clearTimeout(t); r(); });
    });
  }
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("临时目录已清理");
}

async function run() {
  console.log("=== verify-excel-stream: 启动隔离服务器 ===");
  const { port, baseUrl, child, tmpDir } = await startIsolatedServer();

  let passed = 0;
  let failed = 0;

  try {
    // ── 测试 1: Demo 模式 SSE 流 ──
    console.log("\n--- 测试 1: Demo 模式 SSE 流 ---");
    const demoPayload = {
      title: "测试文档",
      userRequest: "帮我生成一份测试报告",
      outline: [
        { title: "第一章 概述", description: "整体介绍", children: [] },
        { title: "第二章 数据", description: "数据分析", children: [] },
        { title: "第三章 结论", description: "总结", children: [] },
      ],
      format: "excel",
      providerPreference: ["demo"],
    };

    const resp = await fetch(`${baseUrl}/api/generation/generate/excel-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(demoPayload),
    });

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/event-stream")) {
      console.error(`FAIL: Content-Type = ${ct}, 期望 text/event-stream`);
      failed++;
      return;
    }
    console.log(`PASS: Content-Type = ${ct}`);
    passed++;

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`FAIL: HTTP ${resp.status} - ${errText}`);
      failed++;
      return;
    }
    console.log(`PASS: HTTP ${resp.status}`);
    passed++;

    // 消费 SSE 流
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    let currentEvent = null;
    const startTime = Date.now();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log(`[reader] stream done=true, 已读 ${buffer.length} bytes 在 buffer 中`);
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push({ event: currentEvent, data });
          } catch (e) {
            console.error(`JSON 解析失败 [${currentEvent}]: ${line.slice(6).slice(0, 200)}`);
          }
          currentEvent = null;
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`SSE 流结束, 耗时 ${elapsed}ms, 收到 ${events.length} 个事件`);
    console.log(`事件类型列表: ${events.map(e => e.event).join(', ')}`);

    const eventTypes = events.map((e) => e.event);
    // 验证所有事件 JSON 数据中都包含 type 字段
    let allHaveType = true;
    for (const ev of events) {
      if (!ev.data.type) {
        console.error(`FAIL: 事件 ${ev.event} 的 JSON 数据缺少 type 字段`);
        allHaveType = false;
        failed++;
      }
    }
    if (allHaveType) { console.log(`PASS: 所有事件 JSON 数据都包含 type 字段`); passed++; }
    else { console.error(`FAIL: 部分事件 JSON 数据缺少 type 字段`); }

    // 验证 section-start 事件包含 chapter 字段
    let allSectionStartHaveChapter = true;
    for (const ev of events) {
      if (ev.event === 'section-start' && !ev.data.chapter) {
        console.error(`FAIL: section-start 事件缺少 chapter 字段`);
        allSectionStartHaveChapter = false;
        failed++;
      }
    }
    if (allSectionStartHaveChapter && sectionStarts.length > 0) { console.log(`PASS: 所有 section-start 事件都包含 chapter`); passed++; }

    if (eventTypes.includes("start")) { console.log("PASS: start 事件"); passed++; }
    else { console.error("FAIL: 缺少 start 事件"); failed++; }

    const sectionStarts = eventTypes.filter((t) => t === "section-start");
    if (sectionStarts.length >= 3) { console.log(`PASS: ${sectionStarts.length} 个 section-start`); passed++; }
    else { console.error(`FAIL: section-start = ${sectionStarts.length}, 期望 >= 3`); failed++; }

    const sections = eventTypes.filter((t) => t === "section");
    if (sections.length >= 3) { console.log(`PASS: ${sections.length} 个 section`); passed++; }
    else { console.error(`FAIL: section = ${sections.length}, 期望 >= 3`); failed++; }

    // 验证 section 事件包含 chapter 字段
    let allSectionHaveChapter = true;
    for (const ev of events) {
      if (ev.event === 'section' && !ev.data.chapter) {
        console.error(`FAIL: section 事件缺少 chapter 字段`);
        allSectionHaveChapter = false;
        failed++;
      }
    }
    if (allSectionHaveChapter && sections.length > 0) { console.log(`PASS: 所有 section 事件都包含 chapter`); passed++; }

    const doneEvent = events.find((e) => e.event === "done");
    if (doneEvent) {
      console.log("PASS: done 事件"); passed++;
      const ep = doneEvent.data.excelPayload;
      if (ep?.sheets?.length > 0) {
        console.log(`PASS: ${ep.sheets.length} 个 sheets`); passed++;
        for (const s of ep.sheets) console.log(`  - "${s.name}", ${s.paragraphs?.length ?? 0} 段落`);
      } else { console.error("FAIL: 缺少 excelPayload.sheets"); failed++; }
      if (doneEvent.data.runId) { console.log(`PASS: runId = ${doneEvent.data.runId}`); passed++; }
      else { console.error("FAIL: 缺少 runId"); failed++; }
      if (doneEvent.data.title) { console.log(`PASS: title = "${doneEvent.data.title}"`); passed++; }
      else { console.error("FAIL: 缺少 title"); failed++; }
    } else {
      console.error("FAIL: 缺少 done 事件（backpressure 死锁？）"); failed++;
    }

    // section 内容完整性
    const sectionEvents = events.filter((e) => e.event === "section");
    let allOk = true;
    for (const se of sectionEvents) {
      if (!se.data?.section?.title || !se.data?.section?.content) { allOk = false; failed++; }
    }
    if (allOk && sectionEvents.length > 0) { console.log(`PASS: 所有 section 含 title + content`); passed++; }

    // ── 测试 2: 400 Bad Request ──
    console.log("\n--- 测试 2: 400 Bad Request ---");
    const badResp = await fetch(`${baseUrl}/api/generation/generate/excel-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outline: [] }),
    });
    if (badResp.status === 400) { console.log("PASS: 缺少 title 返回 400"); passed++; }
    else { console.error(`FAIL: 缺少 title 返回 ${badResp.status}`); failed++; }

    console.log(`\n=== 测试结果: ${passed} passed, ${failed} failed ===`);
  } catch (err) {
    console.error(`测试异常: ${err.message}`);
    failed++;
  } finally {
    await cleanup(child, tmpDir);
  }

  process.exit(failed > 0 ? 1 : 0);
}

const timer = setTimeout(() => { console.error("FATAL: 超时"); process.exit(2); }, 120_000);
run().finally(() => clearTimeout(timer));

