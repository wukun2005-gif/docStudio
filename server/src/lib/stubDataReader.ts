/**
 * stubDataReader.ts — 运行时从 DB 读取真实 case 数据，不调用任何外部 API
 *
 * 替代 fixture 文件（case-1782966166476.ts），直接从 generation_runs 表读取
 * 真实 LLM 生成的 HTML 内容，解析为 GenerateDocResult。
 *
 * 数据流：
 *   DB generation_runs.content (HTML)
 *     → 去除 <div>/<style> 包裹
 *     → 按 <script chart-spec> 标签位置分割为 N 个 section
 *     → 每个 section 提取 chartSpecsRaw（处理双重编码）
 *     → 查询 provenance_nodes + kb_chunks + kb_sources 获取来源树
 *     → 从来源树重建参考来源列表（DB content 中无 footer）
 *     → 返回 GenerateDocResult + citations + provenanceNodes
 */

import { dbGet, dbAll } from "./dbQuery.js";
import { logger } from "./logger.js";
import type { GenerateDocResult } from "./docGenerator.js";

// ── 扩展类型：在 GenerateDocResult 基础上增加来源数据 ──────
export interface CitationItem {
  index: number;
  title: string;
  url: string;
}

export interface ProvenanceNodeRow {
  paragraphIdx: number;
  paragraphTitle: string;
  chunkId: string | null;
  webUrl: string | null;
  webTitle: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  score: number;
  groundingScore: number | null;
}

export interface StubCaseResult extends GenerateDocResult {
  citations: CitationItem[];
  provenanceNodes: ProvenanceNodeRow[];
  /** 原始 DB run ID，用于复制 provenance_nodes */
  sourceRunId: string;
}

// ── DB 记录类型 ──────────────────────────────────────────
interface DbRun {
  id: string;
  title: string;
  content: string;
  outline: string | null;
  trust_score: number | null;
  document_style: string | null;
}

// ── 查询条件：精确定位 case 1782966166476 对应的原始生成记录 ──
// 特征：标题"Nexora Tech项目综合汇报"（无空格），有 provenance 数据，
// content 中包含"6/5-6/25"（mhtml 中的特征数据），不包含"用户认证模块"（后生成的记录）
const SQL_FIND_REAL_CASE = `
  SELECT id, title, content, outline, trust_score, document_style
  FROM generation_runs
  WHERE title LIKE '%Nexora Tech%'
    AND status = 'done'
    AND content LIKE '%6/5-6/25%'
    AND content NOT LIKE '%用户认证模块%'
    AND EXISTS (SELECT 1 FROM provenance_nodes WHERE run_id = generation_runs.id)
  ORDER BY created_at ASC
  LIMIT 1
`;

// Fallback：放宽条件，找最老的有 provenance 数据的记录（原始生成）
const SQL_FIND_REAL_CASE_FALLBACK = `
  SELECT id, title, content, outline, trust_score, document_style
  FROM generation_runs
  WHERE title LIKE '%Nexora Tech%'
    AND status = 'done'
    AND EXISTS (SELECT 1 FROM provenance_nodes WHERE run_id = generation_runs.id)
  ORDER BY created_at ASC
  LIMIT 1
`;

/**
 * 从 DB 读取真实 case 数据，解析为 GenerateDocResult。
 * 如果 DB 中没有符合条件的记录，返回 null（调用方应 fallback 到 fixture）。
 */
export function readCaseFromDb(): StubCaseResult | null {
  // 优先查找有 provenance 数据的记录
  let run = dbGet<DbRun>(SQL_FIND_REAL_CASE);

  // Fallback：无 provenance 数据时，找最新的有内容的记录
  if (!run) {
    logger.warn("[StubDataReader] 未找到有 provenance 数据的记录，尝试 fallback 查询");
    run = dbGet<DbRun>(SQL_FIND_REAL_CASE_FALLBACK);
  }

  if (!run || !run.content) {
    logger.warn("[StubDataReader] DB 中未找到符合条件的 case 数据");
    return null;
  }

  logger.info(
    `[StubDataReader] 从 DB 读取 case: runId=${run.id}, title=${run.title}, contentLen=${run.content.length}`
  );

  // 解析 outline（用于获取 section 标题）
  let outline: Array<{ title: string }> = [];
  if (run.outline) {
    try {
      outline = JSON.parse(run.outline);
    } catch {
      logger.warn("[StubDataReader] outline JSON 解析失败，使用默认标题");
    }
  }

  // 查询来源树（JOIN kb_chunks + kb_sources 获取来源名称和 URL）
  const provenanceNodes = readProvenanceFromDb(run.id);
  logger.info(`[StubDataReader] 查询到 ${provenanceNodes.length} 个来源树节点`);

  // 从 HTML footer 解析参考来源列表（footer 中有完整的标题和 URL）
  const citations = buildCitationsFromHtml(run.content);
  logger.info(`[StubDataReader] 解析到 ${citations.length} 个参考来源`);

  // 解析 HTML 内容为 sections（传入 provenanceNodes 以计算真实 groundingScore）
  const sections = parseHtmlIntoSections(run.content, outline, provenanceNodes);

  if (sections.length === 0) {
    logger.warn("[StubDataReader] HTML 解析后未得到任何 section");
    return null;
  }

  logger.info(
    `[StubDataReader] 解析完成: ${sections.length} sections, ` +
      sections.map((s) => `${s.title}(charts=${s.chartSpecsRaw?.length || 0})`).join(", ")
  );

  return {
    content: run.content,
    sections,
    trustScore: run.trust_score ?? 0.5,
    documentStyle: run.document_style ?? "email",
    title: run.title,
    citations,
    provenanceNodes,
    sourceRunId: run.id,
  };
}

