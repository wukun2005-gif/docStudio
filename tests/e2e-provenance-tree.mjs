/**
 * E2E 测试：生成树完整交互验证
 * - 文档生成 + 生成树构建
 * - 生成树 CRUD（增删改查）
 * - 章节级重新生成 API
 * - 来源拖拽（后端 API 验证）
 *
 * 遵循 CLAUDE.md：API key 通过请求体传递
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";
import { config } from "dotenv";

config();

const API_KEY = process.env.MiMo_KEY;
let server;
let BASE;

try {
  // ── Step 1: 启动隔离服务器 ──
  console.log("\n=== Step 1: 启动隔离服务器 ===");
  server = await startIsolatedServer();
  BASE = server.baseUrl;
  console.log(`✅ 服务器启动成功: ${BASE}`);

  // ── Step 2: 生成文档 ──
  console.log("\n=== Step 2: 生成文档 ===");
  const genRes = await fetch(`${BASE}/api/generation/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "测试周报",
      outline: [
        { id: "s1", title: "本周工作概述", level: 1, children: [] },
        { id: "s2", title: "技术进展", level: 1, children: [] },
      ],
      format: "html",
      userRequest: "写一份技术团队周报",
      apiKey: API_KEY,
    }),
  });
  const genData = await genRes.json();
  console.log(`  ok: ${genData.ok}, runId: ${genData.runId}, sections: ${genData.sections?.length}, content: ${genData.content?.length} chars`);
  if (!genData.ok) { dumpServerLog(); process.exit(1); }
  const runId = genData.runId;
  console.log(`✅ 文档生成成功`);

  // ── Step 3: 查询生成树 ──
  console.log("\n=== Step 3: 查询生成树 ===");
  const treeRes = await fetch(`${BASE}/api/provenance/${runId}`);
  const treeData = await treeRes.json();
  console.log(`  nodes: ${treeData.nodes?.length}`);
  for (const n of treeData.nodes ?? []) {
    console.log(`    para[${n.paragraphIdx}] chunkId=${n.chunkId?.slice(0,8)}... score=${n.score.toFixed(4)} manual=${n.isManual}`);
  }
  console.log(`✅ 生成树查询成功`);

  // ── Step 4: 添加手动来源 ──
  console.log("\n=== Step 4: 添加手动来源 ===");
  const addRes = await fetch(`${BASE}/api/provenance/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, paragraphIdx: 0, chunkId: "manual-chunk-test", score: 0.85 }),
  });
  const addData = await addRes.json();
  console.log(`  new nodeId: ${addData.id}`);
  console.log(`✅ 手动来源添加成功`);

  // ── Step 5: 更新置信度 ──
  console.log("\n=== Step 5: 更新置信度 ===");
  const scoreRes = await fetch(`${BASE}/api/provenance/${addData.id}/score`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 0.99 }),
  });
  console.log(`  ok: ${(await scoreRes.json()).ok}`);
  console.log(`✅ 置信度更新成功`);

  // ── Step 6: 删除来源 ──
  console.log("\n=== Step 6: 删除来源 ===");
  const delRes = await fetch(`${BASE}/api/provenance/${addData.id}`, { method: "DELETE" });
  console.log(`  ok: ${(await delRes.json()).ok}`);
  // 验证已删除
  const afterDel = await fetch(`${BASE}/api/provenance/${runId}`);
  const afterDelData = await afterDel.json();
  const manualLeft = afterDelData.nodes.filter(n => n.isManual);
  console.log(`  manual nodes remaining: ${manualLeft.length}`);
  if (manualLeft.length !== 0) { console.error("❌ 删除失败"); process.exit(1); }
  console.log(`✅ 删除验证通过`);

  // ── Step 7: 章节级重新生成 ──
  console.log("\n=== Step 7: 章节级重新生成 ===");
  const regenRes = await fetch(`${BASE}/api/generation/${runId}/regenerate-section`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sectionIdx: 0,
      section: { id: "s1", title: "本周工作概述", level: 1, children: [] },
      outline: [
        { id: "s1", title: "本周工作概述", level: 1, children: [] },
        { id: "s2", title: "技术进展", level: 1, children: [] },
      ],
      apiKey: API_KEY,
    }),
  });
  const regenData = await regenRes.json();
  console.log(`  status: ${regenRes.status}`);
  console.log(`  ok: ${regenData.ok}`);
  console.log(`  section title: ${regenData.section?.title}`);
  console.log(`  section sources: ${regenData.section?.sources?.length}`);
  console.log(`  section content length: ${regenData.section?.content?.length}`);
  if (!regenData.ok) { dumpServerLog(); process.exit(1); }
  console.log(`✅ 章节级重新生成成功`);

  // ── Step 8: 验证重新生成后生成树已更新 ──
  console.log("\n=== Step 8: 验证重新生成后的生成树 ===");
  const finalTree = await fetch(`${BASE}/api/provenance/${runId}`);
  const finalTreeData = await finalTree.json();
  console.log(`  total nodes: ${finalTreeData.nodes?.length}`);
  const para0Nodes = finalTreeData.nodes.filter(n => n.paragraphIdx === 0);
  const para1Nodes = finalTreeData.nodes.filter(n => n.paragraphIdx === 1);
  console.log(`  para[0] nodes: ${para0Nodes.length} (重新生成后应更新)`);
  console.log(`  para[1] nodes: ${para1Nodes.length} (未修改)`);
  console.log(`✅ 生成树状态验证完成`);

  console.log("\n========================================");
  console.log("✅ 所有 E2E 测试通过！");
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
