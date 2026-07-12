/**
 * Word Payload Builder — 将 GenerateDocResult 转换为 WordWritePayload 格式
 *
 * 供 Word Add-in 使用：每个 section 生成一个章节（连续文档流），
 * 从 HTML content 中提取段落和表格。
 * Word 不支持原生图表 API，因此图表被跳过。
 */
import type { GenerateDocResult } from "./docGenerator.js";
import { logger } from "./logger.js";
import type { CitationItem, ProvenanceNodeRow } from "./stubDataReader.js";

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface WordWritePayload {
  sections: Array<{
    title: string;
    paragraphs: Array<{
      text: string;
      style: 'heading1' | 'heading2' | 'body' | 'bullet' | 'citation';
      sourceChunkId?: string;
      sourceName?: string;
      groundingScore?: number;
    }>;
    tables?: Array<{
      title?: string;
      headers: string[];
      rows: string[][];
    }>;
    citations?: Array<{ index: number; title: string; url: string }>;
  }>;
}

/** toWordPayload 的额外参数 */
export interface WordPayloadExtra {
  citations?: CitationItem[];
  provenanceNodes?: ProvenanceNodeRow[];
}

// ═══════════════════════════════════════════════════════════
// HTML 解析工具（复用 excelPayloadBuilder 的逻辑）
// ═══════════════════════════════════════════════════════════

/** 段落样式 */
type ParagraphStyle = "heading1" | "heading2" | "body" | "bullet" | "citation";

/**
 * 从 HTML 内容中提取段落列表。
 */
function parseHtmlToParagraphs(html: string): Array<{ text: string; style: ParagraphStyle }> {
  if (!html) return [];

  const paragraphs: Array<{ text: string; style: ParagraphStyle }> = [];

  const blockRegex = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

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
 */
function parseHtmlTables(html: string): Array<{ title?: string; headers: string[]; rows: string[][] }> {
  if (!html) return [];

  const tables: Array<{ title?: string; headers: string[]; rows: string[][] }> = [];

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableInner = tableMatch[1];

    const captionMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tableInner);
    const title = captionMatch ? stripHtmlTags(captionMatch[1]).trim() : undefined;

    const headers: string[] = [];
    const rows: string[][] = [];

    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    let isFirstRow = true;

    while ((trMatch = trRegex.exec(tableInner)) !== null) {
      const trInner = trMatch[1];
      const cells: string[] = [];

      const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(trInner)) !== null) {
        cells.push(stripHtmlTags(cellMatch[2]).trim());
      }

      if (cells.length === 0) continue;

      if (isFirstRow && /<th/i.test(trInner)) {
        headers.push(...cells);
        isFirstRow = false;
      } else {
        if (isFirstRow && headers.length === 0) {
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
 * 从伪表格行（连续的 body 段落，用多空格/制表符分隔列）提取表格数据。
 * 第一行作为表头。
 */
function extractPseudoTable(rows: string[]): { headers: string[]; rows: string[][] } {
  const TABLE_COL_SEP = /\s{2,}|\t/;
  const headers = rows[0].split(TABLE_COL_SEP).map(s => s.trim()).filter(Boolean);
  const dataRows: string[][] = [];
  for (let i = 1; i < rows.length; i++) {
    dataRows.push(rows[i].split(TABLE_COL_SEP).map(s => s.trim()).filter(Boolean));
  }
  return { headers, rows: dataRows };
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

// ═══════════════════════════════════════════════════════════
// 核心导出函数
// ═══════════════════════════════════════════════════════════

/**
 * 将 GenerateDocResult 转换为 WordWritePayload。
 *
 * 与 Excel 版本的区别：
 * - 所有 section 合并为连续文档流（不是每个 section 一个 Sheet）
 * - 不包含图表（Word JS API 无原生图表支持）
 * - 参考来源附加在第一个 section 的 citations 字段中
 */
export function toWordPayload(
  result: GenerateDocResult,
  extra?: WordPayloadExtra,
): WordWritePayload {
  logger.info(`[WordPayloadBuilder] 开始转换: ${result.sections.length} 个 section → Word payload, citations=${extra?.citations?.length || 0}`);

  const sections: WordWritePayload["sections"] = [];

  for (let i = 0; i < result.sections.length; i++) {
    const section = result.sections[i];

    // 1. 解析段落和伪表格（单次遍历）
    const rawParagraphs = parseHtmlToParagraphs(section.content);
    const paragraphs: WordWritePayload["sections"][number]["paragraphs"] = [];
    const pseudoTables: Array<{ title?: string; headers: string[]; rows: string[][] }> = [];

    // 添加 section 标题作为第一行（heading1）
    paragraphs.push({
      text: section.title,
      style: "heading1",
      groundingScore: section.groundingScore,
    });

    // 伪表格检测：连续的 body 段落，文本包含 2+ 个连续空格或制表符分隔的 3+ 列
    let tableBuffer: string[] = [];
    let tableColCount = 0;
    const TABLE_COL_SEP = /\s{2,}|\t/;

    for (const para of rawParagraphs) {
      if (para.style === 'body') {
        const parts = para.text.split(TABLE_COL_SEP).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 3) {
          if (tableBuffer.length === 0) {
            // 开始新表格
            tableBuffer.push(para.text);
            tableColCount = parts.length;
            continue;
          } else if (parts.length === tableColCount) {
            // 继续当前表格
            tableBuffer.push(para.text);
            continue;
          }
          // 列数不一致 → flush 后作为普通段落处理
        }
      }
      // 不是表格行 → flush 缓冲区
      if (tableBuffer.length >= 2) {
        pseudoTables.push(extractPseudoTable(tableBuffer));
      }
      tableBuffer = [];
      tableColCount = 0;
      paragraphs.push({ text: para.text, style: para.style });
    }
    // flush 末尾缓冲区
    if (tableBuffer.length >= 2) {
      pseudoTables.push(extractPseudoTable(tableBuffer));
    }

    // 2. 合并伪表格和 HTML 表格
    const htmlTables = parseHtmlTables(section.content);
    const tables = [...pseudoTables, ...htmlTables];

    // 构建章节
    const wordSection: WordWritePayload["sections"][number] = {
      title: section.title,
      paragraphs,
    };

    if (tables && tables.length > 0) {
      wordSection.tables = tables;
    }

    sections.push(wordSection);
  }

  // 参考来源作为最后一个独立章节
  if (extra?.citations && extra.citations.length > 0) {
    sections.push({
      title: '参考来源',
      paragraphs: [],
      citations: extra.citations,
    });
  }

  logger.info(`[WordPayloadBuilder] 转换完成: ${sections.length} 个章节, 共 ${sections.reduce((sum, s) => sum + s.paragraphs.length, 0)} 个段落`);
  return { sections };
}