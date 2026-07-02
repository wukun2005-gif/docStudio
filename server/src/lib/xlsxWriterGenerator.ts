/**
 * XlsxWriter Generator — 三层自适应 Excel 生成
 *
 * Tier 1: Code Interpreter — LLM 写的 xlsxwriter Python 脚本 → python3 执行 → 原生 .xlsx
 * Tier 2: Template Assembly  — JSON chart spec → 模板拼装 Python 脚本 → python3 执行
 * Tier 3: 多 Sheet 纯文本       — SheetJS 纯文本（generateExcel fallback）
 *
 * 自动检测 python3 + xlsxwriter 可用性，按编译结果分流，不依赖 model ID 猜测。
 * 单用户本地 App，不沙箱。
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./logger.js";
import { extractChartDataFromText } from "./chartDataExtractor.js";
import type { ExportSection, ChartSpec } from "./docExporter.js";

// ═══════════════════════════════════════════════════════════
// Python 可用性检测
// ═══════════════════════════════════════════════════════════

let _pythonAvailable: boolean | null = null;
let _xlsxWriterAvailable: boolean | null = null;

async function execFileAsync(file: string, args: string[], timeoutMs = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

/** 检测 python3 是否可用（缓存结果） */
export async function isPythonAvailable(): Promise<boolean> {
  if (_pythonAvailable !== null) return _pythonAvailable;
  try {
    await execFileAsync("python3", ["--version"], 5000);
    _pythonAvailable = true;
  } catch {
    _pythonAvailable = false;
    logger.warn("[XlsxWriterGen] python3 不可用，降级到 Tier 3（纯文本 Excel）");
  }
  return _pythonAvailable;
}

/** 检测 xlsxwriter 是否已安装（缓存结果） */
export async function isXlsxWriterAvailable(): Promise<boolean> {
  if (_xlsxWriterAvailable !== null) return _xlsxWriterAvailable;
  try {
    await execFileAsync("python3", ["-c", "import xlsxwriter"], 5000);
    _xlsxWriterAvailable = true;
  } catch {
    _xlsxWriterAvailable = false;
    logger.warn("[XlsxWriterGen] xlsxwriter 未安装，降级到 Tier 3（纯文本 Excel）。安装: pip3 install xlsxwriter");
  }
  return _xlsxWriterAvailable;
}

/** 重置缓存（用于测试） */
export function resetPythonDetectionCache(): void {
  _pythonAvailable = null;
  _xlsxWriterAvailable = null;
}

// ═══════════════════════════════════════════════════════════
// Tier 1: Python 脚本编译验证（不执行）
// ═══════════════════════════════════════════════════════════