/**
 * 从 DB 读取 outline（用于 chat stub mode）。
 * 返回带 id/level 字段的 outline 数组，格式与前端期望一致。
 */
export function readOutlineFromDb(): Array<{
  id: string;
  title: string;
  level: number;
  children: unknown[];
  description: string;
}> | null {
  // 精确定位 case 1782966166476 对应的原始生成记录
  let run = dbGet<{ outline: string | null; title: string }>(`
    SELECT outline, title
    FROM generation_runs
    WHERE title LIKE '%Nexora Tech%'
      AND status = 'done'
      AND content LIKE '%6/5-6/25%'
      AND content NOT LIKE '%用户认证模块%'
      AND EXISTS (SELECT 1 FROM provenance_nodes WHERE run_id = generation_runs.id)
    ORDER BY created_at ASC
    LIMIT 1
  `);

  // Fallback：放宽条件，找最老的有 provenance 数据的记录
  if (!run || !run.outline) {
    run = dbGet<{ outline: string | null; title: string }>(`
      SELECT outline, title
      FROM generation_runs
      WHERE title LIKE '%Nexora Tech%'
        AND status = 'done'
        AND EXISTS (SELECT 1 FROM provenance_nodes WHERE run_id = generation_runs.id)
      ORDER BY created_at ASC
      LIMIT 1
    `);
  }

  if (!run || !run.outline) {
    logger.warn("[StubDataReader] DB 中未找到 outline 数据");
    return null;
  }

  try {
    const raw = JSON.parse(run.outline);
    return raw.map(
      (item: { title: string; description?: string; children?: unknown[] }, i: number) => ({
        id: `s${i + 1}`,
        title: item.title,
        level: 1,
        children: item.children ?? [],
        description: item.description ?? "",
      })
    );
  } catch {
    logger.warn("[StubDataReader] outline JSON 解析失败");
    return null;
  }
}

// ── Word Add-in 专用 outline 读取 ────────────────────────

/**
 * 从 DB 读取 Word Add-in 专用 case（1782961869584）的大纲。
 * 数据存储在 sync_data 表 (store_name='cases', record_id='case-1782961869584')
 */
export function readWordOutlineFromDb(): Array<{
  id: string;
  title: string;
  level: number;
  children: unknown[];
  description: string;
}> | null {
  const caseRow = dbGet<{ data: string }>(
    "SELECT data FROM sync_data WHERE store_name = 'cases' AND record_id = 'case-1782961869584'",
  );

  if (!caseRow?.data) {
    logger.warn("[StubDataReader] Word case outline 未在 sync_data 表中找到");
    return null;
  }

  let caseData: { outline?: Array<{ title: string; description?: string; children?: unknown[] }> };
  try {
    caseData = JSON.parse(caseRow.data);
  } catch {
    logger.warn("[StubDataReader] Word case outline JSON 解析失败");
    return null;
  }

  if (!caseData.outline || caseData.outline.length === 0) {
    logger.warn("[StubDataReader] Word case outline 为空");
    return null;
  }

  logger.info(`[StubDataReader] Word case outline: ${caseData.outline.length} sections`);
  return caseData.outline.map(
    (item: { title: string; description?: string; children?: unknown[] }, i: number) => ({
      id: `s${i + 1}`,
      title: item.title,
      level: 1,
      children: item.children ?? [],
      description: item.description ?? "",
    })
  );
}

/**
 * 从 DB 查询来源树数据，JOIN kb_chunks 和 kb_sources 获取来源名称和 URL。
 */
