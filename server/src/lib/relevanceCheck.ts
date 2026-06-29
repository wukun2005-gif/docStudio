/**
 * 内容相关度检查 (Relevance Check)
 *
 * 按照 RAGAS Answer Relevancy 标准，验证生成内容是否与用户原始需求相关。
 *
 * 优化策略（参考 patentExaminator）：
 * 1. 根据 LLM 的 context window size 动态决定放多少章节
 * 2. 使用模型的 maxOutputTokens 能力，而非硬编码
 * 3. 推理模型自动 4x maxTokens
 * 4. 尽可能一次调用处理多个章节，失败时逐步回退
 *
 * 参考：
 * - RAGAS Answer Relevancy: https://docs.ragas.io/en/latest/concepts/metrics/answer_relevancy.html
 * - DeepEval: https://docs.confident-ai.com/docs/metrics-answer-relevancy
 */

import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { isReasoningModelStatic } from "../providers/openai.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens, estimateTokens, getModelContextInfo, calculateAvailableInputTokens } from "./llmUtils.js";

// ── 任务感知的模型选择 ──────────────────────────────────
//
// relevance check 是"逐句相关性判定 + JSON 结构化输出"任务，
// 不需要推理模型的推理深度。当且仅当用户启用了 model fallback 时，
// 主动从 fallback 链中挑选第一个非推理模型。

function selectBestEvalModel(
  primaryModel: string,
  providerPreference: string[],
  dbSettings: ReturnType<typeof readSettingsFromDb>,
): string {
  if (!isReasoningModelStatic(primaryModel)) return primaryModel;

  const fallbackMap = dbSettings.enableModelFallback ?? {};
  const fallbackEnabled = Object.values(fallbackMap).some(Boolean);
  if (!fallbackEnabled) return primaryModel;

  const fallbackLists = dbSettings.modelFallbacks ?? {};
  for (const pid of providerPreference) {
    if (!fallbackMap[pid]) continue;
    const list = fallbackLists[pid];
    if (!list || list.length === 0) continue;
    for (const m of list) {
      if (!isReasoningModelStatic(m)) {
        logger.info(`[RelevanceCheck] 任务感知选模型: ${primaryModel} → ${m} (非推理模型)`);
        return m;
      }
    }
  }
  return primaryModel;
}

// ============ Types ============

export interface RelevanceVerdict {
  text: string;
  relevant: boolean;
  reason?: string;
}

export interface RelevanceCheckResult {
  score: number;                 // 0-1
  verdicts: RelevanceVerdict[];
  irrelevantSentences: string[];
}

// ============ LLM Judge ============

const RELEVANCE_JUDGE_SYSTEM = `你是一名专业的文档相关性核查员。你的任务是逐句判断生成文档中的每个声明是否与用户原���需求直接相关。

CORRELATION RULES（按以下标准判定）：
- relevant：声明直接回答、支撑或展开用户需求的具体方面；或是文档结构中必要的组成部分
- irrelevant：声明是泛泛而谈、完全偏离主题、无意义的空洞内容

RELEVANT 的典型场景（遇到此类应标记为 relevant）：
- 文档开头的称呼/敬语（如"尊敬的陈宇、各位管理层"）— 这是面向特定读者的格式礼仪，与用户需求中指定的读者角色直接相关
- 章节间的结构引导句（如"下一节将分析技术就绪度"、"后续章节将详细拆解各业务线"）— 帮助读者理解文档结构，是专业文档的必要组成
- 面向不同读者的行动指引（如"请各部门负责人重点审阅对应模块"）— 与用户需��中"面向各负责人"的指示直接相关
- 总结性陈述（如"综上所述"）— 用于收束章节、提炼要点，是文档结构的正常组成

IRRELEVANT 的典型场景（遇到此类应标记为 irrelevant）：
- 纯常识性铺垫（如"软件工程是一门复杂的学科"）— 与用户的具体需求无关
- 完全空洞的套话（如"本报告将对多个维度进行深入分析"而不指明具体维度）
- 明显偏离用户需求主题的离题内容
- 在章节标题后机械重复用户需求但不提供任何新信息的句子

判定原则：
- 仅当声明完全无信息量或明显离题时标记为 irrelevant
- 对正常文档结构要素（称呼、过渡、总结）给予 relevant 判定
- 不确定时倾向于 relevant，因为文档结构完整性本身就是合格的

CRITICAL OUTPUT FORMAT（必须严格按以下 JSON schema 输出，不得输出任何非 JSON 内容，不得输出 markdown 代码块）：
{
  "verdicts": [
    {"text": "���判定的声明原文", "relevant": true, "reason": "具体相关原因"},
    {"text": "被判定的声明原文", "relevant": false, "reason": "具体不相关原因"}
  ],
  "irrelevant_sentences": ["不相关声明列表"],
  "relevance_ratio": 0.85
}

强制要求：
1. verdicts 必须覆盖输入中的每一个声明，不得遗漏
2. relevance_ratio = relevant 数量 / 总声明数量（保留两位小数）
3. 不要在 JSON 外输出任何解释性文字或 markdown 标记`;