/** 编译检查 Python 脚本语法，不执行。通过 → Tier 1，失败 → Tier 2 */
export async function validatePythonScript(script: string): Promise<boolean> {
  if (!script || script.trim().length < 20) return false;

  // 必须 import xlsxwriter
  if (!/import\s+xlsxwriter/.test(script)) return false;

  try {
    await execFileAsync("python3", ["-c", `compile(${JSON.stringify(script)}, 'gen.py', 'exec')`], 5000);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// Tier 1: 执行 LLM 生成的 Python 脚本
// ═══════════════════════════════════════════════════════════

/** 执行 Python xlsxwriter 脚本，产出 .xlsx Buffer */
export async function executePythonScript(script: string, timeoutMs = 120_000): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iwrite-xlsx-"));
  const scriptPath = path.join(tmpDir, "gen.py");
  const outputPath = path.join(tmpDir, "output.xlsx");

  try {
    fs.writeFileSync(scriptPath, script, "utf-8");

    await execFileAsync("python3", [scriptPath, outputPath], timeoutMs);

    if (!fs.existsSync(outputPath)) {
      throw new Error("Python 脚本执行完成但未生成 output.xlsx");
    }

    const buffer = fs.readFileSync(outputPath);
    if (buffer.length < 1024) {
      throw new Error(`生成的 xlsx 文件过小: ${buffer.length} bytes`);
    }

    logger.info(`[XlsxWriterGen] Tier 1 成功: Python 脚本生成 ${(buffer.length / 1024).toFixed(1)} KB xlsx`);
    return buffer;
  } finally {
    // 清理临时文件
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Tier 2: 模板化生成（从 chart spec 拼装 Python 脚本）
// ═══════════════════════════════════════════════════════════

/**
 * 根据 chart specs 和 sections 生成 xlsxwriter Python 脚本，执行后返回 .xlsx Buffer。
 * 照搬 Code Interpreter Pattern：app 用模板生成 Python 脚本，python3 执行。
 */
export async function generateXlsxFromTemplate(
  title: string,
  sections: ExportSection[],
  chartSpecs: ChartSpec[],
  citations?: Array<{ index: number; title: string; url?: string }>,
  timeoutMs = 60_000,
): Promise<Buffer> {
  const script = buildTemplateScript(title, sections, chartSpecs, citations);
  logger.info(`[XlsxWriterGen] Tier 2: 模板脚本 ${script.length} 字符, ${chartSpecs.length} 图表`);
  return executePythonScript(script, timeoutMs);
}

/** 构建模板化 Python 脚本 */
function buildTemplateScript(
  title: string,
  sections: ExportSection[],
  _chartSpecs: ChartSpec[],
  citations?: Array<{ index: number; title: string; url?: string }>,
): string {
  let script = `#!/usr/bin/env python3
"""Auto-generated xlsxwriter script — Tier 2 Template Assembly"""
import sys, xlsxwriter

wb = xlsxwriter.Workbook(sys.argv[1])
# ── 全局格式 ──
hdr_fmt = wb.add_format({"bold": True, "bg_color": "#2563EB", "font_color": "#FFFFFF", "border": 1, "text_wrap": True})
cell_fmt = wb.add_format({"border": 1, "text_wrap": True, "valign": "top"})
title_fmt = wb.add_format({"bold": True, "font_size": 14})
note_fmt = wb.add_format({"italic": True, "font_color": "#6B7280", "text_wrap": True})
num_fmt = wb.add_format({"border": 1, "align": "center"})

`;

  // ── 每个 section → 独立 sheet ──
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si]!;
    const sheetName = sanitizeSheetName(s.title);
    const safeTitle = pythonStr(s.title);
    // 使用 section 自带的 chartSpecs（per-section 关联，不依赖标题匹配）
    const charts = s.chartSpecs ?? [];

    // 计算最大列宽（用于标题 merge）
    const maxCols = Math.max(
      ...s.content.split("\n")
        .map((l) => l.split("|").filter(Boolean).length)
        .concat([1]),
      1,
    );

    script += `# ═══ Sheet ${si + 1}: ${safeTitle} ═══
ws${si} = wb.add_worksheet("${sheetName}")
ws${si}.set_column(0, ${Math.max(0, maxCols - 1)}, 20)

row = 0
# 章节标题（跨多列合并）
ws${si}.merge_range(row, 0, row, ${maxCols - 1}, ${safeTitle}, title_fmt)
row += 2

`;

    // ── 预处理：HTML → 纯文本（section content 经过 cleanContent 已转为 HTML）──
    // 策略：先移除 Python 代码块 → 提取 HTML 表格行 → 去标签
    let plainTextContent = s.content;
    // 解码常见 HTML 实体
    plainTextContent = plainTextContent
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'");

    // Defense-in-depth: 移除可能残留的 Python 代码块和 chart JSON 块
    // 注意：不能假设 HTML 结构规范（如 </code> 和 </pre> 之间可能有残片），
    // 因此用 <pre>...</pre> 级别匹配，不要求 <code> 标签配对。
    // 正常情况下 Bug 1 修复后不会残留，此处作为安全网。
    plainTextContent = plainTextContent
      // 完整的 <pre>...</pre> 块（含 xlsxwriter Python 代码）
      .replace(/<pre[^>]*>[\s\S]*?xlsxwriter[\s\S]*?<\/pre>/gi, "")
      // 孤立的 <code>...</code> 块（含 xlsxwriter）
      .replace(/<code[^>]*>[\s\S]*?xlsxwriter[\s\S]*?<\/code>/gi, "")
      // 残留的 chart JSON 块（<pre> 包裹的 JSON）
      .replace(/<pre[^>]*>\s*\[[\s\S]*?"type"\s*:[\s\S]*?\]\s*<\/pre>/gi, "")
      // markdown 代码块（如果 HTML 转换失败，原始 markdown 可能残留）
      .replace(/```python[\s\S]*?```/gi, "");

    // 提取 HTML 表格行（<tr> → 用 | 重新分隔，保留表格结构供下游解析）
    const trRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const trMatches = plainTextContent.match(trRegex);
    if (trMatches) {
      const tableRows = trMatches
        .map((tr) => {
          const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
          return cells ? cells.map((c) => c.replace(/<[^>]+>/g, "").trim()).join(" | ") : "";
        })
        .filter((r) => r.trim());
      // 用提取的表格行替换原 HTML 表格区域
      plainTextContent = plainTextContent.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "\n" + tableRows.join("\n") + "\n");
    }

    // 去掉剩余的 HTML 标签
    plainTextContent = plainTextContent.replace(/<[^>]+>/g, "");
    // 清理多余空白
    plainTextContent = plainTextContent.replace(/\n{3,}/g, "\n\n").trim();

    // 解析段落：检测表格行（| 分隔或 2+ 空格分隔 → 表格；其他 → 说明文字）
    const paragraphs = plainTextContent.split("\n").filter((p) => p.trim());
    for (const para of paragraphs) {
      const trimmed = para.trim();
      // 跳过 markdown 表格分隔行（如 |----|:---:|---:|）
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;

      // 尝试解析为表格行（含 | 分隔符的至少 2 列数据）
      const pipeCols = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
      if (pipeCols.length >= 2) {
        // Markdown table row
        script += `ws${si}.write_row(row, 0, [${pipeCols.map((c) => pythonStr(c)).join(", ")}], cell_fmt)\nrow += 1\n`;
        continue;
      }

      const tabCols = trimmed.split(/\t|\s{2,}/).filter(Boolean);
      if (tabCols.length >= 2 && /[\d%]/.test(trimmed)) {
        script += `ws${si}.write_row(row, 0, [${tabCols.map((c) => pythonStr(c)).join(", ")}], cell_fmt)\nrow += 1\n`;
        continue;
      }

      // 普通说明文字 — 用 write 而非 merge_range（merge_range 单格是 no-op）
      if (trimmed) {
        script += `ws${si}.write(row, 0, ${pythonStr(trimmed)}, note_fmt)\nrow += 1\n`;
      }
    }

    // 图表
    for (let ci = 0; ci < charts.length; ci++) {
      const chart = charts[ci]!;
      if (chart.categories.length > 0 && chart.series.length > 0) {
        script += buildChartCode(si, ci, chart, sheetName);
      }
    }

    script += "\n";
  }

  // ── 引用来源 sheet ──
  if (citations && citations.length > 0) {
    script += `# ═══ 参考来源 ═══
ref_ws = wb.add_worksheet("参考来源")
ref_ws.set_column(0, 0, 8)
ref_ws.set_column(1, 1, 60)
ref_ws.set_column(2, 2, 80)
ref_ws.write(0, 0, "编号", hdr_fmt)
ref_ws.write(0, 1, "标题", hdr_fmt)
ref_ws.write(0, 2, "链接", hdr_fmt)
`;
    for (let ci = 0; ci < citations.length; ci++) {
      const c = citations[ci]!;
      script += `ref_ws.write(${ci + 1}, 0, "[${c.index}]", cell_fmt)\n`;
      script += `ref_ws.write(${ci + 1}, 1, ${pythonStr(c.title)}, cell_fmt)\n`;
      script += `ref_ws.write(${ci + 1}, 2, ${pythonStr(c.url || "")}, cell_fmt)\n`;
    }
  }

  script += "\nwb.close()\n";
  return script;
}

