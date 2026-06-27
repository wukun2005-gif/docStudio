/**
 * 知识库存储模块 — SQLite + 向量化
 * 参考 patentExaminator knowledgeDb.ts
 *
 * 所有 DB 访问通过 lib/dbQuery.ts，自动审计。
 */
import crypto from "crypto";
import { localIso } from "../../../shared/src/datetime.js";
import { dbRun, dbGet, dbAll, dbTransaction } from "./dbQuery.js";
import { logAudit } from "./auditLog.js";

// ── Sources ─────────────────────────────────────────

export function addSource(source: {
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string;
}): void {
  const now = localIso();
  dbRun(
    `INSERT OR REPLACE INTO kb_sources
      (id, name, type, file_path, url, content_hash, chunk_count, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      source.id, source.name, source.type,
      source.filePath ?? null, source.url ?? null, source.contentHash ?? null,
      source.chunkCount, source.status, now, now,
    ],
    { table: "kb_sources", recordId: source.id, source: "knowledge", newData: source },
  );
}

export function getAllSources(): Array<{
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string; createdAt: string; updatedAt: string;
}> {
  const rows = dbAll<any>("SELECT * FROM kb_sources ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    filePath: r.file_path,
    url: r.url,
    contentHash: r.content_hash,
    chunkCount: r.chunk_count,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSourceById(id: string): {
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string; createdAt: string; updatedAt: string;
} | undefined {
  return dbGet<any>("SELECT * FROM kb_sources WHERE id = ?", [id]);
}

export function deleteSource(id: string): void {
  dbRun(
    "DELETE FROM kb_sources WHERE id = ?",
    [id],
    { table: "kb_sources", recordId: id, source: "knowledge", operation: "DELETE" },
  );
}

export function updateSourceStatus(id: string, status: string): void {
  dbRun(
    "UPDATE kb_sources SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    [status, id],
    { table: "kb_sources", recordId: id, source: "knowledge", newData: { status } },
  );
}

export function findDuplicateByHash(contentHash: string): string | undefined {
  const row = dbGet<{ id: string }>(
    "SELECT id FROM kb_sources WHERE content_hash = ?",
    [contentHash],
  );
  return row?.id;
}

// ── Chunks ──────────────────────────────────────────

export function addChunks(chunks: Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount?: number; metadata?: Record<string, unknown>;
}>): void {
  dbTransaction(() => {
    for (const c of chunks) {
      dbRun(
        `INSERT OR REPLACE INTO kb_chunks
          (id, source_id, content, chunk_index, token_count, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
        [
          c.id, c.sourceId, c.content, c.chunkIndex,
          c.tokenCount ?? 0, c.metadata ? JSON.stringify(c.metadata) : null,
        ],
        { table: "kb_chunks", recordId: c.id, source: "knowledge", newData: c },
      );
    }
  });
}

export function getChunksBySourceId(sourceId: string): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount: number; metadata?: Record<string, unknown>; createdAt: string;
}> {
  const rows = dbAll<any>(
    "SELECT * FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index",
    [sourceId],
  );
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    content: r.content,
    chunkIndex: r.chunk_index,
    tokenCount: r.token_count,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at,
  }));
}

export function getAllChunks(): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount: number; metadata?: Record<string, unknown>;
}> {
  const rows = dbAll<any>("SELECT * FROM kb_chunks ORDER BY source_id, chunk_index");
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    content: r.content,
    chunkIndex: r.chunk_index,
    tokenCount: r.token_count,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  }));
}

