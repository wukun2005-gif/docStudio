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

// ── MMR 多样性排序（照搬 patentExaminator mmrDiversityRank） ───

/** Jaccard 相似度（基于 token 集合） */
function jaccardSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** MMR 多样性排序（Jaccard 相似度，照搬 patentExaminator） */
function mmrDiversityRank(
  candidates: Array<{ id: string; score: number; text: string }>,
  lambda: number = 0.7,
  limit: number = 5,
): Array<{ id: string; score: number }> {
  if (candidates.length <= limit) {
    return candidates.map((c) => ({ id: c.id, score: c.score }));
  }

  const selected: Array<{ id: string; score: number; text: string }> = [];
  const remaining = [...candidates];

  // 第一个：最高分
  selected.push(remaining.shift()!);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;

      // 与已选集合的最大 Jaccard 相似度
      let maxSim = 0;
      for (const s of selected) {
        const sim = jaccardSimilarity(remaining[i].text, s.text);
        maxSim = Math.max(maxSim, sim);
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected.map((c) => ({ id: c.id, score: c.score }));
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

  // 归一化 RRF 分数到 0-1 范围
  if (fused.length > 0) {
    const maxRRF = fused[0].score;
    const minRRF = fused[fused.length - 1].score;
    const range = maxRRF - minRRF;
    if (range > 0) {
      for (const item of fused) {
        item.score = (item.score - minRRF) / range;
      }
    } else {
      // 所有分数相同，设为 1
      for (const item of fused) {
        item.score = 1;
      }
    }
  }
  logger.info(`[HybridSearch] RRF fusion: ${fused.length} results (normalized)`);

  // 5. MMR 多样性排序（照搬 patentExaminator: Jaccard 相似度, lambda=0.7, topK=limit）
  const chunkMap = new Map(allChunks.map((c) => [c.id, c]));
  const mmrCandidates = fused
    .slice(0, limit * 2) // 取多一些候选给 MMR 做选择
    .map((item) => {
      const chunk = chunkMap.get(item.id);
      return { id: item.id, score: item.score, text: chunk?.content ?? "" };
    })
    .filter((c) => c.text.length > 0);

  const diversified = mmrDiversityRank(mmrCandidates, 0.7, limit);
  logger.info(`[HybridSearch] MMR diversity: ${mmrCandidates.length} → ${diversified.length} results`);

  // 6. 构建结果
  const results: SearchResult[] = diversified
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

// ── 跨源混合检索（本地 + 远程） ─────────────────────────

export interface RemoteSearchConfig {
  /** MS Graph access token */
  msAccessToken?: string;
  /** GitHub token */
  githubToken?: string;
  /** Embedding 配置 */
  embedding?: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
  };
  /** 是否启用远程检索 */
  enableRemote?: boolean;
}

export interface CrossSourceSearchResult {
  chunkId: string;
  content: string;
  sourceId: string;
  score: number;
  matchType: "bm25" | "vector" | "hybrid" | "remote";
  /** 来源平台 */
  platform?: "local" | "onedrive" | "github";
  /** 远程来源的额外信息 */
  remoteInfo?: {
    fileName: string;
    fileUrl?: string;
  };
}

/**
 * 跨源混合检索：本地知识库 + GitHub + OneDrive
 *
 * 流程:
 * 1. 并行执行本地检索和远程 Phase 1
 * 2. 远程 Phase 2（如果需要）
 * 3. 跨源 RRF 融合
 */
export async function hybridSearchWithRemote(
  query: string,
  config: HybridSearchConfig & RemoteSearchConfig = {},
): Promise<CrossSourceSearchResult[]> {
  const { enableRemote = true, limit = 10 } = config;

  // 1. 本地知识库检索
  const localResults = hybridSearch(query, config);
  const localMapped: CrossSourceSearchResult[] = localResults.map(r => ({
    ...r,
    platform: "local" as const,
  }));

  if (!enableRemote) {
    return localMapped;
  }

  // 2. 远程检索（并行执行）
  const remotePromises: Promise<CrossSourceSearchResult[]>[] = [];

  // OneDrive 两阶段检索
  if (config.msAccessToken) {
    remotePromises.push(
      (async () => {
        try {
          // 动态导入避免循环依赖
          const { twoStageRetrieve } = await import("./remoteRetrieval.js");
          const results = await twoStageRetrieve(query, {
            msAccessToken: config.msAccessToken,
            queryEmbedding: config.queryEmbedding,
            embedding: config.embedding,
            candidateLimit: 20,
            fetchLimit: 10,
          });
          return results.map((r, idx) => ({
            chunkId: `remote-${r.platform}-${idx}`,
            content: r.content,
            sourceId: r.fileName,
            score: r.score,
            matchType: r.matchType === "keyword" ? "remote" as const : r.matchType as "vector" | "hybrid",
            platform: r.platform as "onedrive",
            remoteInfo: {
              fileName: r.fileName,
              fileUrl: r.fileUrl,
            },
          }));
        } catch (err) {
          logger.warn(`[HybridSearch] OneDrive 检索失败: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }
      })(),
    );
  }

  // GitHub 检索（在已 clone 的 repo 中搜索）
  if (config.githubToken) {
    remotePromises.push(
      (async () => {
        try {
          // GitHub 检索通过本地已索引的 chunks 完成
          // 已经在本地知识库中，不需要额外处理
          return [];
        } catch (err) {
          logger.warn(`[HybridSearch] GitHub 检索失败: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }
      })(),
    );
  }

  // 等待远程检索完成
  const remoteResults = await Promise.all(remotePromises);
  const allRemote = remoteResults.flat();

  // 3. 跨源 RRF 融合
  if (allRemote.length === 0) {
    return localMapped;
  }

  // 使用 RRF 融合本地和远程结果
  const K = 60;
  const scores = new Map<string, { result: CrossSourceSearchResult; localRank: number; remoteRank: number }>();

  localMapped.forEach((r, rank) => {
    scores.set(r.chunkId, { result: r, localRank: rank + 1, remoteRank: Infinity });
  });

  allRemote.forEach((r, rank) => {
    const existing = scores.get(r.chunkId);
    if (existing) {
      existing.remoteRank = rank + 1;
    } else {
      scores.set(r.chunkId, { result: r, localRank: Infinity, remoteRank: rank + 1 });
    }
  });

  const fused = Array.from(scores.values()).map(s => {
    const localScore = s.localRank < Infinity ? 1 / (K + s.localRank) : 0;
    const remoteScore = s.remoteRank < Infinity ? 1 / (K + s.remoteRank) : 0;
    return {
      ...s.result,
      score: localScore + remoteScore,
      matchType: (s.localRank < Infinity && s.remoteRank < Infinity) ? "hybrid" as const : s.result.matchType,
    };
  }).sort((a, b) => b.score - a.score);

  // 归一化 RRF 分数到 0-1 范围（与纯本地路径保持一致）
  if (fused.length > 0) {
    const maxRRF = fused[0].score;
    const minRRF = fused[fused.length - 1].score;
    const range = maxRRF - minRRF;
    if (range > 0) {
      for (const item of fused) {
        item.score = (item.score - minRRF) / range;
      }
    } else {
      for (const item of fused) {
        item.score = 1;
      }
    }
  }

  logger.info(`[HybridSearch] 跨源融合: local=${localMapped.length}, remote=${allRemote.length}, fused=${fused.length} (normalized)`);

  return fused.slice(0, limit);
}