export function readProvenanceFromDb(runId: string): ProvenanceNodeRow[] {
  try {
    const rows = dbAll<{
      paragraph_idx: number;
      paragraph_title: string | null;
      chunk_id: string | null;
      web_url: string | null;
      web_title: string | null;
      score: number;
      grounding_score: number | null;
      source_name: string | null;
      source_url: string | null;
    }>(
      `SELECT pn.paragraph_idx, pn.paragraph_title, pn.chunk_id, pn.web_url, pn.web_title,
              pn.score, pn.grounding_score,
              ks.name as source_name, ks.url as source_url
       FROM provenance_nodes pn
       LEFT JOIN kb_chunks kc ON pn.chunk_id = kc.id
       LEFT JOIN kb_sources ks ON kc.source_id = ks.id
       WHERE pn.run_id = ?
       ORDER BY pn.paragraph_idx, pn.score DESC`,
      [runId],
    );

    return rows.map((r) => ({
      paragraphIdx: r.paragraph_idx,
      paragraphTitle: r.paragraph_title ?? "",
      chunkId: r.chunk_id,
      webUrl: r.web_url,
      webTitle: r.web_title,
      sourceName: r.source_name,
      sourceUrl: r.source_url,
      score: r.score,
      groundingScore: r.grounding_score,
    }));
  } catch {
    logger.warn("[StubDataReader] provenance_nodes 查询失败（表可能不存在）");
    return [];
  }
}

// ── Word Add-in 专用：按 case ID 读取 case 1782961869584 ──

const WORD_CASE_ID = "case-1782961869584";

/**
 * 从 DB 读取 Word Add-in 专用 case 数据（case 1782961869584）。
 *
 * 数据存储路径：
 *   sync_data 表 (store_name='cases', record_id='case-1782961869584')
 *     → JSON 中 lastRunId 字段指向 generation_runs 表
 *     → generation_runs 表有 content(HTML)、outline、trust_score
 *     → provenance_nodes 表有来源树
 *     → trust_evaluations 表有评估指标
 */
export function readWordCaseFromDb(): StubCaseResult | null {
  // 1. 从 sync_data 表读取 case 元数据，获取 lastRunId
  const caseRow = dbGet<{ data: string }>(
    "SELECT data FROM sync_data WHERE store_name = 'cases' AND record_id = ?",
    [WORD_CASE_ID],
  );

  if (!caseRow?.data) {
    logger.warn(`[StubDataReader] Word case ${WORD_CASE_ID} 未在 sync_data 表中找到`);
    return null;
  }

  let caseData: { lastRunId?: string; title?: string; outline?: Array<{ title: string }>; trustScore?: number };
  try {
    caseData = JSON.parse(caseRow.data);
  } catch {
    logger.warn(`[StubDataReader] Word case ${WORD_CASE_ID} JSON 解析失败`);
    return null;
  }

  const runId = caseData.lastRunId;
  if (!runId) {
    logger.warn(`[StubDataReader] Word case ${WORD_CASE_ID} 无 lastRunId 字段`);
    return null;
  }

  logger.info(`[StubDataReader] Word case ${WORD_CASE_ID} → lastRunId=${runId}`);

  // 2. 从 generation_runs 表读取生成记录
  const run = dbGet<DbRun>(
    "SELECT id, title, content, outline, trust_score, document_style FROM generation_runs WHERE id = ? AND status = 'done'",
    [runId],
  );

  if (!run || !run.content) {
    logger.warn(`[StubDataReader] Word case generation_runs 记录 ${runId} 未找到或无内容`);
    return null;
  }

  logger.info(
    `[StubDataReader] Word case 从 DB 读取: runId=${run.id}, title=${run.title}, contentLen=${run.content.length}`
  );

  // 3. 解析 outline（优先用 generation_runs 的，fallback 到 sync_data 的）
  let outline: Array<{ title: string }> = [];
  if (run.outline) {
    try {
      outline = JSON.parse(run.outline);
    } catch {
      logger.warn("[StubDataReader] Word case outline JSON 解析失败，使用默认标题");
    }
  }
  if (outline.length === 0 && caseData.outline) {
    outline = caseData.outline;
  }

  // 4. 查询来源树
  const provenanceNodes = readProvenanceFromDb(run.id);
  logger.info(`[StubDataReader] Word case 查询到 ${provenanceNodes.length} 个来源树节点`);

  // 5. 从 HTML footer 解析参考来源列表
  const citations = buildCitationsFromHtml(run.content);
  logger.info(`[StubDataReader] Word case 解析到 ${citations.length} 个参考来源`);

  // 6. 解析 HTML 内容为 sections（传入 provenanceNodes 以计算真实 groundingScore）
  const sections = parseHtmlIntoSections(run.content, outline, provenanceNodes);

  if (sections.length === 0) {
    logger.warn("[StubDataReader] Word case HTML 解析后未得到任何 section");
    return null;
  }

  logger.info(
    `[StubDataReader] Word case 解析完成: ${sections.length} sections, ` +
      sections.map((s) => s.title).join(", ")
  );

  return {
    content: run.content,
    sections,
    trustScore: run.trust_score ?? caseData.trustScore ?? 0.5,
    documentStyle: run.document_style ?? "report",
    title: run.title,
    citations,
    provenanceNodes,
    sourceRunId: run.id,
  };
}

