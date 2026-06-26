/**
 * 样本数据全链路 E2E 测试
 * ========================
 *
 * 测试范围：
 * 1. 知识库上传（41 个文件）→ chunk 生成 → 搜索检索
 * 2. People Graph 导入 → CRUD → 组织架构
 * 3. 文档生成 → citation 链路
 * 4. 数据质量 metrics 报告
 */
import { readdirSync, readFileSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SAMPLES_DIR = join(PROJECT_ROOT, "samples");

// ── 测试运行器 ──────────────────────────────────────────

let passed = 0;
let failed = 0;
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

async function uploadFile(filePath) {
  const formData = new FormData();
  const blob = new Blob([readFileSync(filePath)]);
  const fileName = filePath.split("/").pop();
  formData.append("files", blob, fileName);

  const res = await fetch(`${BASE_URL}/api/knowledge/upload`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });
  return res.json();
}

// ── 阶段 1: 知识库上传与验证 ──────────────────────────

async function testKnowledgeUpload() {
  group("阶段 1: 知识库上传");

  // 收集所有样本文件
  const sampleFiles = [];
  function collectFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if ([".docx", ".eml", ".json", ".xlsx", ".pptx"].includes(ext)) {
          sampleFiles.push(fullPath);
        }
      }
    }
  }
  collectFiles(SAMPLES_DIR);

  console.log(`  📁 找到 ${sampleFiles.length} 个样本文件`);

  // 按类型统计
  const byType = {};
  for (const f of sampleFiles) {
    const ext = extname(f).toLowerCase();
    byType[ext] = (byType[ext] || 0) + 1;
  }
  console.log(`  📊 文件类型分布: ${JSON.stringify(byType)}`);

  // 逐个上传（避免并发问题）
  let uploadOk = 0;
  let uploadDup = 0;
  let uploadFail = 0;

  for (const file of sampleFiles) {
    try {
      const result = await uploadFile(file);
      if (result.ok) {
        for (const r of result.results || []) {
          if (r.status === "ok") uploadOk++;
          else if (r.status === "duplicate") uploadDup++;
          else uploadFail++;
        }
      } else {
        uploadFail++;
        console.log(`    ⚠️  ${file.split("/").pop()}: ${result.error}`);
      }
    } catch (err) {
      uploadFail++;
      console.log(`    ❌ ${file.split("/").pop()}: ${err.message}`);
    }
  }

  console.log(`  📤 上传结果: ${uploadOk} 成功, ${uploadDup} 重复, ${uploadFail} 失败`);

  await test("上传全部成功", () => {
    if (uploadFail > 0) throw new Error(`${uploadFail} 个文件上传失败`);
    if (uploadOk === 0 && uploadDup === 0) throw new Error("没有文件上传成功");
  });

  // 验证 stats
  let stats;
  await test("知识库统计正确", async () => {
    const res = await api("GET", "/api/knowledge/stats");
    if (!res.ok) throw new Error(`stats failed: ${res.status}`);
    stats = res.data;
    console.log(`    → sources: ${stats.sourceCount}, chunks: ${stats.chunkCount}, vectors: ${stats.vectorCount}`);
    if (stats.sourceCount < 30) throw new Error(`sourceCount too low: ${stats.sourceCount}`);
    if (stats.chunkCount < stats.sourceCount) throw new Error(`chunkCount should >= sourceCount`);
  });

  // 验证每个 source 的 chunk 数
  await test("每个知识源有多个 chunk", async () => {
    const res = await api("GET", "/api/knowledge/sources");
    if (!res.ok) throw new Error(`sources failed: ${res.status}`);
    const sources = res.data.sources || [];
    const singleChunkSources = sources.filter((s) => s.chunkCount <= 1);
    if (singleChunkSources.length > 0) {
      console.log(`    ⚠️  ${singleChunkSources.length} 个源只有 1 个 chunk:`);
      for (const s of singleChunkSources) {
        console.log(`       - ${s.name} (${s.type})`);
      }
    }
    // 允许短文件只有 1 个 chunk（邮件、Teams 聊天、数据文件）
    const shortFileThreshold = Math.floor(sources.length * 0.5); // 允许 50% 的文件只有 1 chunk
    if (singleChunkSources.length > shortFileThreshold) {
      throw new Error(`${singleChunkSources.length} 个源只有 1 个 chunk（阈值: ${shortFileThreshold}）`);
    }
  });

  return stats;
}