const RELEVANCE_JUDGE_USER = `## 用户原始需求

\`\`\`
{{REQUIREMENT}}
\`\`\`

## 待评估内容

{{DOCUMENT}}

请基于「用户原始需求」逐句判断「当前待评估章节」（如果内容分段）中的每个声明是否相关。

判断时可以参考：
- 全文大纲：判断该声明是否服务于整体文档主线
- 前后章节摘要：判断该声明是否与前文承接、是否与后文呼应（避免重复或跑题）

注意：仅判断「当前待评估章节」中的声明，不要对「全文大纲」「前序/后续章节摘要」中的内容做判断。

输出 JSON：
{
  "verdicts": [
    {"text": "声明内容", "relevant": true/false, "reason": "原因"}
  ],
  "irrelevant_sentences": ["不相关的声明列表"],
  "relevance_ratio": 0.85
}`;

// ============ Core Logic ============

/**
 * 拆分文档为句子/声明（先去除 HTML 标签，避免 LLM 看到标签碎片导致返回的文本与 DOM textContent 不匹配）
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function splitIntoClaims(text: string): string[] {
  const cleanText = stripHtml(text);
  return cleanText
    .split(/[。！？；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/**
 * 解析 JSON 响应
 */
function parseJsonResponse<T>(content: string): T | null {
  // 先剥离 markdown 代码块标记（如 ```json ... ```）
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    return parsed as T;
  } catch {
    // 尝试提取 JSON 块（非贪婪匹配，防止跨多个 JSON 对象误匹配）
    const jsonMatch = cleaned.match(/\{(?:[^{}]|\{[^{}]*\})*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    // 最后回退：贪婪匹配整个 JSON
    const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
    if (greedyMatch) {
      try {
        return JSON.parse(greedyMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}


/**
 * 将章节分批，每批尽可能多地放入章节，但不超过 token 限制
 */
function batchSections(
  sections: Array<{ title: string; content: string }>,
  maxTokensPerBatch: number,
): Array<Array<{ title: string; content: string }>> {
  const batches: Array<Array<{ title: string; content: string }>> = [];
  let currentBatch: Array<{ title: string; content: string }> = [];
  let currentTokens = 0;

  for (const section of sections) {
    const claims = splitIntoClaims(section.content);
    if (claims.length === 0) continue;

    const doc = claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
    const sectionTokens = estimateTokens(doc);

    // 如果当前批次加上这个章节会超过限制，先保存当前批次
    if (currentBatch.length > 0 && currentTokens + sectionTokens > maxTokensPerBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(section);
    currentTokens += sectionTokens;
  }

  // 保存最后一个批次
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * 调用 LLM 进行相关度判定（参考 patentExaminator）
 */
async function callRelevanceJudge(
  requirement: string,
  document: string,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<RelevanceCheckResult> {
  const prompt = RELEVANCE_JUDGE_USER
    .replace("{{REQUIREMENT}}", requirement)
    .replace("{{DOCUMENT}}", document);

  const dbSettings = readSettingsFromDb();
  const providers = [providerId];
  const providerApiKeys: Record<string, string> = {};
  for (const pid of providers) {
    const key = apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const effectiveModelId = selectBestEvalModel(modelId, [providerId], dbSettings);
  const maxTokens = resolveEvalMaxTokens(effectiveModelId);
  logger.info(`[RelevanceCheck] 模型: ${effectiveModelId}, maxTokens: ${maxTokens}`);

  const jsonSchema = {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            relevant: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["text", "relevant"],
        },
      },
      irrelevant_sentences: { type: "array", items: { type: "string" } },
      relevance_ratio: { type: "number" },
    },
    required: ["verdicts", "irrelevant_sentences", "relevance_ratio"],
  };

  // ── 第一次调用 ──
  try {
    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: RELEVANCE_JUDGE_SYSTEM },
          { role: "user", content: prompt },
        ],
        apiKey: "",
        maxTokens,
        temperature: 0,
        timeoutMs: 180_000,
        evalMode: true,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "relevance_result", strict: true, schema: jsonSchema },
        },
      },
      undefined,
      undefined,
      providerApiKeys,
    );

    const parsed = parseJsonResponse<any>(response.text);
    if (parsed && Array.isArray(parsed.verdicts) && parsed.verdicts.length > 0) {
      return {
        score: 1,
        verdicts: parsed.verdicts ?? [],
        irrelevantSentences: parsed.irrelevant_sentences ?? parsed.irrelevantSentences ?? [],
      };
    }
    logger.warn(`[RelevanceCheck] 首次解析失败或 verdicts 为空，尝试重试`);
  } catch (e) {
    logger.warn(`[RelevanceCheck] LLM judge 首次调用失败: ${e}`);
  }

  // ── 重试一次（不使用 json_schema 强制，避免某些模型不支持） ──
  try {
    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: RELEVANCE_JUDGE_SYSTEM },
          { role: "user", content: prompt + "\n\n⚠️ 注意：上一次调用未能输出有效的 JSON。请严格按 JSON 格式输出，不要输出任何解释性文字或 markdown 代码块。" },
        ],
        apiKey: "",
        maxTokens,
        temperature: 0,
        timeoutMs: 180_000,
        evalMode: true,
      },
      undefined,
      undefined,
      providerApiKeys,
    );

    const parsed = parseJsonResponse<any>(response.text);
    if (parsed && Array.isArray(parsed.verdicts) && parsed.verdicts.length > 0) {
      logger.info(`[RelevanceCheck] 重试成功`);
      return {
        score: 1,
        verdicts: parsed.verdicts ?? [],
        irrelevantSentences: parsed.irrelevant_sentences ?? parsed.irrelevantSentences ?? [],
      };
    }
  } catch (e) {
    logger.warn(`[RelevanceCheck] LLM judge 重试也失败: ${e}`);
  }

  // ── 最终降级：score=0.5（而非满分），表示"无法判断" ──
  logger.warn(`[RelevanceCheck] LLM judge 两次调用/解析均失败，保守降级为 score=0.5`);
  return { score: 0.5, verdicts: [], irrelevantSentences: [] };
}

