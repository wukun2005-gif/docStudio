/**
 * 内容完整度检查 (Completeness Check)
 *
 * 按照 RAGAS Context Recall 标准，验证生成文档是否覆盖了用户需求的所有要点。
 *
 * 公式：覆盖的需求要点数 / 需求的总要点数
 *
 * 参考：
 * - RAGAS Context Recall: https://docs.ragas.io/en/latest/concepts/metrics/context_recall.html
 * - DeepEval: https://docs.confident-ai.com/docs/metrics-contextual-recall
 */

import { logger } from "./logger.js";
import { registry, getBreaker } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens, estimateTokens } from "./llmUtils.js";
import { getModelCapabilities } from "../providers/model-capabilities-registry.js";
import { jsonrepair } from "jsonrepair";

// ── 任务感知的模型选择 ──────────────────────────────────
//
// 不猜模型名字。基于实际观测的断路器状态和学习的参数上限来判断。
// 主模型没有已知问题就直接用，有问题才找替代。

function selectBestEvalModel(
  primaryModel: string,
  providerPreference: string[],
  dbSettings: ReturnType<typeof readSettingsFromDb>,
): string {
  const MIN_EVAL_TOKENS = 4096;

  // 主模型检查：断路 或 学习到的上限不足 或 声明容量不足 → 需要替代
  const primaryBreaker = getBreaker(primaryModel);
  const primaryCaps = getModelCapabilities(primaryModel);
  const primaryNeedsFallback = primaryBreaker.isOpen
    || (primaryBreaker.learnedMaxTokens != null && primaryBreaker.learnedMaxTokens < MIN_EVAL_TOKENS)
    || primaryCaps.maxOutputTokens < MIN_EVAL_TOKENS;

  if (!primaryNeedsFallback) return primaryModel;

  // 主模型有问题 → 从 fallback 链中找第一个健康的替代
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
      if (!caps.supportsStructuredOutput) continue;
      logger.info(`[CompletenessCheck] 任务感知选模型: ${primaryModel} → ${m}（${primaryBreaker.isOpen ? `断路器OPEN(${primaryBreaker.lastErrorCode})` : "容量不足"}）`);
      return m;
    }
  }
  return primaryModel;
}

// ============ Types ============

export interface RequirementPoint {
  point: string;
  covered: boolean;
  reason?: "missing" | "lack_source";  // missing=内容未覆盖, lack_source=缺少来源支撑
  evidence?: string;                   // 文档中覆盖该要点的内容或缺失说明
}

export interface CompletenessCheckResult {
  score: number;                    // 0-1
  requirementPoints: RequirementPoint[];
  coveredPoints: string[];
  missingPoints: string[];
  lackSourcePoints: string[];       // 缺少来源支撑的要点
}

// ============ LLM Judge ============

const COMPLETENESS_JUDGE_SYSTEM = `你是一名专业的文档完整度核查员。你的任务是：先从用户原始需求中提取所有具体、可验证的内容要点，然后逐一检查每个要点是否在生成的文档中被充分覆盖。用专业判断而非极端标准：仅当文档完全缺少对要点的实质性覆盖时才标记为 missing。

COMPLETENESS RULES（严格执行）：
- covered：文档中明确、充分地回答或展开了该需求要点，有具体的事实、数据或结论支撑
- missing：文档未提及该要点、或仅表面提及但未展开、或回答得不够具体无法满足用户需求

EXTRACTION RULES：
- 提取的是内容维度的需求要点（如"评估 Sprint 3-4 的进度"、"列出关键风险"、"给出 GoToMarket 计划"）
- 不要提取格式/结构类元数据作为需求要点（如"文档标题应为XXX"、"章节应命名为XXX"、"标题区/分隔线/页码统一风格"、"深色专业配色"）— 这类格式要素不影响内容质量判定
- 不要提取纯视觉/排版要求（如"配色方案"、"字体大小"、"页眉页脚样式"、"封面设计"）— 这些是设计要求不是内容要求
- 不要提取过于宽泛或模糊的句子（如"写一份报告"不应拆出，必须拆到具体维度）
- 每个要点应具体到可以独立验证"是否覆盖"

COVERAGE RULES（覆盖面判定原则）：
- 覆盖可以是直接引用，也可以是合理但表述不同的覆盖
- 例如：需求要求"技术就绪度章节包含系统架构稳定性评估"，文档在技术就绪度章节中描述了架构稳定性，即使措辞不完全相同，也应判定为 covered
- 例如：需求中写了完整的文档标题，但文档使用了简化的标题（如"产品发布准备度评估"），这是合理的标题改写，不应作为遗漏的内容要点
- 仅当文档对需求要点完全缺少实质性覆盖时，才标记为 missing
- 不确定时倾向于 covered

CRITICAL OUTPUT FORMAT（必须严格按以下 JSON schema 输出，不得输出任何非 JSON 内容，不得输出 markdown 代码块）：
{
  "requirement_points": [
    {"point": "具体需求要点", "covered": true, "evidence": "文档中覆盖该要点的具体段落或数据"},
    {"point": "具体需求要点", "covered": false, "evidence": null}
  ],
  "covered_points": ["已覆盖的要点列表"],
  "missing_points": ["遗漏的要点列表"],
  "completeness_ratio": 0.72
}

强制要求：
1. requirement_points 必须覆盖用户需求中所有可独立验证的具体内容要点，但不包括格式/标题类元数据
2. completeness_ratio = covered 数量 / 总要点数量（保留两位小数）
3. 对于每个要点，区分两种情况：
   - "内容未覆盖"：文档中完全没有提到该要点
   - "缺少来源支撑"：文档提到了该要点，但内容缺乏来源支撑（如具体数据、引用等）
4. 不要在 JSON 外输出任何解释性文字或 markdown 标记`;

