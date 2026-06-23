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
export function generateWord(title: string, sections: ExportSection[]): Buffer {
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
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}

// ── PowerPoint 生成 (#14) ─────────────────────────────

/**
 * 生成简单的 PowerPoint XML 格式
 * 简化版：生成 HTML 幻灯片格式
 */
export function generatePowerPoint(title: string, sections: ExportSection[]): Buffer {
  const slides = sections.map((s, idx) => `
<div class="slide" style="page-break-after: always; padding: 40px; min-height: 500px;">
  <h1 style="color: #1a1a2e; font-size: 28px; margin-bottom: 20px;">${s.title}</h1>
  <div style="font-size: 18px; line-height: 1.8;">
    ${s.content.split("\n").filter((p) => p.trim()).map((p) => `<p>${p}</p>`).join("\n")}
  </div>
  <div style="position: absolute; bottom: 20px; right: 40px; color: #999;">${idx + 1}</div>
</div>`).join("\n");

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
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}

// ── Excel 生成 (#15) ──────────────────────────────────

/**
 * 生成简单的 CSV 格式（Excel 可以打开）
 */
export function generateExcel(title: string, sections: ExportSection[]): Buffer {
  const rows = [
    ["章节", "内容", "字数"],
    ...sections.map((s) => [
      s.title,
      s.content.replace(/\n/g, " ").replace(/"/g, '""'),
      String(s.content.length),
    ]),
  ];

  const csv = rows
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");

  // 添加 BOM 以支持中文
  return Buffer.from("﻿" + csv, "utf-8");
}

// ── 统一导出接口 ──────────────────────────────────────

export type ExportFormat = "docx" | "pptx" | "xlsx";

export function exportDocument(
  format: ExportFormat,
  title: string,
  sections: ExportSection[],
): { buffer: Buffer; contentType: string; extension: string } {
  logger.info(`[DocExporter] 导出 ${format}: ${title}`);

  switch (format) {
    case "docx":
      return {
        buffer: generateWord(title, sections),
        contentType: "application/msword",
        extension: ".doc",
      };
    case "pptx":
      return {
        buffer: generatePowerPoint(title, sections),
        contentType: "application/vnd.ms-powerpoint",
        extension: ".ppt",
      };
    case "xlsx":
      return {
        buffer: generateExcel(title, sections),
        contentType: "application/vnd.ms-excel",
        extension: ".csv",
      };
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
