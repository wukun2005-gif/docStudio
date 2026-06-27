/**
 * LLM 调用工具函数 — 参考 patentExaminator
 *
 * 提供统一的 maxTokens 计算、context window 管理等功能。
 */

import { getModelCapabilities } from "../providers/model-capabilities-registry.js";

// ── 推理模型检测（照搬 patentExaminator）──────────────────

const REASONING_MODEL_PATTERNS = /mimo|r1\b|o[134]\b|reasoner|thinking|gemini-\d|glm-\d|k2\.[56]|deepseek-v[34]|kimi-k2|gpt-5|doubao-seed-\d/i;
const REASONING_MAX_TOKENS_MULTIPLIER = 4;

// L1 运行时缓存：modelId → isReasoning（从 API 响应中学到的）
const thinkingModelCache = new Map<string, boolean>();

/** 从 API 响应中学习：如果模型使用了 thinking tokens，缓存为 thinking 模型 */
export function learnThinkingCapability(modelId: string, thinkingTokens: number | undefined): void {
  if (thinkingTokens && thinkingTokens > 0) {
    thinkingModelCache.set(modelId, true);
  }
}

/** 判断模型是否为推理模型 — 三层查询（照搬 patentExaminator） */
export function isReasoningModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  // 1. 运行时缓存
  if (thinkingModelCache.has(modelId)) {
    return thinkingModelCache.get(modelId)!;
  }
  // 2. 静态能力声明
  const caps = getModelCapabilities(modelId);
  if (caps.isReasoning !== undefined) {
    return caps.isReasoning;
  }
  // 3. regex 兜底
  return REASONING_MODEL_PATTERNS.test(modelId);
}

/**
 * 计算最优 maxTokens（照搬 patentExaminator）
 *
 * patentExaminator 方案：
 * 1. 使用模型的 maxOutputTokens 能力
 * 2. 推理模型自动 4x maxTokens
 * 3. 根据输入内容长度动态调整
 */
export function resolveOptimalMaxTokens(
  modelId: string,
  requestedMaxTokens?: number,
): number {
  const caps = getModelCapabilities(modelId);

  // 基础值：使用请求的值或模型的默认值
  let base = requestedMaxTokens ?? Math.min(caps.maxOutputTokens, 4096);

  // 推理模型自动 4x（照搬 patentExaminator）
  if (isReasoningModel(modelId)) {
    base = base * REASONING_MAX_TOKENS_MULTIPLIER;
  }

  // 确保不超过模型的 maxOutputTokens
  return Math.min(base, caps.maxOutputTokens);
}

/**
 * 评估 Judge 专用 maxTokens — 不使用推理模型 4x 乘数
 *
 * 评估 judge 输出通常为 500-2000 tokens 的 JSON。
 * 推理模型（如 kimi-k2.7-code）的 4x 乘数会将 max_tokens 放大到 32000，
 * 导致模型花大量时间 thinking，在百炼等网关上超时。
 */
const EVAL_JUDGE_MAX_TOKENS_CAP = 4096;

export function resolveEvalMaxTokens(modelId: string): number {
  const caps = getModelCapabilities(modelId);
  return Math.min(EVAL_JUDGE_MAX_TOKENS_CAP, caps.maxOutputTokens);
}

/**
 * 估算文本的 token 数量（粗略估算）
 *
 * 1 个中文字符 ≈ 2 tokens
 * 1 个英文单词 ≈ 1 token
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars * 2 + englishWords;
}

/**
 * 获取模型的 context window 信息
 */
export function getModelContextInfo(modelId: string): {
  contextWindow: number;
  maxOutputTokens: number;
  isReasoning: boolean;
} {
  const caps = getModelCapabilities(modelId);
  return {
    contextWindow: caps.contextWindow,
    maxOutputTokens: caps.maxOutputTokens,
    isReasoning: caps.isReasoning,
  };
}

/**
 * 计算可用于输入的 token 数量
 *
 * 考虑因素：
 * 1. 模型的 context window size
 * 2. 模型的 maxOutputTokens
 * 3. 留 20% 缓冲
 */
export function calculateAvailableInputTokens(
  modelId: string,
  overheadTokens: number = 0,
): number {
  const modelInfo = getModelContextInfo(modelId);

  // 可用输入 tokens = contextWindow - maxOutputTokens - overhead
  const available = modelInfo.contextWindow - modelInfo.maxOutputTokens - overheadTokens;

  // 留 20% 缓冲
  return Math.floor(available * 0.8);
}
