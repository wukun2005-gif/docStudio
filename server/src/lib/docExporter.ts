/**
 * 文档导出模块 — Word/PPT/Excel 生成
 * Feature #13: Word 生成
 * Feature #14: PowerPoint 生成
 * Feature #15: Excel 生成
 */
import { logger } from "./logger.js";

export interface ExportSection {
  title: string;
  content: string;
  level?: number;
}

// ── Word 生成 (#13) ──────────────────────────────────

/**
 * 生成简单的 Word XML 格式（.docx 的内核是 XML）
 * 简化版：生成 HTML 格式，Word 可以直接打开
 */
export function generateWord(title: string, sections: ExportSection[], citations?: CitationItem[]): Buffer {
  const citationsHtml = citations && citations.length > 0
    ? `<hr><h2>参考来源</h2><ol>${citations.map(c => {
        const urlPart = formatCitationUrlHtml(c);
        return `<li>[${c.index}] ${escapeHtml(c.title)}${urlPart}</li>`;
      }).join('')}</ol>`
    : '';

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; line-height: 1.6; }
  h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 8px; }
  h2 { color: #16213e; margin-top: 24px; }
  h3 { color: #0f3460; }
  p { margin: 8px 0; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">生成时间：${new Date().toLocaleString("zh-CN")}</p>
${sections.map((s) => {
  const tag = s.level === 1 ? "h2" : s.level === 2 ? "h3" : "h3";
  const paragraphs = s.content.split("\n").filter((p) => p.trim()).map((p) => `<p>${p}</p>`).join("\n");
  return `<${tag}>${s.title}</${tag}>\n${paragraphs}`;
}).join("\n<hr>\n")}
${citationsHtml}
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}

// ── PowerPoint 生成 (#14) ─────────────────────────────

/**
 * 生成简单的 PowerPoint XML 格式
 * 简化版：生成 HTML 幻灯片格式
 */
export function generatePowerPoint(title: string, sections: ExportSection[], citations?: CitationItem[]): Buffer {
  const slides = sections.map((s, idx) => `
<div class="slide" style="page-break-after: always; padding: 40px; min-height: 500px;">
  <h1 style="color: #1a1a2e; font-size: 28px; margin-bottom: 20px;">${s.title}</h1>
  <div style="font-size: 18px; line-height: 1.8;">
    ${s.content.split("\n").filter((p) => p.trim()).map((p) => `<p>${p}</p>`).join("\n")}
  </div>
  <div style="position: absolute; bottom: 20px; right: 40px; color: #999;">${idx + 1}</div>
</div>`).join("\n");

  const citationsSlide = citations && citations.length > 0
    ? `<div class="slide" style="page-break-after: always; padding: 40px; min-height: 500px;">
  <h1 style="color: #1a1a2e; font-size: 28px; margin-bottom: 20px;">参考来源</h1>
  <div style="font-size: 16px; line-height: 1.8;">
    ${citations.map(c => {
      const urlPart = formatCitationUrlHtml(c);
      return `<p>[${c.index}] ${escapeHtml(c.title)}${urlPart}</p>`;
    }).join('')}
  </div>
</div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 0; }
  .slide { position: relative; }
</style>
</head>
<body>
<div style="text-align: center; padding: 40px;">
  <h1 style="font-size: 36px; color: #1a1a2e;">${title}</h1>
  <p style="color: #666;">${new Date().toLocaleDateString("zh-CN")}</p>
</div>
<hr>
${slides}
${citationsSlide}
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}

// ── Excel 生成 (#15) ──────────────────────────────────

/**
 * 生成简单的 CSV 格式（Excel 可以打开）
 */
export function generateExcel(title: string, sections: ExportSection[], citations?: CitationItem[]): Buffer {
  const rows = [
    ["章节", "内容", "字数"],
    ...sections.map((s) => [
      s.title,
      s.content.replace(/\n/g, " ").replace(/"/g, '""'),
      String(s.content.length),
    ]),
  ];

  // 添加参考来源列表
  if (citations && citations.length > 0) {
    rows.push(["", "", ""]);  // 空行分隔
    rows.push(["参考来源", "", ""]);
    citations.forEach(c => {
      const urlPart = formatCitationUrlText(c);
      rows.push([`[${c.index}]`, `${c.title}${urlPart}`, ""]);
    });
  }

  const csv = rows
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");

  // 添加 BOM 以支持中文
  return Buffer.from("﻿" + csv, "utf-8");
}

// ── Email 生成 (.eml) ─────────────────────────────────

export interface CitationItem {
  index: number;
  title: string;
  url?: string;
  fileName?: string;  // 原始文件名，用于内部文件
}

/**
 * 生成标准 RFC 822 格式的 eml 文件
 * 可以直接用 Outlook、Thunderbird 等邮件客户端打开
 * 使用 HTML 格式以支持可点击链接
 */
export function generateEml(title: string, sections: ExportSection[], citations?: CitationItem[]): Buffer {
  // 生成 HTML 格式的正文
  const bodyHtml = sections.map((s) => {
    const paragraphs = s.content.split("\n").filter((p) => p.trim());
    return paragraphs.map((p) => {
      // 将正文中的 [N] 替换为锚点链接
      let html = escapeHtml(p);
      if (citations && citations.length > 0) {
        html = html.replace(/\[(\d+)\]/g, (match, num) => {
          return `<a href="#cite-${num}" style="color: #2563eb; text-decoration: underline;">[${num}]</a>`;
        });
      }
      return `<p style="margin: 8px 0; line-height: 1.6;">${html}</p>`;
    }).join("\n");
  }).join("\n");

  // 生成参考来源列表 HTML
  let citationsHtml = "";
  if (citations && citations.length > 0) {
    citationsHtml = `
<hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
<div style="margin-top: 16px;">
  <h3 style="color: #374151; font-size: 16px; margin-bottom: 12px;">参考来源</h3>
  <ol style="list-style: none; padding: 0; margin: 0;">
${citations.map((c) => {
  if (c.url) {
    // 有URL的都显示为可点击链接（内部文件和外部URL）
    return `    <li id="cite-${c.index}" style="margin: 8px 0; color: #4b5563;">
      <span style="color: #2563eb; font-weight: 500;">[${c.index}]</span> <a href="${escapeHtmlAttr(c.url)}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(c.title)}</a>
    </li>`;
  }
  return `    <li id="cite-${c.index}" style="margin: 8px 0; color: #4b5563;">
      <span style="color: #2563eb; font-weight: 500;">[${c.index}]</span> ${escapeHtml(c.title)}
    </li>`;
}).join("\n")}
  </ol>
</div>`;
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1f2937; max-width: 680px; margin: 0 auto; padding: 20px;">
${bodyHtml}
${citationsHtml}
</body>
</html>`;

  const now = new Date().toUTCString();
  const eml = [
    `Subject: =?UTF-8?B?${Buffer.from(title, "utf-8").toString("base64")}?=`,
    `Date: ${now}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    "",
    Buffer.from(htmlContent, "utf-8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(eml, "utf-8");
}

// ── 统一导出接口 ──────────────────────────────────────

export type ExportFormat = "docx" | "pptx" | "xlsx" | "eml";

export function exportDocument(
  format: ExportFormat,
  title: string,
  sections: ExportSection[],
  citations?: CitationItem[],
): { buffer: Buffer; contentType: string; extension: string } {
  logger.info(`[DocExporter] 导出 ${format}: ${title}, 参考来源: ${citations?.length ?? 0} 个`);

  switch (format) {
    case "docx":
      return {
        buffer: generateWord(title, sections, citations),
        contentType: "application/msword",
        extension: ".doc",
      };
    case "pptx":
      return {
        buffer: generatePowerPoint(title, sections, citations),
        contentType: "application/vnd.ms-powerpoint",
        extension: ".ppt",
      };
    case "xlsx":
      return {
        buffer: generateExcel(title, sections, citations),
        contentType: "application/vnd.ms-excel",
        extension: ".csv",
      };
    case "eml":
      return {
        buffer: generateEml(title, sections, citations),
        contentType: "message/rfc822",
        extension: ".eml",
      };
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// ── HTML 转义工具 ─────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return text
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── 引用格式化工具 ─────────────────────────────────────

/** 判断是否是内部API路径 */
function isInternalApiPath(url: string): boolean {
  return url.startsWith("/api/") || url.startsWith("api/");
}

/** 格式化引用URL用于显示（HTML格式，带链接） */
export function formatCitationUrlHtml(c: CitationItem): string {
  if (!c.url) return "";
  if (isInternalApiPath(c.url)) {
    // 内部文件不显示路径
    return "";
  }
  // 外部URL显示为可点击链接
  return ` <a href="${escapeHtmlAttr(c.url)}">${escapeHtml(c.url)}</a>`;
}

/** 格式化引用URL用于显示（纯文本格式） */
export function formatCitationUrlText(c: CitationItem): string {
  if (!c.url) return "";
  if (isInternalApiPath(c.url)) {
    // 内部文件不显示路径
    return "";
  }
  // 外部URL显示
  return ` (${c.url})`;
}
