/**
 * Fidelity Check — LLM-as-Judge 文档相关性评估
 *
 * 在 RAG 检索之后、调用①（tool calling）之前，用 LLM 逐篇判断检索文档
 * 是否包含撰写指定章节所需的实质性信息。用 fidelityScore 替代 RRF score
 * 做 RAG 门控决策依据。
 *
 * 遵循 groundednessCheck.ts / relevanceCheck.ts 的 evaluator 模式。
 */
import { jsonrepair } from "jsonrepair";
import { logger } from "./logger.js";
import { registry, isModelQuotaExhausted, isModelTimeoutCooldown } from "../providers/registry.js";
import { isReasoningModelStatic } from "../providers/openai.js";
import { getModelCapabilities } from "../providers/model-capabilities-registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens } from "./llmUtils.js";

// ── 任务感知的模型选择 ──────────────────────────────────
//
// Fidelity check 是"二元文档相关性判断"任务，不需要推理深度。
// 当且仅当用户启用了 model fallback 时，主动从 fallback 链挑选非推理模型。
//
// 选模型优先级：
//   1. 非推理 + supportsStructuredOutput（json_schema 保证结构正确）
//   2. 非推理 + 不支持 structured output（纯文本，靠 parseFidelityResponse 兜底）
//   3. 都没有 → 回退主模型
//
// 原则：用户未启用 fallback 时，尊重用户的显式选择，不做替换。
function selectBestEvalModel(
  primaryModel: string,
  providerPreference: string[],
  dbSettings: ReturnType<typeof readSettingsFromDb>,
): string {
  if (!isReasoningModelStatic(primaryModel)) return primaryModel;

  const fallbackMap = dbSettings.enableModelFallback ?? {};
  const fallbackEnabled = Object.values(fallbackMap).some(Boolean);
  if (!fallbackEnabled) return primaryModel;

  // 从 fallback 链扫描：只选【非推理 + 支持 structured output + 容量足够 + 不在冷却】的模型
  // 不降级到无 structured output 的模型 — 这类模型（如 qwen-max）对 JSON 评估任务
  // 频繁返回空响应，反而比主模型更差。
  const fallbackLists = dbSettings.modelFallbacks ?? {};
  for (const pid of providerPreference) {
    if (!fallbackMap[pid]) continue;
    const list = fallbackLists[pid];
    if (!list || list.length === 0) continue;
    for (const m of list) {
      if (!isReasoningModelStatic(m)) {
        if (isModelQuotaExhausted(m)) continue;
        if (isModelTimeoutCooldown(m)) continue;
        const caps = getModelCapabilities(m);
        if (caps.maxOutputTokens < 4096) continue;
        if (caps.supportsStructuredOutput) {
          logger.info(`[Fidelity] 任务感知选模型: ${primaryModel} → ${m} (非推理, 支持结构化输出)`);
          return m;
        }
      }
    }
  }

  // 找不到合适的非推理模型 → 保留主模型
  return primaryModel;
}

// ── 类型定义 ──────────────────────────────────────────

export interface FidelityDoc {
  content: string;
  score: number;
  sourceName?: string;
}

export interface PerDocumentVerdict {
  index: number;
  relevant: boolean;
  reason?: string;
}

export interface FidelityResult {
  fidelityScore: number;
  perDocument: PerDocumentVerdict[];
}

