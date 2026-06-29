/**
 * 远程知识源两阶段检索引擎
 *
 * Phase 1: 使用平台原生搜索 API（Graph Search）获取候选文件
 * Phase 2: 对 top-K 候选拉取 → 复用统一分块 pipeline → 语义重排
 *
 * 所有文本提取、预处理、分块逻辑复用 ingestion.ts 的 ingestFile 函数。
 */

import { logger } from "./logger.js";
import { searchFiles, downloadFile, type GraphSearchResult } from "./connectors/msGraphSearch.js";
import { ingestFile, type EmbeddingConfig } from "./ingestion.js";
import { getAllChunks, getAllVectors } from "./knowledgeDb.js";
import crypto from "crypto";

// ── 会话级缓存 ────────────────────────────────────────────

/** 当前进程已下载的 OneDrive 文件缓存：Graph fileId → sourceId（避免同会话重复下载） */
const onedriveCache = new Map<string, string>();

// ── 类型定义 ────────────────────────────────────────────

export interface RemoteRetrieveConfig {
  /** MS Graph access token */
  msAccessToken?: string;
  /** Query embedding（用于 Phase 2 语义匹配） */
  queryEmbedding?: number[];
  /** 候选文件数量（Phase 1） */
  candidateLimit?: number;
  /** 实际拉取文件数量（Phase 2） */
  fetchLimit?: number;
  /** Embedding 配置 */
  embedding?: EmbeddingConfig;
}

export interface RemoteSearchResult {
  /** chunk 内容 */
  content: string;
  /** 来源文件名 */
  fileName: string;
  /** 来源文件 URL */
  fileUrl?: string;
  /** 相似度分数 */
  score: number;
  /** 匹配类型 */
  matchType: "keyword" | "vector" | "hybrid";
  /** 来源平台 */
  platform: "onedrive" | "sharepoint";
  /** 文件元数据 */
  metadata?: Record<string, unknown>;
}

// ── 两阶段检索 ──────────────────────────────────────────

/**
 * 两阶段检索：OneDrive/SharePoint 文档
 *
 * Phase 1: Graph Search API → 候选文件列表
 * Phase 2: 拉取 top-K → ingestFile 入库 → 在本地知识库中做混合检索
 *
 * 核心：Phase 2 复用统一分块 pipeline，文件入库后走本地混合检索。
 */
