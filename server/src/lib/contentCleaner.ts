/**
 * 内容清洗管线 — 后处理 LLM 生成的内容
 *
 * 清洗步骤：
 * 0. 剥离完整 HTML 文档外壳（<!DOCTYPE>/<html>/<head>/<body>），防止 CSS 泄漏
 * 1. 移除 LLM 元信息（"以下是基于参考文档..."等引导语）
 * 2. 移除 (无来源) 标记
 * 2.5. Strip LLM 私自输出的原始 <sup>/<a> HTML 标签（根因修复：让 convertCitationsToLinks 成为唯一来源）
 * 3. 处理 [N] citation 标记（所有格式都转为可点击链接）
 * 4. Markdown → HTML 转换
 * 5. 清理多余空行和空段落
 */
import type { DocumentFormat } from "../../../shared/src/types/generation.js";

export interface CitationLink {
  index: number;
  title: string;
  url: string;
  /** 知识库来源 ID（用于生成链接到 /api/knowledge/sources/:id） */
  sourceId?: string;
}

/**
 * 清洗 LLM 生成的内容
 */
export function cleanContent(
  raw: string,
  format: DocumentFormat,
  citations: CitationLink[] = [],
  documentStyle?: string,
): string {
  if (!raw || raw.trim().length === 0) return "";

  let text = raw;

  // Step 0: 剥离完整 HTML 文档外壳（<!DOCTYPE>/<html>/<head>/<body>）
  // LLM 有时生成完整 HTML 文档，<body> 和 <style> 标签会泄漏 CSS 到整个页面
  text = stripFullHtmlDocument(text);

  // Step 1: 移除 LLM 元信息
  text = removeMetaContent(text);

  // Step 2: 移除 (无来源) 标记
  text = text.replace(/（无来源）/g, "").replace(/\(无来源\)/g, "");

  // Step 2.5: Strip LLM 私自输出的原始 <sup>/<a> HTML 标签
  // LLM 有时在内容中直接生成 <sup><a> 标签，其 title 属性值包含未转义内容甚至嵌套标签，
  // 形成"套娃式"破损 HTML。我们在此全部 strip，让 convertCitationsToLinks 成为 <sup><a> 的唯一起源。
  // convertCitationsToLinks 用 escapeHtmlAttr 生成标签，从不出 bug。
  text = text.replace(/<\/?(?:sup|a)\b[^>]*>/gi, '');

  // Step 3: Markdown → HTML（先处理 inline Markdown，[N] 此时还是纯文本，不会被破坏）
  text = markdownToHtml(text);

  // Step 4: 处理 [N] citation — 在 Markdown 转 HTML 后生成链接，不再被后续正则处理
  text = convertCitationsToLinks(text, citations);

  // Step 5: 清理
  text = cleanHtml(text);

  return text;
}

/**
 * 剥离完整 HTML 文档外壳，提取 body 内容
 * LLM 有时生成 <!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>
 * 这些标签和 style 会泄漏 CSS 到整个页面
 */
function stripFullHtmlDocument(html: string): string {
  // 只处理完整的 HTML 文档
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html) && !/<!DOCTYPE/i.test(html)) {
    return html;
  }
  // 提取 <body> 内容
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  // 没有 body 标签但有 html/head，移除 head 部分
  const headEnd = html.indexOf("</head>");
  if (headEnd !== -1) {
    const afterHead = html.slice(headEnd + 7);
    return afterHead.replace(/<\/?html[^>]*>/gi, "").replace(/<\/?body[^>]*>/gi, "").trim();
  }
  return html;
}

/**
 * 移除 LLM 输出中的元信息和引导语
 */
function removeMetaContent(text: string): string {
  const metaPatterns = [
    // "以下是基于参考文档添加引用标记的版本："
    /^以下是基于参考文档.*?[:：]\s*\n?/gm,
    // "根据参考文档整理的..."
    /^根据参考文档.*?[:：]\s*\n?/gm,
    // "参考文档中未找到..."
    /参考文档中未找到.*?[。！？\n]/g,
    // "以下是...的版本："
    /^以下是.*?版本[:：]\s*\n?/gm,
    // "补充说明：..." 整段
    /^补充说明[:：].*$/gms,
    // "以上是邮件的主要目的概要..."
    /以上是邮件的主要目的概要.*?[。！？\n]/g,
    // "如有任何疑问或需要进一步讨论，请随时告知。" (模板客套话)
    /如有任何疑问或需要进一步讨论.*?[。！？\n]/g,
    // "子章节一：..." "子章节二：..." 这种结构说明
    /子章节[一二三四五六七八九十]+[:：]/g,
    // "以上是...详细说明" 模板结尾
    /以上是.*?详细说明.*?[。！？\n]/g,
    // "**一、...**" 这种编号标题中的粗体标记会在 markdown 转换中处理
  ];

  let result = text;
  for (const pattern of metaPatterns) {
    result = result.replace(pattern, "");
  }

  return result;
}