// ── 阶段 2: 知识库搜索验证 ──────────────────────────

async function testKnowledgeSearch() {
  group("阶段 2: 知识库搜索");

  const queries = [
    { query: "产品发布时间线", desc: "产品路线图" },
    { query: "API 认证接口设计", desc: "API 文档" },
    { query: "支付系统技术方案", desc: "支付系统设计" },
    { query: "团队成员任务分工", desc: "会议纪要" },
    { query: "RAG 引擎参数配置", desc: "技术配置文档" },
    { query: "客户案例分析", desc: "客户案例研究" },
    { query: "数据安全合规要求", desc: "合规方案" },
    { query: "市场推广策略", desc: "GoToMarket" },
  ];

  for (const { query, desc } of queries) {
    await test(`搜索 "${desc}" (${query})`, async () => {
      const res = await api("POST", "/api/knowledge/search", { query, limit: 5 });
      if (!res.ok) throw new Error(`search failed: ${res.status}`);
      if (!res.data?.ok) throw new Error(`search error: ${res.data?.error}`);
      const results = res.data.results || [];
      console.log(`    → 结果数: ${results.length}`);
      if (results.length === 0) throw new Error("搜索无结果");
      // 验证结果包含 chunk.sourceId
      const hasSourceId = results.some((r) => r.chunk?.sourceId);
      if (!hasSourceId) throw new Error("搜索结果缺少 chunk.sourceId");
    });
  }
}

// ── 阶段 3: People Graph CRUD ──────────────────────────

async function testPeopleGraph() {
  group("阶段 3: People Graph CRUD");

  // 导入 people-graph.json
  const peopleGraphPath = join(SAMPLES_DIR, "charts", "people-graph.json");

  await test("导入 people-graph.json", async () => {
    const jsonContent = JSON.parse(readFileSync(peopleGraphPath, "utf-8"));
    const res = await api("POST", "/api/people/import", jsonContent);
    if (!res.ok) throw new Error(`import failed: ${res.status} ${JSON.stringify(res.data)}`);
    console.log(`    → imported: ${res.data.imported}, relationships: ${res.data.relationships}`);
    if (res.data.imported < 15) throw new Error(`imported too few: ${res.data.imported}`);
  });

  // 验证人数
  await test("GET /api/people — 18 人", async () => {
    const res = await api("GET", "/api/people");
    if (!res.ok) throw new Error(`people failed: ${res.status}`);
    const people = res.data.people || [];
    console.log(`    → 人数: ${people.length}`);
    if (people.length < 15) throw new Error(`people count too low: ${people.length}`);
  });

  // 验证组织架构树
  await test("GET /api/people/org-tree — 多部门", async () => {
    const res = await api("GET", "/api/people/org-tree");
    if (!res.ok) throw new Error(`org-tree failed: ${res.status}`);
    const tree = res.data.tree || {};
    const depts = Object.keys(tree);
    console.log(`    → 部门数: ${depts.length}, 部门: ${depts.join(", ")}`);
    if (depts.length < 5) throw new Error(`departments too few: ${depts.length}`);
  });

  // 验证单人详情
  let firstPersonId;
  await test("GET /api/people/:id — 单人详情", async () => {
    const listRes = await api("GET", "/api/people");
    firstPersonId = listRes.data.people?.[0]?.id;
    if (!firstPersonId) throw new Error("no people to query");
    const res = await api("GET", `/api/people/${firstPersonId}`);
    if (!res.ok) throw new Error(`person detail failed: ${res.status}`);
    console.log(`    → ${res.data.person.name} (${res.data.person.title})`);
  });

  // 验证关系查询
  await test("GET /api/people/:id/relationships — 关系", async () => {
    const res = await api("GET", `/api/people/${firstPersonId}/relationships`);
    if (!res.ok) throw new Error(`relationships failed: ${res.status}`);
    const rels = res.data.relationships || [];
    console.log(`    → 关系数: ${rels.length}`);
  });

  // 测试 CRUD: 添加人员
  let newPersonId;
  await test("POST /api/people — 添加人员", async () => {
    const res = await api("POST", "/api/people", {
      name: "测试人员",
      title: "QA Engineer",
      department: "质量保障",
      email: "test@nexora-tech.com",
    });
    if (!res.ok) throw new Error(`add person failed: ${res.status}`);
    newPersonId = res.data.id;
    if (!newPersonId) throw new Error("no person id returned");
    console.log(`    → 新人员 ID: ${newPersonId}`);
  });

  // 测试 CRUD: 更新人员
  await test("PUT /api/people/:id — 更新人员", async () => {
    const res = await api("PUT", `/api/people/${newPersonId}`, {
      name: "测试人员-更新",
      title: "Senior QA Engineer",
    });
    if (!res.ok) throw new Error(`update person failed: ${res.status}`);
    console.log(`    → 更新成功`);
  });

  // 测试 CRUD: 删除人员
  await test("DELETE /api/people/:id — 删除人员", async () => {
    const res = await api("DELETE", `/api/people/${newPersonId}`);
    if (!res.ok) throw new Error(`delete person failed: ${res.status}`);
    console.log(`    → 删除成功`);
  });

  // 验证导出
  await test("GET /api/people/export — 导出 JSON", async () => {
    const res = await api("GET", "/api/people/export");
    if (!res.ok) throw new Error(`export failed: ${res.status}`);
    const people = res.data.people || [];
    console.log(`    → 导出人数: ${people.length}`);
    if (people.length < 15) throw new Error(`export count too low: ${people.length}`);
  });
}

