/**
 * Chart Spec Parser — 从 LLM 输出/HTML 中提取并校验图表规格 JSON
 *
 * 流程：
 * 1. 从原始 LLM 输出文本中提取 ```chart / ```json chart fenced block
 * 2. jsonrepair() → JSON.parse()
 * 3. Schema 校验（ChartSpec: type, title, categories, series）
 * 4. 失败返回空数组，不抛异常
 */
import { jsonrepair } from "jsonrepair";
import { logger } from "./logger.js";
import type { ChartSpec } from "./docExporter.js";

// ── ChartSpec Schema ──────────────────────────────────────

const VALID_CHART_TYPES = new Set(["bar", "pie", "line", "column", "doughnut", "scatter"]);

function isValidChartType(t: unknown): t is ChartSpec["type"] {
  return typeof t === "string" && VALID_CHART_TYPES.has(t);
}

/** 校验单个 chart spec 对象 */
function validateChartSpec(obj: unknown): obj is ChartSpec {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;

  // type: 必填，有效类型
  if (!isValidChartType(o.type)) return false;

  // title: 必填，非空字符串
  if (typeof o.title !== "string" || !o.title.trim()) return false;

  // categories: 必填，非空字符串数组
  if (!Array.isArray(o.categories) || o.categories.length === 0) return false;
  if (!o.categories.every((c: unknown) => typeof c === "string")) return false;

  // series: 必填，非空数组，每个元素有 name(string) + values(number[])
  if (!Array.isArray(o.series) || o.series.length === 0) return false;
  for (const s of o.series) {
    if (!s || typeof s !== "object") return false;
    const ser = s as Record<string, unknown>;
    if (typeof ser.name !== "string") return false;
    if (!Array.isArray(ser.values) || ser.values.length === 0) return false;
    if (!ser.values.every((v: unknown) => typeof v === "number")) return false;
  }

  return true;
}

// ── 提取与解析 ───────────────────────────────────────────

/**
 * 从原始 LLM 输出文本中提取 \`\`\`chart 代码块的 JSON chart spec。
 * 支持格式：
 *   ```chart
 *   ```json chart
 *   ```chart json
 */
export function extractChartSpecFromText(text: string): ChartSpec[] {
  if (!text) return [];

  const results: ChartSpec[] = [];

  // 匹配 ```chart ... ``` 块
  const chartBlockRegex = /```(?:json\s*)?chart(?:\s*json)?\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = chartBlockRegex.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      const parsed = parseChartSpecJson(raw);
      results.push(...parsed);
    }
  }

  if (results.length > 0) {
    logger.info(`[ChartSpecParser] 从文本提取 ${results.length} 个 chart specs`);
  }

  return results;
}

/**
 * 从 HTML 内容中提取 <script class="chart-spec"> 标签的 JSON chart spec。
 * 这是从 toHtml() 嵌入的 script 标签中还原。
 */
export function extractChartSpecFromHtml(html: string): ChartSpec[] {
  if (!html) return [];

  const results: ChartSpec[] = [];
  const scriptRegex = /<script\s+type="application\/json"\s+class="chart-spec">([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      const parsed = parseChartSpecJson(raw);
      results.push(...parsed);
    }
  }

  return results;
}

/** 解析 JSON 字符串为 ChartSpec[]，失败返回 [] */
function parseChartSpecJson(jsonStr: string): ChartSpec[] {
  try {
    // jsonrepair: 修复 LLM 输出中常见的 JSON 问题（尾部逗号、裸 NaN、未闭合引号等）
    let repaired: string;
    try {
      repaired = jsonrepair(jsonStr);
    } catch {
      // jsonrepair 也失败时尝试裸 JSON.parse
      repaired = jsonStr;
    }

    const parsed = JSON.parse(repaired);

    // 支持单对象和数组
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const valid = items.filter(validateChartSpec);

    if (valid.length < items.length) {
      logger.warn(`[ChartSpecParser] ${items.length - valid.length}/${items.length} 个 chart spec 校验失败`);
    }

    return valid;
  } catch (err) {
    logger.warn(`[ChartSpecParser] JSON 解析失败: ${err}`);
    return [];
  }
}

/**
 * 统一入口：从 HTML 中提取 chart spec（优先 script 标签，fallback 到 code fence）。
 * 用于 parseHtmlSections 后处理。
 */
export function extractChartSpecs(html: string, rawLlmOutput?: string): ChartSpec[] {
  // 优先从 HTML script 标签提取
  const fromHtml = extractChartSpecFromHtml(html);
  if (fromHtml.length > 0) return fromHtml;

  // Fallback: 从原始 LLM 输出提取
  if (rawLlmOutput) {
    return extractChartSpecFromText(rawLlmOutput);
  }

  return [];
}