// ── Outlook Add-in 专用：按 case ID 读取 case 1782296242386 ──

const OUTLOOK_CASE_ID = "case-1782296242386";

/**
 * 从 DB 读取 Outlook Add-in 专用 case（case 1782296242386）的元数据。
 *
 * 数据存储路径：
 *   sync_data 表 (store_name='cases', record_id='case-1782296242386')
 *     → JSON 中 lastRunId 字段指向 generation_runs 表
 *     → generation_runs 表有 content(HTML)、outline、trust_score
 *     → provenance_nodes 表有来源树
 *     → trust_evaluations 表有评估指标
 */
export function readOutlookOutlineFromDb(): Array<{
  id: string;
  title: string;
  level: number;
  children: unknown[];
  description: string;
}> | null {
  const caseRow = dbGet<{ data: string }>(
    "SELECT data FROM sync_data WHERE store_name = 'cases' AND record_id = ?",
    [OUTLOOK_CASE_ID],
  );

  if (!caseRow?.data) {
    logger.warn(`[StubDataReader] Outlook case ${OUTLOOK_CASE_ID} 未在 sync_data 表中找到`);
    return null;
  }

  let caseData: { outline?: Array<{ title: string; description?: string; children?: unknown[] }> };
  try {
    caseData = JSON.parse(caseRow.data);
  } catch {
    logger.warn(`[StubDataReader] Outlook case outline JSON 解析失败`);
    return null;
  }

  if (!caseData.outline || caseData.outline.length === 0) {
    logger.warn(`[StubDataReader] Outlook case outline 为空`);
    return null;
  }

  logger.info(`[StubDataReader] Outlook case outline: ${caseData.outline.length} sections`);
  return caseData.outline.map(
    (item: { title: string; description?: string; children?: unknown[] }, i: number) => ({
      id: `s${i + 1}`,
      title: item.title,
      level: 1,
      children: item.children ?? [],
      description: item.description ?? "",
    }),
  );
}

/**
 * 从 DB 读取 Outlook Add-in 专用 case（case 1782296242386）数据。
 * 复用 readWordCaseFromDb 的实现，区别仅在 caseId 常量与 documentStyle 默认值。
 */
export function readOutlookCaseFromDb(): StubCaseResult | null {
  // 1. 从 sync_data 表读取 case 元数据
  const caseRow = dbGet<{ data: string }>(
    "SELECT data FROM sync_data WHERE store_name = 'cases' AND record_id = ?",
    [OUTLOOK_CASE_ID],
  );

  if (!caseRow?.data) {
    logger.warn(`[StubDataReader] Outlook case ${OUTLOOK_CASE_ID} 未在 sync_data 表中找到`);
    return null;
  }

  let caseData: { lastRunId?: string; title?: string; outline?: Array<{ title: string }>; trustScore?: number };
  try {
    caseData = JSON.parse(caseRow.data);
  } catch {
    logger.warn(`[StubDataReader] Outlook case ${OUTLOOK_CASE_ID} JSON 解析失败`);
    return null;
  }

  const runId = caseData.lastRunId;
  if (!runId) {
    logger.warn(`[StubDataReader] Outlook case ${OUTLOOK_CASE_ID} 无 lastRunId 字段`);
    return null;
  }

  logger.info(`[StubDataReader] Outlook case ${OUTLOOK_CASE_ID} → lastRunId=${runId}`);

  // 2. 从 generation_runs 表读取生成记录
  const run = dbGet<DbRun>(
    "SELECT id, title, content, outline, trust_score, document_style FROM generation_runs WHERE id = ? AND status = 'done'",
    [runId],
  );

  if (!run || !run.content) {
    logger.warn(`[StubDataReader] Outlook case generation_runs 记录 ${runId} 未找到或无内容`);
    return null;
  }

  logger.info(
    `[StubDataReader] Outlook case 从 DB 读取: runId=${run.id}, title=${run.title}, contentLen=${run.content.length}`,
  );

  // 3. 解析 outline（优先用 generation_runs 的，fallback 到 sync_data 的）
  let outline: Array<{ title: string }> = [];
  if (run.outline) {
    try {
      outline = JSON.parse(run.outline);
    } catch {
      logger.warn("[StubDataReader] Outlook case outline JSON 解析失败，使用默认标题");
    }
  }
  if (outline.length === 0 && caseData.outline) {
    outline = caseData.outline;
  }

  // 4. 查询来源树
  const provenanceNodes = readProvenanceFromDb(run.id);
  logger.info(`[StubDataReader] Outlook case 查询到 ${provenanceNodes.length} 个来源树节点`);

  // 5. 从 HTML footer 解析参考来源列表
  const citations = buildCitationsFromHtml(run.content);
  logger.info(`[StubDataReader] Outlook case 解析到 ${citations.length} 个参考来源`);

  // 6. 解析 HTML 内容为 sections（传入 provenanceNodes 以计算真实 groundingScore）
  const sections = parseHtmlIntoSections(run.content, outline, provenanceNodes);

  if (sections.length === 0) {
    logger.warn("[StubDataReader] Outlook case HTML 解析后未得到任何 section");
    return null;
  }

  logger.info(
    `[StubDataReader] Outlook case 解析完成: ${sections.length} sections, ` +
      sections.map((s) => s.title).join(", "),
  );

  return {
    content: run.content,
    sections,
    trustScore: run.trust_score ?? caseData.trustScore ?? 0.5,
    documentStyle: run.document_style ?? "email",
    title: run.title,
    citations,
    provenanceNodes,
    sourceRunId: run.id,
  };
}

