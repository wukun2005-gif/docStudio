/**
 * 生成树模块 — 段落级来源追溯
 * Feature #17: 生成树可视化
 * Feature #18: 生成树 CRUD
 * Feature #19: 拖拽重生成
 */
import { getDb } from "./db.js";
import { logger } from "./logger.js";

export interface ProvenanceNode {
  id: string;
  runId: string;
  paragraphIdx: number;
  chunkId?: string;
  score: number;
  isManual: boolean;
  parentId?: string;
  createdAt: string;
}

// ── CRUD ────────────────────────────────────────────

export function addProvenanceNode(node: {
  id: string; runId: string; paragraphIdx: number;
  chunkId?: string; score?: number; isManual?: boolean; parentId?: string;
}): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO provenance_nodes
    (id, run_id, paragraph_idx, chunk_id, score, is_manual, parent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
    .run(node.id, node.runId, node.paragraphIdx,
      node.chunkId ?? null, node.score ?? 0, node.isManual ? 1 : 0,
      node.parentId ?? null);
}

export function getProvenanceByRunId(runId: string): ProvenanceNode[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM provenance_nodes WHERE run_id = ? ORDER BY paragraph_idx").all(runId) as any[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    chunkId: r.chunk_id,
    score: r.score,
    isManual: r.is_manual === 1,
    parentId: r.parent_id,
    createdAt: r.created_at,
  }));
}

export function deleteProvenanceNode(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM provenance_nodes WHERE id = ?").run(id);
}

export function updateProvenanceScore(id: string, score: number): void {
  const db = getDb();
  db.prepare("UPDATE provenance_nodes SET score = ? WHERE id = ?").run(score, id);
}

/** 替换来源（Feature #18） */
export function replaceSource(nodeId: string, newChunkId: string): void {
  const db = getDb();
  db.prepare("UPDATE provenance_nodes SET chunk_id = ?, is_manual = 1 WHERE id = ?").run(newChunkId, nodeId);
  logger.info(`[Provenance] 替换来源: ${nodeId} -> ${newChunkId}`);
}

/** 获取段落的来源树 */
export function getParagraphTree(runId: string, paragraphIdx: number): ProvenanceNode[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM provenance_nodes WHERE run_id = ? AND paragraph_idx = ? ORDER BY score DESC"
  ).all(runId, paragraphIdx) as any[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    chunkId: r.chunk_id,
    score: r.score,
    isManual: r.is_manual === 1,
    parentId: r.parent_id,
    createdAt: r.created_at,
  }));
}

/** 批量构建生成树 */
export function buildProvenanceTree(
  runId: string,
  paragraphs: Array<{ idx: number; sources: Array<{ chunkId: string; score: number }> }>,
): void {
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO provenance_nodes
    (id, run_id, paragraph_idx, chunk_id, score, is_manual, created_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now','localtime'))`);

  const tx = db.transaction(() => {
    for (const para of paragraphs) {
      for (const source of para.sources) {
        stmt.run(
          crypto.randomUUID(),
          runId,
          para.idx,
          source.chunkId,
          source.score,
        );
      }
    }
  });
  tx();

  logger.info(`[Provenance] 构建生成树: ${paragraphs.length} 段落`);
}

import crypto from "crypto";