export function getChunkById(id: string): {
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount: number; metadata?: Record<string, unknown>;
} | undefined {
  const row = dbGet<any>("SELECT * FROM kb_chunks WHERE id = ?", [id]);
  if (!row) return undefined;
  return {
    id: row.id,
    sourceId: row.source_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    tokenCount: row.token_count,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// ── Vectors ─────────────────────────────────────────

export function addVectors(vectors: Array<{
  chunkId: string; embedding: number[]; modelId: string;
}>): void {
  dbTransaction(() => {
    for (const v of vectors) {
      dbRun(
        `INSERT OR REPLACE INTO kb_vectors
          (chunk_id, embedding, model_id) VALUES (?, ?, ?)`,
        [v.chunkId, Buffer.from(new Float64Array(v.embedding).buffer), v.modelId],
        {
          table: "kb_vectors",
          recordId: v.chunkId,
          source: "knowledge",
          newData: { chunkId: v.chunkId, modelId: v.modelId },
        },
      );
    }
  });
}

export function getAllVectors(): Array<{
  chunkId: string; embedding: number[]; modelId: string;
}> {
  const rows = dbAll<{ chunkId: string; embedding: Buffer; modelId: string }>(
    "SELECT * FROM kb_vectors",
  );
  return rows.map((r) => ({
    chunkId: r.chunkId,
    embedding: Array.from(new Float64Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 8)),
    modelId: r.modelId,
  }));
}

export function getVectorByChunkId(chunkId: string): {
  embedding: number[]; modelId: string;
} | undefined {
  const row = dbGet<{ embedding: Buffer; modelId: string }>(
    "SELECT * FROM kb_vectors WHERE chunk_id = ?",
    [chunkId],
  );
  if (!row) return undefined;
  return {
    embedding: Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8)),
    modelId: row.modelId,
  };
}

// ── Stats ───────────────────────────────────────────

export function getStats(): { sourceCount: number; chunkCount: number; vectorCount: number } {
  const sources = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM kb_sources")!;
  const chunks = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM kb_chunks")!;
  const vectors = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM kb_vectors")!;
  return { sourceCount: sources.c, chunkCount: chunks.c, vectorCount: vectors.c };
}

export function clearKnowledgeDb(): void {
  const sources = dbAll<{ id: string }>("SELECT id FROM kb_sources");

  dbTransaction(() => {
    dbRun("DELETE FROM kb_vectors", [], false);
    dbRun("DELETE FROM kb_chunks", [], false);
    dbRun("DELETE FROM kb_sources", [], false);
    for (const s of sources) {
      logAudit({
        table: "kb_sources",
        operation: "DELETE",
        recordId: s.id,
        source: "knowledge",
      });
    }
  });
}

// ── Utilities ───────────────────────────────────────

export function computeTextHash(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

/** 简单的文本切片 — 按段落和字数 */
export function chunkText(text: string, maxChunkSize: number = 500, overlap: number = 50): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChunkSize) {
      chunks.push(para.trim());
    } else {
      // 长段落按句子切分
      const sentences = para.split(/(?<=[。！？.!?])\s*/);
      let current = "";
      for (const sentence of sentences) {
        if (current.length + sentence.length > maxChunkSize && current.length > 0) {
          chunks.push(current.trim());
          // overlap: 保留最后 overlap 字符
          current = current.slice(-overlap) + sentence;
        } else {
          current += sentence;
        }
      }
      if (current.trim()) {
        chunks.push(current.trim());
      }
    }
  }

  return chunks;
}

// ── Embedding State ───────────────────────────────────

/** 标记 chunk 已 embedding */
export function markChunkEmbedded(chunkId: string): void {
  dbRun(
    "UPDATE kb_chunks SET embedded = 1 WHERE id = ?",
    [chunkId],
    { table: "kb_chunks", recordId: chunkId, source: "knowledge", newData: { embedded: 1 } },
  );
}

/** 批量标记 chunks 已 embedding */
export function markChunksEmbedded(chunkIds: string[]): void {
  if (chunkIds.length === 0) return;
  dbTransaction(() => {
    for (const id of chunkIds) {
      dbRun(
        "UPDATE kb_chunks SET embedded = 1 WHERE id = ?",
        [id],
        { table: "kb_chunks", recordId: id, source: "knowledge", newData: { embedded: 1 } },
      );
    }
  });
}

