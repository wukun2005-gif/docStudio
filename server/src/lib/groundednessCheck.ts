/**
 * Groundedness Check — 句子级验证
 * Feature #12: LLM-as-Judge 验证生成内容是否忠实于检索文档
 */
import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";

// ── 类型定义 ──────────────────────────────────────────

export interface GroundingDoc {
  source: string;
  excerpt: string;
  score?: number;
}

export interface ClaimVerdict {
  text: string;
  verdict: "grounded" | "ungrounded" | "not_verifiable";
  evidence?: string;
  reason?: string;
}

export interface JudgeResult {
  claims: ClaimVerdict[];
  groundedRatio: number;
  overallVerdict: "pass" | "fail" | "partial";
}

export interface GroundednessConfig {
  apiKey?: string;
  providerPreference?: string[];
  modelId?: string;
  providerBaseUrls?: Record<string, string>;
  signal?: AbortSignal;
}

// ── 句子拆分 ──────────────────────────────────────────

/**
 * 将文本拆分为句子/段落
 * - 按中文句号、问号、感叹号、英文句号拆分
 * - 合并过短句子
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const rawSentences = text.split(/(?<=[。！？.!?])/);

  const merged: string[] = [];
  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;

    if (merged.length > 0 && trimmed.length < 5) {
      merged[merged.length - 1] += trimmed;
    } else {
      merged.push(trimmed);
    }
  }

  return merged;
}

// ── Judge Prompt 构建 ──────────────────────────────────

export function buildJudgePrompt(
  sentences: string[],
  groundingDocs: GroundingDoc[],
): { system: string; user: string } {
  const system = [
    "你是事实核查员。判断 AI 生成的回答中，每个声明是否被参考文档支撑。",
    "",
    "规则：",
    "- grounded: 声明有明确的文档支撑",
    "- ungrounded: 声明没有文档支撑，可能是幻觉",
    "- not_verifiable: 无法从文档判断（如常识性陈述）",
    "",
    "输出 JSON：",
    '{"claims":[{"text":"声明","verdict":"grounded|ungrounded|not_verifiable","evidence":"文档片段","reason":"理由"}],"groundedRatio":0.85,"overallVerdict":"pass|fail|partial"}',
    "",
    "groundedRatio = grounded / (grounded + ungrounded)",
    ">= 0.8 pass, 0.5~0.8 partial, < 0.5 fail",
  ].join("\n");

  const docSection = groundingDocs
    .map((doc, i) => `[${i + 1}] ${doc.source}${doc.score ? ` (${doc.score.toFixed(2)})` : ""}\n${doc.excerpt}`)
    .join("\n\n");

  const sentenceSection = sentences.map((s, i) => `[S${i + 1}] ${s}`).join("\n");

  const user = [
    "## 参考文档",
    docSection || "（无参考文档）",
    "",
    "## AI 生成的声明",
    sentenceSection,
    "",
    "请逐句检查每个声明。",
  ].join("\n");

  return { system, user };
}

// ── LLM Judge 调用 ──────────────────────────────────

async function callJudge(
  sentences: string[],
  groundingDocs: GroundingDoc[],
  config: GroundednessConfig,
): Promise<JudgeResult> {
  const { system, user } = buildJudgePrompt(sentences, groundingDocs);

  try {
    const providerApiKeys: Record<string, string> = {};
    for (const pid of config.providerPreference ?? []) {
      const key = config.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const { response } = await registry.runWithFallback(
      config.providerPreference ?? ["openai", "deepseek"],
      {
        modelId: config.modelId ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        apiKey: "",
        temperature: 0,
        responseFormat: {
          type: "json_schema",
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
                      verdict: { type: "string", enum: ["grounded", "ungrounded", "not_verifiable"] },
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
        },
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    );

    if (response.error) {
      throw new Error(`LLM error: ${response.error.message}`);
    }

    const parsed = JSON.parse(response.text) as JudgeResult;
    return parsed;
  } catch (err) {
    logger.error(`[Groundedness] Judge 调用失败: ${err instanceof Error ? err.message : String(err)}`);
    // 返回默认结果
    return {
      claims: sentences.map((s) => ({
        text: s,
        verdict: "not_verifiable" as const,
        reason: "Judge 调用失败",
      })),
      groundedRatio: 0,
      overallVerdict: "fail",
    };
  }
}

// ── 完整 Groundedness Check 流程 ──────────────────────────

export interface FilteredOutput {
  output: string;
  groundingScore: number;
  removedClaims: Array<{ text: string; reason: string }>;
  verdict: "pass" | "partial" | "fail";
}

/**
 * 完整的 Groundedness Check：
 * 1. 句子拆分
 * 2. LLM Judge 验证
 * 3. 过滤无支撑声明
 */
export async function checkGroundedness(
  text: string,
  groundingDocs: GroundingDoc[],
  config: GroundednessConfig = {},
): Promise<FilteredOutput> {
  // 1. 句子拆分
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return { output: text, groundingScore: 1, removedClaims: [], verdict: "pass" };
  }

  logger.info(`[Groundedness] 检查 ${sentences.length} 个声明`);

  // 2. LLM Judge
  const judgeResult = await callJudge(sentences, groundingDocs, config);
  logger.info(`[Groundedness] 结果: ${judgeResult.overallVerdict}, ratio=${judgeResult.groundedRatio.toFixed(2)}`);

  // 3. 过滤无支撑声明
  const removedClaims: Array<{ text: string; reason: string }> = [];
  const keptSentences: string[] = [];

  for (const claim of judgeResult.claims) {
    if (claim.verdict === "ungrounded") {
      removedClaims.push({ text: claim.text, reason: claim.reason ?? "无文档支撑" });
    } else {
      keptSentences.push(claim.text);
    }
  }

  return {
    output: keptSentences.join(""),
    groundingScore: judgeResult.groundedRatio,
    removedClaims,
    verdict: judgeResult.overallVerdict,
  };
}