/**
 * 移除所有 [N] citation 标记（用于邮件格式）
 */
function removeCitationMarkers(text: string): string {
  // 移除 [N] 和 [N][M] 等连续引用
  let result = text.replace(/\[\d+\](?:\[\d+\])*/g, "");
  // 移除句末多余的标点重复（如 "。[1]" 变成 "。" 后不应有空格）
  result = result.replace(/\s+([。，！？；：])/g, "$1");
  // 清理连续空格
  result = result.replace(/  +/g, " ");
  return result;
}

/**
 * 格式化来源名称：UUID 显示为 "知识库文档"
 */
function formatSourceTitle(title: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)) {
    return "知识库文档";
  }
  return title;
}

/**
 * 将 [N] citation 转为可点击 HTML 链接
 */
function convertCitationsToLinks(text: string, citations: CitationLink[]): string {
  return text.replace(/\[(\d+)\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    const cite = citations.find((c) => c.index === num);
    // 无效引用直接 strip，不包裹成 HTML（否则下游正则清理更困难）
    if (!cite) return "";

    const displayTitle = formatSourceTitle(cite.title);

    // 知识库来源：优先链接到原始文件 URL（GitHub/OneDrive），否则用 API 端点
    if (cite.sourceId) {
      const href = cite.url
        ? escapeHtmlAttr(cite.url)
        : `/api/knowledge/sources/${escapeHtmlAttr(cite.sourceId)}/file`;
      return `<sup><a href="${href}" target="_blank" rel="noopener" class="cite-link" title="${escapeHtmlAttr(displayTitle)}">[${num}]</a></sup>`;
    }
    // Web 来源：直接链接
    if (cite.url) {
      return `<sup><a href="${escapeHtmlAttr(cite.url)}" target="_blank" rel="noopener" class="cite-link" title="${escapeHtmlAttr(displayTitle)}">[${num}]</a></sup>`;
    }
    // 无链接
    return `<sup><span class="cite-ref" title="${escapeHtmlAttr(displayTitle)}">[${num}]</span></sup>`;
  });
}

/**
 * 简易 Markdown → HTML 转换
 * 支持：标题、粗体、斜体、列表、链接、代码块
 */
