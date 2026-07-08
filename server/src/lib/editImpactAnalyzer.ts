/**
 * Edit Impact Analyzer — 判断文档修改的重要性级别，决定触发哪些 downstream 环节
 * Phase 3: Downstream 智能触发
 */
import Levenshtein from "fast-levenshtein";
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { logger } from "./logger.js";

export type EditSignificance = "cosmetic" | "stylistic" | "substantive" | "structural";

export interface EditImpactResult {
  significance: EditSignificance;
  reason: string;
  triggers: string[];
  skipLLM: boolean;
}

export interface EditImpactConfig {
  apiKey?: string;
  providerPreference?: string[];
  modelId?: string;
  providerBaseUrls?: Record<string, string>;
}

const DOWNSTREAM_PIPELINE: Record<EditSignificance, string[]> = {
  cosmetic: [],
  stylistic: ["trustScore"],
  substantive: ["groundedness", "provenance", "trustScore", "completeness", "relevance"],
  structural: ["groundedness", "provenance", "trustScore", "completeness", "relevance", "conflicts"],
};

/**
 * 快速过滤层：基于编辑距离判断极端情况
 * @returns null 表示需要进入 LLM 判断；否则直接返回结果
 */
export function quickFilter(oldText: string, newText: string): EditImpactResult | null {
  const dist = Levenshtein.get(oldText, newText);
  const maxLen = Math.max(oldText.length, newText.length);
  const ratio = maxLen > 0 ? dist / maxLen : 0;

  // 改动 < 3 个字符，且改动比例 < 1% → cosmetic，零 LLM 成本
  if (dist < 3 && ratio < 0.01) {
    return {
      significance: "cosmetic",
      reason: `编辑距离=${dist}，改动比例=${(ratio * 100).toFixed(2)}%，极小改动`,
      triggers: DOWNSTREAM_PIPELINE.cosmetic,
      skipLLM: true,
    };
  }

  // 改动 > 50% → 直接判定为 substantive，跳过 LLM
  if (ratio > 0.5) {
    return {
      significance: "substantive",
      reason: `编辑距离=${dist}，改动比例=${(ratio * 100).toFixed(2)}%，大幅改动`,
      triggers: DOWNSTREAM_PIPELINE.substantive,
      skipLLM: true,
    };
  }

  // 中间地带 → 需要 LLM 判断
  return null;
}

/**
 * LLM 语义判断层：分析修改的实质影响
 */
export async function analyzeSignificance(
  oldText: string,
  newText: string,
  instruction: string,
  config: EditImpactConfig,
): Promise<EditImpactResult> {
  // 先过快速过滤
  const quick = quickFilter(oldText, newText);
  if (quick) return quick;

  const systemPrompt = `你是一个文档修改影响分析助手。判断以下文本修改的重要性级别。

请从三个维度分析：
1. 修改是否涉及事实、数据、引用的变化？
2. 修改是否改变了文档结构或章节组织？
3. 修改是否仅涉及语气、措辞、标点、格式？

输出 JSON：
{
  "significance": "cosmetic" | "stylistic" | "substantive" | "structural",
  "reason": "简要说明判定理由（50字以内）"
}

级别定义：
- cosmetic: 仅标点、空格、格式、个别错别字
- stylistic: 语气、措辞、句式调整，语义不变
- substantive: 数据、事实、引用、内容变化
- structural: 章节增删、大纲变化、主题偏移

注意：直接输出 JSON，不要 markdown 代码块。`;

  const userPrompt = `修改指令：${instruction}

原文（前500字）：
${oldText.slice(0, 500)}

修改后（前500字）：
${newText.slice(0, 500)}`;

  try {
    const dbSettings = readSettingsFromDb();
    const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
    const providers = config.providerPreference ?? defaultProviders;

    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = config.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        apiKey: "",
        temperature: 0.1,
        timeoutMs: 30_000,
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    );

    if (response.error) {
      logger.error(`[EditImpact] LLM analysis error: ${response.error.message}`);
      // LLM 失败时保守处理：视为 substantive
      return {
        significance: "substantive",
        reason: "LLM 分析失败，保守处理",
        triggers: DOWNSTREAM_PIPELINE.substantive,
        skipLLM: false,
      };
    }

    const parsed = JSON.parse(response.text) as { significance: EditSignificance; reason: string };
    const sig = DOWNSTREAM_PIPELINE[parsed.significance] ? parsed.significance : "substantive";

    logger.info(`[EditImpact] significance=${sig}, reason=${parsed.reason}`);

    return {
      significance: sig,
      reason: parsed.reason,
      triggers: DOWNSTREAM_PIPELINE[sig],
      skipLLM: false,
    };
  } catch (err) {
    logger.error(`[EditImpact] analysis failed: ${err}`);
    return {
      significance: "substantive",
      reason: "分析异常，保守处理",
      triggers: DOWNSTREAM_PIPELINE.substantive,
      skipLLM: false,
    };
  }
}

/**
 * 获取指定重要性级别需要触发的 downstream 环节
 */
export function getDownstreamTriggers(significance: EditSignificance): string[] {
  return DOWNSTREAM_PIPELINE[significance] ?? DOWNSTREAM_PIPELINE.substantive;
}
