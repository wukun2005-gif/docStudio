/**
 * Groundedness Detection — LLM-as-Judge 验证
 *
 * 照搬 patentExaminator groundednessCheck.ts，适配 i-Write 场景。
 *
 * 在 LLM 生成回答之后，检查回答是否忠实于检索到的文档，
 * 移除无支撑声明后再返回给用户。
 */
import { jsonrepair } from "jsonrepair";
import { logger } from "./logger.js";
import { registry, getBreaker } from "../providers/registry.js";
import { getModelCapabilities } from "../providers/model-capabilities-registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens } from "./llmUtils.js";

// ── 任务感知的模型选择 ──────────────────────────────────
//
// groundedness check 是"事实匹配 + JSON 结构化输出"任务，
// 不需要推理模型的推理深度。当且仅当用户启用了 model fallback 时，
// 主动从 fallback 链中挑选非推理模型。
//
// 选模型优先级：
//   1. 非推理 + supportsStructuredOutput（json_schema 保证结构正确，zero retry）
//   2. 非推理 + 不支持 structured output（json_object，靠 extractJudgeJson 兜底）
//   3. 都没有 → 回退主模型
//
// 原则：用户未启用 fallback 时，尊重用户的显式选择，不做替换。
function selectBestEvalModel(
  primaryModel: string,
  providerPreference: string[],
  dbSettings: ReturnType<typeof readSettingsFromDb>,
): string {
  const MIN_EVAL_TOKENS = 4096;

  // 基于实际观测的断路器状态，不猜模型名字
  const primaryBreaker = getBreaker(primaryModel);
  const primaryCaps = getModelCapabilities(primaryModel);
  if (!primaryBreaker.isOpen
    && (primaryBreaker.learnedMaxTokens == null || primaryBreaker.learnedMaxTokens >= MIN_EVAL_TOKENS)
    && primaryCaps.maxOutputTokens >= MIN_EVAL_TOKENS) return primaryModel;

  const fallbackMap = dbSettings.enableModelFallback ?? {};
  const fallbackLists = dbSettings.modelFallbacks ?? {};
  for (const pid of providerPreference) {
    if (!fallbackMap[pid]) continue;
    const list = fallbackLists[pid];
    if (!list || list.length === 0) continue;
    for (const m of list) {
      if (m === primaryModel) continue;
      const breaker = getBreaker(m);
      if (breaker.isOpen) continue;
      if (breaker.learnedMaxTokens != null && breaker.learnedMaxTokens < MIN_EVAL_TOKENS) continue;
      const caps = getModelCapabilities(m);
      if (caps.maxOutputTokens < MIN_EVAL_TOKENS) continue;
      if (caps.supportsStructuredOutput) {
        logger.info(`[Groundedness] 任务感知选模型: ${primaryModel} → ${m}`);
        return m;
      }
    }
  }
  return primaryModel;
}

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

/**
 * 尝试将任意对象中的 claims 适配为 ClaimVerdict 数组。
 * 处理 LLM 偶尔输出 claims 为 object（按 S1/S2 索引）而非 array 的情况。
 */
function tryAdaptClaims(raw: Record<string, unknown>): ClaimVerdict[] | null {
  const claims = raw.claims;
  if (!claims) return null;

  // 正常情况：claims 已经是数组
  if (Array.isArray(claims)) {
    return claims as ClaimVerdict[];
  }

  // 适配：claims 是 object（如 { "S1": {...}, "S2": {...} }）
  if (typeof claims === "object" && claims !== null) {
    const values = Object.values(claims as Record<string, unknown>);
    if (values.length > 0 && values.every((c) => c && typeof c === "object" && typeof (c as Record<string, unknown>).verdict === "string")) {
      return values as ClaimVerdict[];
    }
  }

  return null;
}

