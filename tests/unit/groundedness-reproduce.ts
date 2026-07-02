/**
 * 复现脚本：用 MiniMax-M2.1 调用 groundedness judge，捕获真实失败响应
 *
 * 遵守 CLAUDE.md：只读生产 DB（获取 settings），不写、不 hit 生产 server
 */
import Database from "better-sqlite3";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { buildJudgePrompt, extractJudgeJson } from "../../server/src/lib/groundednessCheck.js";
import { getModelCapabilities } from "../../server/src/providers/model-capabilities-registry.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(PROJECT_ROOT, "server/data/docstudio.db");

// 1. 只读 DB 获取 settings
const db = new Database(DB_PATH, { readonly: true });
const settingsRow = db.prepare("SELECT value FROM user_settings WHERE key = 'provider_bailian'").get() as { value: string } | undefined;
db.close();

if (!settingsRow) {
  console.error("No bailian settings found in DB");
  process.exit(1);
}

const settings = JSON.parse(settingsRow.value);
const apiKey = settings.apiKey;
const baseUrl = settings.baseUrl ?? "https://ws-3vv2b1h4akmem3xz.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

console.log(`Base URL: ${baseUrl}`);
console.log(`API Key: ${apiKey ? "****" + apiKey.slice(-4) : "NONE"}`);

if (!apiKey) {
  console.error("No bailian API key found");
  process.exit(1);
}

// 2. 构建和 log 中失败的 groundedness 调用相同的 prompt
// 模拟真实失败场景：36 个句子（和 log 中 Sec 2 的 36 句一致）
const sampleSentences = [
  "Sprint 3 完成了认证模块的开发，包括 OAuth 2.0 和 SAML 协议支持",
  "认证模块的单元测试覆盖率达到 92%，集成测试通过率 100%",
  "Sprint 4 重点完成了支付系统的集成，支持微信支付、支付宝和信用卡",
  "支付系统通过了 PCI-DSS 合规审查，符合 Level 1 标准",
  "CI/CD 流水线优化完成，部署时间从 45 分钟缩短到 12 分钟",
  "引入了蓝绿部署策略，实现零停机部署",
  "自动化测试覆盖了 85% 的关键路径",
  "代码审查流程优化，PR 平均审查时间从 2.4 天缩短到 1.1 天",
  "Sprint 3 计划完成 42 个 story points，实际完成 38 个，完成率 90%",
  "Sprint 4 计划完成 40 个 story points，实际完成 37 个，完成率 92.5%",
  "两个 Sprint 共修复 47 个 bug，其中 3 个 P0 级别",
  "技术债务减少了 15%，主要得益于重构了遗留的支付模块",
  "团队速率从 Sprint 2 的 32 points 提升到 Sprint 4 的 37 points",
  "代码质量指标：SonarQube 技术债务比率从 3.2% 降到 2.1%",
  "新增了 3 个自动化测试套件，覆盖了认证、支付和通知模块",
  "性能基准测试显示 API 响应时间 P99 从 450ms 降到 230ms",
  "数据库查询优化后，核心查询性能提升 40%",
  "引入了分布式链路追踪，实现了全链路可观测性",
  "日志系统升级到结构化日志，支持 Elasticsearch 检索",
  "告警规则优化，误报率从 15% 降低到 3%",
  "Sprint 3-4 期间完成了 3 次安全审计，发现并修复了 8 个中高危漏洞",
  "依赖库升级到最新稳定版本，消除了 12 个已知 CVE",
  "完成了 Kubernetes 集群从 1.28 到 1.30 的升级",
  "引入了 GitOps 工作流，使用 ArgoCD 管理部署",
  "基础设施即代码覆盖率从 60% 提升到 95%",
  "云成本优化后，月度基础设施开支降低 22%",
  "团队引入了 Trunk-Based Development，缩短了分支合并周期",
  "开发者体验改善：本地开发环境搭建时间从 2 小时缩短到 15 分钟",
  "新增了 5 个内部技术文档，覆盖了架构设计和 API 规范",
  "完成了 3 次跨团队技术分享，参与人数超过 60 人",
  "Sprint Retrospective 中团队满意度评分从 3.8 提升到 4.2",
  "引入了 AI 辅助代码审查工具，提升了代码审查效率 30%",
  "建立了 On-Call 轮值制度，生产事故响应时间缩短到 5 分钟以内",
  "完成了灾备演练，RTO 从 4 小时提升到 45 分钟，RPO 从 1 小时提升到 5 分钟",
  "Sprint 3-4 累计交付了 6 个主要功能特性，全部通过验收测试",
  "整体质量指标：线上故障率降低 60%，用户满意度提升 15%",
];

