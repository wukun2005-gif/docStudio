/**
 * Excel Payload Builder — 将 GenerateDocResult 转换为 ExcelWritePayload 格式
 *
 * 供 Excel Add-in 使用：每个 outline section 生成一个 Sheet，
 * 从 HTML content 中提取段落、表格、图表规格。
 */
import type { GenerateDocResult } from "./docGenerator.js";
import type { ChartSpec } from "./docExporter.js";
import { extractChartSpecFromText } from "./chartSpecParser.js";
import { logger } from "./logger.js";
import type { CitationItem, ProvenanceNodeRow } from "./stubDataReader.js";

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface ExcelWritePayload {
  sheets: Array<{
    name: string;
    paragraphs: Array<{
      text: string;
      style: "heading1" | "heading2" | "body" | "bullet" | "citation";
      sourceChunkId?: string;
      sourceName?: string;
      groundingScore?: number;
    }>;
    tables?: Array<{
      title?: string;
      headers: string[];
      rows: string[][];
      startRow?: number;
    }>;
    charts?: Array<{
      type: "bar" | "column" | "pie" | "line" | "doughnut" | "scatter";
      title: string;
      categories: string[];
      series: Array<{ name: string; values: number[] }>;
      afterRow?: number;
    }>;
    conditionalFormats?: Array<{
      range: string;
      type: "colorScale" | "dataBar";
    }>;
    citations?: Array<{ index: number; title: string; url: string }>;
  }>;
}

/** toExcelPayload 的额外参数 */
export interface ExcelPayloadExtra {
  citations?: CitationItem[];
  provenanceNodes?: ProvenanceNodeRow[];
}

// ═══════════════════════════════════════════════════════════
// HTML 解析工具
// ═══════════════════════════════════════════════════════════

/** 段落样式 */
type ParagraphStyle = "heading1" | "heading2" | "body" | "bullet" | "citation";

/**
 * 从 HTML 内容中提取段落列表。
 * 策略：
 * - <h1> → heading1
 * - <h2>/<h3> → heading2
 * - <li> → bullet
 * - <blockquote> → citation
 * - <p> 及其他 → body
 */
function parseHtmlToParagraphs(html: string): Array<{ text: string; style: ParagraphStyle }> {
  if (!html) return [];

  const paragraphs: Array<{ text: string; style: ParagraphStyle }> = [];

  // 匹配块级元素：h1-h6, p, li, blockquote, 以及裸文本行
  // 先按 < 和 > 分割，再逐个匹配
  const blockRegex = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  // 提取所有块级元素
  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const rawText = stripHtmlTags(match[2]).trim();
    if (!rawText) continue;

    let style: ParagraphStyle = "body";
    if (tag === "h1") {
      style = "heading1";
    } else if (tag === "h2" || tag === "h3") {
      style = "heading2";
    } else if (tag === "li") {
      style = "bullet";
    } else if (tag === "blockquote") {
      style = "citation";
    }

    paragraphs.push({ text: rawText, style });
  }

  // 如果没有匹配到任何块级元素，尝试按 <br> 或换行分割
  if (paragraphs.length === 0) {
    // 移除所有 HTML 标签，然后按换行分割
    const stripped = stripHtmlTags(html);
    const lines = stripped.split(/\n+/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      paragraphs.push({ text: line, style: "body" });
    }
  }

  return paragraphs;
}

/**
 * 从 HTML 内容中提取表格数据。
 * 解析 <table> 元素，提取 headers 和 rows。
 */
function parseHtmlTables(html: string): Array<{ title?: string; headers: string[]; rows: string[][] }> {
  if (!html) return [];

  const tables: Array<{ title?: string; headers: string[]; rows: string[][] }> = [];

  // 匹配 <table>...</table> 块
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableInner = tableMatch[1];

    // 尝试提取表格标题（<caption> 标签）
    const captionMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tableInner);
    const title = captionMatch ? stripHtmlTags(captionMatch[1]).trim() : undefined;

    // 提取表头：优先 <th>，若没有则取第一行 <tr> 的 <td>
    const headers: string[] = [];
    const rows: string[][] = [];

    // 匹配所有 <tr>
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    let isFirstRow = true;

    while ((trMatch = trRegex.exec(tableInner)) !== null) {
      const trInner = trMatch[1];
      const cells: string[] = [];

      // 匹配 <th> 或 <td>
      const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(trInner)) !== null) {
        cells.push(stripHtmlTags(cellMatch[2]).trim());
      }

      if (cells.length === 0) continue;

      if (isFirstRow && /<th/i.test(trInner)) {
        // 表头行
        headers.push(...cells);
        isFirstRow = false;
      } else {
        if (isFirstRow && headers.length === 0) {
          // 没有 <th>，用第一行 <td> 作为表头
          headers.push(...cells);
          isFirstRow = false;
        } else {
          rows.push(cells);
        }
      }
    }

    if (headers.length > 0) {
      tables.push({ title, headers, rows });
    }
  }

  return tables;
}