/**
 * 检查整个文档的相关度
 *
 * 优化策略（参考 patentExaminator）：
 * 1. 根据 LLM 的 context window size 动态决定放多少章节
 * 2. 使用模型的 maxOutputTokens 能力
 * 3. 推理模型自动 4x maxTokens
 * 4. 尽可能一次调用处理多个章节，失败时逐步回退
 */
export async function checkDocumentRelevance(
  sections: Array<{ title: string; content: string }>,
  requirement: string,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<RelevanceCheckResult> {
  // 获取模型能力（参考 patentExaminator）
  const modelInfo = getModelContextInfo(modelId);

  // 估算 system prompt + requirement 的 token 数
  const systemTokens = estimateTokens(RELEVANCE_JUDGE_SYSTEM);
  const requirementTokens = estimateTokens(requirement);
  const overheadTokens = systemTokens + requirementTokens + 500; // 500 for JSON structure

  // 计算可用于文档内容的 token 数（留 20% 缓冲）
  // 确保不超过模型的 contextWindow - maxOutputTokens
  const maxInputTokens = modelInfo.contextWindow - modelInfo.maxOutputTokens;
  let availableTokens = Math.min(
    Math.floor((maxInputTokens - overheadTokens) * 0.8),
    modelInfo.contextWindow - overheadTokens - modelInfo.maxOutputTokens,
  );

  // 单次 batch 输入规模上限（防止推理模型在大输入下超时）
  // 经验值：40K tokens ≈ 15K 汉字，对 262K 推理模型能在 60-120s 内完成
  const PER_BATCH_TOKEN_CAP = 40_000;
  if (availableTokens > PER_BATCH_TOKEN_CAP) {
    logger.info(`[RelevanceCheck] 将单批 token 上限从 ${availableTokens} 钳制到 ${PER_BATCH_TOKEN_CAP}，避免推理超时`);
    availableTokens = PER_BATCH_TOKEN_CAP;
  }

  // 为 running context（全文大纲 + 前后章节摘要）预留 token 空间
  // 估算：大纲 ~10 tokens/章节 × N 章节 + 前后各 2 节 × 300 字 ≈ 1000-2000 tokens
  const RUNNING_CONTEXT_BUDGET = Math.min(
    3000,
    Math.floor(sections.length * 15 + 4 * 200),
  );
  availableTokens = Math.max(5000, availableTokens - RUNNING_CONTEXT_BUDGET);

  // 将章节分批
  const batches = batchSections(sections, availableTokens);

  logger.info(`[RelevanceCheck] 章节总数: ${sections.length}, 分批数: ${batches.length}, contextWindow: ${modelInfo.contextWindow}, maxOutputTokens: ${modelInfo.maxOutputTokens}, availableTokens: ${availableTokens}, runningCtxBudget: ${RUNNING_CONTEXT_BUDGET}`);

  // ── 构建全文大纲（作为 running context 的一部分）──────────
  // 评估器需要看到全文结构才能判断某章节是否偏离主线，而不是孤立判断
  const outlineText = sections
    .map((s, i) => `${i + 1}. ${s.title}`)
    .join("\n");

  // 计算每个 batch 覆盖的原始章节索引范围
  const batchRanges: Array<{ startIdx: number; endIdx: number }> = [];
  let cursor = 0;
  for (const batch of batches) {
    batchRanges.push({ startIdx: cursor, endIdx: cursor + batch.length - 1 });
    cursor += batch.length;
  }

  // 为指定 batch 生成 running context（全文大纲 + 前后相邻章节摘要）
  const buildRunningContext = (batchIdx: number): string => {
    const parts: string[] = [];
    parts.push(`【全文大纲】\n${outlineText}`);

    const { startIdx, endIdx } = batchRanges[batchIdx]!;

    // 前序章节摘要（取紧邻的 1-2 节，每节取前 300 字）
    const prevSummaries: string[] = [];
    for (let i = Math.max(0, startIdx - 2); i < startIdx; i++) {
      const s = sections[i]!;
      const snippet = s.content.slice(0, 300).replace(/\n+/g, " ");
      prevSummaries.push(`- 章节 ${i + 1}「${s.title}」: ${snippet}${s.content.length > 300 ? "..." : ""}`);
    }
    if (prevSummaries.length > 0) {
      parts.push(`\n【前序章节摘要】\n${prevSummaries.join("\n")}`);
    }

    // 后续章节摘要
    const nextSummaries: string[] = [];
    for (let i = endIdx + 1; i < Math.min(sections.length, endIdx + 3); i++) {
      const s = sections[i]!;
      const snippet = s.content.slice(0, 300).replace(/\n+/g, " ");
      nextSummaries.push(`- 章节 ${i + 1}「${s.title}」: ${snippet}${s.content.length > 300 ? "..." : ""}`);
    }
    if (nextSummaries.length > 0) {
      parts.push(`\n【后续章节摘要】\n${nextSummaries.join("\n")}`);
    }

    return parts.join("\n");
  };

  // 串行处理每个批次（避免同一 API Key 并发请求导致百炼等网关超时）
  const allVerdicts: RelevanceVerdict[] = [];
  const irrelevantSentences: string[] = [];

  let batchFailCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const batchContent = batch.map((section, idx) => {
      const claims = splitIntoClaims(section.content);
      return `### 章节 ${idx + 1}: ${section.title}\n${claims.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
    }).join("\n\n");

    const runningCtx = buildRunningContext(i);
    const doc = `${runningCtx}\n\n【当前待评估章节】\n${batchContent}`;

    try {
      const result = await callRelevanceJudge(requirement, doc, apiKey, providerId, modelId);
      // callRelevanceJudge 在失败时返回 score=0.5 的保守降级，这里正常收集 verdicts
      allVerdicts.push(...result.verdicts);
      irrelevantSentences.push(...(result.irrelevantSentences ?? []));
    } catch (e) {
      // 批次失败时：这些句子不进入相关度计算，但也不影响总分——保守标记为 irrelevant
      // （之前的逻辑是默认全部 relevant，导致 score=1，这是 bug）
      batchFailCount++;
      for (const section of batch) {
        const claims = splitIntoClaims(section.content);
        claims.forEach((text) => {
          allVerdicts.push({ text, relevant: false, reason: "检查失败，保守标记为不相关" });
        });
      }
      logger.warn(`[RelevanceCheck] 批次 ${i + 1} 失败，保守标记为不相关: ${e}`);
    }
  }

  const total = allVerdicts.length;
  const relevantCount = allVerdicts.filter((v) => v.relevant).length;
  // 所有批次都失败时 score=0.5（无法判断）；否则按实际 relevant/total 计算
  const score = total === 0
    ? 0.5
    : (batchFailCount === batches.length ? 0.5 : relevantCount / total);

  return {
    score,
    verdicts: allVerdicts,
    irrelevantSentences,
  };
}