/** 设置 chunk 的 text_hash */
export function updateChunkTextHash(chunkId: string, textHash: string): void {
  dbRun(
    "UPDATE kb_chunks SET text_hash = ? WHERE id = ?",
    [textHash, chunkId],
    { table: "kb_chunks", recordId: chunkId, source: "knowledge", newData: { text_hash: textHash } },
  );
}

/** 批量设置 text_hash */
export function updateChunksTextHash(ids: string[], hashes: string[]): void {
  dbTransaction(() => {
    for (let i = 0; i < ids.length; i++) {
      dbRun(
        "UPDATE kb_chunks SET text_hash = ? WHERE id = ?",
        [hashes[i], ids[i]],
        { table: "kb_chunks", recordId: ids[i], source: "knowledge", newData: { text_hash: hashes[i] } },
      );
    }
  });
}

/** 根据 text_hash 查找已 embedding 的 chunks（用于断点续传） */
export function findEmbeddedHashes(hashes: string[]): Set<string> {
  if (hashes.length === 0) return new Set();
  const placeholders = hashes.map(() => "?").join(",");
  const rows = dbAll<{ text_hash: string }>(
    `SELECT text_hash FROM kb_chunks WHERE text_hash IN (${placeholders}) AND embedded = 1`,
    hashes,
  );
  return new Set(rows.map((r) => r.text_hash));
}

/** 获取未 embedding 的 chunks */
export function getUnembeddedChunks(): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
}> {
  return dbAll<any>(
    "SELECT id, source_id as sourceId, content, chunk_index as chunkIndex FROM kb_chunks WHERE embedded = 0 ORDER BY LENGTH(content)",
  );
}

// ── Remote Index ────────────────────────────────────────