function markdownToHtml(text: string): string {
  const lines = text.split("\n");
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let tableBuffer: string[] = [];

  /** flush tableBuffer as HTML <table> */
  const flushTable = () => {
    if (tableBuffer.length < 2) {
      // not a valid table — render as paragraphs
      for (const row of tableBuffer) {
        htmlLines.push(`<p>${inlineMarkdown(row)}</p>`);
      }
      tableBuffer = [];
      return;
    }
    // Find separator row (e.g. |---|:---:|---|)
    const sepIdx = tableBuffer.findIndex((r) => /^\|[\s\-:|]+\|$/.test(r.trim()));
    if (sepIdx < 0) {
      for (const row of tableBuffer) {
        htmlLines.push(`<p>${inlineMarkdown(row)}</p>`);
      }
      tableBuffer = [];
      return;
    }
    const headerRows = tableBuffer.slice(0, sepIdx);
    const dataRows = tableBuffer.slice(sepIdx + 1);
    const alignments: ("left" | "center" | "right" | "")[] = [];
    const sepCells = tableBuffer[sepIdx].split("|").map((c) => c.trim()).filter(Boolean);
    for (const cell of sepCells) {
      if (cell.startsWith(":") && cell.endsWith(":")) alignments.push("center");
      else if (cell.endsWith(":")) alignments.push("right");
      else if (cell.startsWith(":")) alignments.push("left");
      else alignments.push("");
    }

    const parseRow = (row: string) => row.split("|").map((c) => c.trim()).filter(Boolean);

    let html = "<table>\n";
    for (const hr of headerRows) {
      const cells = parseRow(hr);
      html += "<thead><tr>" + cells.map((c, ci) => {
        const align = alignments[ci] ? ` style="text-align:${alignments[ci]}"` : "";
        return `<th${align}>${inlineMarkdown(c)}</th>`;
      }).join("") + "</tr></thead>\n";
    }
    html += "<tbody>\n";
    for (const dr of dataRows) {
      const cells = parseRow(dr);
      html += "<tr>" + cells.map((c, ci) => {
        const align = alignments[ci] ? ` style="text-align:${alignments[ci]}"` : "";
        return `<td${align}>${inlineMarkdown(c)}</td>`;
      }).join("") + "</tr>\n";
    }
    html += "</tbody></table>";
    htmlLines.push(html);
    tableBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 代码块
    if (line.trim().startsWith("```")) {
      flushTable();
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inCodeBlock) {
        htmlLines.push("</code></pre>");
        inCodeBlock = false;
      } else {
        htmlLines.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      htmlLines.push(escapeHtml(line));
      continue;
    }

    // 空行 — flush table/lists
    if (line.trim() === "") {
      flushTable();
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      htmlLines.push("");
      continue;
    }

    // 标题 (# ## ###)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushTable();
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      const level = headingMatch[1].length;
      htmlLines.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Markdown table row (starts with | and contains at least one more |)
    if (/^\|.+\|/.test(line.trim())) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      tableBuffer.push(line);
      continue;
    }

    // Trailing table segment: LLM sometimes appends table rows to paragraph text
    // e.g. "这是一段说明文字。| 列1 | 列2 | 列3 |"
    // Split the line into paragraph text + table row, so the table header isn't lost
    const trailingTableMatch = line.match(/^(.+?[。！？.!；;])\s*(\|.+\|)$/);
    if (trailingTableMatch) {
      const paraText = trailingTableMatch[1].trim();
      const tableRow = trailingTableMatch[2].trim();
      flushTable();
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (paraText) {
        htmlLines.push(`<p>${inlineMarkdown(paraText)}</p>`);
      }
      tableBuffer.push(tableRow);
      continue;
    }

    // 无序列表 (- 或 *)
    if (/^\s*[-*]\s+/.test(line)) {
      flushTable();
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      const content = line.replace(/^\s*[-*]\s+/, "");
      htmlLines.push(`<li>${inlineMarkdown(content)}</li>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushTable();
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      const content = line.replace(/^\s*\d+[.)]\s+/, "");
      htmlLines.push(`<li>${inlineMarkdown(content)}</li>`);
      continue;
    }

    // 关闭列表
    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }

    // 普通段落
    flushTable();
    htmlLines.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  flushTable();
  if (inList) htmlLines.push("</ul>");
  if (inCodeBlock) htmlLines.push("</code></pre>");

  return htmlLines.join("\n");
}

/**
 * 行内 markdown 转换（粗体、斜体、链接、行内代码）
 */
function inlineMarkdown(text: string): string {
  let result = text;
  // 行内代码
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // 斜体（不匹配 HTML 属性中的 _blank 等）
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // 只匹配前后是空白、标点或行首行尾的 _，避免匹配 HTML 属性中的 _blank
  result = result.replace(/(?<=^|[\s.,;:!?一-鿿])_(.+?)_(?=$|[\s.,;:!?一-鿿])/g, "<em>$1</em>");
  // 链接 [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return result;
}

function cleanHtml(html: string): string {
  let result = html;
  // 移除空段落
  result = result.replace(/<p>\s*<\/p>/g, "");
  // 移除连续空行
  result = result.replace(/\n{3,}/g, "\n\n");
  // 修复 LLM 生成的数字中的多余句号（如 5.。0 → 5.0，3.。8 → 3.8）
  result = result.replace(/(\d)\.。(\d)/g, '$1.$2');
  // 修复缺失 > 的闭合标签（</p → </p>，</li → </li>）
  result = result.replace(/<\/(p|li)(?!>)/g, '</$1>');
  // 移除首尾空白
  result = result.trim();
  return result;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML 属性值转义（用于 URL 等属性值）
 * 注意：不对 & 进行转义，因为 URL 中的 & 是合法的查询参数分隔符
 */
function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