export async function twoStageRetrieve(
  query: string,
  config: RemoteRetrieveConfig,
): Promise<RemoteSearchResult[]> {
  if (!config.msAccessToken) {
    return [];
  }

  const candidateLimit = config.candidateLimit ?? 20;
  const fetchLimit = config.fetchLimit ?? 10;

  logger.info(`[RemoteRetrieve] 开始两阶段检索: query="${query.slice(0, 50)}..."`);

  // ── Phase 1: Graph Search API（粗筛） ──────────────────

  let candidates: GraphSearchResult[] = [];
  try {
    candidates = await searchFiles(
      { accessToken: config.msAccessToken },
      query,
      {
        top: candidateLimit,
        fileTypes: ["docx", "pdf", "txt", "md", "html", "pptx", "xlsx"],
      },
    );
    logger.info(`[RemoteRetrieve] Phase 1: ${candidates.length} 个候选文件`);
  } catch (err) {
    logger.error(`[RemoteRetrieve] Phase 1 失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (candidates.length === 0) {
    return [];
  }

  // ── Phase 2: 拉取 + ingestFile 入库 ───────────────────

  const topCandidates = candidates.slice(0, fetchLimit);
  const ingestedSourceIds: string[] = [];

  for (const candidate of topCandidates) {
    try {
      // 检查会话缓存：是否已经下载并入库过
      const cachedSourceId = onedriveCache.get(candidate.id);
      if (cachedSourceId) {
        ingestedSourceIds.push(cachedSourceId);
        logger.info(`[RemoteRetrieve] 已有缓存（跳过下载）: ${candidate.name}`);
        continue;
      }

      // 下载文件
      logger.info(`[RemoteRetrieve] 下载文件: ${candidate.name} (${candidate.id})`);
      const { content, mimeType } = await downloadFile(
        { accessToken: config.msAccessToken },
        candidate.id,
      );

      // ★ 复用统一分块 pipeline：extractText → preprocess → smartChunk → 去噪 → 存储 → embedding
      const result = await ingestFile({
        content,
        fileName: candidate.name,
        sourceType: "onedrive_file",
        url: candidate.webUrl,
        filePath: `onedrive/${candidate.id}/${candidate.name}`,
        embedding: config.embedding,
      });

      if (result.status === "ok") {
        onedriveCache.set(candidate.id, result.sourceId);
        ingestedSourceIds.push(result.sourceId);
        logger.info(`[RemoteRetrieve] 入库成功: ${candidate.name}, ${result.chunkCount} chunks`);
      } else if (result.status === "duplicate") {
        // 内容相同，已在库中（可能由之前的 generation run 入库）
        onedriveCache.set(candidate.id, result.sourceId);
        ingestedSourceIds.push(result.sourceId);
        logger.info(`[RemoteRetrieve] 文件已存在（复用入库）: ${candidate.name}, sourceId=${result.sourceId.slice(0, 8)}...`);
      }
    } catch (err) {
      logger.warn(`[RemoteRetrieve] 文件处理失败: ${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (ingestedSourceIds.length === 0) {
    return [];
  }

  // ── 在本地知识库中做检索（刚入库的 chunks 已在库中） ────

  const results: RemoteSearchResult[] = [];

  // 关键词匹配
  const keywordResults = keywordMatch(query, ingestedSourceIds);

  // 如果有 queryEmbedding，做向量匹配
  if (config.queryEmbedding) {
    const vectorResults = vectorMatch(config.queryEmbedding, ingestedSourceIds);
    const fused = fuseResults(keywordResults, vectorResults);

    for (const r of fused) {
      results.push({
        content: r.content,
        fileName: r.fileName,
        fileUrl: r.fileUrl,
        score: r.score,
        matchType: r.matchType,
        platform: "onedrive",
      });
    }
  } else {
    for (const r of keywordResults) {
      results.push({
        content: r.content,
        fileName: r.fileName,
        fileUrl: r.fileUrl,
        score: r.score,
        matchType: "keyword",
        platform: "onedrive",
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  logger.info(`[RemoteRetrieve] 两阶段检索完成: ${results.length} 个结果`);
  return results.slice(0, 10);
}

// ── 辅助函数 ────────────────────────────────────────────

/** 在指定 sourceId 范围内做关键词匹配 */
function keywordMatch(
  query: string,
  sourceIds: string[],
): Array<{ content: string; fileName: string; fileUrl?: string; score: number }> {
  const queryTokens = tokenize(query);
  const allChunks = getAllChunks();
  const sourceSet = new Set(sourceIds);

  return allChunks
    .filter(c => sourceSet.has(c.sourceId))
    .map(chunk => {
      const chunkTokens = tokenize(chunk.content);
      let matchCount = 0;
      for (const qt of queryTokens) {
        if (chunkTokens.includes(qt)) matchCount++;
      }
      const score = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
      return { content: chunk.content, fileName: chunk.sourceId, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 在指定 sourceId 范围内做向量匹配 */
function vectorMatch(
  queryEmbedding: number[],
  sourceIds: string[],
): Array<{ content: string; fileName: string; fileUrl?: string; score: number }> {
  const allVectors = getAllVectors();
  const allChunks = getAllChunks();
  const sourceSet = new Set(sourceIds);
  const chunkMap = new Map(allChunks.map(c => [c.id, c]));

  return allVectors
    .filter(v => {
      const chunk = chunkMap.get(v.chunkId);
      return chunk && sourceSet.has(chunk.sourceId);
    })
    .map(v => {
      const chunk = chunkMap.get(v.chunkId)!;
      const score = cosineSimilarity(queryEmbedding, v.embedding);
      return { content: chunk.content, fileName: chunk.sourceId, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 融合关键词和向量结果（RRF） */
function fuseResults(
  keywordResults: Array<{ content: string; fileName: string; fileUrl?: string; score: number }>,
  vectorResults: Array<{ content: string; fileName: string; fileUrl?: string; score: number }>,
): Array<{ content: string; fileName: string; fileUrl?: string; score: number; matchType: "keyword" | "vector" | "hybrid" }> {
  const K = 60;
  const scores = new Map<string, { content: string; fileName: string; fileUrl?: string; keywordRank: number; vectorRank: number }>();

  keywordResults.forEach((r, rank) => {
    const key = r.content.slice(0, 50);
    scores.set(key, { content: r.content, fileName: r.fileName, fileUrl: r.fileUrl, keywordRank: rank + 1, vectorRank: Infinity });
  });

  vectorResults.forEach((r, rank) => {
    const key = r.content.slice(0, 50);
    const existing = scores.get(key);
    if (existing) {
      existing.vectorRank = rank + 1;
    } else {
      scores.set(key, { content: r.content, fileName: r.fileName, fileUrl: r.fileUrl, keywordRank: Infinity, vectorRank: rank + 1 });
    }
  });

  return Array.from(scores.values()).map(s => {
    const keywordScore = s.keywordRank < Infinity ? 1 / (K + s.keywordRank) : 0;
    const vectorScore = s.vectorRank < Infinity ? 1 / (K + s.vectorRank) : 0;
    const totalScore = keywordScore + vectorScore;

    let matchType: "keyword" | "vector" | "hybrid";
    if (s.keywordRank < Infinity && s.vectorRank < Infinity) matchType = "hybrid";
    else if (s.vectorRank < Infinity) matchType = "vector";
    else matchType = "keyword";

    return { content: s.content, fileName: s.fileName, fileUrl: s.fileUrl, score: totalScore, matchType };
  }).sort((a, b) => b.score - a.score);
}

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 简单分词 */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^一-鿿a-z0-9]/g, " ");
  const tokens: string[] = [];
  const englishWords = normalized.match(/[a-z]+/g) ?? [];
  tokens.push(...englishWords);
  const chinese = normalized.match(/[一-鿿]+/g) ?? [];
  for (const segment of chinese) {
    for (let i = 0; i < segment.length - 1; i++) {
      tokens.push(segment.slice(i, i + 2));
    }
    if (segment.length === 1) tokens.push(segment);
  }
  return tokens.filter(t => t.length > 0);
}