const COMPLETENESS_JUDGE_USER = `## 用户原始需求

\`\`\`
{{REQUIREMENT}}
\`\`\`

## 生成的文档内容

{{DOCUMENT}}

请先从用户需求中提取所有具体要点，然后逐一检查每个要点是否在文档中被覆盖。

对于每个要点，判断：
1. covered=true：文档中明确覆盖了该要点，且有具体数据/引用支撑
2. covered=false, reason="missing"：文档中完全没有提到该要点
3. covered=false, reason="lack_source"：文档提到了该要点，但缺乏具体数据或来源支撑（如"需要补充 Teams Chat 协作频次数据"）

输出 JSON：
{
  "requirement_points": [
    {"point": "具体需求要点", "covered": true/false, "reason": "missing/lack_source", "evidence": "覆盖该要点的文档内容或缺失说明"}
  ],
  "covered_points": ["已覆盖的要点列表"],
  "missing_points": ["内容未覆盖的要点列表"],
  "lack_source_points": ["缺少来源支撑的要点列表"],
  "completeness_ratio": 0.75
}`;

// ============ Core Logic ============

/**
 * 解析 LLM JSON 响应（使用 jsonrepair 处理 LLM 输出不确定性）
 * 照搬 groundednessCheck.ts 的同名函数
 */