export interface FidelityConfig {
  apiKey?: string;
  providerPreference?: string[];
  modelId?: string;
  providerBaseUrls?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ── Prompt 构建 ──────────────────────────────────────

const FIDELITY_SYSTEM_PROMPT = `你是一名文档检索质量评估员。你的任务是判断每篇检索到的文档是否包含可用于撰写指定章节的实质性信息。

判断标准：
- relevant: 该文档包含与章节主题相关的实质性信息（事实、数据、观点、分析），可以直接或经过改编后用于章节写作
- not_relevant: 该文档内容与章节主题无关，或内容空洞不包含实质性信息

判定指引：
- 一份文档只要有一部分内容与章节相关，就应判定为 relevant
- 如果文档内容看似相关但全是泛泛而谈、不包含任何具体信息，则判定为 not_relevant
- 仅当文档与章节主题完全无关、内容为空、或全是无意义的元信息时标记为 not_relevant
- 不确定时倾向于 relevant（宁可放行也不错误拦截）

输出严格的 JSON，不要在 JSON 外输出任何文字或 markdown 标记：
{
  "per_document": [
    {"index": 0, "relevant": true, "reason": "包含章节所需的具体数据"},
    {"index": 1, "relevant": false, "reason": "内容与章节主题完全无关"}
  ],
  "fidelity_score": 0.75
}`;

function buildFidelityPrompt(
  sources: FidelityDoc[],
  sectionTitle: string,
  sectionDescription?: string,
): { system: string; user: string } {
  const docsSection = sources
    .map((s, i) => {
      const label = s.sourceName ? `《${s.sourceName}》` : "";
      const scoreInfo = `（相似度: ${s.score.toFixed(2)}）`;
      // 截断：每篇文档最多 3000 字符
      const truncated = s.content.length > 3000
        ? s.content.slice(0, 3000) + "…"
        : s.content;
      return `[${i}] ${label}${scoreInfo}\n${truncated}`;
    })
    .join("\n\n---\n\n");

  const descLine = sectionDescription
    ? `\n## 章节描述\n${sectionDescription}`
    : "";

  const user = `## 待撰写章节
${sectionTitle}${descLine}

## 检索到的文档（共 ${sources.length} 篇）

${docsSection}

请逐篇判断每篇文档是否包含可用于撰写上述章节的实质性信息。`;

  return { system: FIDELITY_SYSTEM_PROMPT, user };
}

// ── JSON 解析 ────────────────────────────────────────

function parseFidelityResponse(text: string): FidelityResult | null {
  let cleaned = text.trim();

  // 步骤 1: 剥离 markdown 代码块
  const fencePatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\w*\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pat of fencePatterns) {
    const m = cleaned.match(pat);
    if (m) {
      cleaned = m[1]!.trim();
      break;
    }
  }

  // 步骤 2: 提取花括号
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    logger.warn(`[Fidelity] parseFidelityResponse: 未找到有效 JSON 对象, textLen=${text.length}`);
    return null;
  }
  cleaned = cleaned.substring(start, end + 1);

  // 步骤 3: jsonrepair + JSON.parse
  let repaired: string;
  try {
    repaired = jsonrepair(cleaned);
  } catch {
    logger.warn(`[Fidelity] parseFidelityResponse: jsonrepair 异常, textLen=${text.length}`);
    return null;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(repaired);
  } catch (parseErr) {
    logger.warn(
      `[Fidelity] parseFidelityResponse: jsonrepair 后 JSON.parse 仍失败, ` +
      `parseError=${parseErr instanceof Error ? parseErr.message : String(parseErr)}, ` +
      `textLen=${text.length}`,
    );
    return null;
  }

  // 步骤 4: 提取 per_document 数组
  const perDocRaw = raw.per_document;
  if (!Array.isArray(perDocRaw)) {
    logger.warn(`[Fidelity] parseFidelityResponse: per_document 不是数组, type=${typeof perDocRaw}`);
    return null;
  }

  const perDocument: PerDocumentVerdict[] = [];
  for (const item of perDocRaw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.index !== "number") continue;
    if (typeof obj.relevant !== "boolean") continue;
    perDocument.push({
      index: obj.index,
      relevant: obj.relevant,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
    });
  }

  if (perDocument.length === 0) {
    logger.warn(`[Fidelity] parseFidelityResponse: per_document 解析后为空`);
    return null;
  }

  // 步骤 5: fidelity_score
  // 始终从 perDocument 计算，保证分数与逐篇判断数学一致。
  // LLM 返回的 fidelity_score 字段仅供参考（可能不一致，如 1/3 相关却返回 0.67）。
  const relevantCount = perDocument.filter((d) => d.relevant).length;
  const fidelityScore = perDocument.length > 0
    ? relevantCount / perDocument.length
    : 0;

  // 对比日志：LLM 返回的 fidelity_score 与计算值差异较大时 warn
  if (typeof raw.fidelity_score === "number") {
    const llmScore = Math.max(0, Math.min(1, raw.fidelity_score));
    if (Math.abs(llmScore - fidelityScore) > 0.1) {
      logger.warn(
        `[Fidelity] LLM 返回的 fidelity_score=${llmScore.toFixed(2)} 与 ` +
        `计算值 relevant/total=${relevantCount}/${perDocument.length}=${fidelityScore.toFixed(2)} 不一致，以计算值为准`,
      );
    }
  }

  return { fidelityScore, perDocument };
}

