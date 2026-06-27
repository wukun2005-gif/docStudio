/**
 * Groundedness Detection — LLM-as-Judge 验证
 *
 * 照搬 patentExaminator groundednessCheck.ts，适配 i-Write 场景。
 *
 * 在 LLM 生成回答之后，检查回答是否忠实于检索到的文档，
 * 移除无支撑声明后再返回给用户。
 */
import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens } from "./llmUtils.js";

// ── 类型定义 ──────────────────────────────────────────

export interface GroundingDoc {
  source: string;
  excerpt: string;
  score?: number | undefined;
}

export interface ClaimVerdict {
  text: string;
  verdict: "grounded" | "ungrounded" | "not_verifiable" | "common_knowledge";
  evidence?: string;
  reason?: string;
}

export interface JudgeResult {
  claims: ClaimVerdict[];
  /** groundedRatio = (grounded + common_knowledge) / (grounded + common_knowledge + ungrounded) */
  groundedRatio: number;
  overallVerdict: "pass" | "fail" | "partial";
}

export interface FilteredOutput {
  output: string;
  groundingScore: number;
  removedClaims: Array<{ text: string; reason: string }>;
  verdict: "pass" | "partial" | "fail";
}

export interface GroundednessConfig {
  apiKey?: string;
  providerPreference?: string[];
  modelId?: string;
  providerBaseUrls?: Record<string, string>;
  signal?: AbortSignal;
  /** LLM 调用超时（毫秒），照搬 patentExaminator */
  timeoutMs?: number;
}

// ── 句子拆分（照搬 patentExaminator splitIntoSentences） ───

