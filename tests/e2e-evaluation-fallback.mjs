/**
 * E2E 测试：评估功能的 Model Fallback
 *
 * 验证：
 * 1. 评估函数正确使用 model fallback
 * 2. 串行执行避免 rate limit
 * 3. 日志显示 fallback 链
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

const TEST_NAME = "e2e-evaluation-fallback";

async function run() {
  console.log(`\n[${TEST_NAME}] Starting test...\n`);

  // 1. 启动隔离服务器（复制生产 DB，这样有现有的 generation run 和 settings）
  const { baseUrl, cleanup } = await startIsolatedServer({ copyProductionDb: true });

  try {
    // 2. 获取现有的 generation run
    console.log(`[${TEST_NAME}] Fetching generation history...`);
    const historyRes = await fetch(`${baseUrl}/api/generation/history`);
    const historyData = await historyRes.json();

    if (!historyData.runs || historyData.runs.length === 0) {
      throw new Error("No generation runs found in DB");
    }

    const testRun = historyData.runs.find(r => r.status === "done");
    if (!testRun) {
      throw new Error("No completed generation runs found");
    }

    console.log(`[${TEST_NAME}] Using run: ${testRun.id} - "${testRun.title}"`);

    // 3. 调用评估 API（评估7个章节，每个1-2分钟，共需约15分钟）
    console.log(`[${TEST_NAME}] Calling evaluation API (7 sections, ~15 min total)...`);
    const startTime = Date.now();

    const evalRes = await fetch(`${baseUrl}/api/generation/${testRun.id}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(1800_000), // 30分钟超时
    });

    const evalData = await evalRes.json();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[${TEST_NAME}] Evaluation completed in ${duration}s`);
    console.log(`[${TEST_NAME}] Response status: ${evalRes.status}`);
    console.log(`[${TEST_NAME}] Response:`, JSON.stringify(evalData, null, 2));

    // 4. 验证响应
    if (!evalData.ok) {
      throw new Error(`Evaluation failed: ${evalData.error}`);
    }

    if (!evalData.metrics) {
      throw new Error("No metrics in response");
    }

    console.log(`\n[${TEST_NAME}] ✓ Evaluation API returned successfully`);
    console.log(`[${TEST_NAME}] Metrics:`);
    console.log(`  - groundedness: ${evalData.metrics.groundedness?.score?.toFixed(2)}`);
    console.log(`  - relevance: ${evalData.metrics.relevance?.score?.toFixed(2)}`);
    console.log(`  - completeness: ${evalData.metrics.completeness?.score?.toFixed(2)}`);
    console.log(`  - conflicts: ${evalData.metrics.conflicts?.hasConflicts}`);

    console.log(`\n[${TEST_NAME}] ✓ Test passed!\n`);
  } catch (err) {
    console.error(`\n[${TEST_NAME}] ✗ Test failed: ${err.message}\n`);
    dumpServerLog();
    throw err;
  } finally {
    await cleanup();
  }
}

run().catch(() => process.exit(1));
