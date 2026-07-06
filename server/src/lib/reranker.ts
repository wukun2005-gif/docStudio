/**
 * 重排序模块 — 本地启发式重排序
 *
 * 照搬 patentExaminator reranker.ts 的核心逻辑，适配 i-Write 场景。
 * 远程 reranker API 调用已在 toolExecutor.ts 的 fuseAndRank 中实现。
 *
 * 信号：语义相似度 + 关键词匹配 + 来源权重
 */
import { logger } from "./logger.js";

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

// ── 关键词提取（照搬 patentExaminator extractTerms） ────────

/** 提取文本中的关键词（去停用词） */
function extractTerms(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "是", "在", "和", "有", "不", "这", "我", "他", "她", "它",
    "们", "那", "被", "从", "到", "也", "就", "都", "而", "及", "与", "或",
    "但", "如", "所", "之", "等", "将", "已", "可", "对", "于", "其", "上",
    "下", "中", "为", "以", "因", "并", "地", "要", "会", "能", "来", "去",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "through", "during", "before", "after",
  ]);

  const tokens: string[] = [];
  // 中文 2-gram（长度 >= 2 的连续中文字符）
  const chineseChars = text.match(/[一-鿿]{2,}/g) ?? [];
  // 英文单词（长度 >= 3）
  const englishWords = text.match(/[a-zA-Z]{3,}/g) ?? [];
  tokens.push(...chineseChars, ...englishWords.map((w) => w.toLowerCase()));

  return [...new Set(tokens.filter((t) => !stopWords.has(t) && t.length >= 2))];
}

// ── 来源权重 ────────────────────────────────────────

/** 来源权重（RAG 知识库 > 生成结果 > demo 数据） */
function sourceWeight(metadata?: Record<string, unknown>): number {
  const engine = metadata?.engine as string;
  if (engine === "rag") return 1.0;       // 用户知识库，最高信任
  const sourceType = metadata?.sourceType as string;
  if (sourceType === "demo") return 0.5;
  if (sourceType === "generation") return 0.7;
  return 0.8; // web search 结果
}

// ── 本地启发式重排序 ──────────────────────────────────

/**
 * 本地启发式重排序（照搬 patentExaminator localRerank）
 *
 * 信号：
 * 1. 语义相似度（原始 score，跨源融合时为 0，由 reranker API 提供时有值）
 * 2. 关键词匹配度（带停用词过滤的 extractTerms）
 * 3. 来源权重（RAG > web > demo）
 */
export function localRerank(
  results: RerankInput[],
  query: string,
): RerankOutput[] {
  if (results.length <= 1) {
    return results.map((r) => ({ chunkId: r.chunkId, score: r.score }));
  }

  const queryTerms = extractTerms(query);
  logger.info(`[Rerank] localRerank 开始: ${results.length} 候选, queryTerms=[${queryTerms.join(", ")}]`);

  const scored = results.map((result) => {
    const { chunkId, text, metadata, score: semanticScore } = result;

    // 1. 语义相似度（来自上游的原始分数）
    const s1 = semanticScore;

    // 2. 关键词匹配度（照搬 patentExaminator: extractTerms + 交集比）
    const chunkTerms = extractTerms(text);
    const matchedTerms = queryTerms.filter((t) => chunkTerms.includes(t));
    const s2 = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;

    // 3. 来源权重
    const s3 = sourceWeight(metadata);

    // 综合评分（权重：语义 0.4, 关键词 0.4, 来源 0.2）
    const finalScore = 0.4 * s1 + 0.4 * s2 + 0.2 * s3;

    return { chunkId, score: finalScore };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  logger.info(`[Rerank] localRerank 完成: ${sorted.length} 结果, top score=${sorted[0]?.score?.toFixed(4) ?? "N/A"}`);
  return sorted;
}

/**
 * 重排序入口（向后兼容 knowledge.ts）
 * 直接调用 localRerank。
 */
export async function rerank(
  results: RerankInput[],
  query: string,
): Promise<RerankOutput[]> {
  return localRerank(results, query);
}

// ── 远程 Reranker API（统一入口） ────────────────────────────

export interface RerankerConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/**
 * 统一的 reranker 调用入口：
 *   1. 如果配置了远程 reranker API → 调用远程 API（cross-encoder 语义重排序）
 *   2. 如果远程 API 失败或未配置 → fallback 到本地启发式（localRerank）
 *
 * 所有需要 reranking 的场景都必须调用此函数，确保：
 *   - 远程 reranker API 优先
 *   - 本地启发式仅作为 fallback
 *
 * @param query  检索 query
 * @param items  候选项（含 id 和 text）
 * @param config reranker 配置（可选，未配置则直接用本地启发式）
 * @param topN   返回的 top-N 数量
 * @returns 按 reranker 分数降序排列的结果，每项含 { id, score }
 */
export async function remoteRerank(
  query: string,
  items: Array<{ id: string; text: string; score?: number }>,
  config?: RerankerConfig,
  topN?: number,
): Promise<Array<{ id: string; score: number }>> {
  if (items.length <= 1) {
    return items.map((i) => ({ id: i.id, score: i.score ?? 0 }));
  }

  const limit = topN ?? items.length;

  // 优先级 1：远程 reranker API
  if (config) {
    try {
      const rerankUrl = config.baseUrl.endsWith("/v1")
        ? `${config.baseUrl}/rerank`
        : `${config.baseUrl}/v1/rerank`;
      const documents = items.map((r) => r.text);
      logger.info(`[Rerank] 远程 Rerank: ${documents.length} 候选, model=${config.modelId}, topN=${limit}`);
      const res = await fetch(rerankUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.modelId, query, documents, top_n: limit }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ index: number; relevance_score: number }> };
        const results = data.results ?? [];
        const reranked = results
          .filter((r) => r.index >= 0 && r.index < items.length)
          .map((r) => ({ id: items[r.index]!.id, score: r.relevance_score }))
          .filter((r): r is { id: string; score: number } => !!r.id);
        logger.info(`[Rerank] 远程 Rerank 完成: ${reranked.length} 结果, top score=${reranked[0]?.score?.toFixed(4) ?? "N/A"}`);
        return reranked.slice(0, limit);
      }
      logger.warn(`[Rerank] 远程 Rerank 失败 (${res.status})，降级到本地启发式`);
    } catch (err) {
      logger.warn(`[Rerank] 远程 Rerank 错误，降级到本地启发式: ${err}`);
    }
  }

  // 优先级 2：本地启发式算法
  try {
    const rerankInput: RerankInput[] = items.map((i) => ({
      chunkId: i.id,
      text: i.text,
      score: i.score ?? 0,
    }));
    const reranked = localRerank(rerankInput, query);
    logger.info(`[Rerank] 本地启发式完成: ${reranked.length} 结果, top score=${reranked[0]?.score?.toFixed(4) ?? "N/A"}`);
    return reranked.slice(0, limit).map((r) => ({ id: r.chunkId, score: r.score }));
  } catch (err) {
    logger.warn(`[Rerank] 本地启发式失败，按原始顺序返回: ${err}`);
    return items.slice(0, limit).map((i) => ({ id: i.id, score: i.score ?? 0 }));
  }
}
