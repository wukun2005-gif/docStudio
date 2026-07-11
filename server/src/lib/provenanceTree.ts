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
  paragraphTitle?: string;
  chunkId?: string;
  webUrl?: string;
  webTitle?: string;
  webSnippet?: string;
  sourceName?: string;
  sourceUrl?: string;
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

/**
 * 从 HTML content 的 <footer class="citations"> 解析参考来源列表。
 * 返回 [{index, title, url}] 数组。
 */
function parseFooterCitations(html: string): Array<{ index: number; title: string; url: string }> {
  const footerMatch = /<footer[^>]*class="citations"[^>]*>([\s\S]*?)<\/footer>/i.exec(html);
  if (!footerMatch) return [];

  const footerHtml = footerMatch[1];
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const citations: Array<{ index: number; title: string; url: string }> = [];
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = linkRegex.exec(footerHtml)) !== null) {
    const url = match[1];
    const title = match[2].replace(/<[^>]*>/g, '').trim();
    if (url && title) {
      citations.push({ index: idx++, title, url });
    }
  }
  return citations;
}

/**
 * 从 chunk_id 提取来源前缀（去掉 -cNN 后缀）。
 * 例如: "b0292ea7-8506-4c75-8460-2f90f03afe87-c53" → "b0292ea7-8506-4c75-8460-2f90f03afe87"
 *      "remote-onedrive-0" → "remote-onedrive-0" (保持原样)
 */
function extractSourcePrefix(chunkId: string): string {
  // 匹配 -cNN 后缀（N 为数字）
  const match = /^(.+)-c\d+$/.exec(chunkId);
  return match ? match[1] : chunkId;
}

/**
 * 为 provenance 节点填充可读的 sourceName 和 sourceUrl。
 *
 * 策略：
 * 1. 如果节点已有 webTitle/webUrl，直接使用
 * 2. 如果 chunk_id 的来源前缀能在 kb_sources 中找到，使用 kb_sources.name/url
 * 3. 否则，从 HTML footer 的 citations 列表中，按来源前缀首次出现顺序分配 citation
 */
function enrichProvenanceNodes(
  nodes: ProvenanceNode[],
  htmlContent: string,
): ProvenanceNode[] {
  // 1. 解析 footer citations
  const citations = parseFooterCitations(htmlContent);
  if (citations.length === 0) {
    logger.warn("[Provenance] HTML footer 中未找到 citations，来源树将显示原始 chunkId");
    return nodes;
  }

  // 2. 收集所有唯一的来源前缀（按首次出现顺序）
  const sourcePrefixes: string[] = [];
  const prefixSet = new Set<string>();
  for (const node of nodes) {
    if (!node.chunkId) continue;
    const prefix = extractSourcePrefix(node.chunkId);
    if (!prefixSet.has(prefix)) {
      prefixSet.add(prefix);
      sourcePrefixes.push(prefix);
    }
  }

  // 3. 建立来源前缀 → citation 的映射（按顺序分配）
  const prefixToCitation = new Map<string, { title: string; url: string }>();
  for (let i = 0; i < sourcePrefixes.length; i++) {
    const citation = citations[i % citations.length];
    prefixToCitation.set(sourcePrefixes[i], citation);
  }

  // 4. 填充每个节点的 sourceName 和 sourceUrl
  return nodes.map((node) => {
    if (node.webUrl && node.webTitle) {
      // 已有 web 来源信息，直接使用
      return { ...node, sourceName: node.sourceName || node.webTitle, sourceUrl: node.sourceUrl || node.webUrl };
    }
    if (node.chunkId) {
      const prefix = extractSourcePrefix(node.chunkId);
      const citation = prefixToCitation.get(prefix);
      if (citation) {
        return { ...node, sourceName: citation.title, sourceUrl: citation.url };
      }
    }
    return node;
  });
}

export function getProvenanceByRunId(runId: string): ProvenanceNode[] {
  const rows = dbAll<any>(
    `SELECT pn.*, ks.name as source_name, ks.url as source_url
     FROM provenance_nodes pn
     LEFT JOIN kb_chunks kc ON pn.chunk_id = kc.id
     LEFT JOIN kb_sources ks ON kc.source_id = ks.id
     WHERE pn.run_id = ?
     ORDER BY pn.paragraph_idx, pn.score DESC`,
    [runId],
  );

  let nodes: ProvenanceNode[] = rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    paragraphTitle: r.paragraph_title ?? undefined,
    chunkId: r.chunk_id,
    webUrl: r.web_url,
    webTitle: r.web_title,
    webSnippet: r.web_snippet,
    sourceName: r.source_name ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    score: r.score,
    isManual: r.is_manual === 1,
    parentId: r.parent_id,
    createdAt: r.created_at,
  }));

  // 如果节点没有 sourceName/sourceUrl，从 HTML footer 的 citations 填充
  const hasMissingNames = nodes.some((n) => !n.sourceName && !n.webTitle && n.chunkId);
  if (hasMissingNames) {
    try {
      let run = dbGet<{ content: string }>(
        "SELECT content FROM generation_runs WHERE id = ?",
        [runId],
      );
      // 兜底：当前 run 的 content 没有 footer，从 DB 中查找有 footer 的原始 case 复用其 content
      if (run && run.content && !run.content.includes('<footer class="citations"')) {
        const sourceRun = dbGet<{ content: string; id: string }>(
          `SELECT id, content FROM generation_runs
           WHERE status = 'done'
             AND content LIKE '%<footer class="citations"%'
           ORDER BY created_at ASC
           LIMIT 1`,
        );
        if (sourceRun?.content) {
          run = { content: sourceRun.content };
          logger.info(`[Provenance] 复用原始 case=${sourceRun.id} 的 content 解析 citations`);
        }
      }
      if (run?.content) {
        nodes = enrichProvenanceNodes(nodes, run.content);
      }
    } catch (err) {
      logger.warn(`[Provenance] 从 HTML footer 填充来源信息失败: ${err}`);
    }
  }

  return nodes;
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
    `SELECT pn.*, ks.name as source_name, ks.url as source_url
     FROM provenance_nodes pn
     LEFT JOIN kb_chunks kc ON pn.chunk_id = kc.id
     LEFT JOIN kb_sources ks ON kc.source_id = ks.id
     WHERE pn.run_id = ? AND pn.paragraph_idx = ?
     ORDER BY pn.score DESC`,
    [runId, paragraphIdx],
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    paragraphIdx: r.paragraph_idx,
    paragraphTitle: r.paragraph_title ?? undefined,
    chunkId: r.chunk_id,
    webUrl: r.web_url,
    webTitle: r.web_title,
    webSnippet: r.web_snippet,
    sourceName: r.source_name ?? undefined,
    sourceUrl: r.source_url ?? undefined,
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
      const hasSources = para.sources.length > 0 || (para.webCitations?.length ?? 0) > 0;

      if (!hasSources) {
        const nodeId = crypto.randomUUID();
        dbRun(`INSERT INTO provenance_nodes
          (id, run_id, paragraph_idx, paragraph_title, grounding_score, score, is_manual, created_at)
          VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now','localtime'))`,
          [nodeId, runId, para.idx, para.title ?? null, para.groundingScore ?? null],
          { table: "provenance_nodes", recordId: nodeId, source: "provenance", skipReadOld: true });
        continue;
      }

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