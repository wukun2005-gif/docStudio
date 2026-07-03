/**
 * Slide Layout Engine — 从 HTML 解析元素，根据内容动态计算 slide 布局
 *
 * 替代 generatePowerPoint() 中的硬编码坐标。
 * 用 cheerio 解析 HTML 结构，根据内容度量估算元素高度，按流式布局计算 x/y/w/h。
 */

import * as cheerio from "cheerio";
import type { ChartSpec } from "./docExporter.js";

// ── 类型定义 ────────────────────────────────────────────

export type SlideElementType = "heading" | "paragraph" | "list" | "table" | "chart";

export interface SlideElement {
  type: SlideElementType;
  /** 纯文本内容（用于 text-based 元素） */
  text?: string;
  /** list items */
  items?: string[];
  /** table 数据：二维数组，第一行为表头 */
  tableData?: string[][];
  /** chart spec */
  chartSpec?: ChartSpec;
}

export interface LayoutElement extends SlideElement {
  x: number; // inches
  y: number;
  w: number;
  h: number;
}

export interface SlideOptions {
  slideWidth: number;
  slideHeight: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  contentWidth: number;
}

// ── 默认选项（LAYOUT_WIDE: 13.333" x 7.5"）──────────────

const DEFAULT_OPTIONS: SlideOptions = {
  slideWidth: 13.333,
  slideHeight: 7.5,
  marginX: 0.5,
  marginTop: 1.2,   // 留出 title + separator 空间
  marginBottom: 0.4, // page number 空间
  contentWidth: 13.333 - 2 * 0.5,
};

// ── 高度估算常量 ─────────────────────────────────────────

const CHARS_PER_LINE_H3 = 55;
const CHARS_PER_LINE_P = 75;
const LINE_HEIGHT_H3 = 0.30;
const LINE_HEIGHT_P = 0.24;
const LINE_HEIGHT_LI = 0.24;
const TABLE_ROW_HEIGHT = 0.22;
const CHART_HEIGHT_DEFAULT = 1.5;
const ELEMENT_GAP = 0.10;

// ── parseSectionHtml ────────────────────────────────────

/**
 * 从 section HTML 中解析出 SlideElement 列表。
 * section HTML 格式: <h2>title</h2><p>...</p><h3>...</h3><table>...</table>...
 *
 * 后处理：将相邻的 table+chart 配对为 table-chart-row，实现 side-by-side 布局。
 */
export function parseSectionHtml(
  html: string,
  chartSpecs?: ChartSpec[],
): SlideElement[] {
  const elements: SlideElement[] = [];
  const $ = cheerio.load(html, { xml: { decodeEntities: false } });

  // 移除 script 标签（chart-spec, xlsx-script）和 SVG 图表容器
  $("script").remove();
  $("div.charts").remove();
  $("svg").remove();

  // 提取 chart specs 引用
  const remainingSpecs = chartSpecs ? [...chartSpecs] : [];

  // 遍历子节点。HTML 片段（如 "<p>...</p><table>...</table>"）在 cheerio 加载后，
  // 其子元素位于 root document 的 children 中（cheerio 不自动包裹 body）。
  const children = ($ as any).root().children().toArray();

  for (const child of children) {
    const el = $(child);
    const tag = (child.tagName || "").toLowerCase();

    if (tag === "h3") {
      const text = el.text().trim();
      if (text) elements.push({ type: "heading", text });
    } else if (tag === "p") {
      const text = el.text().trim();
      if (text) elements.push({ type: "paragraph", text });
    } else if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      el.find("li").each((_i, li) => {
        const itemText = $(li).text().trim();
        if (itemText) items.push(itemText);
      });
      if (items.length > 0) elements.push({ type: "list", items });
    } else if (tag === "table") {
      const tableData: string[][] = [];
      el.find("tr").each((_i, tr) => {
        const row: string[] = [];
        $(tr).find("th,td").each((_j, cell) => {
          row.push($(cell).text().trim());
        });
        if (row.length > 0) tableData.push(row);
      });
      if (tableData.length > 0) elements.push({ type: "table", tableData });
    } else {
      const text = el.text().trim();
      if (text) elements.push({ type: "paragraph", text });
    }
  }

  // 将 chart specs 追加为 chart 元素
  for (const spec of remainingSpecs) {
    elements.push({ type: "chart", chartSpec: spec });
  }

  // ── 后处理：配对 table + chart → side-by-side row ──
  return pairTablesAndCharts(elements);
}

