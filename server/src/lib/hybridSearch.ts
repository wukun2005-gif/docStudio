/**
 * 混合检索模块 — BM25 + 向量检索 + RRF 融合 + MMR 多样性
 * Feature #10: Hybrid Search
 */

import { getAllChunks, getAllVectors } from "./knowledgeDb.js";
import { expandQuery } from "./queryExpand.js";
import { logger } from "./logger.js";

// ── BM25 实现 ──────────────────────────────────────────

interface BM25Document {
  id: string;
  text: string;
  tokens: string[];
}

/** 简单中文分词（按字 + 常见词） */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^一-鿿a-z0-9]/g, " ");
  const tokens: string[] = [];

  // 英文单词
  const englishWords = normalized.match(/[a-z]+/g) ?? [];
  tokens.push(...englishWords);

  // 中文按 2-gram
  const chinese = normalized.match(/[一-鿿]+/g) ?? [];
  for (const segment of chinese) {
    for (let i = 0; i < segment.length - 1; i++) {
      tokens.push(segment.slice(i, i + 2));
    }
    if (segment.length === 1) {
      tokens.push(segment);
    }
  }

  return tokens.filter((t) => t.length > 0);
}

class BM25 {
  private k1 = 1.5;
  private b = 0.75;
  private docs: BM25Document[] = [];
  private avgDl = 0;
  private df = new Map<string, number>();
  private initialized = false;

  addDocuments(documents: Array<{ id: string; text: string }>) {
    this.docs = documents.map((d) => ({
      ...d,
      tokens: tokenize(d.text),
    }));

    // 计算平均文档长度
    const totalLen = this.docs.reduce((sum, d) => sum + d.tokens.length, 0);
    this.avgDl = totalLen / this.docs.length || 1;

    // 计算文档频率
    this.df.clear();
    for (const doc of this.docs) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        this.df.set(token, (this.df.get(token) ?? 0) + 1);
      }
    }

    this.initialized = true;
  }

  search(query: string, limit: number = 10): Array<{ id: string; score: number }> {
    if (!this.initialized || this.docs.length === 0) return [];

    const queryTokens = tokenize(query);
    const N = this.docs.length;

    const scores = this.docs.map((doc) => {
      let score = 0;
      const tf = new Map<string, number>();

      // 计算词频
      for (const token of doc.tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      for (const qt of queryTokens) {
        const docFreq = tf.get(qt) ?? 0;
        const dfi = this.df.get(qt) ?? 0;
        if (dfi === 0) continue;

        const idf = Math.log((N - dfi + 0.5) / (dfi + 0.5) + 1);
        const tfNorm = (docFreq * (this.k1 + 1)) / (docFreq + this.k1 * (1 - this.b + this.b * (doc.tokens.length / this.avgDl)));
        score += idf * tfNorm;
      }

      return { id: doc.id, score };
    });

    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ── 向量检索 ──────────────────────────────────────────

/** Cosine similarity */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/** 向量检索 */
function vectorSearch(
  queryEmbedding: number[],
  vectors: Array<{ chunkId: string; embedding: number[] }>,
  limit: number = 10,
): Array<{ id: string; score: number }> {
  const scores = vectors.map((v) => ({
    id: v.chunkId,
    score: cosineSimilarity(queryEmbedding, v.embedding),
  }));

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── RRF 融合 ──────────────────────────────────────────

const RRF_K = 60; // RRF 参数

/** Reciprocal Rank Fusion */
function rrfFusion(
  rankings: Array<Array<{ id: string; score: number }>>,
  k: number = RRF_K,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore);
    });
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ── MMR 多样性排序 ──────────────────────────────────────

/** Maximal Marginal Relevance */
function mmrRerank(
  candidates: Array<{ id: string; score: number; embedding?: number[] }>,
  lambda: number = 0.7,
  limit: number = 10,
): Array<{ id: string; score: number }> {
  if (candidates.length <= limit) return candidates;

  const selected: typeof candidates = [];
  const remaining = [...candidates];

  // 第一个：最高分
  selected.push(remaining.shift()!);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;

      // 与已选集合的最大相似度
      let maxSim = 0;
      if (remaining[i].embedding && selected[0].embedding) {
        for (const s of selected) {
          if (s.embedding) {
            const sim = cosineSimilarity(remaining[i].embedding!, s.embedding!);
            maxSim = Math.max(maxSim, sim);
          }
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ── 完整混合检索流程 ──────────────────────────────────────

export interface SearchResult {
  chunkId: string;
  content: string;
  sourceId: string;
  score: number;
  matchType: "bm25" | "vector" | "hybrid";
}

export interface HybridSearchConfig {
  bm25Weight?: number;
  vectorWeight?: number;
  limit?: number;
  useQueryExpansion?: boolean;
  queryEmbedding?: number[];
}

/**
 * 完整的混合检索流程：
 * 1. Query Expansion（可选）
 * 2. BM25 检索
 * 3. 向量检索（如果有 embedding）
 * 4. RRF 融合
 * 5. MMR 多样性排序
 */
export function hybridSearch(
  query: string,
  config: HybridSearchConfig = {},
): SearchResult[] {
  const {
    limit = 10,
    useQueryExpansion = true,
  } = config;

  logger.info(`[HybridSearch] query="${query.slice(0, 50)}..."`);

  // 1. Query Expansion
  const expanded = useQueryExpansion ? expandQuery(query) : { original: query, expanded: [query], combined: query };
  logger.info(`[HybridSearch] Expanded to ${expanded.expanded.length} variants`);

  // 2. BM25 检索
  const allChunks = getAllChunks();
  const bm25 = new BM25();
  bm25.addDocuments(allChunks.map((c) => ({ id: c.id, text: c.content })));

  const bm25Results = bm25.search(expanded.combined, limit * 2);
  logger.info(`[HybridSearch] BM25: ${bm25Results.length} results`);

  // 3. 向量检索（如果有 queryEmbedding）
  const allVectors = getAllVectors();
  let vectorResults: Array<{ id: string; score: number }> = [];
  if (allVectors.length > 0 && config.queryEmbedding) {
    vectorResults = vectorSearch(config.queryEmbedding, allVectors, limit * 2);
    logger.info(`[HybridSearch] Vector search: ${vectorResults.length} results from ${allVectors.length} vectors`);
  } else if (allVectors.length > 0) {
    logger.info(`[HybridSearch] Vector search: ${allVectors.length} vectors available (skipped, no query embedding)`);
  }

  // 4. RRF 融合
  const rankings = [bm25Results];
  if (vectorResults.length > 0) {
    rankings.push(vectorResults);
  }
  const fused = rrfFusion(rankings);
  logger.info(`[HybridSearch] RRF fusion: ${fused.length} results`);

  // 5. 构建结果
  const chunkMap = new Map(allChunks.map((c) => [c.id, c]));
  const results: SearchResult[] = fused
    .slice(0, limit)
    .map((item) => {
      const chunk = chunkMap.get(item.id);
      if (!chunk) return null;
      return {
        chunkId: chunk.id,
        content: chunk.content,
        sourceId: chunk.sourceId,
        score: item.score,
        matchType: rankings.length > 1 ? "hybrid" : "bm25" as const,
      };
    })
    .filter((r): r is SearchResult => r !== null);

  return results;
}