function parseJsonResponse<T>(content: string): T | null {
  const rawLen = content.length;
  let cleaned = content.trim();

  // 步骤 1: 剥离 markdown 代码块标记
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

  // 步骤 2: 提取首尾大括号之间的内容
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 步骤 2.5: 折叠连续逗号
  cleaned = cleaned.replace(/,(\s*,)+/g, ",");

  // 步骤 3: jsonrepair 修复 + JSON.parse
  let repaired: string;
  try {
    repaired = jsonrepair(cleaned);
  } catch {
    return null;
  }

  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

/**
 * 调用 LLM 进行完整度判定（参考 patentExaminator）
 */
async function callCompletenessJudge(
  requirement: string,
  document: string,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<CompletenessCheckResult> {
  const prompt = COMPLETENESS_JUDGE_USER
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
  logger.info(`[CompletenessCheck] 模型: ${effectiveModelId}, maxTokens: ${maxTokens}`);

  const jsonSchema = {
    type: "object",
    properties: {
      requirement_points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            point: { type: "string" },
            covered: { type: "boolean" },
            reason: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["point", "covered"],
        },
      },
      covered_points: { type: "array", items: { type: "string" } },
      missing_points: { type: "array", items: { type: "string" } },
      lack_source_points: { type: "array", items: { type: "string" } },
      completeness_ratio: { type: "number" },
    },
    required: ["requirement_points", "covered_points", "missing_points", "completeness_ratio"],
  };

  const parseAndMap = (text: string): CompletenessCheckResult | null => {
    const parsed = parseJsonResponse<any>(text);
    if (!parsed) return null;
    // LLM 按 prompt 用 snake_case 输出，做双向兼容
    const raw = parsed as unknown as Record<string, unknown>;
    const coveredPoints = Array.isArray(raw.covered_points)
      ? (raw.covered_points as string[])
      : (parsed.coveredPoints ?? []);
    const missingPoints = Array.isArray(raw.missing_points)
      ? (raw.missing_points as string[])
      : (parsed.missingPoints ?? []);
    const lackSourcePoints = Array.isArray(raw.lack_source_points)
      ? (raw.lack_source_points as string[])
      : (parsed.lackSourcePoints ?? []);
    const requirementPoints = Array.isArray(raw.requirement_points)
      ? (raw.requirement_points as RequirementPoint[])
      : (parsed.requirementPoints ?? []);
    if (!Array.isArray(requirementPoints) || requirementPoints.length === 0) return null;
    return {
      score: parsed.score ?? 1,
      requirementPoints,
      coveredPoints,
      missingPoints,
      lackSourcePoints,
    };
  };

  // ── 第一次调用（带 JSON schema 强制） ──
  try {
    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: COMPLETENESS_JUDGE_SYSTEM },
          { role: "user", content: prompt },
        ],
        apiKey: "",
        maxTokens,
        temperature: 0,
        timeoutMs: 180_000,
        evalMode: true,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "completeness_result", strict: true, schema: jsonSchema },
        },
      },
      undefined,
      undefined,
      providerApiKeys,
    );

    const result = parseAndMap(response.text);
    if (result) return result;
    logger.warn(`[CompletenessCheck] 首次解析失败或要点为空，尝试重试`);
  } catch (e) {
    logger.warn(`[CompletenessCheck] LLM judge 首次调用失败: ${e}`);
  }

  // ── 重试一次（不使用 json_schema 强制） ──
  try {
    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: COMPLETENESS_JUDGE_SYSTEM },
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

    const result = parseAndMap(response.text);
    if (result) {
      logger.info(`[CompletenessCheck] 重试成功`);
      return result;
    }
  } catch (e) {
    logger.warn(`[CompletenessCheck] LLM judge 重试也失败: ${e}`);
  }

  // ── 最终降级：score=0.5（而非满分），表示"无法判断" ──
  logger.warn(`[CompletenessCheck] LLM judge 两次调用/解析均失败，保守降级为 score=0.5`);
  return { score: 0.5, requirementPoints: [], coveredPoints: [], missingPoints: [], lackSourcePoints: [] };
}

/**
 * 检查整个文档的完整度
 */