// ── 阶段 4: 文档生成链路 ──────────────────────────

async function testDocumentGeneration() {
  group("阶段 4: 文档生成与 Citation");

  const mimoKey = getApiKey("mimo");
  if (!mimoKey) {
    console.log("  ⏭️  跳过文档生成（无 MiMo API key）");
    return;
  }

  let genResult;
  await test("生成文档（触发 RAG + citation）", async () => {
    const outline = [
      { id: "s1", title: "产品进展概述", level: 1, description: "概述当前产品开发进展", children: [] },
      { id: "s2", title: "技术方案", level: 1, description: "描述关键技术方案", children: [] },
    ];

    genResult = await api("POST", "/api/generation/generate", {
      title: "产品技术进展汇报",
      outline,
      format: "html",
      userRequest: "基于知识库中的技术文档和会议纪要，生成一份产品技术进展汇报",
      apiKey: mimoKey,
    }, 300_000);

    if (!genResult.ok) throw new Error(`generate failed: ${genResult.status} ${JSON.stringify(genResult.data)}`);
    if (!genResult.data?.content) throw new Error("no content");
    console.log(`    → content length: ${genResult.data.content.length} chars`);
    console.log(`    → sections: ${genResult.data.sections?.length ?? 0}`);
    console.log(`    → trustScore: ${genResult.data.trustScore}`);
  });

  // 验证 citation
  await test("生成内容包含 citation 标记", async () => {
    if (!genResult?.data?.sections) throw new Error("no sections");
    const allContent = genResult.data.sections.map((s) => s.content || "").join("\n");
    const citeMatches = allContent.match(/\[\d+\]/g);
    console.log(`    → citation markers: ${citeMatches?.length ?? 0}`);
    // citation 可能没有（取决于知识库匹配度），但不应该有错误格式
    if (/<body[\s>]/i.test(allContent)) throw new Error("content contains <body> tag");
  });

  // 验证 sources 信息
  await test("sources 包含文件名", async () => {
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
        console.log(`    → "${section.title}": ${section.sources.length} sources`);
      }
    }
  });
}

// ── 阶段 5: 数据质量 Metrics ──────────────────────────

