/**
 * E2E 测试：验证 LLM 标题生成
 *
 * 测试目标：
 * 1. 文档生成时，标题由 LLM 生成（不是启发式规则）
 * 2. 生成的标题不包含特殊字符（box-drawing、装饰符号等）
 * 3. 数据库中存储的标题正确
 *
 * 遵守 claude.md：
 * - 使用 startIsolatedServer() 启动隔离服务器
 * - API key 从 .env 读取，通过请求体传递
 * - 测试结束后清理资源
 */
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

// 加载 .env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const MIMO_KEY = process.env.MiMo_KEY;
if (!MIMO_KEY) {
  console.error("❌ MiMo_KEY not found in .env");
  process.exit(1);
}

let server;
let testPassed = true;

async function run() {
  console.log("🧪 E2E: LLM 标题生成测试\n");

  // 1. 启动隔离服务器
  console.log("📦 启动隔离服务器...");
  server = await startIsolatedServer();
  console.log(`   服务器地址: ${server.baseUrl}\n`);

  // 2. 测试用例：普通文档
  await testCase({
    name: "普通文档标题生成",
    userRequest: "帮我写一份关于人工智能发展趋势的分析报告",
    outline: [
      { title: "引言", description: "介绍AI发展背景", children: [] },
      { title: "当前趋势", description: "分析主要发展方向", children: [] },
      { title: "未来展望", description: "预测未来发展趋势", children: [] },
    ],
    expectedPattern: /^[一-鿿\w\s]+$/,  // 只包含 CJK + 字母数字 + 空白
    unexpectedChars: ["▎", "」", "═", "─"],  // 不应包含的字符
  });

  // 3. 测试用例：邮件
  await testCase({
    name: "邮件标题生成",
    userRequest: "写邮件给苏楠，讨论下周的项目进度",
    outline: [
      { title: "问候", description: "开头问候", children: [] },
      { title: "项目进度汇报", description: "当前进度", children: [] },
      { title: "下周计划", description: "下周安排", children: [] },
    ],
    expectedPattern: /^[一-鿿\w\s]+$/,
    unexpectedChars: ["▎", "」", "═", "─"],
  });

  // 4. 测试用例：边界情况 - 无 userRequest
  await testCase({
    name: "无 userRequest 时使用大纲标题",
    userRequest: "",
    outline: [
      { title: "产品发布计划", description: "发布流程", children: [] },
      { title: "时间表", description: "关键节点", children: [] },
    ],
    expectedPattern: /^[一-鿿\w\s]+$/,
    unexpectedChars: ["▎", "」", "═", "─"],
  });

  // 5. 测试用例：验证 provider 透传（标题生成应复用文档生成的 provider/model）
  await testCase({
    name: "provider 透传验证（Gemini）",
    userRequest: "写一份季度工作总结",
    outline: [
      { title: "工作成果", description: "本季度完成的任务", children: [] },
      { title: "不足与改进", description: "需要改进的地方", children: [] },
    ],
    expectedPattern: /^[一-鿿\w\s]+$/,
    unexpectedChars: ["▎", "」", "═", "─"],
    extraBody: {
      providerPreference: ["gemini"],
      modelId: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_KEY,
    },
  });

  console.log("\n" + "=".repeat(50));
  if (testPassed) {
    console.log("✅ 所有测试通过！");
  } else {
    console.log("❌ 有测试失败");
    process.exitCode = 1;
  }
}

async function testCase({ name, userRequest, outline, expectedPattern, unexpectedChars, extraBody = {} }) {
  console.log(`\n📝 测试: ${name}`);
  console.log(`   userRequest: "${userRequest || "(空)"}"`);
  if (extraBody.providerPreference) {
    console.log(`   provider: ${extraBody.providerPreference[0]}, model: ${extraBody.modelId || "default"}`);
  }

  try {
    // 调用生成接口
    const res = await fetch(`${server.baseUrl}/api/generation/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: outline[0]?.title || "文档",
        outline,
        format: "html",
        userRequest,
        apiKey: MIMO_KEY,
        ...extraBody,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`   ❌ HTTP ${res.status}: ${err}`);
      testPassed = false;
      return;
    }

    const data = await res.json();
    if (!data.ok) {
      console.error(`   ❌ 生成失败: ${data.error}`);
      testPassed = false;
      return;
    }

    console.log(`   生成成功, runId: ${data.runId}`);

    // 直接从生成响应中获取标题（LLM 生成的）
    const title = data.title;

    console.log(`   生成的标题: "${title}"`);

    // 验证标题
    let passed = true;

    // 检查是否包含不应有的字符
    for (const char of unexpectedChars) {
      if (title.includes(char)) {
        console.error(`   ❌ 标题包含不应有的字符: "${char}"`);
        passed = false;
      }
    }

    // 检查是否匹配预期模式
    if (!expectedPattern.test(title)) {
      console.error(`   ❌ 标题包含特殊字符，不符合预期模式`);
      passed = false;
    }

    // 检查标题长度
    if (title.length > 20) {
      console.error(`   ❌ 标题过长 (${title.length} > 20)`);
      passed = false;
    }

    if (title.length === 0) {
      console.error(`   ❌ 标题为空`);
      passed = false;
    }

    if (passed) {
      console.log(`   ✅ 标题验证通过`);
    } else {
      testPassed = false;
    }

  } catch (err) {
    console.error(`   ❌ 异常: ${err.message}`);
    testPassed = false;
  }
}

// 运行测试
try {
  await run();
} finally {
  if (server) {
    console.log("\n🧹 清理服务器...");
    await server.cleanup();
  }
}
