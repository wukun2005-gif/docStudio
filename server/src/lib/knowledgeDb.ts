/**
 * 知识库存储模块 — SQLite + 向量化
 * 参考 patentExaminator knowledgeDb.ts
 */
import Database from "better-sqlite3";
import crypto from "crypto";
import { logger } from "./logger.js";
import { getDb } from "./db.js";

// ── Sources ─────────────────────────────────────────

export function addSource(source: {
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO kb_sources
    (id, name, type, file_path, url, content_hash, chunk_count, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source.id, source.name, source.type,
      source.filePath ?? null, source.url ?? null, source.contentHash ?? null,
      source.chunkCount, source.status, now, now);
}

export function getAllSources(): Array<{
  id: string; name: string; type: string;
  filePath?: string; url?: string; contentHash?: string;
  chunkCount: number; status: string; createdAt: string; updatedAt: string;
}> {
  const db = getDb();
  return db.prepare("SELECT * FROM kb_sources ORDER BY created_at DESC").all() as Array<{
    id: string; name: string; type: string;
    filePath?: string; url?: string; contentHash?: string;
    chunkCount: number; status: string; createdAt: string; updatedAt: string;
  }>;
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
  db.prepare("DELETE FROM kb_sources WHERE id = ?").run(id);
}

export function updateSourceStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE kb_sources SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, id);
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
      stmt.run(c.id, c.sourceId, c.content, c.chunkIndex,
        c.tokenCount ?? 0, c.metadata ? JSON.stringify(c.metadata) : null);
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
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  }));
}

export function getAllChunks(): Array<{
  id: string; sourceId: string; content: string; chunkIndex: number;
  tokenCount: number; metadata?: Record<string, unknown>;
}> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM kb_chunks ORDER BY source_id, chunk_index").all() as any[];
  return rows.map((r) => ({
    ...r,
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
  return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
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
      stmt.run(v.chunkId, Buffer.from(new Float64Array(v.embedding).buffer), v.modelId);
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
  db.exec("DELETE FROM kb_vectors; DELETE FROM kb_chunks; DELETE FROM kb_sources;");
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