export async function checkDocumentCompleteness(
  sections: Array<{ title: string; content: string }>,
  requirement: string,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<CompletenessCheckResult> {
  // ── 内容充足性预检：检测 post-filter 冲突裁剪后的空壳章节 ──
  // 当章节内容极短（< 200 字符），说明冲突过滤已将其内容大幅移除，
  // 这些章节不应被视为"已覆盖"，需要注入到 LLM judge 的 prompt 中。
  const CONTENT_SUFFICIENCY_THRESHOLD = 200; // 字符数，低于此值视为内容不充分
  const insufficientSections: Array<{ title: string; charCount: number }> = [];
  for (const sec of sections) {
    const textLen = (sec.content || "").replace(/<[^>]+>/g, "").trim().length; // 去 HTML 标签后的纯文本长度
    if (textLen < CONTENT_SUFFICIENCY_THRESHOLD) {
      insufficientSections.push({ title: sec.title, charCount: textLen });
    }
  }
  const insufficiencyNote = insufficientSections.length > 0
    ? `\n\n⚠️ 内容充足性警告：以下章节因知识库来源冲突已被大幅裁剪，内容几乎为空，不应视为已充分覆盖：\n${
        insufficientSections.map((s) => `- ${s.title}（纯文本仅 ${s.charCount} 字符）`).join("\n")
      }\n请将这些章节对应的需求要点标记为 missing（除非其他章节中有充分覆盖）。`
    : "";
  logger.info(`[CompletenessCheck] 内容充足性预检: ${insufficientSections.length}/${sections.length} 章节内容不足${insufficientSections.length > 0 ? ` (${insufficientSections.map(s => s.title).join(", ")})` : ""}`);

  // ── 分批策略：保留全文覆盖，不截断（避免丢失尾部章节的覆盖信息）──
  // 单批上限 40K tokens，超出则分批调用 + 合并结果
  const MAX_BATCH_TOKENS = 40_000;

  // 构建全文大纲作为 running context（让评估器知道还有哪些章节未在本批出现）
  const outlineText = sections
    .map((s, i) => `${i + 1}. ${s.title}`)
    .join("\n");

  // 按 token 上限将章节分批
  const batches: Array<Array<{ title: string; content: string }>> = [];
  let currentBatch: Array<{ title: string; content: string }> = [];
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);
    if (currentBatch.length > 0 && currentTokens + sectionTokens > MAX_BATCH_TOKENS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }
    currentBatch.push(section);
    currentTokens += sectionTokens;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  logger.info(`[CompletenessCheck] 章节总数: ${sections.length}, 分批数: ${batches.length}`);

  // 合并所有批次的结果
  const allRequirementPoints: RequirementPoint[] = [];
  const coveredPointsSet = new Set<string>();
  const missingPointsSet = new Set<string>();
  let totalRatio = 0;
  let ratioCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const batchDoc = batch
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join("\n\n");

    // 注入全文大纲作为 running context + 内容充足性警告（仅首批）
    const batchLabel = batches.length === 1 ? "" : `\n\n【当前批次：第 ${i + 1}/${batches.length} 批，包含章节：${batch.map((s) => s.title).join("、")}】`;
    const sufficiencyWarning = i === 0 ? insufficiencyNote : "";
    const docWithOutline = `【全文大纲】\n${outlineText}${batchLabel}\n\n【本批章节内容】\n\n${batchDoc}${sufficiencyWarning}`;

    try {
      const result = await callCompletenessJudge(requirement, docWithOutline, apiKey, providerId, modelId);
      const ratio = (result as any).completeness_ratio;
      if (typeof ratio === 'number' && ratio > 0) {
        totalRatio += ratio;
        ratioCount++;
      }
      for (const p of result.requirementPoints ?? []) {
        // 去重：同一要点在多批都被识别时取最严判定（有 covered=true 就保留）
        const existing = allRequirementPoints.find((ep) => ep.point === p.point);
        if (!existing) {
          allRequirementPoints.push(p);
        } else if (!existing.covered && p.covered) {
          existing.covered = true;
          existing.evidence = p.evidence;
        }
      }
      (result.coveredPoints ?? []).forEach((p) => coveredPointsSet.add(p));
      (result.missingPoints ?? []).forEach((p) => missingPointsSet.add(p));
    } catch (e) {
      logger.warn(`[CompletenessCheck] 批次 ${i + 1} 失败: ${e}`);
    }
  }

  // 已被覆盖的要点从 missing 中移除
  for (const cp of coveredPointsSet) missingPointsSet.delete(cp);

  // 综合 score：优先用要点覆盖率，回退到各批 ratio 平均，最后回退到 0.5（而非满分）
  const totalPoints = allRequirementPoints.length;
  const coveredCount = allRequirementPoints.filter((p) => p.covered).length;
  const score = totalPoints > 0
    ? coveredCount / totalPoints
    : (ratioCount > 0 ? totalRatio / ratioCount : 0.5);

  // 提取缺少来源支撑的要点
  const lackSourcePointsSet = new Set<string>();
  for (const p of allRequirementPoints) {
    if (p.reason === "lack_source" || (p.reason === undefined && !p.covered && !missingPointsSet.has(p.point))) {
      lackSourcePointsSet.add(p.point);
    }
  }

  return {
    score,
    requirementPoints: allRequirementPoints,
    coveredPoints: Array.from(coveredPointsSet),
    missingPoints: Array.from(missingPointsSet),
    lackSourcePoints: Array.from(lackSourcePointsSet),
  };
}

/**
 * 从需求中提取要点（用于展示）
 */
export async function extractRequirementPoints(
  requirement: string,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<string[]> {
  const prompt = `请从以下用户需求中提取所有具体要点：

\`\`\`
${requirement}
\`\`\`

输出 JSON：
{
  "points": ["要点1", "要点2", ...]
}`;

  try {
    const dbSettings = readSettingsFromDb();
    const providers = [providerId];
    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const effectiveModelId = selectBestEvalModel(modelId, [providerId], dbSettings);

    const maxTokens = resolveEvalMaxTokens(effectiveModelId);

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "user", content: prompt },
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

    const parsed = parseJsonResponse<{ points: string[] }>(response.text);
    return parsed?.points ?? [];
  } catch (e) {
    logger.warn(`[CompletenessCheck] Requirement point extraction failed: ${e}`);
    return [];
  }
}