/**
 * 从 section 的 chartSpecsRaw 和 HTML content 中提取图表规格。
 *
 * 三级提取策略：
 * 1. Primary: chartSpecsRaw（LLM 预提取的 JSON 字符串数组）
 * 2. Fallback 1: HTML <script chart-spec> 标签（兼容 type/class 两种属性顺序）
 * 3. Fallback 2: ```chart 代码块
 *
 * 所有路径都经过 normalizeChartSpecItems 处理双重编码，并用 isValidChartSpec 严格校验。
 */
function parseChartSpecs(content: string, chartSpecsRaw?: string[]): ExcelWritePayload["sheets"][number]["charts"] {
  const charts: ExcelWritePayload["sheets"][number]["charts"] = [];

  // 优先从 chartSpecsRaw 解析（LLM 预提取的 JSON）
  if (chartSpecsRaw && chartSpecsRaw.length > 0) {
    for (const raw of chartSpecsRaw) {
      try {
        const parsed = JSON.parse(raw);
        const items = normalizeChartSpecItems(parsed);
        for (const item of items) {
          charts.push({
            type: item.type,
            title: item.title,
            categories: item.categories,
            series: item.series,
          });
        }
      } catch {
        logger.warn(`[ExcelPayloadBuilder] chartSpecsRaw JSON 解析失败，尝试文本提取`);
      }
    }
  }

  // Fallback 1: 从 HTML content 中的 <script chart-spec> 标签提取
  // 兼容两种属性顺序：<script class="chart-spec" type="application/json"> 和 <script type="application/json" class="chart-spec">
  if (charts.length === 0) {
    const scriptRegex = /<script[^>]*chart-spec[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const items = normalizeChartSpecItems(parsed);
        for (const item of items) {
          charts.push({
            type: item.type,
            title: item.title,
            categories: item.categories,
            series: item.series,
          });
        }
      } catch {
        logger.warn(`[ExcelPayloadBuilder] <script chart-spec> JSON 解析失败`);
      }
    }
  }

  // Fallback 2: 从 ```chart 代码块提取
  if (charts.length === 0) {
    const fromText = extractChartSpecFromText(content);
    for (const spec of fromText) {
      charts.push({
        type: spec.type,
        title: spec.title,
        categories: spec.categories,
        series: spec.series,
      });
    }
  }

  return charts.length > 0 ? charts : undefined;
}

/**
 * 将解析后的 JSON 规范化为 ChartSpec 数组，处理双重编码。
 *
 * 双重编码格式（DB 真实数据）：
 *   ["[{\"type\":\"column\",...}]", "[{\"type\":\"pie\",...}]"]
 *   → 每个字符串元素需再次 JSON.parse 得到 chart spec 对象
 *
 * 单层格式：
 *   {"type":"bar",...} 或 [{"type":"bar",...}]
 *   → 直接使用
 */
function normalizeChartSpecItems(parsed: unknown): ChartSpec[] {
  const raw: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const items: unknown[] = [];

  for (const item of raw) {
    if (typeof item === "string") {
      // 双重编码：字符串内含 JSON 数组或对象
      try {
        const inner = JSON.parse(item);
        if (Array.isArray(inner)) {
          items.push(...inner);
        } else {
          items.push(inner);
        }
      } catch {
        // 字符串不是 JSON，跳过
      }
    } else {
      items.push(item);
    }
  }

  return items.filter(isValidChartSpec) as ChartSpec[];
}

/**
 * 严格校验 ChartSpec 对象。
 * 检查 series 每个元素是否有 name（string）和 values（number[]），
 * 防止 writeCharts 因 s.values 为 undefined 而崩溃。
 */
function isValidChartSpec(obj: unknown): obj is ChartSpec {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const validTypes = new Set(["bar", "pie", "line", "column", "doughnut", "scatter"]);
  if (typeof o.type !== "string" || !validTypes.has(o.type)) return false;
  if (typeof o.title !== "string" || !o.title.trim()) return false;
  if (!Array.isArray(o.categories) || o.categories.length === 0) return false;
  if (!Array.isArray(o.series) || o.series.length === 0) return false;
  for (const s of o.series) {
    if (!s || typeof s !== "object") return false;
    const ser = s as Record<string, unknown>;
    if (typeof ser.name !== "string") return false;
    if (!Array.isArray(ser.values) || ser.values.length === 0) return false;
    if (!ser.values.every((v: unknown) => typeof v === "number")) return false;
  }
  return true;
}

/** 移除所有 HTML 标签，返回纯文本 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

/**
 * 生成合法的 Sheet 名称（Excel 限制：最长 31 字符，不含 \ / ? * [ ] :）
 */
function sanitizeSheetName(name: string, index: number): string {
  let sanitized = name
    .replace(/[\\\/\?\*\[\]:]/g, "_")
    .trim()
    .slice(0, 31);

  if (!sanitized) {
    sanitized = `Sheet${index + 1}`;
  }

  return sanitized;
}

// ═══════════════════════════════════════════════════════════
// 核心导出函数
// ═══════════════════════════════════════════════════════════

