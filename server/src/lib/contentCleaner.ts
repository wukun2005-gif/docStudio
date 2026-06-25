/**
 * 内容清洗管线 — 后处理 LLM 生成的内容
 *
 * 清洗步骤：
 * 0. 剥离完整 HTML 文档外壳（<!DOCTYPE>/<html>/<head>/<body>），防止 CSS 泄漏
 * 1. 移除 LLM 元信息（"以下是基于参考文档..."等引导语）
 * 2. 移除 (无来源) 标记
 * 3. 处理 [N] citation 标记（邮件移除，其他格式转为可点击链接）
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

  // Step 3: 处理 [N] citation — 所有格式都转为可点击链接（包括邮件）
  text = convertCitationsToLinks(text, citations);

  // Step 4: Markdown → HTML
  text = markdownToHtml(text);

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
    if (!cite) return `<sup class="cite-ref">[${num}]</sup>`;

    const displayTitle = formatSourceTitle(cite.title);

    // 知识库来源：链接到原始文件
    if (cite.sourceId) {
      return `<sup><a href="/api/knowledge/sources/${escapeHtmlAttr(cite.sourceId)}/file" target="_blank" rel="noopener" class="cite-link" title="${escapeHtmlAttr(displayTitle)}">[${num}]</a></sup>`;
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

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 代码块
    if (line.trim().startsWith("```")) {
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

    // 空行
    if (line.trim() === "") {
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
      const level = headingMatch[1].length;
      htmlLines.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // 无序列表 (- 或 *)
    if (/^\s*[-*]\s+/.test(line)) {
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
    htmlLines.push(`<p>${inlineMarkdown(line)}</p>`);
  }

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

/**
 * 清理 HTML：移除空段落、多余换行
 */
function cleanHtml(html: string): string {
  let result = html;
  // 移除空段落
  result = result.replace(/<p>\s*<\/p>/g, "");
  // 移除连续空行
  result = result.replace(/\n{3,}/g, "\n\n");
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
