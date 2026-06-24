/**
 * 知识库存储模块 — SQLite + 向量化
 * 参考 patentExaminator knowledgeDb.ts
 */
import Database from "better-sqlite3";
import crypto from "crypto";
import { localIso } from "../../../shared/src/datetime.js";
import { logger } from "./logger.js";
import { getDb } from "./db.js";
import { logAudit } from "./auditLog.js";

// ── Sources ─────────────────────────────────────────

export function addSource(source: {
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string;
}): void {
  const db = getDb();
  const now = localIso();
  // 查询旧数据用于审计
  const oldRow = db.prepare("SELECT * FROM kb_sources WHERE id = ?").get(source.id) as any;

  db.prepare(`INSERT OR REPLACE INTO kb_sources
    (id, name, type, file_path, url, content_hash, chunk_count, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source.id, source.name, source.type,
      source.filePath ?? null, source.url ?? null, source.contentHash ?? null,
      source.chunkCount, source.status, now, now);

  logAudit({
    table: "kb_sources",
    operation: oldRow ? "UPDATE" : "INSERT",
    recordId: source.id,
    oldData: oldRow,
    newData: source,
    source: "knowledge",
  });
}

export function getAllSources(): Array<{
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string; createdAt: string; updatedAt: string;
}> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kb_sources ORDER BY created_at DESC").all() as any[];
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
  const db = getDb();
  return db.prepare("SELECT * FROM kb_sources WHERE id = ?").get(id) as any;
}

export function deleteSource(id: string): void {
  const db = getDb();
  // 查询旧数据用于审计
  const oldRow = db.prepare("SELECT * FROM kb_sources WHERE id = ?").get(id) as any;

  db.prepare("DELETE FROM kb_sources WHERE id = ?").run(id);

  logAudit({
    table: "kb_sources",
    operation: "DELETE",
    recordId: id,
    oldData: oldRow,
    source: "knowledge",
  });
}

export function updateSourceStatus(id: string, status: string): void {
  const db = getDb();
  // 查询旧数据用于审计
  const oldRow = db.prepare("SELECT * FROM kb_sources WHERE id = ?").get(id) as any;

  db.prepare("UPDATE kb_sources SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, id);

  logAudit({
    table: "kb_sources",
    operation: "UPDATE",
    recordId: id,
    oldData: oldRow,
    newData: { ...oldRow, status },
    source: "knowledge",
  });
}

export function findDuplicateByHash(contentHash: string): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT id FROM kb_sources WHERE content_hash = ?").get(contentHash) as { id: string } | undefined;
  return row?.id;
}

// ── Chunks ──────────────────────────────────────────

export function addChunks(chunks: Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount?: number; metadata?: Record<string, unknown>;
}>): void {
  const db = getDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO kb_chunks
    (id, source_id, content, chunk_index, token_count, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
  const tx = db.transaction(() => {
    for (const c of chunks) {
      // 查询旧数据用于审计
      const oldRow = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(c.id) as any;

      stmt.run(c.id, c.sourceId, c.content, c.chunkIndex,
        c.tokenCount ?? 0, c.metadata ? JSON.stringify(c.metadata) : null);

      logAudit({
        table: "kb_chunks",
        operation: oldRow ? "UPDATE" : "INSERT",
        recordId: c.id,
        oldData: oldRow,
        newData: c,
        source: "knowledge",
      });
    }
  });
  tx();
}

export function getChunksBySourceId(sourceId: string): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount: number; metadata?: Record<string, unknown>; createdAt: string;
}> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index").all(sourceId) as any[];
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
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kb_chunks ORDER BY source_id, chunk_index").all() as any[];
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
  const db = getDb();
  const row = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(id) as any;
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
  const db = getDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO kb_vectors
    (chunk_id, embedding, model_id) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const v of vectors) {
      // 查询旧数据用于审计
      const oldRow = db.prepare("SELECT chunk_id, model_id FROM kb_vectors WHERE chunk_id = ?").get(v.chunkId) as any;

      stmt.run(v.chunkId, Buffer.from(new Float64Array(v.embedding).buffer), v.modelId);

      logAudit({
        table: "kb_vectors",
        operation: oldRow ? "UPDATE" : "INSERT",
        recordId: v.chunkId,
        oldData: oldRow ? { chunkId: oldRow.chunk_id, modelId: oldRow.model_id } : undefined,
        newData: { chunkId: v.chunkId, modelId: v.modelId },
        source: "knowledge",
      });
    }
  });
  tx();
}

export function getAllVectors(): Array<{
  chunkId: string; embedding: number[]; modelId: string;
}> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kb_vectors").all() as Array<{
    chunkId: string; embedding: Buffer; modelId: string;
  }>;
  return rows.map((r) => ({
    chunkId: r.chunkId,
    embedding: Array.from(new Float64Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 8)),
    modelId: r.modelId,
  }));
}

export function getVectorByChunkId(chunkId: string): {
  embedding: number[]; modelId: string;
} | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM kb_vectors WHERE chunk_id = ?").get(chunkId) as {
    embedding: Buffer; modelId: string;
  } | undefined;
  if (!row) return undefined;
  return {
    embedding: Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8)),
    modelId: row.modelId,
  };
}

// ── Stats ───────────────────────────────────────────

export function getStats(): { sourceCount: number; chunkCount: number; vectorCount: number } {
  const db = getDb();
  const sources = db.prepare("SELECT COUNT(*) as c FROM kb_sources").get() as { c: number };
  const chunks = db.prepare("SELECT COUNT(*) as c FROM kb_chunks").get() as { c: number };
  const vectors = db.prepare("SELECT COUNT(*) as c FROM kb_vectors").get() as { c: number };
  return { sourceCount: sources.c, chunkCount: chunks.c, vectorCount: vectors.c };
}

export function clearKnowledgeDb(): void {
  const db = getDb();
  // 查询旧数据用于审计
  const sources = db.prepare("SELECT id FROM kb_sources").all() as Array<{ id: string }>;

  db.exec("DELETE FROM kb_vectors; DELETE FROM kb_chunks; DELETE FROM kb_sources;");

  // 记录审计：每个被删除的 source
  for (const s of sources) {
    logAudit({
      table: "kb_sources",
      operation: "DELETE",
      recordId: s.id,
      source: "knowledge",
    });
  }
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
  const db = getDb();
  const oldRow = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(chunkId) as any;

  db.prepare("UPDATE kb_chunks SET embedded = 1 WHERE id = ?").run(chunkId);

  logAudit({
    table: "kb_chunks",
    operation: "UPDATE",
    recordId: chunkId,
    oldData: oldRow,
    newData: { ...oldRow, embedded: 1 },
    source: "knowledge",
  });
}

/** 批量标记 chunks 已 embedding */
export function markChunksEmbedded(chunkIds: string[]): void {
  if (chunkIds.length === 0) return;
  const db = getDb();
  const stmt = db.prepare("UPDATE kb_chunks SET embedded = 1 WHERE id = ?");
  const tx = db.transaction(() => {
    for (const id of chunkIds) {
      const oldRow = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(id) as any;
      stmt.run(id);
      logAudit({
        table: "kb_chunks",
        operation: "UPDATE",
        recordId: id,
        oldData: oldRow,
        newData: { ...oldRow, embedded: 1 },
        source: "knowledge",
      });
    }
  });
  tx();
}

/** 设置 chunk 的 text_hash */
export function updateChunkTextHash(chunkId: string, textHash: string): void {
  const db = getDb();
  const oldRow = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(chunkId) as any;

  db.prepare("UPDATE kb_chunks SET text_hash = ? WHERE id = ?").run(textHash, chunkId);

  logAudit({
    table: "kb_chunks",
    operation: "UPDATE",
    recordId: chunkId,
    oldData: oldRow,
    newData: { ...oldRow, text_hash: textHash },
    source: "knowledge",
  });
}

/** 批量设置 text_hash */
export function updateChunksTextHash(ids: string[], hashes: string[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE kb_chunks SET text_hash = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (let i = 0; i < ids.length; i++) {
      const oldRow = db.prepare("SELECT * FROM kb_chunks WHERE id = ?").get(ids[i]) as any;
      stmt.run(hashes[i], ids[i]);
      logAudit({
        table: "kb_chunks",
        operation: "UPDATE",
        recordId: ids[i],
        oldData: oldRow,
        newData: { ...oldRow, text_hash: hashes[i] },
        source: "knowledge",
      });
    }
  });
  tx();
}

/** 根据 text_hash 查找已 embedding 的 chunks（用于断点续传） */
export function findEmbeddedHashes(hashes: string[]): Set<string> {
  if (hashes.length === 0) return new Set();
  const db = getDb();
  const placeholders = hashes.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT text_hash FROM kb_chunks WHERE text_hash IN (${placeholders}) AND embedded = 1`
  ).all(...hashes) as Array<{ text_hash: string }>;
  return new Set(rows.map((r) => r.text_hash));
}

/** 获取未 embedding 的 chunks */
export function getUnembeddedChunks(): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
}> {
  const db = getDb();
  return db.prepare(
    "SELECT id, source_id as sourceId, content, chunk_index as chunkIndex FROM kb_chunks WHERE embedded = 0 ORDER BY LENGTH(content)"
  ).all() as any[];
}