/**
 * 将 GenerateDocResult 转换为 ExcelWritePayload。
 *
 * 每个 section 生成一个 Sheet，包含：
 * - 标题行（heading1）
 * - 段落内容（从 HTML 解析）
 * - 表格数据（从 <table> 提取）
 * - 图表规格（从 chartSpecsRaw 或 ```chart 代码块提取）
 * - 参考来源列表（从 extra.citations 添加到每个 sheet 底部）
 *
 * 如果 extra.provenanceNodes 存在，额外生成一个"来源树" Sheet。
 */
export function toExcelPayload(
  result: GenerateDocResult,
  extra?: ExcelPayloadExtra,
): ExcelWritePayload {
  logger.info(`[ExcelPayloadBuilder] 开始转换: ${result.sections.length} 个 section → Excel payload, citations=${extra?.citations?.length || 0}, provenanceNodes=${extra?.provenanceNodes?.length || 0}`);

  const sheets: ExcelWritePayload["sheets"] = [];

  for (let i = 0; i < result.sections.length; i++) {
    const section = result.sections[i];
    const sheetName = sanitizeSheetName(section.title, i);

    // 1. 解析段落
    const rawParagraphs = parseHtmlToParagraphs(section.content);
    const paragraphs: ExcelWritePayload["sheets"][number]["paragraphs"] = [];

    // 添加 section 标题作为第一行（heading1）
    paragraphs.push({
      text: section.title,
      style: "heading1",
      groundingScore: section.groundingScore,
    });

    // 添加解析出的段落
    for (const para of rawParagraphs) {
      paragraphs.push({
        text: para.text,
        style: para.style,
      });
    }

    // 2. 解析表格
    const tables = parseHtmlTables(section.content);

    // 3. 解析图表
    const charts = parseChartSpecs(section.content, section.chartSpecsRaw);

    // 构建 Sheet
    const sheet: ExcelWritePayload["sheets"][number] = {
      name: sheetName,
      paragraphs,
    };

    if (tables && tables.length > 0) {
      sheet.tables = tables.map((t, tIdx) => ({
        title: t.title,
        headers: t.headers,
        rows: t.rows,
        startRow: 1 + paragraphs.length + tIdx,
      }));
    }

    if (charts) {
      sheet.charts = charts.map((c, cIdx) => ({
        type: c.type,
        title: c.title,
        categories: c.categories,
        series: c.series,
        afterRow: 1 + paragraphs.length + (tables?.length || 0) + cIdx,
      }));
    }

    // 参考来源不添加到每个 sheet，而是统一放到单独的"参考来源" sheet
    sheets.push(sheet);
  }

  // 添加"参考来源" sheet（单独一个 sheet，参考 web app 设计）
  // 注意：不写 paragraphs 标题行，writeCitationsAt 会负责写标题和表头
  if (extra?.citations && extra.citations.length > 0) {
    sheets.push({
      name: "参考来源",
      paragraphs: [],
      citations: extra.citations,
    });
  }

  logger.info(`[ExcelPayloadBuilder] 转换完成: ${sheets.length} 个 sheets, 共 ${sheets.reduce((sum, s) => sum + s.paragraphs.length, 0)} 个段落`);
  return { sheets };
}

/**
 * 构建来源树 Sheet，展示每个段落的来源追溯信息。
 */
function buildSourceTreeSheet(nodes: ProvenanceNodeRow[]): ExcelWritePayload["sheets"][number] {
  // 按 paragraphIdx 分组
  const grouped = new Map<number, ProvenanceNodeRow[]>();
  for (const node of nodes) {
    const group = grouped.get(node.paragraphIdx) ?? [];
    group.push(node);
    grouped.set(node.paragraphIdx, group);
  }

  const paragraphs: ExcelWritePayload["sheets"][number]["paragraphs"] = [
    { text: "来源树", style: "heading1" },
    { text: "以下为各段落的来源追溯信息，按段落和相关性分数排序。", style: "body" },
  ];

  const tableRows: string[][] = [];
  for (const [paraIdx, group] of grouped) {
    const paraTitle = group[0]?.paragraphTitle || `段落 ${paraIdx + 1}`;
    const groundingScore = group[0]?.groundingScore;

    for (const node of group) {
      const sourceName = node.sourceName || node.webTitle || node.chunkId || "(未知来源)";
      const sourceType = node.sourceName ? "知识库" : (node.webUrl ? "Web" : "未知");
      const sourceUrl = node.sourceUrl || node.webUrl || node.chunkId || "";

      tableRows.push([
        paraTitle,
        sourceName,
        sourceType,
        node.score.toFixed(4),
        groundingScore != null ? groundingScore.toFixed(4) : "N/A",
        sourceUrl,
      ]);
    }
  }

  const tables: ExcelWritePayload["sheets"][number]["tables"] = [{
    title: "段落来源追溯",
    headers: ["段落", "来源", "类型", "相关性分数", "Grounding Score", "链接/ChunkID"],
    rows: tableRows,
  }];

  return {
    name: "来源树",
    paragraphs,
    tables,
  };
}