// ── 内部：从 HTML footer 解析参考来源列表 ──────────────────

/**
 * 从 HTML content 的 <footer class="citations"> 区域解析参考来源列表。
 *
 * HTML footer 结构：
 *   <footer class="citations">
 *     <h3>参考来源</h3>
 *     <div class="citation-list">
 *       <div class="citation-item">
 *         <span class="citation-num">[1]</span>
 *         <a href="https://..." class="cite-kb-link">标题文本</a>
 *       </div>
 *       ...
 *     </div>
 *   </footer>
 */
function buildCitationsFromHtml(html: string): CitationItem[] {
  const citations: CitationItem[] = [];

  // 提取 <footer class="citations"> 区域
  const footerMatch = /<footer[^>]*class="citations"[^>]*>([\s\S]*?)<\/footer>/i.exec(html);
  if (!footerMatch) {
    logger.warn("[StubDataReader] HTML 中未找到 <footer class=\"citations\">，尝试 fallback");
    return buildCitationsFromProvenanceFallback(html);
  }

  const footerHtml = footerMatch[1];

  // 匹配每个 citation-item：<div class="citation-item"><span class="citation-num">[N]</span> <a href="...">title</a></div>
  const itemRegex = /<div[^>]*class="citation-item"[^>]*>([\s\S]*?)<\/div>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(footerHtml)) !== null) {
    const itemHtml = itemMatch[1];

    // 提取编号 [N]
    const numMatch = /<span[^>]*class="citation-num"[^>]*>\s*\[(\d+)\]\s*<\/span>/i.exec(itemHtml);
    const index = numMatch ? parseInt(numMatch[1], 10) : citations.length + 1;

    // 提取链接（匹配所有 <a> 标签，不仅限于 cite-kb-link）
    const linkMatch = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(itemHtml);
    if (linkMatch) {
      const url = linkMatch[1];
      const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
      citations.push({ index, title, url });
    } else {
      // 没有链接的纯文本引用
      const text = itemHtml.replace(/<[^>]+>/g, "").replace(/\[\d+\]/g, "").trim();
      if (text) {
        citations.push({ index, title: text, url: "" });
      }
    }
  }

  if (citations.length === 0) {
    logger.warn("[StubDataReader] footer 中未找到 citation items，尝试 fallback");
    return buildCitationsFromProvenanceFallback(html);
  }

  // 按 index 排序
  citations.sort((a, b) => a.index - b.index);

  logger.info(`[StubDataReader] 从 HTML footer 解析到 ${citations.length} 个 citations: [${citations.map(c => c.index).join(",")}]`);
  return citations;
}

/**
 * Fallback：当 HTML footer 解析失败时，尝试从 provenance_nodes 的 webTitle 构建 citations。
 */
function buildCitationsFromProvenanceFallback(_html: string): CitationItem[] {
  // 注意：此 fallback 仅在极端情况下使用
  // 正常情况下 buildCitationsFromHtml 应该成功
  return [];
}

