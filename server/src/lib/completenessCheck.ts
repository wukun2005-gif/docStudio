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
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens, estimateTokens } from "./llmUtils.js";

// ============ Types ============

export interface RequirementPoint {
  point: string;
  covered: boolean;
  evidence?: string;  // 文档中覆盖该要点的内容
}

export interface CompletenessCheckResult {
  score: number;                    // 0-1
  requirementPoints: RequirementPoint[];
  coveredPoints: string[];
  missingPoints: string[];
}

// ============ LLM Judge ============

const COMPLETENESS_JUDGE_SYSTEM = `你是一名严苛的文档完整度核查员。你的任务是：先从用户原始需求中提取所有具体、可验证的要点，然后逐一检查每个要点是否在生成的文档中被充分覆盖。必须从严判定，宁可误杀不可放过：当你对"是否覆盖"有任何疑虑时，应标记为 missing。

COMPLETENESS RULES（严格执行）：
- covered：文档中明确、充分地回答或展开了该需求要点，有具体的事实、数据或结论支撑
- missing：文档未提及该要点、或仅表面提及但未展开、或回答得不够具体无法满足用户需求

EXTRACTION RULES：
- 提取具体、可验证的需求要点（如"评估 Sprint 3-4 的进度"、"列出关键风险"、"给出 GoToMarket 计划"）
- 不要提取过于宽泛或模糊的句子（如"写一份报告"不应拆出，必须拆到具体维度）
- 每个要点应具体到可以独立验证"是否覆盖"

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
1. requirement_points 必须覆盖用户需求中所有可独立验证的具体要点
2. completeness_ratio = covered 数量 / 总要点数量（保留两位小数）
3. 不要在 JSON 外输出任何解释性文字或 markdown 标记`;

const COMPLETENESS_JUDGE_USER = `## 用户原始需求

\`\`\`
{{REQUIREMENT}}
\`\`\`

## 生成的文档内容

{{DOCUMENT}}

请先从用户需求中提取所有具体要点，然后逐一检查每个要点是否在文档中被覆盖。

输出 JSON：
{
  "requirement_points": [
    {"point": "具体需求要点", "covered": true/false, "evidence": "覆盖该要点的文档内容"}
  ],
  "covered_points": ["已覆盖的要点列表"],
  "missing_points": ["遗漏的要点列表"],
  "completeness_ratio": 0.75
}`;

// ============ Core Logic ============

/**
 * 解析 JSON 响应
 */
function parseJsonResponse<T>(content: string): T | null {
  try {
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
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

  const maxTokens = resolveEvalMaxTokens(modelId);
  logger.info(`[CompletenessCheck] 模型: ${modelId}, maxTokens: ${maxTokens}`);

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
            evidence: { type: "string" },
          },
          required: ["point", "covered"],
        },
      },
      covered_points: { type: "array", items: { type: "string" } },
      missing_points: { type: "array", items: { type: "string" } },
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
    const requirementPoints = Array.isArray(raw.requirement_points)
      ? (raw.requirement_points as RequirementPoint[])
      : (parsed.requirementPoints ?? []);
    if (!Array.isArray(requirementPoints) || requirementPoints.length === 0) return null;
    return {
      score: parsed.score ?? 1,
      requirementPoints,
      coveredPoints,
      missingPoints,
    };
  };

  // ── 第一次调用（带 JSON schema 强制） ──
  try {
    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: modelId,
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
        modelId: modelId,
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
  return { score: 0.5, requirementPoints: [], coveredPoints: [], missingPoints: [] };
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

    // 注入全文大纲作为 running context
    const batchLabel = batches.length === 1 ? "" : `\n\n【当前批次：第 ${i + 1}/${batches.length} 批，包含章节：${batch.map((s) => s.title).join("、")}】`;
    const docWithOutline = `【全文大纲】\n${outlineText}${batchLabel}\n\n【本批章节内容】\n\n${batchDoc}`;

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

  return {
    score,
    requirementPoints: allRequirementPoints,
    coveredPoints: Array.from(coveredPointsSet),
    missingPoints: Array.from(missingPointsSet),
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

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: modelId,
        messages: [
          { role: "user", content: prompt },
        ],
        apiKey: "",
        maxTokens: 2000,
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