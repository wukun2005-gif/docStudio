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

const COMPLETENESS_JUDGE_SYSTEM = `You are a strict completeness evaluator for knowledge-grounded document generation.

Your task: Extract all key points from the user's requirement, then check if each point is covered in the generated document.

COMPLETENESS RULES:
- covered: The document explicitly addresses or sufficiently covers the requirement point
- missing: The document does not address or only superficially touches the requirement point

EXTRACTION RULES:
- Extract concrete, actionable requirement points
- Do NOT extract vague or overly broad points
- Each point should be specific enough to verify

OUTPUT FORMAT (strict JSON):
{
  "requirement_points": [
    {"point": "具体需求要点", "covered": true, "evidence": "文档中覆盖该要点的内容"},
    {"point": "具体需求要点", "covered": false, "evidence": null}
  ],
  "covered_points": ["已覆盖的要点列表"],
  "missing_points": ["遗漏的要点列表"],
  "completeness_ratio": 0.75
}`;

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

  try {
    const dbSettings = readSettingsFromDb();
    const providers = [providerId];
    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    // 评估 judge 使用固定 cap，避免推理模型 4x 放大导致超时
    const maxTokens = resolveEvalMaxTokens(modelId);

    logger.info(`[CompletenessCheck] 模型: ${modelId}, maxTokens: ${maxTokens}`);

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
      },
      undefined,
      undefined,
      providerApiKeys,
    );

    const parsed = parseJsonResponse<CompletenessCheckResult>(response.text);
    return parsed ?? { score: 1, requirementPoints: [], coveredPoints: [], missingPoints: [] };
  } catch (e) {
    logger.warn(`[CompletenessCheck] LLM judge call failed: ${e}`);
    return { score: 1, requirementPoints: [], coveredPoints: [], missingPoints: [] };
  }
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

  // 综合 score：优先用要点覆盖率，回退到各批 ratio 平均
  const totalPoints = allRequirementPoints.length;
  const coveredCount = allRequirementPoints.filter((p) => p.covered).length;
  const score = totalPoints > 0
    ? coveredCount / totalPoints
    : (ratioCount > 0 ? totalRatio / ratioCount : 1);

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
