/**
 * 文档导出模块 — Word/PPT/Excel 生成
 * Feature #13: Word 生成
 * Feature #14: PowerPoint 生成
 * Feature #15: Excel 生成
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip,
} from "docx";
import { logger } from "./logger.js";

// pptxgenjs & xlsx - dynamic require to avoid ESM interop type issues
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const PptxGenJS: new () => any = require("pptxgenjs");
const XLSX: typeof import("xlsx") = require("xlsx");

export interface ExportSection {
  title: string;
  content: string;
  level?: number;
}

// 子标题标记（由 parseHtmlSections 在导出路径中注入，与 generation.ts 保持同步）
const SUB_MARKER = "\x01H\x01";

// ── Word 生成 (#13) ──────────────────────────────────

/**
 * 生成标准 OOXML .docx 格式文档
 * 使用保守兼容的配置，确保 Word、Pages、WPS、Google Docs 等均可正常打开
 */
export async function generateWord(title: string, sections: ExportSection[], citations?: CitationItem[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 44,
          font: {
            ascii: "Times New Roman",
            eastAsia: "SimSun",
            hAnsi: "Times New Roman",
            cs: "Times New Roman",
          },
        }),
      ],
    }),
  );

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [
        new TextRun({
          text: `生成时间：${new Date().toLocaleString("zh-CN")}`,
          size: 21,
          color: "808080",
          font: {
            ascii: "Times New Roman",
            eastAsia: "SimSun",
            hAnsi: "Times New Roman",
            cs: "Times New Roman",
          },
        }),
      ],
    }),
  );

  for (const section of sections) {
    const headingSize = section.level === 2 ? 28 : 32;

    children.push(
      new Paragraph({
        spacing: { before: 360, after: 200 },
        children: [
          new TextRun({
            text: section.title,
            bold: true,
            size: headingSize,
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        ],
      }),
    );

    const paragraphs = section.content.split("\n").filter((p) => p.trim());
    // 表格检测：连续的"列对齐"段落 → 合并为 docx Table
    const TABLE_COL_SEP = /\s{2,}/;  // 2+ 空格作为列分隔
    let tableBuffer: string[][] = [];

    const flushTable = () => {
      if (tableBuffer.length < 2) {
        // 不够成表格，按普通段落渲染
        for (const row of tableBuffer) {
          children.push(new Paragraph({
            spacing: { after: 120, line: 360, lineRule: "auto" },
            indent: { firstLine: 420 },
            children: [new TextRun({ text: row.join("  "), size: 24, font: { ascii: "Times New Roman", eastAsia: "SimSun", hAnsi: "Times New Roman", cs: "Times New Roman" } })],
          }));
        }
        tableBuffer = [];
        return;
      }
      // 渲染为 docx Table
      const colCount = Math.max(...tableBuffer.map(r => r.length));
      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
      const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
      const tableRows = tableBuffer.map((row, rowIdx) => {
        const isHeader = rowIdx === 0;
        const cells: TableCell[] = [];
        for (let c = 0; c < colCount; c++) {
          cells.push(new TableCell({
            borders,
            width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
            children: [new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [new TextRun({
                text: row[c] ?? "",
                bold: isHeader,
                size: isHeader ? 22 : 21,
                font: { ascii: "Times New Roman", eastAsia: "SimSun", hAnsi: "Times New Roman", cs: "Times New Roman" },
              })],
            })],
          }));
        }
        return new TableRow({ children: cells });
      });
      children.push(new Table({ rows: tableRows, width: { size: 9000, type: WidthType.DXA } }));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] })); // 表后空行
      tableBuffer = [];
    };

    for (const paraText of paragraphs) {
      // 表格行检测：2+ 空格分隔的多列文本
      const cols = paraText.split(TABLE_COL_SEP).map(c => c.trim()).filter(Boolean);
      if (cols.length >= 2 && !paraText.startsWith(SUB_MARKER)) {
        tableBuffer.push(cols);
        continue;
      }
      // 非表格行 → 先 flush 已累积的表格
      flushTable();

      // 检测子标题标记：以 SUB_MARKER 开头的行作为加粗小标题
      if (paraText.startsWith(SUB_MARKER)) {
        const subTitle = paraText.slice(SUB_MARKER.length).trim();
        if (subTitle) {
          children.push(
            new Paragraph({
              spacing: { before: 240, after: 120 },
              children: [
                new TextRun({
                  text: subTitle,
                  bold: true,
                  size: 26, // 介于正文(24)和主标题(32)之间
                  font: {
                    ascii: "Times New Roman",
                    eastAsia: "SimSun",
                    hAnsi: "Times New Roman",
                    cs: "Times New Roman",
                  },
                }),
              ],
            }),
          );
        }
        continue;
      }

      const runs = buildInlineRuns(paraText, citations);
      children.push(
        new Paragraph({
          spacing: { after: 120, line: 360, lineRule: "auto" },
          indent: { firstLine: 420 },
          children: runs,
        }),
      );
    }
    // section 结束，flush 剩余的表格
    flushTable();
  }

  if (citations && citations.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 480, after: 200 },
        children: [
          new TextRun({
            text: "————————————————————",
            size: 20,
            color: "BFBFBF",
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "参考来源",
            bold: true,
            size: 28,
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        ],
      }),
    );

    for (const c of citations) {
      const citeRuns: TextRun[] = [
        new TextRun({
          text: `[${c.index}] `,
          bold: true,
          size: 22,
          color: "2563EB",
          font: {
            ascii: "Times New Roman",
            eastAsia: "SimSun",
            hAnsi: "Times New Roman",
            cs: "Times New Roman",
          },
        }),
      ];

      if (c.url) {
        citeRuns.push(
          new TextRun({
            text: c.title,
            underline: {},
            color: "0563C1",
            size: 22,
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        );
        citeRuns.push(
          new TextRun({
            text: ` ${c.url}`,
            size: 18,
            color: "808080",
            italics: true,
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        );
      } else {
        citeRuns.push(
          new TextRun({
            text: c.title,
            size: 22,
            font: {
              ascii: "Times New Roman",
              eastAsia: "SimSun",
              hAnsi: "Times New Roman",
              cs: "Times New Roman",
            },
          }),
        );
      }

      children.push(
        new Paragraph({
          spacing: { after: 100, line: 320, lineRule: "auto" },
          children: citeRuns,
        }),
      );
    }
  }

  const doc = new Document({
    creator: "DocStudio",
    title: title,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.27),
              height: convertInchesToTwip(11.69),
            },
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        children: children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

/**
 * 构建内联文本 runs，将 [N] 引用标记转换为带颜色的标注
 * 不使用超链接（某些旧版 Pages 对 hyperlink 元素兼容性差）
 */
function buildInlineRuns(text: string, citations?: CitationItem[]): TextRun[] {
  const fontConfig = {
    ascii: "Times New Roman",
    eastAsia: "SimSun",
    hAnsi: "Times New Roman",
    cs: "Times New Roman",
  };

  if (!citations || citations.length === 0) {
    return [new TextRun({ text, size: 24, font: fontConfig })];
  }

  const citationMap = new Map<number, CitationItem>();
  for (const c of citations) {
    citationMap.set(c.index, c);
  }

  const runs: TextRun[] = [];
  const citePattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = citePattern.exec(text)) !== null) {
    const citeNum = parseInt(match[1]!, 10);
    const before = text.slice(lastIndex, match.index);
    if (before) {
      runs.push(new TextRun({ text: before, size: 24, font: fontConfig }));
    }

    runs.push(
      new TextRun({
        text: `[${citeNum}]`,
        superScript: false,
        size: 20,
        color: "2563EB",
        font: fontConfig,
      }),
    );

    lastIndex = match.index + match[0].length;
  }

  const after = text.slice(lastIndex);
  if (after) {
    runs.push(new TextRun({ text: after, size: 24, font: fontConfig }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 24, font: fontConfig }));
  }

  return runs;
}

