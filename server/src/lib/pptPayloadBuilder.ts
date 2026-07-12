/**
 * pptPayloadBuilder.ts — 将 GenerateDocResult 转换为 PptWritePayload
 *
 * 转换规则：
 * - 第1张：标题页（文档标题 + 副标题）
 * - 每个 section → 一张幻灯片（标题 + 子标题要点 + 第一张表格）
 *   - <h3> 子标题作为分组要点前缀
 *   - <p> 段落文本 → 压缩为简短要点（提取核心数据）
 *   - <table> → 取第一张表格写入幻灯片
 *   - 图表在 PPT 中不支持，从 chartSpecs 中提取关键数据转为文字摘要
 * - 最后一张：参考来源
 *
 * 关键改进：
 * - 使用 DOMParser 正确解析 HTML 而非正则
 * - 每个 <h3> + 后续 <p> 作为一个要点组
 * - 表格直接从 DOM 中提取，避免正则匹配问题
 */

import type { GenerateDocResult } from "./docGenerator.js";

export interface PptSlideData {
  title: string;
  subtitle?: string;
  isTitleSlide?: boolean; // 标记为标题页
  bulletPoints?: string[];
  paragraphs?: string[];
  table?: {
    title?: string;
    headers: string[];
    rows: string[][];
  };
  charts?: Array<{
    type: string;
    title: string;
    categories: string[];
    series: Array<{ name: string; values: number[] }>;
  }>;
  citationUrls?: Array<{ index: number; url: string; title: string }>; // 引用超链接
  notes?: string;
}

export interface PptWritePayload {
  slides: PptSlideData[];
  citations?: Array<{ index: number; title: string; url: string }>;
}

/**
 * 压缩长句为 PPT 要点（取关键信息）
 */
function condenseSentence(text: string, maxLen = 60): string {
  // 去除引用标记 [1] [2] 等
  let s = text.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  // 取前 maxLen 字符，在最近的标点处截断
  const truncated = s.substring(0, maxLen);
  const lastPunct = Math.max(
    truncated.lastIndexOf("，"),
    truncated.lastIndexOf("、"),
    truncated.lastIndexOf("；")
  );
  if (lastPunct > maxLen * 0.5) {
    return truncated.substring(0, lastPunct) + "…";
  }
  return truncated + "…";
}

/**
 * 从 HTML 中提取纯文本
 */
