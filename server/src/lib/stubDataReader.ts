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

  // 解析 HTML 内容为 sections
  const sections = parseHtmlIntoSections(run.content, outline);

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

  // 匹配每个 <a> 标签（citation 链接）
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*class="cite-[^"]*-link"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let index = 1;

  while ((match = linkRegex.exec(footerHtml)) !== null) {
    const url = match[1];
    const title = match[2].trim();
    citations.push({ index: index++, title, url });
  }

  if (citations.length === 0) {
    logger.warn("[StubDataReader] footer 中未找到 citation links，尝试 fallback");
    return buildCitationsFromProvenanceFallback(html);
  }

  logger.info(`[StubDataReader] 从 HTML footer 解析到 ${citations.length} 个 citations`);
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
  outline: Array<{ title: string }>
): GenerateDocResult["sections"] {
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
      logger.warn("[StubDataReader] 内容中未找到 chart-spec 标签，返回单个 section");
      return [
        {
          title: outline[0]?.title ?? "Sheet 1",
          content,
          sources: [],
          webCitations: [],
          groundingScore: 0.5,
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
        sources: [],
        webCitations: [],
        groundingScore: 0.5,
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
      sources: [],
      webCitations: [],
      groundingScore: 0.5,
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
