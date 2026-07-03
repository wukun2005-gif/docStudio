/**
 * Slide Element Extractor — 从 Playwright 渲染的页面提取元素位置和样式。
 *
 * page.evaluate 代码以字符串形式传递，避免服务器 tsconfig 需要 DOM lib。
 */

import type { Page } from "playwright";

export interface ExtractedElement {
  type: "text" | "table" | "chart";
  x: number; y: number; w: number; h: number;
  text?: string; bold?: boolean; fontSize?: number; color?: string;
  tableData?: string[][];
  chartIndex?: number;
}

const SLIDE_W_INCH = 13.333;
const VIEWPORT_W = 960;

function pxToInches(px: number): number {
  return (px / VIEWPORT_W) * SLIDE_W_INCH;
}

// evaluate 代码以独立 .js 字符串执行，避免 TS 检查 DOM API
const EXTRACT_TEXT = `(() => {
  const r = [];
  const c = document.querySelector(".slide");
  if (!c) return r;
  (function walk(el) {
    const t = el.tagName ? el.tagName.toLowerCase() : "";
    if (t === "h2" || t === "h3" || t === "p") {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const txt = (el.textContent || "").trim();
      if (txt && b.width > 0 && b.height > 0) {
        r.push({ tag:t, text:txt, x:b.left, y:b.top, w:b.width, h:b.height, bold:s.fontWeight==="bold"||parseInt(s.fontWeight)>=600, fontSize:parseFloat(s.fontSize), color:s.color||"#333" });
      }
    }
    for (const ch of el.children || []) walk(ch);
  })(c);
  return r;
})()`;

const EXTRACT_TABLES = `(() => {
  const r = [];
  document.querySelectorAll(".ip-table table").forEach(tbl => {
    const b = tbl.getBoundingClientRect();
    const rows = [];
    tbl.querySelectorAll("tr").forEach(tr => {
      const row = [];
      tr.querySelectorAll("th,td").forEach(cell => row.push((cell.textContent||"").trim()));
      if (row.length) rows.push(row);
    });
    if (rows.length) r.push({ x:b.left, y:b.top, w:b.width, h:b.height, rows });
  });
  return r;
})()`;

const EXTRACT_CHARTS = `(() => {
  const r = [];
  document.querySelectorAll("[data-chart]").forEach(el => {
    const b = el.getBoundingClientRect();
    r.push({ x:b.left, y:b.top, w:b.width, h:b.height, idx:parseInt(el.getAttribute("data-chart")||"0") });
  });
  return r;
})()`;

export async function extractSlideElements(page: Page): Promise<ExtractedElement[]> {
  const elements: ExtractedElement[] = [];

  const textResults: any[] = await page.evaluate(EXTRACT_TEXT);
  for (const t of textResults) {
    elements.push({ type: "text", x: pxToInches(t.x), y: pxToInches(t.y), w: pxToInches(t.w), h: pxToInches(t.h), text: t.text, bold: t.bold, fontSize: t.fontSize, color: t.color });
  }

  const tableResults: any[] = await page.evaluate(EXTRACT_TABLES);
  for (const t of tableResults) {
    elements.push({ type: "table", x: pxToInches(t.x), y: pxToInches(t.y), w: pxToInches(t.w), h: pxToInches(t.h), tableData: t.rows });
  }

  const chartResults: any[] = await page.evaluate(EXTRACT_CHARTS);
  for (const c of chartResults) {
    elements.push({ type: "chart", x: pxToInches(c.x), y: pxToInches(c.y), w: pxToInches(c.w), h: pxToInches(c.h), chartIndex: c.idx });
  }

  return elements;
}