/** 构建单个图表的 xlsxwriter Python 代码 */
function buildChartCode(sheetIdx: number, chartIdx: number, chart: ChartSpec, sheetName: string): string {
  const chartVar = `chart_${sheetIdx}_${chartIdx}`;
  const chartTitle = pythonStr(chart.title);
  const categories = `[${chart.categories.map((c) => pythonStr(c)).join(", ")}]`;
  const seriesData = chart.series
    .map((ser, si) => `    ("${ser.name.replace(/"/g, '\\"')}", [${ser.values.join(", ")}]),`)
    .join("\n");

  // 确定 chart type 对应的 xlsxwriter add_chart 和 add_series
  const typeMap: Record<string, { cls: string; add: string }> = {
    bar: { cls: "bar", add: "add_series" },
    column: { cls: "column", add: "add_series" },
    pie: { cls: "pie", add: "add_series" },
    doughnut: { cls: "doughnut", add: "add_series" },
    line: { cls: "line", add: "add_series" },
    scatter: { cls: "scatter", add: "add_series" },
  };
  const t = typeMap[chart.type] ?? typeMap["column"]!;
  const safeSheetName = pythonStr(sheetName);

  return `
# 图表: ${chartTitle}
# 将 chart data 写入 sheet（xlsxwriter 图表需要数据在 worksheet 中）
data_start_row = row + 1
ws${sheetIdx}.write_row(data_start_row, 0, ["类别"] + ${categories}, hdr_fmt)
${chart.series.map((ser, si) => `
series_data = [${pythonStr(ser.name)}] + [${ser.values.join(", ")}]
ws${sheetIdx}.write_row(data_start_row + ${si + 1}, 0, series_data, num_fmt)
`).join("")}

${chartVar} = wb.add_chart({"type": "${t.cls}"})
${chartVar}.set_title({"name": ${chartTitle}})
${chartVar}.set_x_axis({"name": "类别"})
${chart.series.map((_ser, si) => `
${chartVar}.add_series({
    "name": [${safeSheetName}, data_start_row + ${si + 1}, 0],
    "categories": [${safeSheetName}, data_start_row, 1, data_start_row, ${chart.categories.length}],
    "values": [${safeSheetName}, data_start_row + ${si + 1}, 1, data_start_row + ${si + 1}, ${chart.categories.length}],
})
`).join("")}
ws${sheetIdx}.insert_chart("A" + str(data_start_row + ${chart.series.length + 2}), ${chartVar})

row = data_start_row + ${chart.series.length + 20}  # chart 下方留足够空间
`;
}