// ── PowerPoint 生成 (#14) ─────────────────────────────

/**
 * 生成 PPTX 格式（使用 pptxgenjs 库）
 */
export async function generatePowerPoint(title: string, sections: ExportSection[], citations?: CitationItem[]): Promise<Buffer> {
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "DocStudio";
  pptx.title = title;

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "1a1a2e" };
  titleSlide.addText(title, {
    x: 0.5, y: 2.0, w: "90%", h: 1.5,
    fontSize: 44, color: "FFFFFF", bold: true, align: "center",
    fontFace: "Microsoft YaHei",
  });
  titleSlide.addText(new Date().toLocaleDateString("zh-CN"), {
    x: 0.5, y: 3.8, w: "90%", h: 0.5,
    fontSize: 18, color: "CCCCCC", align: "center",
    fontFace: "Microsoft YaHei",
  });

  for (const [idx, section] of sections.entries()) {
    const slide = pptx.addSlide();

    slide.addText(section.title, {
      x: 0.5, y: 0.3, w: "90%", h: 0.8,
      fontSize: 28, color: "1a1a2e", bold: true,
      fontFace: "Microsoft YaHei",
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 1.1, w: 9.0, h: 0.05,
      fill: { color: "16213e" },
    });

    slide.addText(section.content, {
      x: 0.5, y: 1.4, w: "90%", h: 4.5,
      fontSize: 16, color: "333333",
      fontFace: "Microsoft YaHei",
      valign: "top",
      lineSpacingMultiple: 1.5,
    });

    slide.addText(`${idx + 1}`, {
      x: 9.0, y: 5.1, w: 0.5, h: 0.4,
      fontSize: 12, color: "999999", align: "right",
    });
  }

  if (citations && citations.length > 0) {
    const citeSlide = pptx.addSlide();
    citeSlide.addText("参考来源", {
      x: 0.5, y: 0.3, w: "90%", h: 0.8,
      fontSize: 28, color: "1a1a2e", bold: true,
      fontFace: "Microsoft YaHei",
    });
    citeSlide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 1.1, w: 9.0, h: 0.05,
      fill: { color: "16213e" },
    });

    const citeText = citations.map(c => {
      const urlPart = c.url ? ` ${c.url}` : "";
      return `[${c.index}] ${c.title}${urlPart}`;
    }).join("\n");

    citeSlide.addText(citeText, {
      x: 0.5, y: 1.4, w: "90%", h: 4.5,
      fontSize: 14, color: "333333",
      fontFace: "Microsoft YaHei",
      valign: "top",
      lineSpacingMultiple: 1.5,
    });
  }

  const buffer = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
  return Buffer.from(buffer);
}