/**
 * 将 element 列表中相邻的 table+chart 配成 table-chart-row。
 * 从列表末尾向前扫描：每个 chart 与最近的未被配对的 table 组成一对。
 */
function pairTablesAndCharts(elements: SlideElement[]): SlideElement[] {
  const result: SlideElement[] = [];
  // 收集所有 table 和 chart 的索引
  const tableIndices: number[] = [];
  const chartIndices: number[] = [];

  for (let i = 0; i < elements.length; i++) {
    if (elements[i]!.type === "table") tableIndices.push(i);
    if (elements[i]!.type === "chart") chartIndices.push(i);
  }

  // 从后向前配对：最后一个 chart 配最后一个 table
  const pairedTables = new Set<number>();
  const pairedCharts = new Set<number>();
  const pairs: Array<{ tableIdx: number; chartIdx: number }> = [];

  let ti = tableIndices.length - 1;
  let ci = chartIndices.length - 1;
  while (ti >= 0 && ci >= 0) {
    pairs.push({ tableIdx: tableIndices[ti]!, chartIdx: chartIndices[ci]! });
    pairedTables.add(tableIndices[ti]!);
    pairedCharts.add(chartIndices[ci]!);
    ti--;
    ci--;
  }

  // 重建列表：配对的 table+chart → table-chart-row，未配对的保持原样
  for (let i = 0; i < elements.length; i++) {
    if (pairedTables.has(i)) {
      const pair = pairs.find(p => p.tableIdx === i);
      if (pair) {
        const tableEl = elements[pair.tableIdx]!;
        const chartEl = elements[pair.chartIdx]!;
        result.push({
          type: "table",
          tableData: tableEl.tableData,
          chartSpec: chartEl.chartSpec,
        });
        // 跳过对应的 chart（已合并）
        continue;
      }
    }
    if (pairedCharts.has(i)) continue; // 已在 pair 中处理
    result.push(elements[i]!);
  }

  return result;
}

// ── 高度估算 ─────────────────────────────────────────────

function estimateHeight(el: SlideElement): number {
  switch (el.type) {
    case "heading": {
      const chars = el.text?.length ?? 0;
      return Math.max(0.4, Math.ceil(chars / CHARS_PER_LINE_H3) * LINE_HEIGHT_H3);
    }
    case "paragraph": {
      const chars = el.text?.length ?? 0;
      return Math.max(0.3, Math.ceil(chars / CHARS_PER_LINE_P) * LINE_HEIGHT_P);
    }
    case "list": {
      const count = el.items?.length ?? 0;
      return count * LINE_HEIGHT_LI;
    }
    case "table": {
      const rows = el.tableData?.length ?? 0;
      const tableH = Math.max(0.5, rows * TABLE_ROW_HEIGHT);
      // 如果有关联 chart，高度取 table 和 chart 的较大值
      if (el.chartSpec) {
        return Math.max(tableH, CHART_HEIGHT_DEFAULT);
      }
      return tableH;
    }
    case "chart":
      return CHART_HEIGHT_DEFAULT;
    default:
      return 0.5;
  }
}

// ── computeSlideLayout ──────────────────────────────────

/** 最小 chart 高度（inch），避免缩放后完全不可读 */
const MIN_CHART_H = 1.1;
/** 最小 table 行高 */
const MIN_TABLE_ROW_H = 0.14;

/**
 * 将 SlideElement 列表按流式布局排列。
 * 先估算总高度，若超出 slide 可用空间，按比例压缩所有元素高度。
 * 仅当压缩到最小阈值后仍溢出时才分页。
 */