export function extractJudgeJson(text: string): JudgeResult | null {
  const rawLen = text.length;
  let cleaned = text.trim();
  const trimmedLen = cleaned.length;

  // 步骤 1: 剥离 markdown 代码块标记
  let fenceStripped = false;
  const fencePatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\w*\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pat of fencePatterns) {
    const m = cleaned.match(pat);
    if (m) {
      cleaned = m[1].trim();
      fenceStripped = true;
      break;
    }
  }
  const afterFenceLen = cleaned.length;

  // 步骤 2: 提取首尾大括号
  let braceExtracted = false;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
    braceExtracted = true;
  }
  const afterBraceLen = cleaned.length;

  // 步骤 2.5: 折叠连续逗号（LLM 偶发输出 ",,," 导致 jsonrepair 异常）
  cleaned = cleaned.replace(/,(\s*,)+/g, ",");

  // 步骤 3: jsonrepair 修复 + JSON.parse
  let repaired = "";
  try {
    repaired = jsonrepair(cleaned);
  } catch (repairErr) {
    // jsonrepair 自身抛出异常 → 尝试 regex 兜底提取关键指标
    // 不使用正则打地鼠修复 JSON，而是直接提取 groundedRatio 和 overallVerdict，
    // 避免 retry 给出更差的结果（如第一次 0.75 → retry 0.33）
    const cleanedPreview = cleaned.length <= 1000 ? cleaned : cleaned.slice(0, 500) + "\n...\n" + cleaned.slice(-500);
    logger.warn(
      `[Groundedness] extractJudgeJson: jsonrepair() 异常，尝试 regex 兜底, ` +
      `repairError=${repairErr instanceof Error ? repairErr.message : String(repairErr)}, ` +
      `文本快照(rawLen=${rawLen}, trimmedLen=${trimmedLen}, afterFence=${afterFenceLen}, afterBrace=${afterBraceLen}, ` +
      `fenceStripped=${fenceStripped}, braceExtracted=${braceExtracted}), ` +
      `输入给 jsonrepair 的文本:\n${cleanedPreview}`,
    );

    // Regex 兜底：从原始文本中提取 groundedRatio 和 overallVerdict
    const ratioMatch = cleaned.match(/"groundedRatio"\s*:\s*([0-9]+\.?[0-9]*)/);
    const verdictMatch = cleaned.match(/"overallVerdict"\s*:\s*"(pass|fail|partial)"/);
    if (ratioMatch) {
      const groundedRatio = parseFloat(ratioMatch[1]);
      const overallVerdict = (verdictMatch?.[1] as "pass" | "fail" | "partial") ?? "partial";
      logger.info(
        `[Groundedness] extractJudgeJson: regex 兜底成功, groundedRatio=${groundedRatio}, overallVerdict=${overallVerdict}, claims=0 (未解析个体声明)`,
      );
      return {
        claims: [],
        groundedRatio,
        overallVerdict,
      };
    }

    // regex 也提取不到 → 放弃，由 retry 兜底
    return null;
  }

  // 步骤 4: JSON.parse
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(repaired);
  } catch (parseErr) {
    // jsonrepair 修了但 JSON.parse 仍失败 → 这是关键诊断点
    const cleanedPreview = cleaned.length <= 500 ? cleaned : cleaned.slice(0, 250) + "\n...\n" + cleaned.slice(-250);
    const repairedPreview = repaired.length <= 1000 ? repaired : repaired.slice(0, 500) + "\n...\n" + repaired.slice(-500);
    const changed = repaired !== cleaned;
    logger.warn(
      `[Groundedness] extractJudgeJson: jsonrepair 修复后 JSON.parse 仍失败, ` +
      `parseError=${parseErr instanceof Error ? parseErr.message : String(parseErr)}, ` +
      `文本快照(rawLen=${rawLen}, trimmedLen=${trimmedLen}, afterFence=${afterFenceLen}, afterBrace=${afterBraceLen}, ` +
      `fenceStripped=${fenceStripped}, braceExtracted=${braceExtracted}), ` +
      `jsonrepair是否改动=${changed}, ` +
      `输入给 jsonrepair 的原文:\n${cleanedPreview}\n` +
      `jsonrepair 修复后:\n${repairedPreview}`,
    );

    // Regex 兜底：同 step 3 的 catch 逻辑
    const ratioMatch = cleaned.match(/"groundedRatio"\s*:\s*([0-9]+\.?[0-9]*)/);
    const verdictMatch = cleaned.match(/"overallVerdict"\s*:\s*"(pass|fail|partial)"/);
    if (ratioMatch) {
      const groundedRatio = parseFloat(ratioMatch[1]);
      const overallVerdict = (verdictMatch?.[1] as "pass" | "fail" | "partial") ?? "partial";
      logger.info(
        `[Groundedness] extractJudgeJson: JSON.parse 失败后 regex 兜底成功, groundedRatio=${groundedRatio}, overallVerdict=${overallVerdict}`,
      );
      return {
        claims: [],
        groundedRatio,
        overallVerdict,
      };
    }

    return null;
  }

  // 步骤 5: 适配 claims 结构
  const claims = tryAdaptClaims(raw);
  if (claims) {
    return {
      claims,
      groundedRatio: typeof raw.groundedRatio === "number" ? raw.groundedRatio : 0.5,
      overallVerdict: (["pass", "fail", "partial"].includes(raw.overallVerdict as string)
        ? raw.overallVerdict
        : "partial") as JudgeResult["overallVerdict"],
    };
  }

  // JSON 解析成功但 claims 结构不对（如 claims 缺失、claims 是 string 等奇葩格式）
  const rawKeys = Object.keys(raw);
  const claimsVal = raw.claims;
  const claimsType = typeof claimsVal;
  const isArray = Array.isArray(claimsVal);
  let claimsPreview = "";
  if (claimsVal !== undefined && claimsVal !== null) {
    const s = typeof claimsVal === "string" ? claimsVal : JSON.stringify(claimsVal);
    claimsPreview = s.length <= 500 ? s : s.slice(0, 250) + "\n...\n" + s.slice(-250);
  } else {
    claimsPreview = String(claimsVal);
  }
  logger.warn(
    `[Groundedness] extractJudgeJson: JSON 解析成功但 claims 适配失败, ` +
    `rawKeys=${JSON.stringify(rawKeys)}, claimsType=${claimsType}, isArray=${isArray}, ` +
    `claims值:\n${claimsPreview}`,
  );

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

    const primaryModel = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";
    const modelId = config.modelId // 调用方显式指定模型时，尊重选择
      ? primaryModel
      : selectBestEvalModel(primaryModel, providers, dbSettings);

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

    // 解析失败 → 输出响应原文的全部结构信息，便于复现
    const text = response.text;
    const hasFence = /```/.test(text);
    const hasBraces = text.includes("{");
    const hasBrackets = text.includes("[");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    const leadingChars = text.slice(0, Math.min(200, text.length));
    const trailingChars = text.slice(Math.max(0, text.length - 200));
    logger.warn(
      `[Groundedness] extractJudgeJson 失败, ` +
      `模型=${modelId}, ` +
      `textLen=${text.length}, ` +
      `hasFence=${hasFence}, ` +
      `hasBraces=${hasBraces}, ` +
      `hasBrackets=${hasBrackets}, ` +
      `firstBraceAt=${firstBrace}, ` +
      `lastBraceAt=${lastBrace}, ` +
      `开头200字符:\n${leadingChars}\n` +
      `结尾200字符:\n${trailingChars}\n` +
      `完整文本(≤2000则全量):\n${text.length <= 2000 ? text : text.slice(0, 1000) + "\n...[截断]...\n" + text.slice(-1000)}`,
    );
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

      const retryPrimaryModel = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";
      const retryModelId = config.modelId
        ? retryPrimaryModel
        : selectBestEvalModel(retryPrimaryModel, providers, dbSettings);

      const retryMaxTokens = resolveEvalMaxTokens(retryModelId);

      const { response: retryResponse } = await registry.runWithFallback(
        providers,
        {
          modelId: retryModelId,
          messages: [
            { role: "system", content: buildJudgePrompt(sentences, groundingDocs).system },
            { role: "user", content: buildJudgePrompt(sentences, groundingDocs).user },
            {
              role: "user",
              content: "注意：上一次调用未能输出有效的 JSON。请严格按 JSON 格式输出，不要输出任何解释性文字或 markdown 代码块。只输出一个 JSON 对象。",
            },
          ],
          apiKey: "",
          maxTokens: retryMaxTokens,
          temperature: 0,
          timeoutMs: config.timeoutMs ?? 180_000,
          evalMode: true,
        },
        undefined, undefined,
        providerApiKeys,
        config.providerBaseUrls,
      );

      if (!retryResponse.error) {
        const retryParsed = extractJudgeJson(retryResponse.text);
        if (retryParsed) {
          logger.info(`[Groundedness] 重试成功, model=${retryModelId}`);
          return retryParsed;
        }
        // 重试也解析失败 → 记录重试响应的结构信息
        const retryText = retryResponse.text;
        const hasFence2 = /```/.test(retryText);
        const hasBraces2 = retryText.includes("{");
        const firstBrace2 = retryText.indexOf("{");
        const lastBrace2 = retryText.lastIndexOf("}");
        logger.warn(
          `[Groundedness] 重试 extractJudgeJson 也失败, ` +
          `model=${retryModelId}, ` +
          `textLen=${retryText.length}, ` +
          `hasFence=${hasFence2}, ` +
          `hasBraces=${hasBraces2}, ` +
          `firstBraceAt=${firstBrace2}, ` +
          `lastBraceAt=${lastBrace2}, ` +
          `开头300字符:\n${retryText.slice(0, 300)}\n` +
          `结尾300字符:\n${retryText.slice(Math.max(0, retryText.length - 300))}`,
        );
      } else {
        logger.warn(
          `[Groundedness] 重试 LLM 调用返回 error: ` +
          `model=${retryModelId}, ` +
          `error=${retryResponse.error?.message ?? String(retryResponse.error)}`,
        );
      }
    } catch (retryErr) {
      logger.warn(
        `[Groundedness] 重试 LLM 调用抛出异常: ` +
        `err=${retryErr instanceof Error ? retryErr.message : String(retryErr)}, ` +
        `sentences=${sentences.length}句, ` +
        `docs=${groundingDocs.length}篇`,
      );
    }

    // ── 最终降级：Judge 两次调用均失败，保守保留全部内容 ──
    // 不将句子标记为 not_verifiable（会被 filterUngrounded 全删），
    // 返回空 claims 让 filterUngrounded 走"未找到 verdict → 保守保留"路径。
    // 日志记录 warning 供排查，但不破坏用户已生成的内容。
    logger.warn(
      `[Groundedness] Judge 两次调用均失败，保守保留全部 ${sentences.length} 个句子, ` +
      `docs=${groundingDocs.length}, ` +
      `模型=${config.modelId ?? "auto"}`,
    );
    return {
      claims: [],
      groundedRatio: 1.0,
      overallVerdict: "pass",
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