// ── Excel 生成 (#15) ──────────────────────────────────

/**
 * 生成 XLSX 格式（使用 xlsx 库）
 */
export async function generateExcel(title: string, sections: ExportSection[], citations?: CitationItem[]): Promise<Buffer> {
  const aoa: (string | number)[][] = [
    ["章节", "内容", "字数"],
  ];

  for (const s of sections) {
    aoa.push([
      s.title,
      s.content.replace(/\n/g, " "),
      s.content.length,
    ]);
  }

  if (citations && citations.length > 0) {
    aoa.push(["", "", ""]);
    aoa.push(["参考来源", "", ""]);
    for (const c of citations) {
      const urlPart = c.url ? ` (${c.url})` : "";
      aoa.push([`[${c.index}]`, `${c.title}${urlPart}`, ""]);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 20 },
    { wch: 80 },
    { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer;
}

// ── Email 生成 (.eml) ─────────────────────────────────

export interface CitationItem {
  index: number;
  title: string;
  url?: string;
  fileName?: string;
}

/**
 * 生成标准 RFC 822 格式的 eml 文件
 * 可以直接用 Outlook、Thunderbird、Mail 等邮件客户端打开
 * 使用 HTML 格式以支持可点击链接
 */
export function generateEml(title: string, sections: ExportSection[], citations?: CitationItem[]): Buffer {
  const bodyHtml = sections.map((s) => {
    const paragraphs = s.content.split("\n").filter((p) => p.trim());
    return paragraphs.map((p) => {
      let html = escapeHtml(p);
      if (citations && citations.length > 0) {
        html = html.replace(/\[(\d+)\]/g, (match, num) => {
          return `<a href="#cite-${num}" style="color: #2563eb; text-decoration: underline;">[${num}]</a>`;
        });
      }
      return `<p style="margin: 8px 0; line-height: 1.6;">${html}</p>`;
    }).join("\n");
  }).join("\n");

  let citationsHtml = "";
  if (citations && citations.length > 0) {
    citationsHtml = `
<hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
<div style="margin-top: 16px;">
  <h3 style="color: #374151; font-size: 16px; margin-bottom: 12px;">参考来源</h3>
  <ol style="list-style: none; padding: 0; margin: 0;">
${citations.map((c) => {
  if (c.url) {
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

export async function exportDocument(
  format: ExportFormat,
  title: string,
  sections: ExportSection[],
  citations?: CitationItem[],
): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  logger.info(`[DocExporter] 导出 ${format}: ${title}, 参考来源: ${citations?.length ?? 0} 个`);

  switch (format) {
    case "docx":
      return {
        buffer: await generateWord(title, sections, citations),
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
      };
    case "pptx":
      return {
        buffer: await generatePowerPoint(title, sections, citations),
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: ".pptx",
      };
    case "xlsx":
      return {
        buffer: await generateExcel(title, sections, citations),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: ".xlsx",
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
