/**
 * 知识库相关类型
 */

export type SourceType =
  | "pdf" | "docx" | "txt" | "html" | "md" | "url" | "demo" | "generation"
  | "github_repo"      // GitHub repo 整体（clone 到本地）
  | "github_file"      // repo 内单个文件
  | "onedrive_file"    // OneDrive 文件
  | "sharepoint_file"  // SharePoint 文件
  | "outlook_email"    // Outlook 邮件
  | "outlook_contact"  // Outlook 联系人
  | "teams_chat";      // Teams 聊天
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

// ── 远程知识源索引 ──────────────────────────────────────

export interface RemoteIndex {
  id: string;
  sourceType: "github_repo" | "onedrive" | "sharepoint" | "outlook_email" | "outlook_contact";
  remoteId: string;         // 平台侧 ID（GitHub: owner/repo, OneDrive: fileId）
  name: string;
  url?: string;
  metadata?: RemoteIndexMetadata;
  contentHash?: string;
  indexedAt: string;
  chunkCount: number;
  status: "indexed" | "syncing" | "error";
}

export interface RemoteIndexMetadata {
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
  mimeType?: string;
  size?: number;
  lastModified?: string;
  [key: string]: unknown;
}

// ── 同步任务 ────────────────────────────────────────────

export type SyncJobStatus = "pending" | "running" | "completed" | "error";

export interface SyncJob {
  id: string;
  sourceType: "github_repo" | "onedrive" | "outlook_email" | "outlook_contact";
  config: SyncJobConfig;
  status: SyncJobStatus;
  progress?: SyncJobProgress;
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobConfig {
  owner?: string;
  repo?: string;
  branch?: string;
  folderId?: string;
  [key: string]: unknown;
}

export interface SyncJobProgress {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
}
