/**
 * E2E 测试：文档标题自动生成和更新
 */
import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

loadEnvFile();

async function main() {
  console.log("=== E2E: 文档标题自动生成 ===\n");

  console.log("1. 启动隔离服务器...");
  const { baseUrl, cleanup } = await startIsolatedServer({ copyProductionDb: true });
  console.log(`   服务器地址: ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;
  function assert(cond, msg) {
    if (cond) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  try {
    const apiKey = getApiKey("mimo");
    if (!apiKey) {
      console.error("ERROR: 未找到 MiMo_KEY，请检查 .env 文件");
      process.exit(1);
    }

    const outline = [
      { id: "s1", title: "问候与近况", level: 1, children: [], description: "开场问候" },
      { id: "s2", title: "产品进展", level: 1, children: [], description: "本周进展" },
      { id: "s3", title: "竞品分析", level: 1, children: [], description: "竞品对比" },
    ];

    const userRequest = "向苏楠写一封邮件，汇报最近一周在做什么产品";

    // 测试1：生成文档后服务端返回有意义的标题
    console.log("\n2. 生成文档，检查返回标题...");
    const genRes = await fetch(`${baseUrl}/api/generation/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "写邮件给苏楠汇报工作",
        outline,
        format: "html",
        userRequest,
        apiKey,
        providerPreference: ["mimo"],
      }),
      signal: AbortSignal.timeout(300_000),
    }).then(r => r.json());

    assert(genRes.ok, `生成成功`);
    assert(!!genRes.title, `返回了 title 字段: "${genRes.title}"`);
    assert(genRes.title !== "新文档", `标题不是"新文档": "${genRes.title}"`);
    assert(genRes.title !== "问候与近况", `标题不是大纲章节名: "${genRes.title}"`);
    console.log(`  服务端返回标题: "${genRes.title}"`);

    // 测试2：history 接口返回正确的标题
    console.log("\n3. 检查 history 接口标题...");
    const historyRes = await fetch(`${baseUrl}/api/generation/history`).then(r => r.json());
    assert(historyRes.ok, `history 成功`);
    const latestRun = historyRes.runs?.[0];
    assert(!!latestRun, "有生成记录");
    console.log(`  history 最新标题: "${latestRun?.title}"`);
    assert(latestRun?.title !== "新文档", `history 标题不是"新文档"`);
    assert(latestRun?.title !== "问候与近况", `history 标题不是大纲章节名`);

    // 测试3：模拟客户端 case 创建 + updateTitle 流程
    console.log("\n4. 模拟客户端 case 创建和标题更新...");
    const caseId = `case-${Date.now()}`;

    // 创建 case（初始标题"新文档"）
    const createRes = await fetch(`${baseUrl}/api/data/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: caseId,
        title: "新文档",
        userRequest,
        outline: [],
        format: "html",
        workflowState: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    }).then(r => r.json());
    assert(createRes.ok, `创建 case 成功`);

    // 更新标题
    const updateRes = await fetch(`${baseUrl}/api/data/cases/${caseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: caseId,
        title: genRes.title,
        userRequest,
        outline: [],
        format: "html",
        workflowState: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    }).then(r => r.json());
    assert(updateRes.ok, `更新 case 标题成功`);

    // 验证标题已更新
    const getRes = await fetch(`${baseUrl}/api/data/cases/${caseId}`).then(r => r.json());
    assert(getRes.ok, `获取 case 成功`);
    assert(getRes.record?.title === genRes.title,
      `case 标题已更新为: "${getRes.record?.title}"`);

    // 测试4：加载 cases 时动态修正"新文档"标题
    console.log('\n5. 测试加载 cases 时动态修正"新文档"标题...');
    // 创建一个"新文档"case（1小时前创建）
    const oldCaseId = `case-${Date.now() - 100000}`;
    const oldCaseTime = new Date(Date.now() - 3600000).toISOString();
    await fetch(`${baseUrl}/api/data/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: oldCaseId,
        title: "新文档",
        userRequest,
        outline: [],
        format: "html",
        workflowState: "completed",
        createdAt: oldCaseTime,
        updatedAt: oldCaseTime,
      }),
    }).then(r => r.json());

    // 加载 cases 列表（触发动态修正）
    const casesRes = await fetch(`${baseUrl}/api/data/cases`).then(r => r.json());
    assert(casesRes.ok, "加载 cases 成功");
    const fixedCase = casesRes.records.find(c => c.id === oldCaseId);
    assert(!!fixedCase, "找到目标 case");
    console.log(`  修正后 case 标题: "${fixedCase?.title}"`);
    assert(fixedCase?.title !== "新文档",
      `case 标题被修正: "${fixedCase?.title}"`);

    // 验证再次加载时标题保持修正
    const casesRes2 = await fetch(`${baseUrl}/api/data/cases`).then(r => r.json());
    const fixedCase2 = casesRes2.records.find(c => c.id === oldCaseId);
    assert(fixedCase2?.title === fixedCase?.title,
      `再次加载标题保持: "${fixedCase2?.title}"`);

    console.log(`\n=== 测试完成: 通过 ${passed}, 失败 ${failed} ===`);
    if (failed > 0) {
      dumpServerLog();
      process.exit(1);
    }
  } finally {
    await cleanup();
  }
}

main().catch(async (e) => {
  console.error("Test error:", e);
  dumpServerLog();
  process.exit(1);
});