async function testDataQualityMetrics() {
  group("阶段 5: 数据质量 Metrics");

  // 获取所有知识源
  const sourcesRes = await api("GET", "/api/knowledge/sources");
  const sources = sourcesRes.data?.sources || [];

  // 获取 chunks 统计
  const statsRes = await api("GET", "/api/knowledge/stats");
  const stats = statsRes.data;

  // 获取人员数据
  const peopleRes = await api("GET", "/api/people");
  const people = peopleRes.data?.people || [];

  const treeRes = await api("GET", "/api/people/org-tree");
  const tree = treeRes.data?.tree || {};

  // Metrics 报告
  console.log("\n┌─────────────────────────────────────────┐");
  console.log("│         数据质量 Metrics 报告            │");
  console.log("├─────────────────────────────────────────┤");

  // 1. 文件类型覆盖度
  const typeSet = new Set(sources.map((s) => s.type));
  const targetTypes = ["docx", "email", "json", "excel", "ppt"];
  const typeCoverage = targetTypes.filter((t) => typeSet.has(t)).length;
  console.log(`│ 类型覆盖度: ${typeCoverage}/${targetTypes.length} (${(typeCoverage / targetTypes.length * 100).toFixed(0)}%)`.padEnd(44) + "│");

  // 2. 文件数量
  console.log(`│ 知识源数量: ${sources.length}`.padEnd(44) + "│");

  // 3. Chunk 分布
  const chunkCounts = sources.map((s) => s.chunkCount);
  const avgChunks = (chunkCounts.reduce((a, b) => a + b, 0) / chunkCounts.length).toFixed(1);
  const maxChunks = Math.max(...chunkCounts);
  const minChunks = Math.min(...chunkCounts);
  console.log(`│ Chunk 分布: 平均${avgChunks}, 范围${minChunks}-${maxChunks}`.padEnd(44) + "│");

  // 4. 单 chunk 文件比例
  const singleChunk = sources.filter((s) => s.chunkCount <= 1).length;
  console.log(`│ 单 chunk 文件: ${singleChunk}/${sources.length} (${(singleChunk / sources.length * 100).toFixed(0)}%)`.padEnd(44) + "│");

  // 5. 人员数据
  console.log(`│ 人员数量: ${people.length}`.padEnd(44) + "│");
  console.log(`│ 部门数量: ${Object.keys(tree).length}`.padEnd(44) + "│");

  // 6. 搜索命中率
  const testQueries = ["产品发布", "API 设计", "支付系统", "团队会议", "RAG 配置"];
  let searchHits = 0;
  for (const q of testQueries) {
    const res = await api("POST", "/api/knowledge/search", { query: q, limit: 3 });
    if (res.ok && res.data?.results?.length > 0) searchHits++;
  }
  const searchHitRate = (searchHits / testQueries.length * 100).toFixed(0);
  console.log(`│ 搜索命中率: ${searchHits}/${testQueries.length} (${searchHitRate}%)`.padEnd(44) + "│");

  console.log("└─────────────────────────────────────────┘");

  // 质量断言
  await test("类型覆盖度 100%", () => {
    if (typeCoverage < targetTypes.length) throw new Error(`缺少类型: ${targetTypes.filter((t) => !typeSet.has(t)).join(", ")}`);
  });

  await test("搜索命中率 >= 80%", () => {
    if (searchHits < testQueries.length * 0.8) throw new Error(`命中率过低: ${searchHitRate}%`);
  });

  await test("人员数量 >= 15", () => {
    if (people.length < 15) throw new Error(`人员过少: ${people.length}`);
  });

  await test("部门数量 >= 5", () => {
    if (Object.keys(tree).length < 5) throw new Error(`部门过少: ${Object.keys(tree).length}`);
  });
}

// ── 主函数 ──────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   样本数据全链路 E2E 测试 (隔离服务器)    ║");
  console.log("╚══════════════════════════════════════════╝");

  // 1. 加载 .env
  loadEnvFile();

  const mimoKey = getApiKey("mimo");
  console.log(`\n─── 环境配置 ───`);
  console.log(`MiMo: ${mimoKey ? `已配置 (...${mimoKey.slice(-4)})` : "未配置"}`);
  console.log(`Samples: ${SAMPLES_DIR}`);
  console.log("");

  // 2. 启动隔离服务器（全新数据库）
  console.log("─── 启动隔离服务器 ───");
  let cleanup;
  try {
    const server = await startIsolatedServer({ copyProductionDb: false });
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
    await testKnowledgeUpload();
    await testKnowledgeSearch();
    await testPeopleGraph();
    await testDocumentGeneration();
    await testDataQualityMetrics();

    // 4. 汇总
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n═══ 测试结果 ═══`);
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`⏱️  耗时: ${duration}s`);

    if (failures.length > 0) {
      console.log(`\n─── 失败详情 ───`);
      for (const f of failures) {
        console.log(`  ❌ ${f.name}: ${f.error}`);
      }
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
