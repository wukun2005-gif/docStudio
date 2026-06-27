/**
 * E2E 测试：百炼评估端到端诊断
 *
 * 目的：在隔离环境中 1:1 还原用户的评估流程，定位 kimi-k2.7-code 在评估时 timeout 的根因
 *
 * 遵守 CLAUDE.md：
 * - 使用 startIsolatedServer({ copyProductionDb: true }) 复制生产 DB（只读复制，不写生产库）
 * - API key 从 .env 读取，通过请求体传递
 * - 测试结束后清理隔离 server 和临时目录
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const TEST_NAME = "e2e-bailian-evaluation";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const BAILIAN_KEY = process.env.bailian_key;
const BAILIAN_BASEURL = process.env.bailian_baseurl;

if (!BAILIAN_KEY) {
  console.error(`[${TEST_NAME}] ❌ bailian_key not found in .env`);
  process.exit(1);
}

// 要测试的模型列表
const MODELS_TO_TEST = ["kimi-k2.7-code", "qwen-plus"];

async function run() {
  console.log(`\n[${TEST_NAME}] 🧪 百炼评估端到端诊断\n`);

  // 1. 启动隔离服务器（复制生产 DB，有现有 generation run）
  console.log(`[${TEST_NAME}] 📦 启动隔离服务器（copyProductionDb=true）...`);
  const { baseUrl, cleanup } = await startIsolatedServer({ copyProductionDb: true });

  try {
    console.log(`[${TEST_NAME}] 服务器地址: ${baseUrl}\n`);

    // 2. 找一个已完成的 generation run
    console.log(`[${TEST_NAME}] 查询已有的 generation runs...`);
    const historyRes = await fetch(`${baseUrl}/api/generation/history`);
    const historyData = await historyRes.json();

    if (!historyData.runs || historyData.runs.length === 0) {
      throw new Error("No generation runs found in DB");
    }

    const testRun = historyData.runs.find(r => r.status === "done");
    if (!testRun) {
      throw new Error("No completed generation runs found (need at least one 'done' run)");
    }

    console.log(`[${TEST_NAME}] ✓ 选用 run: id=${testRun.id}, title="${testRun.title}"\n`);

    // 3. 对每个模型跑一次评估，记录耗时
    for (const modelId of MODELS_TO_TEST) {
      console.log(`\n[${TEST_NAME}] ─── 开始评估: model=${modelId} ───`);
      const startTime = Date.now();

      try {
        const evalRes = await fetch(`${baseUrl}/api/generation/${testRun.id}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: BAILIAN_KEY,
            providerId: "bailian",
            modelId,
            providerBaseUrls: BAILIAN_BASEURL ? { bailian: BAILIAN_BASEURL } : undefined,
          }),
          signal: AbortSignal.timeout(900_000), // 15 min 总超时
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const evalData = await evalRes.json();

        if (!evalData.ok) {
          console.log(`[${TEST_NAME}] ❌ model=${modelId} 失败 (${duration}s): ${evalData.error}`);
          continue;
        }

        console.log(`[${TEST_NAME}] ✅ model=${modelId} 成功 (${duration}s)`);
        console.log(`[${TEST_NAME}]   groundedness: ${evalData.metrics?.groundedness?.score?.toFixed(2) ?? "N/A"}`);
        console.log(`[${TEST_NAME}]   relevance:    ${evalData.metrics?.relevance?.score?.toFixed(2) ?? "N/A"}`);
        console.log(`[${TEST_NAME}]   completeness: ${evalData.metrics?.completeness?.score?.toFixed(2) ?? "N/A"}`);
        console.log(`[${TEST_NAME}]   conflicts:    ${evalData.metrics?.conflicts?.hasConflicts} (${evalData.metrics?.conflicts?.items?.length ?? 0} items)`);
        console.log(`[${TEST_NAME}]   irrelevant:   ${evalData.metrics?.relevance?.irrelevantSentences?.length ?? 0}`);
        console.log(`[${TEST_NAME}]   missing:      ${evalData.metrics?.completeness?.missingPoints?.length ?? 0}`);
      } catch (e) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${TEST_NAME}] ❌ model=${modelId} 异常 (${duration}s): ${e.message}`);
      }
    }

    console.log(`\n[${TEST_NAME}] 🏁 诊断完成\n`);
  } catch (err) {
    console.error(`\n[${TEST_NAME}] ✗ Test failed: ${err.message}\n`);
    dumpServerLog();
    throw err;
  } finally {
    await cleanup();
  }
}

run().catch(() => process.exit(1));