// ═══════════════════════════════════════════════════════════
// Tier 2/3 分流入口
// ═══════════════════════════════════════════════════════════

export interface XlsxGenerationResult {
  buffer: Buffer;
  tier: 1 | 2 | 3;
}

/**
 * 主入口：按能力自动分流
 *
 * Tier 1: python3 + xlsxwriter 可用 + LLM 输出了有效 Python 脚本 → 直接执行
 * Tier 2: python3 + xlsxwriter 可用 + 有 chart specs → 模板生成
 * Tier 3: Python/xlsxwriter 不可用 或 无脚本无 chart → 纯文本多 sheet
 */
export async function generateXlsxWithCharts(
  title: string,
  sections: ExportSection[],
  citations?: Array<{ index: number; title: string; url?: string }>,
): Promise<XlsxGenerationResult> {
  // ── 检测 Python 环境 ──
  const pythonOk = await isPythonAvailable();
  const xlsxOk = pythonOk && await isXlsxWriterAvailable();

  if (!pythonOk || !xlsxOk) {
    logger.info("[XlsxWriterGen] Tier 3: Python/xlsxwriter 不可用，使用纯文本多 sheet");
    const buffer = await (await import("./docExporter.js")).generateExcel(title, sections, citations);
    return { buffer, tier: 3 };
  }

  // ── Tier 1: 尝试 LLM 生成的 Python 脚本 ──
  const pythonScripts = sections
    .map((s) => s.pythonScript)
    .filter((s): s is string => !!s && s.trim().length > 20);

  if (pythonScripts.length > 0) {
    // 合并所有 section 的脚本
    const fullScript = pythonScripts.join("\n\n# ═══ Next Section ═══\n\n");
    const isValid = await validatePythonScript(fullScript);

    if (isValid) {
      try {
        logger.info(`[XlsxWriterGen] Tier 1: 执行 LLM 生成的 Python 脚本 (${fullScript.length} chars)`);
        const buffer = await executePythonScript(fullScript, 120_000);
        return { buffer, tier: 1 };
      } catch (err) {
        logger.warn(`[XlsxWriterGen] Tier 1 失败: ${err}，降级到 Tier 2`);
      }
    } else {
      logger.info("[XlsxWriterGen] LLM Python 脚本编译失败，降级到 Tier 2");
    }
  }

  // ── Tier 2: 模板化生成 ──
  // 使用每个 section 自带的 chartSpecs（保留 per-section 关联）
  let allChartSpecs = sections.flatMap((s) => s.chartSpecs ?? []);

  // ── Tier 2 兜底：规则引擎从纯文本提取图表数据 ──
  // 将提取的 chart specs 直接赋值到对应 section，而非打平后靠标题匹配
  if (allChartSpecs.length === 0) {
    let totalExtracted = 0;
    for (const s of sections) {
      if (s.content && s.content.length > 50) {
        const specs = extractChartDataFromText(s.content, s.title);
        if (specs.length > 0) {
          s.chartSpecs = specs;
          totalExtracted += specs.length;
        }
      }
    }
    if (totalExtracted > 0) {
      allChartSpecs = sections.flatMap((s) => s.chartSpecs ?? []);
      logger.info(`[XlsxWriterGen] Tier 2 兜底: 规则引擎从文本提取 ${totalExtracted} 个 chart specs`);
    }
  }

  if (allChartSpecs.length > 0) {
    try {
      logger.info(`[XlsxWriterGen] Tier 2: 模板生成 ${sections.length} sheets + ${allChartSpecs.length} charts`);
      const buffer = await generateXlsxFromTemplate(title, sections, allChartSpecs, citations, 60_000);
      return { buffer, tier: 2 };
    } catch (err) {
      logger.warn(`[XlsxWriterGen] Tier 2 失败: ${err}，降级到 Tier 3`);
    }
  }

  // ── Tier 3: 纯文本多 sheet fallback ──
  logger.info("[XlsxWriterGen] Tier 3: 无脚本无 chart spec（规则引擎也未提取到数据），使用纯文本多 sheet");
  const buffer = await (await import("./docExporter.js")).generateExcel(title, sections, citations);
  return { buffer, tier: 3 };
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

/** 清理 sheet 名（Excel 限制：≤31 chars, 不能含 [ ] : * ? / \） */
function sanitizeSheetName(name: string): string {
  let cleaned = name.replace(/[\[\]:*?/\\]/g, "-").replace(/\s+/g, " ").trim();
  if (cleaned.length > 31) cleaned = cleaned.slice(0, 28) + "...";
  if (!cleaned) cleaned = "Sheet";
  return cleaned;
}

/** 转义 Python 字符串字面量 */
function pythonStr(s: string): string {
  // 使用 JSON.stringify 获得安全的转义，但需要处理 Python 兼容性
  return JSON.stringify(s);
}