export function addRemoteIndex(entry: {
  id: string; sourceType: string; remoteId: string; name: string;
  url?: string; metadata?: Record<string, unknown>; contentHash?: string;
  chunkCount?: number; status?: string;
}): void {
  const now = localIso();
  dbRun(
    `INSERT OR REPLACE INTO kb_remote_index
      (id, source_type, remote_id, name, url, metadata, content_hash, indexed_at, chunk_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, entry.sourceType, entry.remoteId, entry.name,
      entry.url ?? null, entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.contentHash ?? null, now, entry.chunkCount ?? 0, entry.status ?? "indexed",
    ],
    { table: "kb_remote_index", recordId: entry.id, source: "knowledge", newData: entry },
  );
}

export function getRemoteIndexesByType(sourceType: string): Array<{
  id: string; sourceType: string; remoteId: string; name: string;
  url?: string; metadata?: Record<string, unknown>; contentHash?: string;
  indexedAt: string; chunkCount: number; status: string;
}> {
  const rows = dbAll<any>(
    "SELECT * FROM kb_remote_index WHERE source_type = ? ORDER BY indexed_at DESC",
    [sourceType],
  );
  return rows.map(r => ({
    id: r.id,
    sourceType: r.source_type,
    remoteId: r.remote_id,
    name: r.name,
    url: r.url ?? undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    contentHash: r.content_hash ?? undefined,
    indexedAt: r.indexed_at,
    chunkCount: r.chunk_count,
    status: r.status,
  }));
}

export function getRemoteIndexByRemoteId(sourceType: string, remoteId: string): {
  id: string; sourceType: string; remoteId: string; name: string;
  url?: string; metadata?: Record<string, unknown>; contentHash?: string;
  indexedAt: string; chunkCount: number; status: string;
} | undefined {
  const r = dbGet<any>(
    "SELECT * FROM kb_remote_index WHERE source_type = ? AND remote_id = ?",
    [sourceType, remoteId],
  );
  if (!r) return undefined;
  return {
    id: r.id,
    sourceType: r.source_type,
    remoteId: r.remote_id,
    name: r.name,
    url: r.url ?? undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    contentHash: r.content_hash ?? undefined,
    indexedAt: r.indexed_at,
    chunkCount: r.chunk_count,
    status: r.status,
  };
}

export function updateRemoteIndexStatus(id: string, status: string, chunkCount?: number): void {
  if (chunkCount !== undefined) {
    dbRun(
      "UPDATE kb_remote_index SET status = ?, chunk_count = ?, indexed_at = datetime('now','localtime') WHERE id = ?",
      [status, chunkCount, id],
      { table: "kb_remote_index", recordId: id, source: "knowledge", newData: { status, chunk_count: chunkCount } },
    );
  } else {
    dbRun(
      "UPDATE kb_remote_index SET status = ?, indexed_at = datetime('now','localtime') WHERE id = ?",
      [status, id],
      { table: "kb_remote_index", recordId: id, source: "knowledge", newData: { status } },
    );
  }
}

export function deleteRemoteIndex(id: string): void {
  dbRun(
    "DELETE FROM kb_remote_index WHERE id = ?",
    [id],
    { table: "kb_remote_index", recordId: id, source: "knowledge", operation: "DELETE" },
  );
}

// ── Sync Jobs ───────────────────────────────────────────

export function addSyncJob(job: {
  id: string; sourceType: string; config: Record<string, unknown>;
  status?: string;
}): void {
  const now = localIso();
  dbRun(
    `INSERT INTO kb_sync_jobs
      (id, source_type, config, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [job.id, job.sourceType, JSON.stringify(job.config), job.status ?? "pending", now, now],
    { table: "kb_sync_jobs", recordId: job.id, source: "knowledge", newData: job },
  );
}

export function updateSyncJob(id: string, updates: {
  status?: string; progress?: Record<string, unknown>;
  lastSyncAt?: string; errorMessage?: string;
}): void {
  const now = localIso();
  const oldRow = dbGet<any>("SELECT * FROM kb_sync_jobs WHERE id = ?", [id]);
  if (!oldRow) return;

  const newStatus = updates.status ?? oldRow.status;
  const newProgress = updates.progress ? JSON.stringify(updates.progress) : oldRow.progress;
  const newLastSync = updates.lastSyncAt ?? oldRow.last_sync_at;
  const newError = updates.errorMessage ?? oldRow.error_message;

  dbRun(
    `UPDATE kb_sync_jobs SET status = ?, progress = ?, last_sync_at = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    [newStatus, newProgress, newLastSync, newError, now, id],
    {
      table: "kb_sync_jobs", recordId: id, source: "knowledge",
      newData: { status: newStatus, progress: newProgress, last_sync_at: newLastSync, error_message: newError },
    },
  );
}

export function getSyncJobsByType(sourceType: string): Array<{
  id: string; sourceType: string; config: Record<string, unknown>;
  status: string; progress?: Record<string, unknown>;
  lastSyncAt?: string; errorMessage?: string;
  createdAt: string; updatedAt: string;
}> {
  const rows = dbAll<any>(
    "SELECT * FROM kb_sync_jobs WHERE source_type = ? ORDER BY created_at DESC",
    [sourceType],
  );
  return rows.map(r => ({
    id: r.id,
    sourceType: r.source_type,
    config: JSON.parse(r.config),
    status: r.status,
    progress: r.progress ? JSON.parse(r.progress) : undefined,
    lastSyncAt: r.last_sync_at ?? undefined,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSyncJobById(id: string): {
  id: string; sourceType: string; config: Record<string, unknown>;
  status: string; progress?: Record<string, unknown>;
  lastSyncAt?: string; errorMessage?: string;
  createdAt: string; updatedAt: string;
} | undefined {
  const r = dbGet<any>("SELECT * FROM kb_sync_jobs WHERE id = ?", [id]);
  if (!r) return undefined;
  return {
    id: r.id,
    sourceType: r.source_type,
    config: JSON.parse(r.config),
    status: r.status,
    progress: r.progress ? JSON.parse(r.progress) : undefined,
    lastSyncAt: r.last_sync_at ?? undefined,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
