/**
 * Slide HTML Builder — 为每个 section 生成带 CSS Flexbox 布局的 HTML。
 * CSS 负责所有排版，Playwright 渲染后提取坐标 → pptxgenjs 绘制。
 */

import type { ExportSection } from "./docExporter.js";

export interface SlideHtmlPage {
  html: string;
  chartPlaceholders: Array<{ index: number; chartSpec: ExportSection["chartSpecs"] extends (infer T)[] | undefined ? T : never }>;
  tables: string[][][];
}

/**
 * 生成单个 slide 的 HTML。使用 CSS Flexbox 布局：
 * - 标题行
 * - info point 行（h3 + p + table+chart 并排）
 * 宽度 960px 对应 LAYOUT_WIDE (13.333") 等比缩小
 */
export function buildSlideHtml(section: ExportSection): string {
  const title = escapeHtml(section.title);
  const chartSpecs = section.chartSpecs || [];
  const tables = section.tables || [];

  // 解析 HTML 内容：提取 h3 和 p 元素
  const parts = parseContentHtml(section.content);

  // 按 info point 分组（每个 h3 开始一个新 info point）
  const groups = groupIntoInfoPoints(parts);

  // 分离独立段落（无 h3 的组开头）和 info points
  const standalonePs: string[] = [];
  const infoPoints: ContentPart[][] = [];
  for (const g of groups) {
    const hasH3 = g.some(p => p.tag === "h3");
    if (hasH3) {
      infoPoints.push(g);
    } else {
      for (const p of g) standalonePs.push(p.text);
    }
  }

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 960px; height: 540px; margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; overflow: hidden; }
.slide { height: 100%; display: flex; flex-direction: column; padding: 22px 30px 14px 30px; }
h2 { font-size: 22px; color: #1a1a2e; margin-bottom: 10px; flex-shrink: 0; }
.sep { width: 100%; height: 2px; background: #16213e; margin-bottom: 6px; flex-shrink: 0; }
.standalone { font-size: 9px; color: #333; line-height: 1.3; margin-bottom: 4px; flex-shrink: 0; }
.info-points { flex: 1; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
.info-point { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.ip-header h3 { font-size: 12px; color: #1a1a2e; margin-bottom: 1px; }
.ip-header p { font-size: 9px; color: #333; line-height: 1.3; margin-bottom: 2px; }
.ip-body { display: flex; gap: 8px; flex: 1; min-height: 0; }
.ip-table { flex: 1; min-width: 0; }
.ip-table table { width: 100%; border-collapse: collapse; font-size: 7px; }
.ip-table th { background: #16213e; color: #fff; padding: 2px 3px; text-align: center; }
.ip-table td { padding: 1px 3px; border: 0.5px solid #ddd; text-align: center; }
.ip-chart { flex: 1; min-width: 0; min-height: 40px; border: 1px dashed #ccc; background: #fafafa; display: flex; align-items: center; justify-content: center; color: #999; font-size: 9px; }
</style></head><body><div class="slide">
<h2>${title}</h2>
<div class="sep"></div>`;

  // 独立段落（如"各位领导，你好："）放在 flex 容器外
  for (const p of standalonePs) {
    html += `<div class="standalone"><p>${escapeHtml(p)}</p></div>`;
  }

  html += `<div class="info-points">`;

  // 按 max(tables, charts, infoPoints) 迭代，确保所有数据都渲染
  const rowCount = Math.max(infoPoints.length, tables.length, chartSpecs.length);

  for (let i = 0; i < rowCount; i++) {
    const ip = infoPoints[i];
    const h3 = ip?.find(p => p.tag === "h3");
    const ps = ip?.filter(p => p.tag === "p") || [];

    html += `<div class="info-point">`;
    html += `<div class="ip-header">`;
    if (h3) html += `<h3>${escapeHtml(h3.text)}</h3>`;
    for (const p of ps.slice(0, 2)) {
      html += `<p>${escapeHtml(p.text)}</p>`;
    }
    html += `</div>`;

    html += `<div class="ip-body">`;
    // Table
    if (i < tables.length && tables[i]) {
      const t = tables[i]!;
      html += `<div class="ip-table"><table>`;
      for (let ri = 0; ri < t.length; ri++) {
        const tag = ri === 0 ? "th" : "td";
        html += "<tr>";
        for (const cell of t[ri]!) {
          html += `<${tag}>${escapeHtml(cell || "")}</${tag}>`;
        }
        html += "</tr>";
      }
      html += `</table></div>`;
    }
    // Chart placeholder
    if (i < chartSpecs.length && chartSpecs[i]) {
      const cs = chartSpecs[i]!;
      html += `<div class="ip-chart" data-chart="${i}" data-chart-type="${cs.type}" data-chart-title="${escapeHtml(cs.title)}">Chart: ${escapeHtml(cs.title)}</div>`;
    }
    html += `</div></div>`;
  }

  html += `</div></div></body></html>`;
  return html;
}

// ── helpers ──

interface ContentPart { tag: string; text: string; }

function parseContentHtml(html: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /<(h3|p)\b[^>]*>(.*?)<\/\1>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const text = m[2]!.replace(/<[^>]+>/g, "").trim();
    if (text) parts.push({ tag: m[1]!.toLowerCase(), text });
  }
  return parts;
}

function groupIntoInfoPoints(parts: ContentPart[]): ContentPart[][] {
  const groups: ContentPart[][] = [];
  let current: ContentPart[] = [];
  for (const p of parts) {
    if (p.tag === "h3" && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