// ── 主函数 ──────────────────────────────────────────

export async function checkFidelity(
  sources: FidelityDoc[],
  sectionTitle: string,
  sectionDescription?: string,
  config: FidelityConfig = {},
): Promise<FidelityResult> {
  if (sources.length === 0) {
    return { fidelityScore: 0, perDocument: [] };
  }

  const { system, user } = buildFidelityPrompt(sources, sectionTitle, sectionDescription);

  try {
    const dbSettings = readSettingsFromDb();
    const providers = config.providerPreference ?? dbSettings.providerPreference ?? ["mimo"];
    const primaryModel = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";
    const evalModel = selectBestEvalModel(primaryModel, providers, dbSettings);

    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = config.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const caps = getModelCapabilities(evalModel);
    const supportsSO = caps.supportsStructuredOutput;

    logger.info(
      `[Fidelity] 开始评估: model=${evalModel}, ` +
      `supportsSO=${supportsSO}, ` +
      `docs=${sources.length}, ` +
      `section="${sectionTitle}"`,
    );

    // ── 能力自适应：支持 SO 用 json_schema，不支持则不发送 responseFormat ──
    const requestOverrides: {
      responseFormat?: {
        type: "json_schema";
        json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
      };
    } = {};
    if (supportsSO) {
      requestOverrides.responseFormat = {
        type: "json_schema",
        json_schema: {
          name: "fidelity_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              per_document: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    relevant: { type: "boolean" },
                    reason: { type: "string" },
                  },
                  required: ["index", "relevant"],
                },
              },
              fidelity_score: { type: "number" },
            },
            required: ["per_document", "fidelity_score"],
          },
        },
      };
    }

    // Fidelity check 是轻量级"文档是否相关"判断。
    // 默认 30s：bailian 等 provider 的 qwen 模型 15s 内频繁超时，30s 仍远低于 generateSection 的 180s。
    const fidelityTimeout = config.timeoutMs ?? 30_000;

    // ── 第一次调用 ──
    const result = await registry.runWithFallback(
      providers,
      {
        modelId: evalModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        apiKey: "",
        maxTokens: resolveEvalMaxTokens(evalModel),
        temperature: 0,
        timeoutMs: fidelityTimeout,
        evalMode: true,
        signal: config.signal,
        ...requestOverrides,
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    );

    if (result.response.error) {
      logger.warn(`[Fidelity] 第一次调用返回 error: ${result.response.error.message}`);
    } else {
      const parsed = parseFidelityResponse(result.response.text);
      if (parsed) {
        logger.info(`[Fidelity] 评估完成: fidelity=${parsed.fidelityScore.toFixed(2)}, relevant=${parsed.perDocument.filter(d => d.relevant).length}/${parsed.perDocument.length}`);
        return parsed;
      }
      // 仅解析失败才重试（超时/网络错误不重试，避免加倍阻塞）
      if (!result.response.error) {
        logger.warn(`[Fidelity] 解析失败，快速重试 (无 responseFormat, model=${evalModel})`);

        const retryResult = await registry.runWithFallback(
          providers,
          {
            modelId: evalModel,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
              {
                role: "user",
                content: "注意：上一次调用未能输出有效的 JSON。请严格按 JSON 格式输出，不要输出任何解释性文字或 markdown 代码块。只输出一个 JSON 对象。",
              },
            ],
            apiKey: "",
            maxTokens: resolveEvalMaxTokens(evalModel),
            temperature: 0,
            timeoutMs: Math.min(fidelityTimeout, 20_000),
            evalMode: true,
            signal: config.signal,
          },
          undefined, undefined,
          providerApiKeys,
          config.providerBaseUrls,
        );

        if (!retryResult.response.error) {
          const retryParsed = parseFidelityResponse(retryResult.response.text);
          if (retryParsed) {
            logger.info(`[Fidelity] 重试成功: fidelity=${retryParsed.fidelityScore.toFixed(2)}`);
            return retryParsed;
          }
          logger.warn(`[Fidelity] 重试解析也失败, textLen=${retryResult.response.text.length}`);
        } else {
          logger.warn(`[Fidelity] 重试 LLM 返回 error: ${retryResult.response.error.message}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`[Fidelity] LLM 调用异常: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 评估失败：抛异常让调用方走默认路径 ──
  throw new Error("Fidelity check 评估失败（LLM 超时/报错/解析失败），调用方应走默认路径");
}