const sampleDocs = [
  {
    source: "Sprint 3-4 执行总结报告.docx",
    excerpt: "Sprint 3 完成认证模块开发（OAuth 2.0 + SAML），单元测试覆盖率 92%，集成测试通过率 100%。Sprint 4 完成支付系统集成（微信支付、支付宝、信用卡），通过 PCI-DSS Level 1 合规审查。CI/CD 优化后部署时间从 45 分钟缩短至 12 分钟，引入蓝绿部署实现零停机。",
    score: 0.95,
  },
  {
    source: "Q3 技术质量报告 v3.pdf",
    excerpt: "Sprint 3 计划 42 SP，实际完成 38 SP（90%）。Sprint 4 计划 40 SP，实际完成 37 SP（92.5%）。两个 Sprint 修复 47 个 bug（3 个 P0）。技术债务减少 15%。团队速率从 32 SP 提升到 37 SP。SonarQube 技术债务比率从 3.2% 降到 2.1%。API 响应时间 P99 从 450ms 降到 230ms。",
    score: 0.90,
  },
  {
    source: "基础设施与安全季度报告.md",
    excerpt: "完成 3 次安全审计，修复 8 个中高危漏洞。依赖库升级消除 12 个 CVE。Kubernetes 从 1.28 升级到 1.30。GitOps 工作流使用 ArgoCD。基础设施即代码覆盖率从 60% 提升到 95%。云成本优化后月度开支降低 22%。灾备演练 RTO 从 4h 提升到 45min，RPO 从 1h 提升到 5min。",
    score: 0.85,
  },
];

const { system, user } = buildJudgePrompt(sampleSentences, sampleDocs);

// 3. 调用 MiniMax-M2.1（和 log 中一样的模型）
const modelToUse = "MiniMax-M2.1";
const caps = getModelCapabilities(modelToUse);
console.log(`\n模型能力: isReasoning=${caps.isReasoning} supportsStructuredOutput=${caps.supportsStructuredOutput}`);

// 4. 发送请求
const responseFormat = caps.supportsStructuredOutput
  ? {
      type: "json_schema" as const,
      json_schema: {
        name: "groundedness_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            claims: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  verdict: { type: "string", enum: ["grounded", "common_knowledge", "ungrounded", "not_verifiable"] },
                  evidence: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["text", "verdict"],
              },
            },
            groundedRatio: { type: "number" },
            overallVerdict: { type: "string", enum: ["pass", "fail", "partial"] },
          },
          required: ["claims", "groundedRatio", "overallVerdict"],
        },
      },
    }
  : { type: "json_object" as const };

async function callLLM() {
  const body: Record<string, unknown> = {
    model: modelToUse,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    max_tokens: 4096,
    response_format: responseFormat,
  };

  console.log(`\n发送请求: ${baseUrl}/chat/completions`);
  const start = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const duration = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    console.error(`HTTP ${res.status}: ${errText}`);
    return null;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const thinkingTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  console.log(`HTTP 200 duration=${duration}ms textLen=${content.length} thinkingTokens=${thinkingTokens}`);

  return content;
}

// 旧版 extractJudgeJson（修复前的逻辑）
function oldExtractJudgeJson(text: string): any | null {
  let cleaned = text.trim();
  const fencePatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\w*\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pat of fencePatterns) {
    const m = cleaned.match(pat);
    if (m) { cleaned = m[1].trim(); break; }
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.claims && Array.isArray(parsed.claims)) return parsed;
  } catch {
    try {
      let repaired = cleaned
        .replace(/,(\s*[}\]])/g, "$1")
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
      const parsed = JSON.parse(repaired);
      if (parsed.claims && Array.isArray(parsed.claims)) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

async function main() {
  const totalRuns = 5;
  let newFailures = 0;
  let oldFailures = 0;
  const responseTexts: string[] = [];

  for (let i = 1; i <= totalRuns; i++) {
    console.log(`\n=== 第 ${i}/${totalRuns} 次调用 ===`);
    const text = await callLLM();
    if (!text) {
      console.log("HTTP 调用失败");
      newFailures++;
      oldFailures++;
      continue;
    }
    responseTexts.push(text);

    const newResult = extractJudgeJson(text);
    const oldResult = oldExtractJudgeJson(text);

    if (newResult) {
      console.log(`✅ 新版解析: claims=${newResult.claims.length} ratio=${newResult.groundedRatio} verdict=${newResult.overallVerdict}`);
    } else {
      console.log(`❌ 新版解析失败！textLen=${text.length}`);
      console.log("--- 响应原文(前500) ---");
      console.log(text.slice(0, 500));
      console.log("--- 响应原文(后500) ---");
      console.log(text.slice(-500));
      newFailures++;
    }

    if (oldResult) {
      console.log(`   旧版解析: claims=${oldResult.claims.length} ratio=${oldResult.groundedRatio} verdict=${oldResult.overallVerdict}`);
    } else {
      console.log(`   旧版解析失败！`);
      oldFailures++;
    }
  }

  console.log(`\n=== 总结 ===`);
  console.log(`新版: ${newFailures}/${totalRuns} 次解析失败`);
  console.log(`旧版: ${oldFailures}/${totalRuns} 次解析失败`);

  if (newFailures > 0) {
    console.log(`\n⚠️ 新版仍有失败，需要进一步分析响应原文`);
  } else if (oldFailures > 0) {
    console.log(`\n✅ 新版修复了 ${oldFailures} 次旧版会失败的解析`);
  } else {
    console.log(`\n⚠️ 新旧版均无失败，需要更多样本或更真实的 prompt 来复现`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});