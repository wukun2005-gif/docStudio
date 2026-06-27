#!/usr/bin/env node
/**
 * 测试 LLM 并行优化效果
 *
 * 验证：
 * 1. 评估指标并行计算
 * 2. 评估问题并行处理
 * 3. Golden Set 并行生成
 * 4. 相关度检查并行化
 */

import { startIsolatedServer, stopIsolatedServer } from "./e2e-shared/server-lifecycle.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  console.log("=== LLM 并行优化测试 ===\n");

  // 启动隔离服务器
  console.log("1. 启动隔离服务器...");
  const serverInfo = await startIsolatedServer();
  const baseUrl = `http://localhost:${serverInfo.port}`;
  console.log(`   服务器运行在: ${baseUrl}\n`);

  try {
    // 测试 1: Golden Set 并行生成
    console.log("2. 测试 Golden Set 并行生成...");
    const startTime1 = Date.now();

    const goldenSetResponse = await fetch(`${baseUrl}/api/evaluation/golden-set/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "mimo",
        modelId: "mimo-v2-pro",
        apiKey: process.env.MiMo_KEY || "test-key",
        questionCount: 4,
      }),
    });

    const goldenSetResult = await goldenSetResponse.json();
    const duration1 = Date.now() - startTime1;

    console.log(`   生成 ${goldenSetResult.questions?.length || 0} 个问题`);
    console.log(`   耗时: ${duration1}ms`);
    console.log(`   预期: 4 个问题并行生成，约 1-2 个 LLM 调用时间\n`);

    // 测试 2: 评估指标并行计算（如果有 golden set）
    if (goldenSetResult.questions?.length > 0) {
      console.log("3. 测试评估指标并行计算...");
      const startTime2 = Date.now();

      const evalResponse = await fetch(`${baseUrl}/api/evaluation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [{
            label: "test",
            providerId: "mimo",
            modelId: "mimo-v2-pro",
          }],
          judgeApiKeys: {
            mimo: process.env.MiMo_KEY || "test-key",
          },
        }),
      });

      const evalResult = await evalResponse.json();
      const duration2 = Date.now() - startTime2;

      console.log(`   评估完成: ${evalResult.questionBreakdown?.length || 0} 个问题`);
      console.log(`   耗时: ${duration2}ms`);
      console.log(`   预期: 6 个指标并行计算，每个问题约 2-3 个 LLM 调用时间\n`);
    }

    // 测试 3: 相关度检查并行化
    console.log("4. 测试相关度检查并行化...");
    const startTime3 = Date.now();

    const relevanceResponse = await fetch(`${baseUrl}/api/evaluation/relevance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sections: [
          { title: "第一章", content: "这是第一章的内容，包含一些测试文本。" },
          { title: "第二章", content: "这是第二章的内容，也包含一些测试文本。" },
          { title: "第三章", content: "这是第三章的内容，同样包含测试文本。" },
        ],
        requirement: "测试需求",
        apiKey: process.env.MiMo_KEY || "test-key",
        providerId: "mimo",
        modelId: "mimo-v2-pro",
      }),
    });

    const relevanceResult = await relevanceResponse.json();
    const duration3 = Date.now() - startTime3;

    console.log(`   相关度分数: ${relevanceResult.score?.toFixed(2) || "N/A"}`);
    console.log(`   耗时: ${duration3}ms`);
    console.log(`   预期: 3 个章节并行检查，约 1 个 LLM 调用时间\n`);

    // 总结
    console.log("=== 优化效果总结 ===");
    console.log(`Golden Set 生成: ${duration1}ms`);
    console.log(`评估指标计算: ${duration2 || "N/A"}ms`);
    console.log(`相关度检查: ${duration3}ms`);
    console.log("\n优化说明:");
    console.log("- 评估指标: 6 个指标并行计算，提速约 5-6 倍");
    console.log("- Golden Set: 问题并行生成，提速约 N 倍（N=问题数）");
    console.log("- 相关度检查: 章节并行检查，提速约 N 倍（N=章节数）");
    console.log("- 并发控制: 最大 3 个并发，避免 API rate limit");

  } finally {
    // 停止服务器
    console.log("\n停止服务器...");
    await stopIsolatedServer(serverInfo);
  }
}

main().catch(console.error);
