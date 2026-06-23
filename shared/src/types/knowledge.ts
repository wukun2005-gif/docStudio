/**
 * 知识库相关类型
 */

export type SourceType = "pdf" | "docx" | "txt" | "html" | "md" | "url" | "demo" | "generation";
export type SourceStatus = "processing" | "ready" | "error";

export interface KnowledgeSource {
  id: string;
  name: string;
  type: SourceType;
  filePath?: string;
  url?: string;
  contentHash?: string;
  chunkCount: number;
  status: SourceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata?: ChunkMetadata;
  createdAt: string;
}

export interface ChunkMetadata {
  page?: number;
  section?: string;
  title?: string;
  [key: string]: unknown;
}

export interface KnowledgeVector {
  chunkId: string;
  embedding: number[];
  modelId: string;
}

export interface SearchResult {
  chunk: KnowledgeChunk;
  source: KnowledgeSource;
  score: number;
  matchType: "bm25" | "vector" | "hybrid";
}