export function computeSlideLayout(
  elements: SlideElement[],
  options: Partial<SlideOptions> = {},
): LayoutElement[][] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usableHeight = opts.slideHeight - opts.marginTop - opts.marginBottom;

  // ── 第一轮：估算原始高度 ──
  const rawHeights = elements.map(el => estimateHeight(el));
  const totalRawHeight = rawHeights.reduce((s, h) => s + h + ELEMENT_GAP, 0);

  // ── 计算缩放比例 ──
  let scale = 1.0;
  if (totalRawHeight > usableHeight) {
    // 先尝试只压缩 chart
    const nonChartTotal = elements.reduce((sum, el, i) => {
      if (el.type !== "chart") return sum + rawHeights[i]! + ELEMENT_GAP;
      return sum + ELEMENT_GAP;
    }, 0);
    const chartCount = elements.filter(el => el.type === "chart").length;
    const remainingForCharts = usableHeight - nonChartTotal;

    if (remainingForCharts >= chartCount * MIN_CHART_H) {
      // charts 可以压缩到可用空间
      // 不需要全局缩放，给每个 chart 均分剩余空间
    } else {
      // charts 压缩到最小还不够 → 全局等比缩放
      scale = usableHeight / totalRawHeight;
    }
  }

  // ── 第二轮：应用缩放，放置元素 ──
  const slides: LayoutElement[][] = [];
  let currentSlide: LayoutElement[] = [];
  let currentY = opts.marginTop;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    let h = rawHeights[i]!;

    // 应用缩放
    if (scale < 1.0) {
      if (el.type === "chart") {
        h = Math.max(MIN_CHART_H, h * scale);
      } else if (el.type === "table") {
        const rows = el.tableData?.length ?? 1;
        const tableMin = rows * MIN_TABLE_ROW_H;
        // 如果表格关联了 chart（paired row），chart 需要足够高度
        const minH = el.chartSpec ? Math.max(tableMin, MIN_CHART_H) : tableMin;
        h = Math.max(minH, h * scale);
      } else {
        h = h * scale;
      }
    } else if (el.type === "chart" && totalRawHeight > usableHeight) {
      // 仅压缩 chart：均分剩余空间
      const chartCount = elements.filter(e => e.type === "chart").length;
      const nonChartH = elements.reduce((sum, e, j) => {
        if (e.type !== "chart") return sum + rawHeights[j]! + ELEMENT_GAP;
        return sum + ELEMENT_GAP;
      }, 0);
      const chartSpace = Math.max(MIN_CHART_H, (usableHeight - nonChartH) / Math.max(chartCount, 1));
      h = chartSpace;
    }

    // 溢出 → 分页（容忍 0.35" 微小溢出，避免因舍入误差导致分页）
    const overflowBy = (currentY + h) - (opts.marginTop + usableHeight);
    if (overflowBy > 0.35) {
      if (currentSlide.length > 0) {
        slides.push(currentSlide);
      }
      currentSlide = [];
      currentY = opts.marginTop;
    }

    currentSlide.push({ ...el, x: opts.marginX, y: currentY, w: opts.contentWidth, h });
    currentY += h + ELEMENT_GAP;
  }

  if (currentSlide.length > 0) {
    slides.push(currentSlide);
  }
  if (slides.length === 0) {
    slides.push([]);
  }

  return slides;
}

// ── 辅助：从数据库 HTML 解析所有 section ──────────────────

export interface ParsedSection {
  title: string;
  html: string;
  chartSpecs?: ChartSpec[];
  tables?: string[][][];
}

/**
 * 从 docStudio 的完整 HTML 输出中解析 section。
 * 与 generation.ts 的 parseHtmlSections 类似，但保留原始 HTML。
 */
export function parseSectionsFromFullHtml(html: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(html)) !== null) {
    const title = match[1]!.replace(/<[^>]+>/g, "").trim();
    let innerHtml = match[2]!;

    // 提取 chart-spec 脚本
    const chartSpecs: ChartSpec[] = [];
    const chartRegex = /<script\s+type="application\/json"\s+class="chart-spec">([\s\S]*?)<\/script>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = chartRegex.exec(innerHtml)) !== null) {
      try {
        const raw = cm[1]!.trim();
        const rawSpecs: string[] = JSON.parse(raw);
        for (const s of rawSpecs) {
          try {
            const obj = JSON.parse(s);
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
              if (item && item.type && item.categories && item.series) {
                chartSpecs.push(item as ChartSpec);
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    innerHtml = innerHtml.replace(chartRegex, "");

    // 移除 SVG 图表 div
    innerHtml = innerHtml.replace(/<div class="charts">[\s\S]*?<\/div>/gi, "");

    // 移除 xlsx-script
    innerHtml = innerHtml.replace(/<script\s+type="application\/x-python"[\s\S]*?<\/script>/gi, "");

    sections.push({
      title,
      html: innerHtml.trim(),
      chartSpecs: chartSpecs.length > 0 ? chartSpecs : undefined,
    });
  }

  return sections;
}
