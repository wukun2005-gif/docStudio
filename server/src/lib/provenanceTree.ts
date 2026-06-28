/**
 * 生成树模块 — 段落级来源追溯
 * Feature #17: 生成树可视化
 * Feature #18: 生成树 CRUD
 * Feature #19: 拖拽重生成
 */
import { dbRun, dbGet, dbAll, dbTransaction } from "./dbQuery.js";
import { logger } from "./logger.js";

export interface ProvenanceNode {
  id: string;
  runId: string;
  paragraphIdx: number;
  chunkId?: string;
  webUrl?: string;
  webTitle?: string;
  webSnippet?: string;
  score: number;
  isManual: boolean;
  parentId?: string;
  createdAt: string;
}

// ── CRUD ────────────────────────────────────────────

export function addProvenanceNode(node: {
  id: string; runId: string; paragraphIdx: number;
  chunkId?: string; webUrl?: string; webTitle?: string; webSnippet?: string;
  score?: number; isManual?: boolean; parentId?: string;
}): void {
  dbRun(`INSERT OR REPLACE INTO provenance_nodes
    (id, run_id, paragraph_idx, chunk_id, web_url, web_title, web_snippet, score, is_manual, parent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
    [node.id, node.runId, node.paragraphIdx,
      node.chunkId ?? null, node.webUrl ?? null, node.webTitle ?? null, node.webSnippet ?? null,
      node.score ?? 0, node.isManual ? 1 : 0,
      node.parentId ?? null],
    { table: "provenance_nodes", recordId: node.id, source: "provenance" });
}

export function getProvenanceByRunId(runId: string): ProvenanceNode[] {
  const rows = dbAll<any>("SELECT * FROM provenance_nodes WHERE run_id = ? ORDER BY paragraph_idx", [runId]);
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    chunkId: r.chunk_id,
    webUrl: r.web_url,
    webTitle: r.web_title,
    webSnippet: r.web_snippet,
    score: r.score,
    isManual: r.is_manual === 1,
    parentId: r.parent_id,
    createdAt: r.created_at,
  }));
}

export function deleteProvenanceNode(id: string): void {
  dbRun("DELETE FROM provenance_nodes WHERE id = ?", [id],
    { table: "provenance_nodes", recordId: id, source: "provenance", operation: "DELETE" });
}

export function updateProvenanceScore(id: string, score: number): void {
  dbRun("UPDATE provenance_nodes SET score = ? WHERE id = ?", [score, id],
    { table: "provenance_nodes", recordId: id, source: "provenance" });
}

/** 替换来源（Feature #18） */
export function replaceSource(nodeId: string, newChunkId: string): void {
  dbRun("UPDATE provenance_nodes SET chunk_id = ?, is_manual = 1 WHERE id = ?", [newChunkId, nodeId],
    { table: "provenance_nodes", recordId: nodeId, source: "provenance" });
  logger.info(`[Provenance] 替换来源: ${nodeId} -> ${newChunkId}`);
}

/** 获取段落的来源树 */
export function getParagraphTree(runId: string, paragraphIdx: number): ProvenanceNode[] {
  const rows = dbAll<any>(
    "SELECT * FROM provenance_nodes WHERE run_id = ? AND paragraph_idx = ? ORDER BY score DESC",
    [runId, paragraphIdx],
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    chunkId: r.chunk_id,
    webUrl: r.web_url,
    webTitle: r.web_title,
    webSnippet: r.web_snippet,
    score: r.score,
    isManual: r.is_manual === 1,
    parentId: r.parent_id,
    createdAt: r.created_at,
  }));
}

/** 批量构建生成树 */
export function buildProvenanceTree(
  runId: string,
  paragraphs: Array<{
    idx: number;
    title?: string;
    groundingScore?: number;
    sources: Array<{ chunkId: string; score: number }>;
    webCitations?: Array<{ url: string; title: string; snippet: string; score?: number }>;
  }>,
): void {
  dbTransaction(() => {
    for (const para of paragraphs) {
      // ── 每个段落内归一化分数到 0–1（Bug 5 fix：RRF 原始分数 ~0.003–0.015 对 UI 无意义）──
      const allScores: number[] = [
        ...para.sources.map((s) => s.score),
        ...(para.webCitations ?? []).map((wc) => wc.score ?? 0.5),
      ];
      const maxScore = Math.max(...allScores);
      const minScore = Math.min(...allScores);
      const normalize = (raw: number): number => {
        if (maxScore === minScore || !isFinite(raw)) return 1.0;
        return Number(((raw - minScore) / (maxScore - minScore)).toFixed(4));
      };

      for (const source of para.sources) {
        const nodeId = crypto.randomUUID();
        dbRun(`INSERT INTO provenance_nodes
          (id, run_id, paragraph_idx, paragraph_title, grounding_score, chunk_id, score, is_manual, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now','localtime'))`,
          [nodeId, runId, para.idx, para.title ?? null, para.groundingScore ?? null, source.chunkId, normalize(source.score)],
          { table: "provenance_nodes", recordId: nodeId, source: "provenance", skipReadOld: true });
      }
      for (const wc of para.webCitations ?? []) {
        const nodeId = crypto.randomUUID();
        dbRun(`INSERT INTO provenance_nodes
          (id, run_id, paragraph_idx, paragraph_title, grounding_score, web_url, web_title, web_snippet, score, is_manual, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now','localtime'))`,
          [nodeId, runId, para.idx, para.title ?? null, para.groundingScore ?? null, wc.url, wc.title, wc.snippet, normalize(wc.score ?? 0.5)],
          { table: "provenance_nodes", recordId: nodeId, source: "provenance", skipReadOld: true });
      }
    }
  });

  const totalNodes = paragraphs.reduce((sum, p) => sum + p.sources.length + (p.webCitations?.length ?? 0), 0);
  logger.info(`[Provenance] 构建生成树: ${paragraphs.length} 段落, ${totalNodes} 节点 (分数已按段落归一化到 0-1)`);
}

import crypto from "crypto";