/**
 * 将文本拆分为句子/段落
 * - 按中文句号、问号、感叹号、英文句号拆分
 * - 保留编号段落（如 [0001]）的完整性
 * - 合并过短句子
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // 保护编号段落 [0001] 等，先替换为占位符
  const protectedMarkers: string[] = [];
  const protectedText = text.replace(/\[(\d{4,})\]/g, (match) => {
    const idx = protectedMarkers.length;
    protectedMarkers.push(match);
    return `__PROTECTED_MARKER_${idx}__`;
  });

  // 按句子分隔符拆分（中文句号、问号、感叹号、英文句号）
  const rawSentences = protectedText.split(/(?<=[。！？.!?])/);

  // 还原保护的标记
  const sentences = rawSentences
    .map((s) => {
      let restored = s;
      protectedMarkers.forEach((marker, idx) => {
        restored = restored.replace(`__PROTECTED_MARKER_${idx}__`, marker);
      });
      return restored.trim();
    })
    .filter((s) => s.length > 0);

  // 合并过短的句子（< 5 字符）到前一个句子
  const merged: string[] = [];
  for (const s of sentences) {
    if (merged.length > 0 && s.length < 5) {
      merged[merged.length - 1] += s;
    } else {
      merged.push(s);
    }
  }

  return merged;
}

// ── Judge Prompt 构建（照搬 patentExaminator buildJudgePrompt） ───

export function buildJudgePrompt(
  sentences: string[],
  groundingDocs: GroundingDoc[],
): { system: string; user: string } {
  const system = [
    "你是文档写作 AI 助手的事实核查员。你的任务是判断 AI 生成的回答中，每个声明是否被提供的参考文档支撑。",
    "",
    "规则：",
    "- grounded: 声明有明确的文档支撑（可引用具体段落）",
    "- common_knowledge: 声明是基本常识或普遍认知，不需要文档支撑（如：地球是圆的、一天24小时、LLM是统计模型、软件工程产出是代码和文档等）",
    "- ungrounded: 声明没有文档支撑，且不是常识，可能是幻觉或推测",
    "- not_verifiable: 声明无法从文档中判断（如过渡语句、主观评价）",
    "",
    "输出格式（JSON）：",
    "{",
    '  "claims": [',
    "    {",
    '      "text": "声明原文",',
    '      "verdict": "grounded | common_knowledge | ungrounded | not_verifiable",',
    '      "evidence": "支撑该声明的文档片段（如有）",',
    '      "reason": "判断理由"',
    "    }",
    "  ],",
    '  "groundedRatio": 0.85,',
    '  "overallVerdict": "pass | fail | partial"',
    "}",
    "",
    "注意：",
    "- groundedRatio = (grounded + common_knowledge) 数量 / (grounded + common_knowledge + ungrounded) 数量",
    "- overallVerdict: groundedRatio >= 0.8 为 pass, 0.5~0.8 为 partial, < 0.5 为 fail",
    "- not_verifiable 不计入 groundedRatio 计算",
    "- 严格按 JSON 格式输出，不要输出 markdown 代码块或任何解释性文字",
  ].join("\n");

  const docSection = groundingDocs
    .map(
      (doc, i) =>
        `[${i + 1}] ${doc.source}${doc.score ? ` (相似度: ${doc.score.toFixed(2)})` : ""}\n${doc.excerpt}`,
    )
    .join("\n\n");

  const sentenceSection = sentences
    .map((s, i) => `[S${i + 1}] ${s}`)
    .join("\n");

  const user = [
    "## 参考文档",
    docSection || "（无参考文档）",
    "",
    "## AI 生成的回答（已拆分为声明）",
    sentenceSection,
    "",
    "请逐句检查以上回答的每个声明，判断是否有文档支撑。",
  ].join("\n");

  return { system, user };
}

// ── JSON 解析 ──────────────────────────────────────

export function extractJudgeJson(text: string): JudgeResult | null {
  try {
    const parsed = JSON.parse(text) as JudgeResult;
    if (parsed.claims && Array.isArray(parsed.claims)) {
      return parsed;
    }
  } catch {
    // 尝试提取 JSON 块
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.substring(start, end + 1)) as JudgeResult;
        if (parsed.claims && Array.isArray(parsed.claims)) {
          return parsed;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

// ── LLM Judge 调用 ──────────────────────────────────

async function callJudge(
  sentences: string[],
  groundingDocs: GroundingDoc[],
  config: GroundednessConfig,
): Promise<JudgeResult> {
  const { system, user } = buildJudgePrompt(sentences, groundingDocs);

  try {
    const dbSettings = readSettingsFromDb();
    const providers = config.providerPreference ?? dbSettings.providerPreference ?? ["mimo"];
    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = config.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const modelId = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";

    // 评估 judge 使用固定 cap，避免推理模型 4x 放大导致超时
    const maxTokens = resolveEvalMaxTokens(modelId);

    logger.info(`[Groundedness] 模型: ${modelId}, maxTokens: ${maxTokens}`);

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        apiKey: "",
        maxTokens,
        temperature: 0,
        timeoutMs: config.timeoutMs ?? 180_000,
        evalMode: true,
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
        },
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    );

    if (response.error) {
      throw new Error(`LLM error: ${response.error.message}`);
    }

    // 先尝试直接解析，失败则提取 JSON 块
    const parsed = extractJudgeJson(response.text);
    if (parsed) return parsed;

    throw new Error("JSON 解析失败");
  } catch (err) {
    logger.warn(`[Groundedness] Judge 调用失败: ${err instanceof Error ? err.message : String(err)}，重试一次...`);

    // ── 重试一次 ──
    try {
      const dbSettings = readSettingsFromDb();
      const providers = config.providerPreference ?? dbSettings.providerPreference ?? ["mimo"];
      const providerApiKeys: Record<string, string> = {};
      for (const pid of providers) {
        const key = config.apiKey ?? getApiKey(pid);
        if (key) providerApiKeys[pid] = key;
      }

      const { response: retryResponse } = await registry.runWithFallback(
        providers,
        {
          modelId: config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
          messages: [
            { role: "system", content: buildJudgePrompt(sentences, groundingDocs).system },
            { role: "user", content: buildJudgePrompt(sentences, groundingDocs).user },
          ],
          apiKey: "",
          maxTokens: 2000,
          temperature: 0,
          timeoutMs: config.timeoutMs ?? 180_000,
          evalMode: true,
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
          },
        },
        undefined, undefined,
        providerApiKeys,
        config.providerBaseUrls,
      );

      if (!retryResponse.error) {
        const retryParsed = extractJudgeJson(retryResponse.text);
        if (retryParsed) {
          logger.info(`[Groundedness] 重试成功`);
          return retryParsed;
        }
      }
    } catch (retryErr) {
      logger.warn(`[Groundedness] 重试也失败: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
    }

    // ── 最终降级：使用 partial 而非 pass，避免放行不合格内容 ──
    logger.warn(`[Groundedness] Judge 两次调用均失败，降级为 partial`);
    return {
      claims: sentences.map((s) => ({
        text: s,
        verdict: "not_verifiable" as const,
        reason: "Judge 调用失败，保守标记为无法验证",
      })),
      groundedRatio: 0.5,
      overallVerdict: "partial",
    };
  }
}

// ── 过滤函数（照搬 patentExaminator filterUngrounded） ───

export function filterUngrounded(
  originalOutput: string,
  sentences: string[],
  judgeResult: JudgeResult,
): FilteredOutput {
  const claimVerdicts = judgeResult.claims;

  // 构建句子 → verdict 映射
  const verdictMap = new Map<string, ClaimVerdict>();
  for (const cv of claimVerdicts) {
    verdictMap.set(cv.text, cv);
  }

  const keptSentences: string[] = [];
  const removedClaims: Array<{ text: string; reason: string }> = [];

  for (const sentence of sentences) {
    const verdict = verdictMap.get(sentence);
    if (!verdict) {
      // 未找到 verdict，保守保留
      keptSentences.push(sentence);
      continue;
    }

    switch (verdict.verdict) {
      case "grounded":
        keptSentences.push(sentence);
        break;
      case "common_knowledge":
        // 常识性声明始终保留
        keptSentences.push(sentence);
        break;
      case "not_verifiable":
        // pass 时保留，partial/fail 时移除（照搬 patentExaminator）
        if (judgeResult.overallVerdict === "pass") {
          keptSentences.push(sentence);
        } else {
          removedClaims.push({
            text: sentence,
            reason: verdict.reason || "无法验证",
          });
        }
        break;
      case "ungrounded":
        removedClaims.push({
          text: sentence,
          reason: verdict.reason || "无文档支撑",
        });
        break;
    }
  }

  return {
    output: keptSentences.join("。") + (keptSentences.length > 0 && !keptSentences[keptSentences.length - 1].match(/[。！？.!?]$/) ? "。" : ""),
    groundingScore: judgeResult.groundedRatio,
    removedClaims,
    verdict: judgeResult.overallVerdict,
  };
}

// ── 主函数 ──────────────────────────────────────────

/**
 * 检查 LLM 回答的 groundedness
 * @param output LLM 生成的回答
 * @param groundingDocs RAG + Web 合并的 grounding documents
 * @param config LLM 调用配置
 * @returns 过滤后的输出
 */
export async function checkGroundedness(
  output: string,
  groundingDocs: GroundingDoc[],
  config: GroundednessConfig = {},
): Promise<FilteredOutput> {
  // 如果没有 grounding documents，跳过检查
  if (groundingDocs.length === 0) {
    logger.info("[Groundedness] 无 grounding documents，跳过检查");
    return {
      output,
      groundingScore: 1,
      removedClaims: [],
      verdict: "pass",
    };
  }

  // 拆分句子
  const sentences = splitIntoSentences(output);
  if (sentences.length === 0) {
    return {
      output,
      groundingScore: 1,
      removedClaims: [],
      verdict: "pass",
    };
  }

  logger.info(
    `[Groundedness] 开始检查: ${sentences.length} 个句子, ${groundingDocs.length} 个 grounding documents`,
  );

  // 调用 LLM Judge
  const judgeResult = await callJudge(sentences, groundingDocs, config);

  // 过滤
  const filtered = filterUngrounded(output, sentences, judgeResult);

  logger.info(
    `[Groundedness] 检查完成: verdict=${filtered.verdict}, score=${filtered.groundingScore.toFixed(2)}, removed=${filtered.removedClaims.length} 个声明`,
  );

  return filtered;
}
