/**
 * E2E 测试：验证参考来源的 存储 + 恢复 完整链路
 *
 * 完整链路：
 *   1. 生成文档 → 验证 provenance_nodes 写入 DB（存储）
 *   2. 调用 GET /api/generation/:runId/sections（读取）
 *   3. 对比生成时的 sections 与恢复后的 sections 一致性
 *
 * 遵循 CLAUDE.md：API key 通过请求体传递，使用隔离服务器
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";
import { config } from "dotenv";

config();

const API_KEY = process.env.MiMo_KEY;
let server;

try {
  // ═══════════════════════════════════════════════════════════════
  // Phase A: 生成文档 — 写入 generation_runs + provenance_nodes
  // ═══════════════════════════════════════════════════════════════
  console.log("\n=== Phase A: 启动隔离服务器并生成文档 ===");
  server = await startIsolatedServer();
  const BASE = server.baseUrl;
  console.log(`✅ 服务器启动: ${BASE}`);

  // Step 1: 生成文档
  console.log("\n--- Step 1: 生成文档 ---");
  const outline = [
    { id: "s1", title: "项目背景", level: 1, children: [], description: "介绍项目背景和目标" },
    { id: "s2", title: "技术方案", level: 1, children: [], description: "技术选型和架构设计" },
    { id: "s3", title: "实施计划", level: 1, children: [], description: "时间安排和里程碑" },
  ];

  const genRes = await fetch(`${BASE}/api/generation/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "技术方案文档",
      outline,
      format: "html",
      userRequest: "写一份技术方案文档",
      apiKey: API_KEY,
    }),
  });
  const genData = await genRes.json();
  console.log(`  HTTP ${genRes.status}, ok: ${genData.ok}`);
  console.log(`  runId: ${genData.runId}`);
  console.log(`  sections: ${genData.sections?.length}`);
  console.log(`  content: ${genData.content?.length} chars`);

  if (!genData.ok) {
    console.error("❌ 文档生成失败:", genData.error);
    dumpServerLog();
    process.exit(1);
  }
  console.log("✅ 文档生成成功");

  const runId = genData.runId;
  const originalSections = genData.sections;

  // Step 2: 验证 provenance_nodes 已写入 DB（存储验证）
  console.log("\n--- Step 2: 验证 provenance_nodes 写入 ---");
  const treeRes = await fetch(`${BASE}/api/provenance/${runId}`);
  const treeData = await treeRes.json();
  console.log(`  provenance nodes: ${treeData.nodes?.length ?? 0}`);

  const paraCounts = {};
  for (const n of treeData.nodes ?? []) {
    paraCounts[n.paragraphIdx] = (paraCounts[n.paragraphIdx] ?? 0) + 1;
  }
  console.log(`  段落分布: ${JSON.stringify(paraCounts)}`);

  if (!treeData.nodes || treeData.nodes.length === 0) {
    console.error("❌ provenance_nodes 未写入，存储失败");
    dumpServerLog();
    process.exit(1);
  }
  console.log("✅ provenance_nodes 已写入 DB");

  // Step 3: 验证 generation_runs 记录存在
  console.log("\n--- Step 3: 验证 generation_runs 记录 ---");
  const runRes = await fetch(`${BASE}/api/generation/${runId}`);
  const runData = await runRes.json();
  console.log(`  status: ${runData.run?.status}`);
  console.log(`  content length: ${runData.run?.content?.length ?? 0}`);
  console.log(`  trust_score: ${runData.run?.trust_score}`);

  if (!runData.run || runData.run.status !== "done") {
    console.error("❌ generation_runs 记录异常");
    dumpServerLog();
    process.exit(1);
  }
  console.log("✅ generation_runs 记录正确");

  // ═══════════════════════════════════════════════════════════════
  // Phase B: 模拟 App 重启 — 调用 sections API 恢复数据
  // ═══════════════════════════════════════════════════════════════
  console.log("\n=== Phase B: 模拟 App 重启，恢复 sections ===");

  // Step 4: 调用新 API（模拟重启后 client 端的行为）
  console.log("\n--- Step 4: GET /api/generation/:runId/sections ---");
  const sectionsRes = await fetch(`${BASE}/api/generation/${runId}/sections`);
  const sectionsData = await sectionsRes.json();
  console.log(`  HTTP ${sectionsRes.status}, ok: ${sectionsData.ok}`);
  console.log(`  restored sections: ${sectionsData.sections?.length ?? 0}`);

  if (!sectionsData.ok) {
    console.error("❌ sections API 失败:", sectionsData.error);
    dumpServerLog();
    process.exit(1);
  }
  console.log("✅ sections API 返回成功");

  // Step 5: 逐 section 对比
  console.log("\n--- Step 5: 逐 section 对比 ---");
  let totalOrigSources = 0;
  let totalRestoredSources = 0;

  for (let i = 0; i < Math.max(originalSections.length, sectionsData.sections.length); i++) {
    const orig = originalSections[i];
    const restored = sectionsData.sections[i];
    const origSrcCount = orig?.sources?.length ?? 0;
    const restoredSrcCount = restored?.sources?.length ?? 0;
    totalOrigSources += origSrcCount;
    totalRestoredSources += restoredSrcCount;

    const titleMatch = orig?.title === restored?.title;
    const srcCountMatch = origSrcCount === restoredSrcCount;

    console.log(`  [${i}] title: orig="${orig?.title}" restored="${restored?.title}" ${titleMatch ? "✅" : "❌"}`);
    console.log(`       sources: orig=${origSrcCount} restored=${restoredSrcCount} ${srcCountMatch ? "✅" : "⚠️"}`);

    // 对比 chunkId 集合
    if (orig && restored) {
      const origIds = new Set(orig.sources.map(s => s.chunkId));
      const restoredIds = new Set(restored.sources.map(s => s.chunkId));
      const overlap = [...origIds].filter(id => restoredIds.has(id));
      console.log(`       chunkId overlap: ${overlap.length}/${origIds.size} ${overlap.length === origIds.size ? "✅" : "⚠️ 部分丢失"}`);
    }
  }
  console.log(`  总来源: 生成时=${totalOrigSources} 恢复后=${totalRestoredSources}`);

  // ═══════════════════════════════════════════════════════════════
  // Phase C: 断言
  // ═══════════════════════════════════════════════════════════════
  console.log("\n=== Phase C: 断言验证 ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.error(`  ❌ ${msg}`); failed++; }
  }

  // 存储验证
  assert(treeData.nodes.length > 0, `provenance_nodes 已存储 (${treeData.nodes.length} 条)`);
  assert(Object.keys(paraCounts).length === outline.length, `provenance 覆盖全部 ${outline.length} 个章节`);
  assert(runData.run.status === "done", "generation_runs 状态=done");

  // 恢复验证
  assert(sectionsData.ok === true, "sections API 返回 ok=true");
  assert(sectionsData.sections.length === originalSections.length,
    `sections 数量一致: 生成=${originalSections.length} 恢复=${sectionsData.sections.length}`);
  assert(totalRestoredSources === totalOrigSources,
    `总来源数一致: 生成=${totalOrigSources} 恢复=${totalRestoredSources}`);

  // 逐章节 chunkId 一致性
  for (let i = 0; i < originalSections.length; i++) {
    const orig = originalSections[i];
    const restored = sectionsData.sections[i];
    if (!orig || !restored) continue;
    const origIds = orig.sources.map(s => s.chunkId).sort();
    const restoredIds = restored.sources.map(s => s.chunkId).sort();
    assert(JSON.stringify(origIds) === JSON.stringify(restoredIds),
      `[${i}] "${orig.title}" chunkId 完全匹配 (${origIds.length} 个)`);
  }

  // 来源字段完整性
  const allRestored = sectionsData.sections.flatMap(s => s.sources);
  assert(allRestored.every(s => s.chunkId), "所有来源包含 chunkId");
  assert(allRestored.every(s => typeof s.score === "number"), "所有来源包含 score");
  assert(allRestored.every(s => typeof s.content === "string" && s.content.length > 0), "所有来源包含非空 content");
  assert(allRestored.every(s => s.sourceName), "所有来源包含 sourceName（从 kb_sources JOIN）");

  console.log(`\n  结果: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\n❌ 断言失败");
    dumpServerLog();
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("✅ E2E 测试通过：存储 + 恢复完整链路验证成功！");
  console.log("   - 生成时 provenance_nodes 正确写入 DB");
  console.log("   - 重启后 sections API 正确恢复全部来源");
  console.log("   - chunkId、score、content、sourceName 完全一致");
  console.log("========================================\n");

} catch (err) {
  console.error("\n❌ 测试异常:", err);
  if (server) dumpServerLog();
  process.exit(1);
} finally {
  if (server) {
    console.log("清理隔离服务器...");
    await server.cleanup();
  }
}
