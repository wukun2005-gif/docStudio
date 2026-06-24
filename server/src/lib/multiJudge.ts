/**
 * Multi-Judge Infrastructure — 2 个 LLM Provider 并行打分 + 聚合
 *
 * Feature #38: 2 个 LLM judge 独立评分
 *
 * 聚合算法：
 * - 离散值（0-3 relevance grade）：算术平均，四舍五入到最近整数
 * - 连续值（0-1 faithfulness/correctness）：算术平均
 */
import { registry } from "../providers/registry.js";
import { logger } from "./logger.js";

// ── 类型定义 ──────────────────────────────────────────

export interface JudgeOutput {
  providerId: string;
  rawText: string;
  success: boolean;
  error?: string;
}

export interface MultiJudgeResult<T> {
  aggregated: T;
  individualResults: Array<{ providerId: string; value: T; success: boolean }>;
  judgeCount: number;
}

// ── 默认配置 ──────────────────────────────────────────

export const DEFAULT_JUDGE_CONFIGS: Array<{ providerId: string; modelId: string }> = [
  { providerId: "openai", modelId: "gpt-4o-mini" },
  { providerId: "deepseek", modelId: "deepseek-chat" },
];

// ── 聚合算法 ──────────────────────────────────────────

export function aggregateDiscrete(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return Math.round((values[0]! + values[1]!) / 2);
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function aggregateContinuous(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── 核心调用函数 ──────────────────────────────────────

export async function callMultiJudge(
  prompt: { system: string; user: string },
  judgeApiKeys: Record<string, string>,
  options?: {
    judgeConfigs?: Array<{ providerId: string; modelId: string }>;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** LLM 调用超时（毫秒），照搬 patentExaminator */
    timeoutMs?: number;
  }
): Promise<JudgeOutput[]> {
  const judgeCfgs = options?.judgeConfigs ?? DEFAULT_JUDGE_CONFIGS;
  const temperature = options?.temperature ?? 0;
  const maxTokens = options?.maxTokens ?? 2000;
  const timeoutMs = options?.timeoutMs ?? 300_000; // 照搬 patentExaminator: thinking 模型推理时间长

  const judgeTasks = judgeCfgs.map(async (cfg): Promise<JudgeOutput> => {
    const { providerId, modelId } = cfg;
    const apiKey = judgeApiKeys[providerId];
    if (!apiKey) {
      return { providerId, rawText: "", success: false, error: "No API key" };
    }

    try {
      const result = await registry.runWithFallback(
        [providerId],
        {
          modelId,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          apiKey,
          maxTokens,
          temperature,
          timeoutMs,
          ...(options?.signal !== undefined && { signal: options.signal }),
        },
        undefined, undefined,
        { [providerId]: apiKey },
      );

      if (result.response.error) {
        return {
          providerId,
          rawText: "",
          success: false,
          error: result.response.error.message,
        };
      }

      return {
        providerId,
        rawText: result.response.text,
        success: true,
      };
    } catch (err) {
      return {
        providerId,
        rawText: "",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const settled = await Promise.allSettled(judgeTasks);
  return settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      providerId: judgeCfgs[i]?.providerId ?? "unknown",
      rawText: "",
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

// ── 高级聚合函数 ──────────────────────────────────────

export async function multiJudgeDiscrete(
  prompt: { system: string; user: string },
  judgeApiKeys: Record<string, string>,
  parser: (rawText: string) => number | null,
  options?: {
    judgeConfigs?: Array<{ providerId: string; modelId: string }>;
    defaultValue?: number;
  }
): Promise<MultiJudgeResult<number>> {
  const defaultVal = options?.defaultValue ?? 0;
  const outputs = await callMultiJudge(prompt, judgeApiKeys, options);

  const individualResults: Array<{ providerId: string; value: number; success: boolean }> = [];
  const validValues: number[] = [];

  for (const output of outputs) {
    if (output.success && output.rawText) {
      const parsed = parser(output.rawText);
      if (parsed !== null) {
        individualResults.push({ providerId: output.providerId, value: parsed, success: true });
        validValues.push(parsed);
        continue;
      }
    }
    individualResults.push({
      providerId: output.providerId,
      value: defaultVal,
      success: false,
    });
  }

  const aggregated = validValues.length > 0 ? aggregateDiscrete(validValues) : defaultVal;
  return { aggregated, individualResults, judgeCount: validValues.length };
}

export async function multiJudgeContinuous(
  prompt: { system: string; user: string },
  judgeApiKeys: Record<string, string>,
  parser: (rawText: string) => number | null,
  options?: {
    judgeConfigs?: Array<{ providerId: string; modelId: string }>;
    defaultValue?: number;
  }
): Promise<MultiJudgeResult<number>> {
  const defaultVal = options?.defaultValue ?? 0.5;
  const outputs = await callMultiJudge(prompt, judgeApiKeys, options);

  const individualResults: Array<{ providerId: string; value: number; success: boolean }> = [];
  const validValues: number[] = [];

  for (const output of outputs) {
    if (output.success && output.rawText) {
      const parsed = parser(output.rawText);
      if (parsed !== null) {
        individualResults.push({ providerId: output.providerId, value: parsed, success: true });
        validValues.push(parsed);
        continue;
      }
    }
    individualResults.push({
      providerId: output.providerId,
      value: defaultVal,
      success: false,
    });
  }

  const aggregated = validValues.length > 0 ? aggregateContinuous(validValues) : defaultVal;
  return { aggregated, individualResults, judgeCount: validValues.length };
}

// ── JSON 解析辅助 ──────────────────────────────────────

export function extractJsonFromLLM(text: string): Record<string, unknown> | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as Record<string, unknown>;
    }
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseScoreFromText(text: string): number | null {
  const json = extractJsonFromLLM(text);
  if (json) {
    const score = json.score ?? json.rating ?? json.value;
    if (typeof score === "number") return score;
    if (typeof score === "string") {
      const n = parseFloat(score);
      if (!isNaN(n)) return n;
    }
  }
  // Fallback: 提取第一个数字
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]!);
    if (!isNaN(n)) return n;
  }
  return null;
}