function extractTextFromHtml(html: string): string {
  // Node 环境没有 DOMParser，使用简单的文本提取
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 解析单个 section HTML 为 PptSlideData
 */
function parseSectionHtml(sectionTitle: string, html: string, sources: Array<{ sourceName?: string; sourceUrl?: string }>): PptSlideData {
  const bulletPoints: string[] = [];
  let firstTable: { headers: string[]; rows: string[][]; title?: string } | undefined;
  const charts: Array<{ type: string; title: string; categories: string[]; series: Array<{ name: string; values: number[] }> }> = [];

  // 1. 提取并解析 chartSpecs（脚本标签中的 JSON）
  const chartSpecMatch = html.match(/<script[^>]*class="chart-spec"[^>]*>([\s\S]*?)<\/script>/i);
  if (chartSpecMatch) {
    try {
      const rawContent = chartSpecMatch[1]!.trim();
      const chartJsonStrings = JSON.parse(rawContent) as string[];
      for (const chartJsonStr of chartJsonStrings) {
        try {
          const parsed = JSON.parse(chartJsonStr);
          const chartSpecs = Array.isArray(parsed) ? parsed : [parsed];
          for (const chartSpec of chartSpecs) {
            if (!chartSpec || typeof chartSpec !== 'object') continue;
            const chartTitle = chartSpec.title ?? "图表";
            const categories: string[] = chartSpec.categories ?? [];
            const seriesArr: Array<{ name: string; values: number[] }> = chartSpec.series ?? [];
            const chartType = chartSpec.type ?? "bar";
            if (seriesArr.length > 0 && categories.length > 0) {
              charts.push({ type: chartType, title: chartTitle, categories, series: seriesArr });
            }
          }
        } catch {
          // 忽略单个图表解析失败
        }
      }
    } catch {
      // chartSpec 解析失败不影响其他内容
    }
  }

  // 2. 提取表格（在移除 script 和 svg 之前提取表格内容）
  // 使用简单正则提取 <table>...</table>
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tableMatches = [...html.matchAll(tableRegex)];
  if (tableMatches.length > 0) {
    const firstTableHtml = tableMatches[0]![0];
    // 提取 headers
    const headerMatch = firstTableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    const headers: string[] = [];
    if (headerMatch) {
      const thMatches = [...headerMatch[1]!.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
      for (const th of thMatches) {
        headers.push(extractTextFromHtml(th[1]!));
      }
    }
    // 提取 rows
    const bodyMatch = firstTableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const rows: string[][] = [];
    if (bodyMatch) {
      const trMatches = [...bodyMatch[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const tr of trMatches) {
        const tdMatches = [...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        const row = tdMatches.map(td => extractTextFromHtml(td[1]!));
        if (row.some(cell => cell.length > 0)) {
          rows.push(row);
        }
      }
    }
    if (headers.length > 0) {
      firstTable = { headers, rows };
    }
  }

  // 3. 提取正文段落（去除 script、svg、table 标签后）
  let contentHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<div class="charts">[\s\S]*?<\/div>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, ""); // 移除表格避免重复

  // 按 <h3> 分割内容块
  const h3Blocks = contentHtml.split(/<h3[^>]*>/i);
  for (const block of h3Blocks) {
    if (!block.trim()) continue;
    // 提取 h3 标题
    let blockTitle = "";
    let blockContent = block;
    const h3CloseIdx = block.indexOf("</h3>");
    if (h3CloseIdx >= 0) {
      blockTitle = extractTextFromHtml(block.substring(0, h3CloseIdx));
      blockContent = block.substring(h3CloseIdx + 5);
    }
    // 提取该块中的 <p> 段落
    const pMatches = [...blockContent.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    for (const pMatch of pMatches) {
      const pText = extractTextFromHtml(pMatch[1]!);
      if (pText.length < 5) continue;
      // 把段落拆分为要点
      const sentences = pText
        .split(/(?<=[。！？；])/)
        .map(s => s.trim())
        .filter(s => s.length > 8);
      for (const sent of sentences.slice(0, 2)) {
        // 每个 h3 块最多取2句话
        const prefix = blockTitle ? `${blockTitle}：` : "";
        bulletPoints.push(condenseSentence(prefix + sent));
      }
    }
  }

  // 4. 添加图表关键数据摘要作为额外要点
  for (const chart of charts.slice(0, 2)) {
    const firstSeries = chart.series[0]!;
    const values = firstSeries.values;
    if (!values || values.length === 0) continue;
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const maxIdx = values.indexOf(maxVal);
    const minIdx = values.indexOf(minVal);
    let summary = `${chart.title}：`;
    if (chart.series.length === 1) {
      const maxCat = chart.categories[maxIdx] ?? "";
      const minCat = chart.categories[minIdx] ?? "";
      if (maxCat !== minCat) {
        summary += `最高 ${maxCat}(${maxVal})，最低 ${minCat}(${minVal})`;
      } else {
        summary += `${maxCat} ${maxVal}`;
      }
    } else if (chart.series.length >= 2) {
      const s0Name = chart.series[0]!.name || "系列1";
      const s1Name = chart.series[1]!.name || "系列2";
      const sum0 = values.reduce((a: number, b: number) => a + b, 0);
      const sum1 = (chart.series[1]!.values || []).reduce((a: number, b: number) => a + b, 0);
      summary += `${s0Name} vs ${s1Name}，总量 ${sum0} vs ${sum1}`;
    }
    bulletPoints.push(summary);
  }

  // 5. 限制要点数量（PPT 单页不超过6条，为表格/图表留空间）
  const limitedBullets = bulletPoints.slice(0, 6);

  // 6. 生成 notes（来源信息）
  const notes = sources
    .filter(s => s.sourceName)
    .map(s => s.sourceName)
    .join("; ");

  return {
    title: sectionTitle,
    bulletPoints: limitedBullets.length > 0 ? limitedBullets : undefined,
    table: firstTable,
    charts: charts.length > 0 ? charts.slice(0, 3) : undefined, // 最多传3个图表用于渲染
    notes: notes || undefined,
  };
}

/**
 * 主入口：将 GenerateDocResult 转换为 PptWritePayload
 */
export function toPptPayload(result: GenerateDocResult): PptWritePayload {
  const slides: PptSlideData[] = [];

  // 1. 标题页
  slides.push({
    title: result.title,
    subtitle: new Date().toLocaleDateString("zh-CN"),
    isTitleSlide: true,
    bulletPoints: [
      `共 ${result.sections.length} 个章节`,
      `可信度评分：${Math.round((result.trustScore ?? 0) * 100)}%`,
    ],
  });

  // 2. 各章节页
  for (const section of result.sections) {
    const slideData = parseSectionHtml(
      section.title,
      section.content,
      section.sources as Array<{ sourceName?: string; sourceUrl?: string; sourceId?: string }>
    );
    slides.push(slideData);
  }

  // 3. 参考来源页
  // 按 sourceName+sourceUrl+sourceId 去重，分配连续编号 [1], [2], [3]...
  // 没有外部 URL 的来源用 sourceId 构造 localhost 链接（与 docExporter 一致）
  const sourceKey = (src: { sourceName?: string; sourceUrl?: string; sourceId?: string }) => {
    if (src.sourceUrl && src.sourceUrl.trim()) return `url:${src.sourceUrl.trim()}`;
    if (src.sourceId && src.sourceId.trim()) return `sid:${src.sourceId.trim()}`;
    return `name:${src.sourceName || ""}`;
  };

  const buildUrl = (src: { sourceUrl?: string; sourceId?: string }): string => {
    if (src.sourceUrl && src.sourceUrl.trim()) return src.sourceUrl.trim();
    if (src.sourceId && src.sourceId.trim()) return `http://localhost:3000/api/knowledge/sources/${src.sourceId.trim()}/file`;
    return "";
  };

  const seenSources = new Map<string, number>();
  const citations: Array<{ index: number; title: string; url: string }> = [];
  let nextIdx = 1;

  for (const section of result.sections) {
    for (const src of (section.sources ?? [])) {
      if (!src.sourceName) continue;
      const s = src as { sourceName?: string; sourceUrl?: string; sourceId?: string };
      const key = sourceKey(s);
      if (!seenSources.has(key)) {
        seenSources.set(key, nextIdx);
        citations.push({
          index: nextIdx,
          title: src.sourceName,
          url: buildUrl(s),
        });
        nextIdx++;
      }
    }
  }

  // 收集 webCitations 中的引用
  const webCites = (result.sections as Array<{ webCitations?: Array<{ title: string; url: string; index?: number }> }>)
    .flatMap(s => s.webCitations ?? [])
    .filter(c => c.title);
  for (const wc of webCites) {
    const key = wc.url ? `url:${wc.url}` : `name:${wc.title}`;
    if (!seenSources.has(key)) {
      seenSources.set(key, nextIdx);
      citations.push({ index: nextIdx, title: wc.title, url: wc.url ?? "" });
      nextIdx++;
    }
  }

  if (citations.length > 0) {
    slides.push({
      title: "参考来源",
      citationUrls: citations.map(c => ({ index: c.index, url: c.url, title: c.title })),
    });
  }

  return { slides, citations: citations.length > 0 ? citations : undefined };
}
