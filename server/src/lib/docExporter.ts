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
import { parseSectionHtml, computeSlideLayout } from "./slideLayoutEngine.js";
import { buildSlideHtml } from "./slideHtmlBuilder.js";
import { extractSlideElements } from "./slideElementExtractor.js";
import { newPage } from "./browserManager.js";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// pptxgenjs & xlsx - dynamic require to avoid ESM interop type issues
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const PptxGenJS: new () => any = require("pptxgenjs");
const XLSX: typeof import("xlsx") = require("xlsx");

export interface ChartSpec {
  type: "bar" | "pie" | "line" | "column" | "doughnut" | "scatter";
  title: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface ExportSection {
  title: string;
  content: string;
  level?: number;
  /** LLM 生成的 xlsxwriter Python 脚本（Code Interpreter Pattern） */
  pythonScript?: string;
  /** 从 LLM 输出或规则引擎提取的图表规格 */
  chartSpecs?: ChartSpec[];
  /** 从 HTML 中提取的表格数据（二维数组，第一行为表头） */
  tables?: Array<Array<string[]>>;
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
 * 将带 SUB_MARKER 标记的纯文本转换为 pptxgenjs TextProps 数组
 * SUB_MARKER = "\x01H\x01" 用于标记子标题行（需要加粗+大字号）
 * 同时剥离 \x01 控制字符，避免生成无效的 OOXML
 */
function buildPptxTextRuns(content: string): Array<{ text: string; options: Record<string, unknown> }> {
  const SUB_MARKER = "\x01H\x01";
  const runs: Array<{ text: string; options: Record<string, unknown> }> = [];
  const lines = content.split("\n");

  let currentText = "";
  let currentIsSub = false;
  let startNewSegment = true;

  const flush = () => {
    if (currentText) {
      runs.push({
        text: currentText,
        options: currentIsSub
          ? { fontSize: 18, bold: true, color: "1a1a2e" }
          : { fontSize: 16, color: "333333" },
      });
      currentText = "";
      startNewSegment = true;
    }
  };

  for (const line of lines) {
    if (line.startsWith(SUB_MARKER)) {
      flush();
      currentIsSub = true;
      currentText = line.slice(SUB_MARKER.length).trim();
    } else {
      if (currentIsSub) {
        flush();
      }
      currentIsSub = false;
      if (startNewSegment) {
        currentText = line;
        startNewSegment = false;
      } else {
        currentText += "\n" + line;
      }
    }
  }
  flush();

  // 防御性移除所有 \x01 控制字符（避免生成无效 OOXML）
  for (const run of runs) {
    run.text = run.text.replace(/\x01/g, "");
  }

  return runs;
}

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

    // 使用 buildPptxTextRuns 将内容转换为带格式的文本数组
    const textRuns = buildPptxTextRuns(section.content);
    const hasTables = section.tables && section.tables.length > 0;
    const hasCharts = section.chartSpecs && section.chartSpecs.length > 0;

    // 紧凑布局：同时有表格和图表时减小文字区域，为 side-by-side 布局腾空间
    const bothTablesAndCharts = hasTables && hasCharts;
    const textHeight = bothTablesAndCharts ? 0.7 : (hasTables || hasCharts ? 2.0 : 4.5);

    if (textRuns.length > 0) {
      slide.addText(textRuns, {
        x: 0.5, y: 1.4, w: "90%", h: textHeight,
        fontFace: "Microsoft YaHei",
        valign: "top",
        lineSpacingMultiple: 1.1,
        fontSize: 10,
      });
    }

    // ── Side-by-side 布局：table[i] + chart[i] 并排 ──
    // 同时有表格和图表时：表格在左(4.0"宽)，图表在右(4.7"宽)，每对占 1.5"高
    // 只有表格/图表时：全宽(9.0"宽)，纵向堆叠
    if (bothTablesAndCharts) {
      const tables = section.tables!;
      const charts = section.chartSpecs!;
      const pairCount = Math.max(tables.length, charts.length);
      let zoneY = 1.4 + textHeight + 0.1;
      const SLIDE_BOTTOM = 7.0;
      const zoneH = Math.min(1.5, (SLIDE_BOTTOM - zoneY) / Math.max(pairCount, 1));

      for (let p = 0; p < pairCount; p++) {
        const tableData = tables[p];
        const chartSpec = charts[p];

        // ── 表格（左侧）──
        if (tableData && tableData.length > 0) {
          try {
            const colCount = Math.max(...tableData.map(r => r.length));
            const tableRows: Array<Array<{ text: string; options: Record<string, unknown> }>> = [];
            const hdrRow = tableData[0]!;
            const headerCells = hdrRow.map(cell => ({
              text: cell || "",
              options: { fontSize: 8, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const },
            }));
            while (headerCells.length < colCount) {
              headerCells.push({ text: "", options: { fontSize: 8, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const } });
            }
            tableRows.push(headerCells);
            for (const row of tableData.slice(1)) {
              const cells = row.map(cell => ({
                text: cell || "",
                options: { fontSize: 7, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const },
              }));
              while (cells.length < colCount) {
                cells.push({ text: "", options: { fontSize: 7, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const } });
              }
              tableRows.push(cells);
            }
            slide.addTable(tableRows, {
              x: 0.5, y: zoneY, w: 4.0,
              border: { type: "solid", pt: 0.5, color: "D1D5DB" },
              fontFace: "Microsoft YaHei",
              autoPage: false,
            });
          } catch (tableErr) {
            logger.warn(`[DocExporter] 表格渲染失败: ${tableErr}`);
          }
        }

        // ── 图表（右侧）──
        if (chartSpec) {
          try {
            let chartData: Array<{ name: string; labels?: string[]; values: number[] | Array<{ x: number; y: number }> }>;
            if (chartSpec.type === "scatter") {
              chartData = chartSpec.series.map((s) => {
                const vals: unknown[] = s.values as unknown[];
                if (vals.length > 0 && Array.isArray(vals[0])) {
                  const flatY = (vals as unknown[][]).map((v) => Number(v[1]) || 0);
                  return { name: s.name, labels: chartSpec.categories, values: flatY };
                }
                return { name: s.name, labels: chartSpec.categories, values: vals as number[] };
              });
            } else {
              chartData = chartSpec.series.map((s) => ({
                name: s.name,
                labels: chartSpec.categories,
                values: s.values,
              }));
            }

            let chartType: any;
            switch (chartSpec.type) {
              case "bar": chartType = pptx.charts.BAR; break;
              case "column": chartType = pptx.charts.BAR; break;
              case "pie": chartType = pptx.charts.PIE; break;
              case "doughnut": chartType = pptx.charts.DOUGHNUT; break;
              case "line": chartType = pptx.charts.LINE; break;
              case "scatter": chartType = pptx.charts.SCATTER; break;
              default: chartType = pptx.charts.BAR;
            }

            renderChartOnSlide(slide, pptx, chartSpec, 4.8, zoneY, 4.7, zoneH - 0.1);
          } catch (chartErr) {
            logger.warn(`[DocExporter] 图表渲染失败: ${chartErr}`);
          }
        }

        zoneY += zoneH;
      }
    } else {
      // ── 只有表格或只有图表：全宽纵向堆叠 ──
      let currentY = 1.4 + textHeight + 0.1;
      if (hasTables) {
        for (const tableData of section.tables!) {
          if (tableData.length === 0) continue;
          const colCount = Math.max(...tableData.map(r => r.length));
          const tableRows: Array<Array<{ text: string; options: Record<string, unknown> }>> = [];
          const headerCells = tableData[0]!.map(cell => ({
            text: cell || "",
            options: { fontSize: 10, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const },
          }));
          while (headerCells.length < colCount) {
            headerCells.push({ text: "", options: { fontSize: 10, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const } });
          }
          tableRows.push(headerCells);
          for (const row of tableData.slice(1)) {
            const cells = row.map(cell => ({
              text: cell || "",
              options: { fontSize: 9, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const },
            }));
            while (cells.length < colCount) {
              cells.push({ text: "", options: { fontSize: 9, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const } });
            }
            tableRows.push(cells);
          }
          const tableHeight = Math.min(tableRows.length * 0.3, 2.0);
          try {
            slide.addTable(tableRows, {
              x: 0.5, y: currentY, w: 9.0,
              border: { type: "solid", pt: 0.5, color: "D1D5DB" },
              fontFace: "Microsoft YaHei",
              autoPage: false,
            });
            currentY += tableHeight + 0.1;
          } catch (tableErr) {
            logger.warn(`[DocExporter] 表格渲染失败: ${tableErr}`);
          }
        }
      }
      if (hasCharts) {
        for (const chartSpec of section.chartSpecs!) {
          try {
            const chartData = chartSpec.series.map((s) => ({
              name: s.name,
              labels: chartSpec.categories,
              values: s.values,
            }));
            let chartType: any;
            switch (chartSpec.type) {
              case "bar": chartType = pptx.charts.BAR; break;
              case "column": chartType = pptx.charts.BAR; break;
              case "pie": chartType = pptx.charts.PIE; break;
              case "doughnut": chartType = pptx.charts.DOUGHNUT; break;
              case "line": chartType = pptx.charts.LINE; break;
              case "scatter": chartType = pptx.charts.SCATTER; break;
              default: chartType = pptx.charts.BAR;
            }
            renderChartOnSlide(slide, pptx, chartSpec, 0.5, currentY, 9.0, 2.5);
            currentY += 2.6;
          } catch (chartErr) {
            logger.warn(`[DocExporter] 图表渲染失败: ${chartErr}`);
          }
        }
      }
    }

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
/**
 * Tier 3 fallback: 多 Sheet 纯文本 Excel（SheetJS，不含图表但保留多 sheet+表格）
 * 每个 section 一个 sheet，引用来源追加到最后一个 sheet。
 */
export async function generateExcel(title: string, sections: ExportSection[], citations?: CitationItem[]): Promise<Buffer> {
  const wb = XLSX.utils.book_new();

  // ── 每个 section → 独立 sheet ──
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    // Sheet 名最多 31 字符（Excel 限制）
    const sheetName = s.title.slice(0, 31) || `Sheet ${i + 1}`;

    // 将 content 转为纯文本（content 可能是 HTML，需要去标签）
    let plainContent = s.content
      .replace(/\x01/g, "")  // 移除 SUB_MARKER 控制字符
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();

    // 按段落拆分，每段一行
    const paragraphs = plainContent.split("\n").filter((p) => p.trim());
    const rows: string[][] = paragraphs.map((p) => [p]);

    // 首行放标题
    rows.unshift([s.title]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // ── 引用来源追加到最后一个 sheet ──
  if (citations && citations.length > 0) {
    const refSheetName = "参考来源";
    const citeRows: string[][] = [["编号", "标题", "链接"]];
    for (const c of citations) {
      citeRows.push([`[${c.index}]`, c.title, c.url || ""]);
    }
    const citeWs = XLSX.utils.aoa_to_sheet(citeRows);
    citeWs["!cols"] = [
      { wch: 8 },
      { wch: 60 },
      { wch: 80 },
    ];
    XLSX.utils.book_append_sheet(wb, citeWs, refSheetName);
  }

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
    const paragraphs = s.content.replace(/\x01/g, "").split("\n").filter((p) => p.trim());
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

// ── PowerPoint 生成 v2 辅助函数 ─────────────────────────

function renderTableOnSlide(
  slide: any,
  tableData: string[][],
  x: number, y: number, w: number, h: number,
) {
  const colCount = Math.max(...tableData.map(r => r.length));
  const tableRows: Array<Array<{ text: string; options: Record<string, unknown> }>> = [];
  // header
  const hdrRow = tableData[0]!;
  const headerCells = hdrRow.map(cell => ({
    text: cell || "",
    options: { fontSize: 9, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const },
  }));
  while (headerCells.length < colCount) {
    headerCells.push({ text: "", options: { fontSize: 9, bold: true, color: "FFFFFF", fill: { color: "16213e" }, align: "center" as const, valign: "middle" as const } });
  }
  tableRows.push(headerCells);
  for (const row of tableData.slice(1)) {
    const cells = row.map(cell => ({
      text: cell || "",
      options: { fontSize: 8, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const },
    }));
    while (cells.length < colCount) {
      cells.push({ text: "", options: { fontSize: 8, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const } });
    }
    tableRows.push(cells);
  }
  slide.addTable(tableRows, {
    x, y, w,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    fontFace: "Microsoft YaHei",
    autoPage: false,
  });
}

function renderChartOnSlide(
  slide: any,
  pptx: any,
  chartSpec: ChartSpec,
  x: number, y: number, w: number, h: number,
) {
  // 数据校验：跳过无效数据
  if (!chartSpec.categories || chartSpec.categories.length === 0) {
    if (chartSpec.type === "scatter" && chartSpec.series.length > 0) {
      // scatter 无 categories → 尝试从嵌套 values 中提取
      const firstVal = chartSpec.series[0]!.values[0];
      if (!Array.isArray(firstVal)) {
        logger.warn('[DocExporter] 跳过无效 chart（无 categories）');
        return;
      }
    } else {
      logger.warn('[DocExporter] 跳过无效 chart（无 categories）');
      return;
    }
  }

  let chartData: Array<{ name: string; labels?: string[]; values: number[] }>;
  if (chartSpec.type === "scatter") {
    chartData = chartSpec.series.map((s) => {
      const vals: unknown[] = s.values as unknown[];
      if (vals.length > 0 && Array.isArray(vals[0])) {
        const xs = (vals as unknown[][]).map((v) => String(v[0] ?? ""));
        const ys = (vals as unknown[][]).map((v) => Number(v[1]) || 0);
        return { name: s.name, labels: xs, values: ys };
      }
      return { name: s.name, labels: chartSpec.categories, values: s.values };
    });
  } else {
    chartData = chartSpec.series.map((s) => ({
      name: s.name,
      labels: chartSpec.categories,
      values: s.values,
    }));
  }

  let chartType: any;
  let chartOpts: Record<string, unknown> = {};
  switch (chartSpec.type) {
    case "bar": chartType = pptx.charts.BAR; chartOpts = { barDir: "bar" }; break;
    case "column": chartType = pptx.charts.BAR; chartOpts = { barDir: "col" }; break;
    case "pie": chartType = pptx.charts.PIE; break;
    case "doughnut": chartType = pptx.charts.DOUGHNUT; break;
    case "line": chartType = pptx.charts.LINE; break;
    case "scatter": chartType = pptx.charts.SCATTER; break;
    default: chartType = pptx.charts.BAR; chartOpts = { barDir: "col" };
  }

  slide.addChart(chartType, chartData, {
    x, y, w, h,
    ...chartOpts,
    showTitle: true,
    title: chartSpec.title,
    titleFontFace: "Microsoft YaHei",
    titleFontSize: 10,
    catAxisLabelFontFace: "Microsoft YaHei",
    catAxisLabelFontSize: 7,
    valAxisLabelFontFace: "Microsoft YaHei",
    valAxisLabelFontSize: 7,
    showLegend: chartSpec.series.length > 1,
    legendFontFace: "Microsoft YaHei",
    legendFontSize: 7,
  });
}

// ── PowerPoint 生成 v2（基于 slideLayoutEngine）──────────

/**
 * 使用 slideLayoutEngine 动态计算布局的 PPT 生成。
 * 替代 generatePowerPoint() 中的硬编码坐标，根据内容自适应。
 */
export async function generatePowerPointFromLayout(
  title: string,
  sections: ExportSection[],
  citations?: CitationItem[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "DocStudio";
  pptx.title = title;

  // ── Title slide ──
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

  // ── Section slides ──
  for (const [idx, section] of sections.entries()) {
    // 如果没有 HTML 内容（旧格式 plain text），回退到 buildPptxTextRuns
    const hasHtml = /<[^>]+>/.test(section.content);

    if (hasHtml) {
      // ── 新路径：HTML → parseSectionHtml → computeSlideLayout ──
      const elements = parseSectionHtml(section.content, section.chartSpecs);
      const slideLayouts = computeSlideLayout(elements);

      for (const [li, layoutElements] of slideLayouts.entries()) {
        const slide = pptx.addSlide();

        // Slide title
        const displayTitle = li === 0
          ? section.title
          : `${section.title}（续）`;
        slide.addText(displayTitle, {
          x: 0.5, y: 0.3, w: "90%", h: 0.8,
          fontSize: 28, color: "1a1a2e", bold: true,
          fontFace: "Microsoft YaHei",
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.5, y: 1.1, w: 9.0, h: 0.05,
          fill: { color: "16213e" },
        });

        // 渲染每个 layout element
        for (const el of layoutElements) {
          try {
            switch (el.type) {
              case "heading": {
                slide.addText(el.text ?? "", {
                  x: el.x, y: el.y, w: el.w, h: el.h,
                  fontSize: 18, bold: true, color: "1a1a2e",
                  fontFace: "Microsoft YaHei",
                  valign: "top",
                });
                break;
              }
              case "paragraph": {
                const runs = buildPptxTextRuns(el.text ?? "");
                if (runs.length > 0) {
                  slide.addText(runs, {
                    x: el.x, y: el.y, w: el.w, h: el.h,
                    fontSize: 14, color: "333333",
                    fontFace: "Microsoft YaHei",
                    valign: "top",
                    lineSpacingMultiple: 1.2,
                  });
                }
                break;
              }
              case "list": {
                const bulletText = (el.items ?? [])
                  .map((item) => `• ${item}`)
                  .join("\n");
                slide.addText(bulletText, {
                  x: el.x, y: el.y, w: el.w, h: el.h,
                  fontSize: 14, color: "333333",
                  fontFace: "Microsoft YaHei",
                  valign: "top",
                  lineSpacingMultiple: 1.2,
                });
                break;
              }
              case "table": {
                // table+chart pair → side-by-side
                if (el.chartSpec && el.tableData && el.tableData.length > 0) {
                  // Pie/doughnut 需要接近正方形的空间 → 全宽渲染
                  const isPieLike = el.chartSpec.type === "pie" || el.chartSpec.type === "doughnut";
                  if (isPieLike) {
                    renderTableOnSlide(slide, el.tableData, el.x, el.y, el.w / 2 - 0.2, el.h);
                    renderChartOnSlide(slide, pptx, el.chartSpec, el.x + el.w / 2 + 0.1, el.y, el.w / 2 - 0.2, el.h);
                  } else {
                    const halfW = el.w / 2 - 0.1;
                    renderTableOnSlide(slide, el.tableData, el.x, el.y, halfW, el.h);
                    renderChartOnSlide(slide, pptx, el.chartSpec, el.x + halfW + 0.2, el.y, halfW, el.h);
                  }
                } else if (el.tableData && el.tableData.length > 0) {
                  renderTableOnSlide(slide, el.tableData, el.x, el.y, el.w, el.h);
                }
                break;
              }
              case "chart": {
                if (el.chartSpec) {
                  renderChartOnSlide(slide, pptx, el.chartSpec, el.x, el.y, el.w, el.h);
                }
                break;
              }
            }
          } catch (renderErr) {
            logger.warn(`[DocExporter] 元素渲染失败 (type=${el.type}): ${renderErr}`);
          }
        }

        // Page number - fixed bottom-right, doesn't overlap content
        slide.addText(`${idx + 1}`, {
          x: 8.5, y: 6.8, w: 1.0, h: 0.4,
          fontSize: 10, color: "AAAAAA", align: "right",
        });
      }
    } else {
      // ── 旧路径：plain text（回退） ──
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

      const textRuns = buildPptxTextRuns(section.content);
      if (textRuns.length > 0) {
        slide.addText(textRuns, {
          x: 0.5, y: 1.4, w: "90%", h: 4.5,
          fontFace: "Microsoft YaHei",
          valign: "top",
          lineSpacingMultiple: 1.5,
        });
      }

      slide.addText(`${idx + 1}`, {
        x: 9.0, y: 5.1, w: 0.5, h: 0.4,
        fontSize: 12, color: "999999", align: "right",
      });
    }
  }

  // ── Citations slide ──
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

// ── PPTX Python 生成 ──────────────────────────────────

function execFileAsync(
  cmd: string,
  args: string[],
  timeoutMs: number = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

// ── PPTX HTML 方案（Playwright + CSS Flexbox）──────────

export async function generatePowerPointFromHtml(
  title: string,
  sections: ExportSection[],
  citations?: CitationItem[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "DocStudio";
  pptx.title = title;

  // Title slide
  const ts = pptx.addSlide();
  ts.background = { color: "1a1a2e" };
  ts.addText(title, {
    x: 0.5, y: 2.0, w: "90%", h: 1.5, fontSize: 44, color: "FFFFFF", bold: true, align: "center",
    fontFace: "Microsoft YaHei",
  });
  ts.addText(new Date().toLocaleDateString("zh-CN"), {
    x: 0.5, y: 3.8, w: "90%", h: 0.5, fontSize: 18, color: "CCCCCC", align: "center",
    fontFace: "Microsoft YaHei",
  });

  for (const section of sections) {
    const html = buildSlideHtml(section);
    const chartSpecs = section.chartSpecs || [];

    // 渲染 HTML → 提取坐标
    const { page, context } = await newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const elements = await extractSlideElements(page);
    await context.close();

    const slide = pptx.addSlide();

    // 按 y 坐标排序渲染（从上到下）
    elements.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const el of elements) {
      try {
        if (el.type === "text") {
          // 颜色转换：rgb(r,g,b) → hex, 去掉 #
          let colorHex = (el.color || "#333333").replace("#", "");
          const rgbMatch = colorHex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (rgbMatch) {
            colorHex = [parseInt(rgbMatch[1]!), parseInt(rgbMatch[2]!), parseInt(rgbMatch[3]!)]
              .map(v => v.toString(16).padStart(2, "0").toUpperCase()).join("");
          }
          slide.addText(el.text || "", {
            x: el.x, y: el.y, w: el.w, h: el.h,
            fontSize: Math.round(el.fontSize || 14),
            bold: el.bold,
            color: colorHex,
            fontFace: "Microsoft YaHei",
            valign: "top",
            lineSpacingMultiple: 1.1,
          });
        } else if (el.type === "table" && el.tableData) {
          const colCount = Math.max(...el.tableData.map(r => r.length));
          const rows = el.tableData.map((row, ri) =>
            row.map(cell => ({
              text: cell || "",
              options: ri === 0
                ? { fontSize: 9, bold: true, color: "FFFFFF", fill: { color: "16213E" }, align: "center" as const, valign: "middle" as const }
                : { fontSize: 8, color: "333333", fill: { color: "F8F9FA" }, valign: "middle" as const },
            }))
          );
          slide.addTable(rows, {
            x: el.x, y: el.y, w: el.w,
            border: { type: "solid", pt: 0.5, color: "D1D5DB" },
            fontFace: "Microsoft YaHei", autoPage: false,
          });
        } else if (el.type === "chart" && el.chartIndex !== undefined) {
          const chartSpec = chartSpecs[el.chartIndex];
          if (chartSpec) {
            renderChartOnSlide(slide, pptx, chartSpec, el.x, el.y, el.w, el.h);
          }
        }
      } catch (renderErr) {
        logger.warn(`[DocExporter] HTML 方案渲染失败 (${el.type}): ${renderErr}`);
      }
    }
  }

  // Citations slide
  if (citations && citations.length > 0) {
    const cs = pptx.addSlide();
    cs.addText("参考来源", { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 28, color: "1a1a2e", bold: true, fontFace: "Microsoft YaHei" });
    cs.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.1, w: 9.0, h: 0.05, fill: { color: "16213E" } });
    cs.addText(citations.map(c => `[${c.index}] ${c.title}${c.url ? " " + c.url : ""}`).join("\n"), {
      x: 0.5, y: 1.4, w: "90%", h: 4.5, fontSize: 14, color: "333333", fontFace: "Microsoft YaHei", valign: "top", lineSpacingMultiple: 1.5,
    });
  }

  const buf = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
  return Buffer.from(buf);
}

// ── PPTX Python 回退 ──────────────────────────────────

/** 用 python-pptx 生成 PPTX（替代 pptxgenjs 的 COLUMN chart bug） */
async function generatePPTXWithPython(
  title: string,
  sections: ExportSection[],
  citations?: CitationItem[],
): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iwrite-pptx-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "output.pptx");
  const scriptPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..", "scripts", "pptx_generator.py",
  );

  try {
    // Write input JSON
    const input = {
      title,
      sections: sections.map(s => ({
        title: s.title,
        content: s.content,
        tables: s.tables,
        chartSpecs: s.chartSpecs,
      })),
      citations: citations || [],
    };
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2), "utf-8");

    await execFileAsync("python3", [scriptPath, inputPath, outputPath], 120_000);

    if (!fs.existsSync(outputPath)) {
      throw new Error("Python 脚本执行完成但未生成 output.pptx");
    }

    const buffer = fs.readFileSync(outputPath);
    logger.info(`[DocExporter] Python PPTX 生成成功: ${(buffer.length / 1024).toFixed(1)} KB`);
    return buffer;
  } finally {
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
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
    case "pptx": {
      // 三层回退：HTML → layout engine → legacy
      try {
        const buffer = await generatePowerPointFromHtml(title, sections, citations);
        return { buffer, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" };
      } catch (err1) {
        logger.warn(`[DocExporter] HTML 方案失败，回退 layout engine: ${err1}`);
        try {
          const buffer = await generatePowerPointFromLayout(title, sections, citations);
          return { buffer, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" };
        } catch (err2) {
          logger.warn(`[DocExporter] Layout engine 也失败，回退 legacy: ${err2}`);
          return { buffer: await generatePowerPoint(title, sections, citations), contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" };
        }
      }
    }
    case "xlsx": {
      // ── 三层自适应分流 ──
      // Tier 1: LLM Python 脚本 → python3 执行
      // Tier 2: Chart spec → 模板化 Python 脚本 → python3 执行
      // Tier 3: 纯文本多 Sheet（SheetJS fallback）
      const { generateXlsxWithCharts } = await import("./xlsxWriterGenerator.js");
      const result = await generateXlsxWithCharts(title, sections, citations);
      logger.info(`[DocExporter] xlsx 生成完成: Tier ${result.tier}, ${(result.buffer.length / 1024).toFixed(1)} KB`);
      return {
        buffer: result.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: ".xlsx",
      };
    }
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