// ── 内部：解析 HTML 为 sections ──────────────────────────

/**
 * 将 toHtml 生成的 HTML 内容解析为 sections 数组。
 *
 * HTML 结构：
 *   <div class="doc-content">
 *     <style>...</style>
 *     <h1>文档标题</h1>
 *     <section>
 *       <h2>Sheet 1 - ...</h2>
 *       <script chart-spec>...</script>
 *       ...段落和表格...
 *     </section>
 *     <section>
 *       <h2>Sheet 2 - ...</h2>
 *       <script chart-spec>...</script>
 *       ...段落和表格...
 *     </section>
 *     ...
 *   </div>
 *
 * 按 <section> 标签分割，每个 section 独立，内容不重叠。
 */
function parseHtmlIntoSections(
  html: string,
  outline: Array<{ title: string }>,
  provenanceNodes?: ProvenanceNodeRow[]
): GenerateDocResult["sections"] {
  // 0. 按 paragraphIdx 分组 provenance nodes，用于计算每段 grounding score 和来源
  const nodesByParaIdx = new Map<number, ProvenanceNodeRow[]>();
  if (provenanceNodes && provenanceNodes.length > 0) {
    for (const node of provenanceNodes) {
      const idx = node.paragraphIdx;
      if (!nodesByParaIdx.has(idx)) nodesByParaIdx.set(idx, []);
      nodesByParaIdx.get(idx)!.push(node);
    }
  }

  /** 计算某段落的 groundingScore（取 provenance nodes 的 groundingScore 平均值，无数据时用 0.5） */
  const computeGroundingScore = (paraIdx: number): number => {
    const nodes = nodesByParaIdx.get(paraIdx);
    if (!nodes || nodes.length === 0) return 0.5;
    const scores = nodes.map(n => n.groundingScore ?? n.score ?? 0.5).filter(s => typeof s === "number" && s >= 0 && s <= 1);
    if (scores.length === 0) return 0.5;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };

  /** 计算全局平均 groundingScore（所有段落的加权平均，用于单段落 fallback） */
  const computeGlobalGroundingScore = (): number => {
    if (!provenanceNodes || provenanceNodes.length === 0) return 0.5;
    const scores = provenanceNodes.map(n => n.groundingScore ?? n.score ?? 0.5).filter(s => typeof s === "number" && s >= 0 && s <= 1);
    if (scores.length === 0) return 0.5;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };

  /** 从 provenance nodes 构建某段落的 sources */
  const buildSources = (paraIdx: number): GenerateDocResult["sections"][0]["sources"] => {
    const nodes = nodesByParaIdx.get(paraIdx);
    if (!nodes || nodes.length === 0) return [];
    const seenChunk = new Set<string>();
    const sources: GenerateDocResult["sections"][0]["sources"] = [];
    for (const node of nodes) {
      const key = node.chunkId || node.webUrl || `${node.sourceName}-${node.sourceUrl}`;
      if (!key || seenChunk.has(key)) continue;
      seenChunk.add(key);
      sources.push({
        chunkId: node.chunkId || `web-${node.webUrl || Math.random().toString(36).slice(2)}`,
        content: node.webTitle || node.sourceName || "",
        score: node.score,
        sourceId: node.chunkId || "",
        sourceName: node.sourceName || node.webTitle || "未知来源",
        sourceUrl: node.sourceUrl || node.webUrl || undefined,
      });
    }
    return sources;
  };

  /** 从 provenance nodes 构建某段落的 webCitations */
  const buildWebCitations = (paraIdx: number): GenerateDocResult["sections"][0]["webCitations"] => {
    const nodes = nodesByParaIdx.get(paraIdx);
    if (!nodes || nodes.length === 0) return [];
    const seenUrl = new Set<string>();
    const citations: GenerateDocResult["sections"][0]["webCitations"] = [];
    for (const node of nodes) {
      if (node.webUrl && !seenUrl.has(node.webUrl)) {
        seenUrl.add(node.webUrl);
        citations.push({
          title: node.webTitle || node.webUrl,
          url: node.webUrl,
          snippet: "",
          score: node.score,
        });
      }
    }
    return citations;
  };

  /** 构建所有段落的 sources（用于单段落 fallback） */
  const buildAllSources = (): GenerateDocResult["sections"][0]["sources"] => {
    if (!provenanceNodes || provenanceNodes.length === 0) return [];
    const seenChunk = new Set<string>();
    const sources: GenerateDocResult["sections"][0]["sources"] = [];
    for (const node of provenanceNodes) {
      const key = node.chunkId || node.webUrl || `${node.sourceName}-${node.sourceUrl}`;
      if (!key || seenChunk.has(key)) continue;
      seenChunk.add(key);
      sources.push({
        chunkId: node.chunkId || `web-${node.webUrl || Math.random().toString(36).slice(2)}`,
        content: node.webTitle || node.sourceName || "",
        score: node.score,
        sourceId: node.chunkId || "",
        sourceName: node.sourceName || node.webTitle || "未知来源",
        sourceUrl: node.sourceUrl || node.webUrl || undefined,
      });
    }
    return sources;
  };

  /** 构建所有段落的 webCitations（用于单段落 fallback） */
  const buildAllWebCitations = (): GenerateDocResult["sections"][0]["webCitations"] => {
    if (!provenanceNodes || provenanceNodes.length === 0) return [];
    const seenUrl = new Set<string>();
    const citations: GenerateDocResult["sections"][0]["webCitations"] = [];
    for (const node of provenanceNodes) {
      if (node.webUrl && !seenUrl.has(node.webUrl)) {
        seenUrl.add(node.webUrl);
        citations.push({
          title: node.webTitle || node.webUrl,
          url: node.webUrl,
          snippet: "",
          score: node.score,
        });
      }
    }
    return citations;
  };

  // 1. 去除外层包裹和无关元素
  let content = html
    .replace(/<div class="doc-content">\s*/i, "")
    .replace(/\s*<\/div>\s*$/i, "")
    .replace(/<style>[\s\S]*?<\/style>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .trim();

  // 2. 按 <section> 标签分割
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  const sectionMatches: Array<{ content: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    sectionMatches.push({ content: match[1].trim() });
  }

  // 3. 如果没有 <section> 标签，fallback 到 chart-spec 分割
  if (sectionMatches.length === 0) {
    logger.warn("[StubDataReader] 内容中未找到 <section> 标签，尝试 chart-spec 分割");

    const chartSpecRegex = /<script[^>]*chart-spec[^>]*>([\s\S]*?)<\/script>/gi;
    const chartSpecs: Array<{ start: number; end: number; raw: string; fullTag: string }> = [];
    let csMatch: RegExpExecArray | null;
    while ((csMatch = chartSpecRegex.exec(content)) !== null) {
      chartSpecs.push({
        start: csMatch.index,
        end: chartSpecRegex.lastIndex,
        raw: csMatch[1].trim(),
        fullTag: csMatch[0],
      });
    }

    if (chartSpecs.length === 0) {
      // 没有 <section> 也没有 chart-spec：如果有 provenance nodes 且有多段落，按 <p> 标签分割
      // 用于邮件等无 section 标签的文档类型
      const paraIndices = provenanceNodes
        ? Array.from(new Set(provenanceNodes.map(n => n.paragraphIdx))).sort((a, b) => a - b)
        : [];

      if (provenanceNodes && paraIndices.length > 1) {
        logger.info(`[StubDataReader] 无 section 标签，按 <p> 分割为 ${paraIndices.length} 个段落（provenance paraIdx=${paraIndices.join(',')}）`);
        // 按 <p>...</p> 分割内容
        const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        const paragraphs: string[] = [];
        let pMatch: RegExpExecArray | null;
        while ((pMatch = pRegex.exec(content)) !== null) {
          const pContent = pMatch[1].trim();
          if (pContent && pContent.length > 5) {
            paragraphs.push(`<p>${pContent}</p>`);
          }
        }

        if (paragraphs.length >= paraIndices.length) {
          const sections: GenerateDocResult["sections"] = [];
          for (let i = 0; i < paraIndices.length; i++) {
            const paraIdx = paraIndices[i];
            const title = outline[i]?.title ?? `段落 ${i + 1}`;
            // 将属于该段落的 <p> 分配给该 section（按比例分配）
            const startP = Math.floor((i * paragraphs.length) / paraIndices.length);
            const endP = Math.floor(((i + 1) * paragraphs.length) / paraIndices.length);
            const sectionContent = paragraphs.slice(startP, endP).join('\n');
            sections.push({
              title,
              content: sectionContent || `<p>（段落内容）</p>`,
              sources: buildSources(paraIdx),
              webCitations: buildWebCitations(paraIdx),
              groundingScore: computeGroundingScore(paraIdx),
              citationLinks: [],
            });
          }
          return sections;
        }

        // 如果 <p> 数量不够，按 provenance paraIdx 分组（每段一个 section，内容为整个 content 但带正确标题）
        const sections: GenerateDocResult["sections"] = [];
        for (let i = 0; i < paraIndices.length; i++) {
          const paraIdx = paraIndices[i];
          const title = outline[i]?.title ?? `段落 ${i + 1}`;
          sections.push({
            title,
            content: i === 0 ? content : `<p>（${title}）</p>`,
            sources: buildSources(paraIdx),
            webCitations: buildWebCitations(paraIdx),
            groundingScore: computeGroundingScore(paraIdx),
            citationLinks: [],
          });
        }
        return sections;
      }

      logger.warn("[StubDataReader] 内容中未找到 section/chart-spec 标签且无多段落 provenance，返回单个 section（使用全局 grounding score）");
      return [
        {
          title: outline[0]?.title ?? "邮件正文",
          content,
          sources: buildAllSources(),
          webCitations: buildAllWebCitations(),
          groundingScore: computeGlobalGroundingScore(),
          citationLinks: [],
        },
      ];
    }

    const sections: GenerateDocResult["sections"] = [];
    for (let i = 0; i < chartSpecs.length; i++) {
      const start = i === 0 ? 0 : chartSpecs[i].start;
      const end = i < chartSpecs.length - 1 ? chartSpecs[i + 1].start : content.length;
      const chartSpecsRaw = extractChartSpecsRaw(chartSpecs[i].raw);
      let sectionContent = content.substring(start, end);
      sectionContent = sectionContent.replace(chartSpecs[i].fullTag, "").trim();
      const title = outline[i]?.title ?? `Sheet ${i + 1}`;
      sections.push({
        title,
        content: sectionContent,
        sources: buildSources(i),
        webCitations: buildWebCitations(i),
        groundingScore: computeGroundingScore(i),
        citationLinks: [],
        chartSpecsRaw: chartSpecsRaw.length > 0 ? chartSpecsRaw : undefined,
      });
    }
    return sections;
  }

  // 4. 按 <section> 分割成功
  const sections: GenerateDocResult["sections"] = [];

  for (let i = 0; i < sectionMatches.length; i++) {
    const sectionHtml = sectionMatches[i].content;
    const title = outline[i]?.title ?? `Sheet ${i + 1}`;

    // 提取 chartSpecsRaw
    const chartSpecRegex = /<script[^>]*chart-spec[^>]*>([\s\S]*?)<\/script>/gi;
    let csMatch: RegExpExecArray | null;
    const chartSpecsRaw: string[] = [];
    while ((csMatch = chartSpecRegex.exec(sectionHtml)) !== null) {
      chartSpecsRaw.push(...extractChartSpecsRaw(csMatch[1].trim()));
    }

    // 移除 chart-spec 标签（chartSpecsRaw 已单独提取）
    let cleanContent = sectionHtml.replace(chartSpecRegex, "").trim();

    // 移除开头的 <h2> 标签（title 已单独设置，content 中包含会重复）
    cleanContent = cleanContent.replace(/^<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>\s*/i, "").trim();

    sections.push({
      title,
      content: cleanContent,
      sources: buildSources(i),
      webCitations: buildWebCitations(i),
      groundingScore: computeGroundingScore(i),
      citationLinks: [],
      chartSpecsRaw: chartSpecsRaw.length > 0 ? chartSpecsRaw : undefined,
    });
  }

  return sections;
}

/**
 * 从 chart-spec script 标签内容提取 chartSpecsRaw 数组。
 *
 * 处理两种格式：
 * 1. 双重编码（DB 真实格式）：
 *    ["[{\"type\":\"column\",...}]", "[{\"type\":\"pie\",...}]"]
 *    → 每个元素是 JSON 字符串，直接作为 chartSpecsRaw
 *
 * 2. 单层编码（fixture 格式）：
 *    {"type":"bar","title":"...","series":[{"name":"...","values":[...]}]}
 *    → 原样作为 chartSpecsRaw 的唯一元素
 */
function extractChartSpecsRaw(scriptContent: string): string[] {
  if (!scriptContent) return [];

  try {
    const parsed: unknown = JSON.parse(scriptContent);

    if (Array.isArray(parsed)) {
      // 检查是否是双重编码（数组元素全为字符串）
      if (parsed.every((item) => typeof item === "string")) {
        // 双重编码：["[{...}]", "[{...}]"] → 直接返回
        return parsed as string[];
      }
      // 单层数组：[{...}, {...}] → 逐个 stringify
      return parsed.map((item) => JSON.stringify(item));
    }

    if (typeof parsed === "object" && parsed !== null) {
      // 单对象：{"type":"bar",...} → 原样返回
      return [scriptContent];
    }
  } catch {
    // JSON 解析失败，原样返回
    logger.warn("[StubDataReader] chart-spec JSON 解析失败，原样保留");
    return [scriptContent];
  }

  return [];
}
