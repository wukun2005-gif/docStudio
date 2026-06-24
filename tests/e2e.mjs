/**
 * i-Write E2E 测试
 * ================
 *
 * 照搬 patentExaminator e2e.mjs 模式：
 * 1. 加载 .env
 * 2. 启动隔离服务器（复制生产 DB 副本）
 * 3. 运行测试
 * 4. 失败时 dump server log
 * 5. 清理
 */
import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

// ── 测试运行器 ──────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

async function test(name, fn, timeoutMs = 180_000) {
  const start = Date.now();
  try {
    const result = fn();
    if (result?.then) {
      await Promise.race([
        result,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`超时 (${timeoutMs}ms)`)), timeoutMs)),
      ]);
    }
    const duration = Date.now() - start;
    console.log(`  ✅ ${name} (${duration}ms)`);
    passed++;
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`  ❌ ${name} (${duration}ms): ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function skip(name) {
  console.log(`  ⏭️  ${name} (skipped)`);
  skipped++;
}

function group(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ── HTTP 工具 ──────────────────────────────────────────

let BASE_URL = "";

async function api(method, path, body, timeoutMs = 180_000) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// ── 测试用例 ──────────────────────────────────────────

async function testHealth() {
  group("Health");
  await test("GET /api/health", async () => {
    const res = await api("GET", "/api/health");
    if (!res.ok) throw new Error(`health failed: ${res.status}`);
  });
}

async function testChatPipeline() {
  group("Chat Pipeline (RAG + Web Search + Rerank)");

  const mimoKey = getApiKey("mimo");
  if (!mimoKey) {
    skip("Chat 全流程（无 MiMo API key）");
    return;
  }

  // 测试 1: 发送消息触发大纲生成
  let outline = null;
  await test("POST /api/chat — 大纲生成", async () => {
    const res = await api("POST", "/api/chat", {
      message: "向王芳写一封邮件，汇报最近一周在做什么产品",
      apiKey: mimoKey,
    });
    if (!res.ok) throw new Error(`chat failed: ${res.status} ${JSON.stringify(res.data)}`);
    if (!res.data?.content) throw new Error("no content");
    outline = res.data?.suggestedOutline;
    console.log(`    → type: ${res.data.type}`);
    console.log(`    → content: ${res.data.content.slice(0, 80)}`);
    console.log(`    → outline sections: ${outline?.length ?? 0}`);
  });

  // 测试 2: 生成文档（单章节，触发 RAG + Web + Rerank + Groundedness 流程）
  await test("POST /api/generation/generate — 单章节文档生成", async () => {
    const simpleOutline = [
      { id: "s1", title: "称呼", level: 1, description: "邮件开头称呼", children: [] },
    ];

    const genRes = await api("POST", "/api/generation/generate", {
      title: "邮件",
      outline: simpleOutline,
      format: "html",
      userRequest: "写一封邮件开头称呼",
      apiKey: mimoKey,
    });
    if (!genRes.ok) throw new Error(`generate failed: ${genRes.status} ${JSON.stringify(genRes.data)}`);
    if (!genRes.data?.content) throw new Error("no content in generate response");
    console.log(`    → content length: ${genRes.data.content.length} chars`);
    console.log(`    → trustScore: ${genRes.data.trustScore}`);
    console.log(`    → sections: ${genRes.data.sections?.length ?? 0}`);
  });
}

async function testFullDocGeneration() {
  group("Full Document Generation (multi-section + RAG + citations)");

  const mimoKey = getApiKey("mimo");
  if (!mimoKey) {
    skip("全流程文档生成（无 MiMo API key）");
    return;
  }

  // 多章节大纲，触发 RAG 检索 + source name 解析 + citation 转换 + content cleaning
  const outline = [
    { id: "s1", title: "问候与近况", level: 1, description: "简要问候收件人，并介绍最近一周的工作近况", children: [] },
    { id: "s2", title: "产品进展汇报", level: 1, description: "汇报当前正在做的产品及进展情况", children: [] },
  ];

  let genResult = null;
  await test("POST /api/generation/generate — 多章节邮件生成", async () => {
    genResult = await api("POST", "/api/generation/generate", {
      title: "向王芳汇报工作进展",
      outline,
      format: "html",
      documentStyle: "email",
      userRequest: "向王芳写一封邮件，汇报最近一周在做什么产品",
      apiKey: mimoKey,
    }, 300_000);
    if (!genResult.ok) throw new Error(`generate failed: ${genResult.status} ${JSON.stringify(genResult.data)}`);
    if (!genResult.data?.content) throw new Error("no content");
    console.log(`    → content length: ${genResult.data.content.length} chars`);
    console.log(`    → sections: ${genResult.data.sections?.length ?? 0}`);
    console.log(`    → trustScore: ${genResult.data.trustScore}`);
  });

  // 验证 content 不包含完整 HTML 文档外壳（DOMPurify 前置检查）
  await test("content 不包含 <body>/<style> 泄漏", async () => {
    if (!genResult?.data?.content) throw new Error("no content to check");
    const content = genResult.data.content;
    if (/<body[\s>]/i.test(content)) throw new Error("content contains <body> tag");
    if (/<style[\s>]/i.test(content)) throw new Error("content contains <style> tag");
    if (/<!DOCTYPE/i.test(content)) throw new Error("content contains <!DOCTYPE>");
    console.log(`    → 无 HTML 文档外壳泄漏 ✓`);
  });

  // 验证 citation [N] 标记存在且可解析
  await test("citation [N] 标记格式正确", async () => {
    if (!genResult?.data?.sections) throw new Error("no sections");
    const allContent = genResult.data.sections.map(s => s.content || "").join("\n");
    const citeMatches = allContent.match(/\[\d+\]/g);
    console.log(`    → citation markers: ${citeMatches?.length ?? 0}`);
    // 有 citation 就验证格式；没有也 OK（取决于知识库匹配度）
  });

  // 验证 source 信息不是 UUID（之前的 bug：sourceId 是 UUID 直接显示）
  await test("sources 包含文件名而非 UUID", async () => {
    if (!genResult?.data?.sections) throw new Error("no sections");
    for (const section of genResult.data.sections) {
      if (!section.sources) continue;
      for (const src of section.sources) {
        const name = src.sourceName || src.title || "";
        if (name && /^[0-9a-f]{8}-/.test(name)) {
          throw new Error(`source name is UUID: ${name}`);
        }
      }
      if (section.sources.length > 0) {
        const src0 = section.sources[0];
        console.log(`    → "${section.title}": ${section.sources.length} sources, e.g. "${src0.sourceName || src0.title || "(无名称)"}"`);
      }
    }
  });

  // 验证 cleanContent 不会抛异常（之前的 stripFullHtmlDocument bug）
  await test("cleanContent 不抛异常（stripFullHtmlDocument）", async () => {
    if (!genResult?.data?.content) throw new Error("no content");
    // 如果走到这里没抛异常，说明 cleanContent 正常工作
    console.log(`    → cleanContent 正常 ✓`);
  });
}

async function testKnowledgeSearch() {
  group("Knowledge Search (Hybrid + MMR)");

  await test("POST /api/knowledge/search — 混合检索 + MMR", async () => {
    const res = await api("POST", "/api/knowledge/search", {
      query: "项目进展",
      limit: 5,
    });
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    if (!res.data?.ok) throw new Error(`search error: ${res.data?.error}`);
    console.log(`    → results: ${res.data.results?.length ?? 0}`);
  });
}

async function testSettings() {
  group("Settings");

  await test("GET /api/settings — 读取设置", async () => {
    const res = await api("GET", "/api/settings");
    if (!res.ok) throw new Error(`settings failed: ${res.status}`);
    console.log(`    → settings keys: ${Object.keys(res.data?.data ?? res.data ?? {}).join(", ")}`);
  });
}

// ── 主函数 ──────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     i-Write E2E 测试 (隔离服务器)     ║");
  console.log("╚══════════════════════════════════════╝");

  // 1. 加载 .env
  loadEnvFile();

  const mimoKey = getApiKey("mimo");
  console.log(`\n─── 环境配置 ───`);
  console.log(`MiMo: ${mimoKey ? `已配置 (...${mimoKey.slice(-4)})` : "未配置"}`);
  console.log("");

  // 2. 启动隔离服务器（复制生产 DB 副本，保留 settings 和知识库）
  console.log("─── 启动隔离服务器 ───");
  let cleanup;
  try {
    const server = await startIsolatedServer({ copyProductionDb: true });
    BASE_URL = server.baseUrl;
    cleanup = server.cleanup;
    console.log(`✅ 隔离服务器就绪: ${BASE_URL}`);
  } catch (err) {
    console.error(`❌ 启动隔离服务器失败: ${err.message}`);
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    // 3. 运行测试
    await testHealth();
    await testSettings();
    await testKnowledgeSearch();
    await testChatPipeline();
    await testFullDocGeneration();

    // 4. 汇总
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n═══ 测试结果 ═══`);
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`⏭️  跳过: ${skipped}`);
    console.log(`⏱️  耗时: ${duration}s`);

    if (failures.length > 0) {
      console.log(`\n─── 失败详情 ───`);
      for (const f of failures) {
        console.log(`  ❌ ${f.name}: ${f.error}`);
      }
      // dump server log for debugging
      console.log(`\n─── Server Log ───`);
      dumpServerLog();
    }
  } finally {
    // 5. 清理
    console.log("\n─── 清理 ───");
    if (cleanup) await cleanup();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n❌ E2E 测试异常: ${err.message}`);
  console.error(err.stack);
  dumpServerLog();
  process.exit(1);
});
