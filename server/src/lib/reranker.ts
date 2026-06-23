/**
 * 重排序模块 — 三级降级：远程 API → 本地 Cross-Encoder → 启发式加权
 * Feature #11: Reranker
 */
import { logger } from "./logger.js";

export interface RerankConfig {
  semanticWeight: number;
  keywordWeight: number;
  categoryWeight: number;
  recencyWeight: number;
  sourceWeight: number;
}

const DEFAULT_CONFIG: RerankConfig = {
  semanticWeight: 0.4,
  keywordWeight: 0.25,
  categoryWeight: 0.15,
  recencyWeight: 0.1,
  sourceWeight: 0.1,
};

export interface RerankInput {
  chunkId: string;
  text: string;
  metadata?: Record<string, unknown>;
  score: number;
}

export interface RerankOutput {
  chunkId: string;
  score: number;
}

// ── 启发式重排序（Level 3 fallback） ──────────────────────

/** 关键词匹配分数 */
function keywordScore(text: string, query: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const textLower = text.toLowerCase();
  let matches = 0;
  for (const token of queryTokens) {
    if (textLower.includes(token)) matches++;
  }
  return queryTokens.length > 0 ? matches / queryTokens.length : 0;
}

/** 来源权重（demo 数据权重较低） */
function sourceWeight(metadata?: Record<string, unknown>): number {
  const sourceType = metadata?.sourceType as string;
  if (sourceType === "demo") return 0.5;
  if (sourceType === "generation") return 0.7;
  return 1.0;
}

/** 本地启发式重排序 */
export function localRerank(
  results: RerankInput[],
  query: string,
  config: RerankConfig = DEFAULT_CONFIG,
): RerankOutput[] {
  if (results.length <= 1) {
    return results.map((r) => ({ chunkId: r.chunkId, score: r.score }));
  }

  const reranked = results.map((r) => {
    const kwScore = keywordScore(r.text, query);
    const srcWeight = sourceWeight(r.metadata);

    const finalScore =
      config.semanticWeight * r.score +
      config.keywordWeight * kwScore +
      config.sourceWeight * srcWeight +
      config.categoryWeight * 0.5 + // 默认中等类别权重
      config.recencyWeight * 0.5;   // 默认中等时间权重

    return { chunkId: r.chunkId, score: finalScore };
  });

  return reranked.sort((a, b) => b.score - a.score);
}

// ── 远程 Reranker API（Level 1） ─────────────────────────

export interface RemoteRerankerConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/** 远程 reranker API 调用 */
export async function remoteRerank(
  results: RerankInput[],
  query: string,
  config: RemoteRerankerConfig,
): Promise<RerankOutput[] | null> {
  try {
    const baseUrl = config.baseUrl.endsWith("/v1") ? config.baseUrl : `${config.baseUrl}/v1`;
    const response = await fetch(`${baseUrl}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        query,
        documents: results.map((r) => r.text),
        top_n: results.length,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      logger.warn(`[Rerank] Remote API error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results
      .map((r) => ({
        chunkId: results[r.index].chunkId,
        score: r.relevance_score,
      }))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    logger.warn(`[Rerank] Remote API failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── 三级降级重排序 ──────────────────────────────────────

export interface RerankPipelineConfig {
  remote?: RemoteRerankerConfig;
  localConfig?: RerankConfig;
}

/**
 * 三级降级重排序：
 * 1. 远程 Reranker API
 * 2. 本地 Cross-Encoder（暂未实现，直接降级到 Level 3）
 * 3. 本地启发式算法
 */
export async function rerank(
  results: RerankInput[],
  query: string,
  config: RerankPipelineConfig = {},
): Promise<RerankOutput[]> {
  if (results.length <= 1) {
    return results.map((r) => ({ chunkId: r.chunkId, score: r.score }));
  }

  // Level 1: 远程 Reranker API
  if (config.remote) {
    logger.info("[Rerank] 尝试远程 Reranker API...");
    const remoteResult = await remoteRerank(results, query, config.remote);
    if (remoteResult) {
      logger.info("[Rerank] 远程 Reranker 成功");
      return remoteResult;
    }
    logger.warn("[Rerank] 远程 Reranker 失败，降级到本地");
  }

  // Level 2: 本地 Cross-Encoder（暂未实现）
  // TODO: 集成 Xenova/bge-reranker-base

  // Level 3: 本地启发式
  logger.info("[Rerank] 使用本地启发式重排序");
  return localRerank(results, query, config.localConfig);
}
