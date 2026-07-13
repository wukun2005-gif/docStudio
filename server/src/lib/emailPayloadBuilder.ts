/**
 * Email Payload Builder — 将 GenerateDocResult 转换为 EmailWritePayload 格式
 *
 * 供 Outlook Add-in 使用：将生成结果（来自 stub mode 或真实 LLM）转为
 * 可写回 Outlook 邮件正文的 payload。
 *
 * 关键修复：
 * - htmlToText 使用状态机而非简单正则，正确处理属性中的引号/尖括号
 * - bodyHtml 直接使用清理后的 section HTML（不再从纯文本重建），保留段落格式
 * - citations 作为脚注追加到 body 末尾，编号从 [1] 连续编号
 * - 正文中 [N] 引用自动转为超链接（指向脚注对应条目）
 * - sourceTree 构建段落→来源映射，供前端来源树展示
 * - paragraphScores 从真实 groundingScore 取值
 */
import * as cheerio from "cheerio";
import type { GenerateDocResult } from "./docGenerator.js";
import { logger } from "./logger.js";
import type { CitationItem } from "./stubDataReader.js";

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface SourceTreeNode {
  /** 段落标题 */
  title: string;
  /** 段落 grounding score */
  score: number;
  /** 该段落引用的来源列表 */
  citations: Array<{ index: number; title: string; url: string }>;
}

export interface EmailWritePayload {
  /** 邮件主题 */
  subject: string;
  /** 邮件正文（HTML 格式，与 Outlook HTML 兼容） */
  bodyHtml: string;
  /** 邮件正文（纯文本格式，作为 fallback） */
  bodyText: string;
  /** 邮件正文原始字符数（不含 citations 脚注） */
  bodyCharCount: number;
  /** 参考来源列表 */
  citations: Array<{ index: number; title: string; url: string }>;
  /** trust_score（综合质量分） */
  trustScore: number;
  /** 文档类型（email） */
  documentStyle: string;
  /** 各段落 grounding score（用于评估卡显示） */
  paragraphScores?: Array<{ title: string; score: number }>;
  /** 来源树：段落 → 引用来源 */
  sourceTree?: SourceTreeNode[];
}

/** toEmailPayload 的额外参数 */
export interface EmailPayloadExtra {
  citations?: CitationItem[];
}

// ═══════════════════════════════════════════════════════════
// HTML 解析工具（使用 cheerio 保证健壮性）
// ═══════════════════════════════════════════════════════════

/** 使用 cheerio 提取纯文本（健壮处理所有 HTML 边界情况） */
function htmlToTextRobust(html: string): string {
  if (!html) return "";
  try {
    const $ = cheerio.load(html, { xml: false });
    $("style, script, footer, nav, header").remove();
    $("br").replaceWith("\n");
    $("p, div, h1, h2, h3, h4, h5, h6, li").after("\n\n");
    $("hr").after("\n---\n");
    let text = $.text();
    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  } catch {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

/**
 * 清理 HTML 用于邮件正文：
 * - 移除 script/style/footer/chart
 * - 修复损坏的 HTML（如 <em> 标签污染 target 属性等）
 * - 移除 <sup> 上标（让引用编号正常显示）
 * - 清理 a.cite-link 的冗余属性，但保留 href
 * - 给段落/标题添加 Outlook 友好 inline style
 */
function cleanHtmlForEmail(html: string, sectionTitle?: string): string {
  if (!html) return "";
  try {
    // 先修复已知的 HTML 损坏：target="<em>blank" 等 markdown 污染
    // 移除所有 <em> 和 </em> 标签（斜体在邮件中不重要，避免属性污染）
    let fixed = html
      .replace(/<\/?em[^>]*>/gi, "")
      .replace(/<\/?strong[^>]*>/gi, "")
      .replace(/<\/?b[^>]*>/gi, "")
      .replace(/<\/?i[^>]*>/gi, "");

    const $ = cheerio.load(`<div id="__email_root__">${fixed}</div>`, { xml: false });
    const $root = $("#__email_root__");

    // 移除不需要的元素
    $root.find("style, script, footer, nav, header, .chart-container, [data-chart]").remove();

    // 移除 <sup> 包裹（让引用编号 [N] 正常显示为正文中的普通文本）
    $root.find("sup").each((_, el) => {
      const $sup = $(el);
      $sup.replaceWith($sup.html() || "");
    });

    // 清理所有 cite-link 链接：只保留 href，移除其他属性
    $root.find("a.cite-link, a[class*='cite']").each((_, el) => {
      const $a = $(el);
      const href = ($a.attr("href") || "").trim();
      const text = $a.text().trim();
      // 验证 href 是有效 URL（不以 javascript: 等开头）
      const safeHref = href && !href.startsWith("javascript:") ? href : "";
      if (safeHref) {
        $a.replaceWith(`<a href="${safeHref}" style="color:#1a73e8;text-decoration:none">${text}</a>`);
      } else {
        $a.replaceWith(text);
      }
    });

    // 清理所有其他 <a> 标签的损坏属性
    $root.find("a").each((_, el) => {
      const $a = $(el);
      const href = ($a.attr("href") || "").trim();
      // 如果 href 被 <em> 等标签污染，尝试提取
      const cleanHref = href.replace(/<[^>]+>/g, "").trim();
      if (cleanHref && !cleanHref.startsWith("javascript:")) {
        $a.attr("href", cleanHref);
        $a.removeAttr("target").removeAttr("rel").removeAttr("class").removeAttr("title");
        $a.attr("style", "color:#1a73e8;text-decoration:none");
      } else if (!cleanHref || cleanHref.startsWith("javascript:")) {
        // 无效链接，替换为纯文本
        $a.replaceWith($a.text());
      }
    });

    // 给所有 <p> 添加 Outlook 友好样式
    $root.find("p").each((_, el) => {
      $(el).attr("style", "margin:8px 0;line-height:1.6;font-size:14px");
    });

    // 给所有 <h2>/<h3> 添加样式
    $root.find("h1, h2, h3").each((_, el) => {
      $(el).attr("style", "color:#1a73e8;font-size:14px;margin:16px 0 8px 0;font-weight:600");
    });

    let result = $root.html() || "";
    if (sectionTitle) {
      result = `<h3 style="color:#1a73e8;font-size:14px;margin:16px 0 8px 0;font-weight:600">— ${sectionTitle} —</h3>\n${result}`;
    }
    return result;
  } catch (e) {
    logger.warn(`[EmailPayloadBuilder] cleanHtmlForEmail 失败，使用 fallback: ${e}`);
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  }
}

/**
 * 对正文中的引用进行重新编号：
 * 1. 扫描清理后的 HTML，找出所有 [N] 引用（在 a.cite-link 中或纯文本中）
 * 2. 按出现顺序收集唯一引用编号
 * 3. 从 [1] 开始重新编号
 * 4. 替换正文中所有引用编号
 * 5. 返回重新编号后的 HTML 和新的引用列表
 * 6. 将正文中的纯文本 [N] 转为指向脚注锚点的超链接
 */
function renumberCitations(
  bodyHtml: string,
  citations: CitationItem[],
): { html: string; renumberedCitations: Array<{ index: number; title: string; url: string }>; citeOldToNew: Map<number, number> } {
  // 建立 oldIndex -> citation 的映射
  const oldCiteMap = new Map<number, CitationItem>();
  for (const c of citations) {
    oldCiteMap.set(c.index, c);
  }

  // 用 cheerio 加载 HTML，遍历所有文本节点和链接，找出 [N] 模式
  const $ = cheerio.load(`<div id="__renum__">${bodyHtml}</div>`, { xml: false });
  const $root = $("#__renum__");

  // 第一步：收集正文中实际出现的所有引用编号（按出现顺序）
  const appearedOrigIndices: number[] = [];
  const appearedSet = new Set<number>();

  const collectFromText = (text: string) => {
    const citeRegex = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = citeRegex.exec(text)) !== null) {
      const num = parseInt(m[1], 10);
      if (num > 0 && num <= 500 && oldCiteMap.has(num) && !appearedSet.has(num)) {
        appearedSet.add(num);
        appearedOrigIndices.push(num);
      }
    }
  };

  // 遍历所有文本节点
  $root.find("*").contents().each((_, node) => {
    if (node.type === "text") {
      collectFromText($(node).text());
    }
  });

  // 也收集 a 标签中的文本
  $root.find("a").each((_, el) => {
    collectFromText($(el).text());
  });

  // 如果正文没有任何引用，但 citations 列表非空，按 citations 原始顺序全部保留
  if (appearedOrigIndices.length === 0 && citations.length > 0) {
    for (const c of citations) {
      if (!appearedSet.has(c.index)) {
        appearedSet.add(c.index);
        appearedOrigIndices.push(c.index);
      }
    }
  }

  // 建立 old -> new 编号映射
  const citeOldToNew = new Map<number, number>();
  const renumberedCitations: Array<{ index: number; title: string; url: string }> = [];
  appearedOrigIndices.forEach((oldIdx, newIdx) => {
    const newIndex = newIdx + 1;
    citeOldToNew.set(oldIdx, newIndex);
    const c = oldCiteMap.get(oldIdx);
    if (c) {
      renumberedCitations.push({ index: newIndex, title: c.title, url: c.url });
    }
  });

  // 第二步：替换正文中的 [N] 编号，并将纯文本 [N] 转为超链接
  // 先处理已有的 a.cite-link 链接
  $root.find("a").each((_, el) => {
    const $a = $(el);
    const text = $a.text();
    const m = /^\[(\d+)\]$/.exec(text.trim());
    if (m) {
      const oldNum = parseInt(m[1], 10);
      const newNum = citeOldToNew.get(oldNum);
      if (newNum !== undefined) {
        $a.text(`[${newNum}]`);
        $a.attr("href", `#cite-${newNum}`);
        $a.attr("style", "color:#1a73e8;text-decoration:none");
        $a.removeAttr("target").removeAttr("rel").removeAttr("class");
      }
    }
  });

  // 处理纯文本中的 [N]（不在 <a> 标签内的）
  // 遍历所有文本节点，将 [N] 替换为 <a href="#cite-N">[N]</a>
  $root.find("*").contents().each((_, node) => {
    if (node.type === "text") {
      const text = $(node).text();
      if (!/\[\d+\]/.test(text)) return;
      let replaced = text;
      replaced = replaced.replace(/\[(\d+)\]/g, (match, numStr) => {
        const oldNum = parseInt(numStr, 10);
        const newNum = citeOldToNew.get(oldNum);
        if (newNum !== undefined) {
          return `<a href="#cite-${newNum}" style="color:#1a73e8;text-decoration:none">[${newNum}]</a>`;
        }
        return match; // 不在引用列表中的 [N] 保持原样
      });
      if (replaced !== text) {
        $(node).replaceWith(replaced);
      }
    }
  });

  const newHtml = $root.html() || "";
  return { html: newHtml, renumberedCitations, citeOldToNew };
}

// ═══════════════════════════════════════════════════════════
// 核心导出函数
// ═══════════════════════════════════════════════════════════

/**
 * 将 GenerateDocResult 转换为 EmailWritePayload。
 */
export function toEmailPayload(
  result: GenerateDocResult,
  extra?: EmailPayloadExtra,
): EmailWritePayload {
  logger.info(
    `[EmailPayloadBuilder] 开始转换: ${result.sections.length} sections → Email payload, citations=${extra?.citations?.length || 0}`,
  );

  // 1. 提取 subject
  const rawTitle = result.title || result.sections[0]?.title || "邮件草稿";
  const subject = rawTitle.replace(/^eml:\s*/i, "").trim() || "邮件草稿";

  // 2. 提取 citations（建立 index→citation 映射）
  const rawCitations = extra?.citations ?? [];

  // 3. 先构造 body HTML（清理每个 section）
  const bodyHtmlParts: string[] = [];
  const bodyTextParts: string[] = [];
  const paragraphScores: Array<{ title: string; score: number }> = [];
  const sourceTree: SourceTreeNode[] = [];
  // 收集所有段落引用的原始 citation 编号（用于 sourceTree 重编号）
  const sectionCiteOldIndices: number[][] = [];

  for (let i = 0; i < result.sections.length; i++) {
    const section = result.sections[i];
    const sectionTitle = section.title || "";
    const cleanHtml = cleanHtmlForEmail(section.content, sectionTitle);
    if (cleanHtml) bodyHtmlParts.push(cleanHtml);

    const sectionText = htmlToTextRobust(section.content);
    if (sectionText) {
      bodyTextParts.push(sectionTitle ? `— ${sectionTitle} —\n\n${sectionText}` : sectionText);
    }

    const gScore = typeof section.groundingScore === "number" ? section.groundingScore : 0.5;
    paragraphScores.push({ title: sectionTitle, score: gScore });

    // 收集该段落引用的原始 citation 编号
    const paraCiteSet = new Set<number>();
    if (section.citationLinks && section.citationLinks.length > 0) {
      for (const cl of section.citationLinks) {
        if (!paraCiteSet.has(cl.index) && cl.index > 0) {
          paraCiteSet.add(cl.index);
        }
      }
    }
    // 从 sources/webCitations 补充
    if (section.sources) {
      for (const src of section.sources) {
        const title = src.sourceName || src.chunkId || "";
        const matched = rawCitations.find(c => c.title === title || (title && c.title && (title.includes(c.title) || c.title.includes(title))));
        if (matched && !paraCiteSet.has(matched.index)) {
          paraCiteSet.add(matched.index);
        }
      }
    }
    if (section.webCitations) {
      for (const wc of section.webCitations) {
        const matched = rawCitations.find(c => c.url === wc.url);
        if (matched && !paraCiteSet.has(matched.index)) {
          paraCiteSet.add(matched.index);
        }
      }
    }
    sectionCiteOldIndices.push(Array.from(paraCiteSet));

    // sourceTree 先临时用旧编号，后面重编号后再更新
    sourceTree.push({
      title: sectionTitle || `段落 ${i + 1}`,
      score: gScore,
      citations: [], // 稍后填充
    });
  }

  // 4. 合并所有 section HTML，然后统一重编号引用
  let bodyHtml = bodyHtmlParts.join("\n");
  let bodyText = bodyTextParts.join("\n\n");

  const { html: renumberedHtml, renumberedCitations, citeOldToNew } = renumberCitations(bodyHtml, rawCitations);
  bodyHtml = renumberedHtml;

  // 更新 sourceTree 中的引用编号（old -> new）
  for (let i = 0; i < sourceTree.length; i++) {
    const oldIndices = sectionCiteOldIndices[i] || [];
    const newCitations: Array<{ index: number; title: string; url: string }> = [];
    const seen = new Set<number>();
    for (const oldIdx of oldIndices) {
      const newIdx = citeOldToNew.get(oldIdx);
      if (newIdx !== undefined && !seen.has(newIdx)) {
        seen.add(newIdx);
        const c = renumberedCitations.find(rc => rc.index === newIdx);
        if (c) newCitations.push(c);
      }
    }
    sourceTree[i].citations = newCitations;
  }

  // 5. 追加 citations footer 到 HTML 和 text（使用新编号，带锚点 id）
  if (renumberedCitations.length > 0) {
    const citHtmlParts = [
      `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px 0">`,
      `<p style="color:#666;font-size:12px;margin:8px 0"><strong>参考来源</strong></p>`,
    ];
    for (const cit of renumberedCitations) {
      if (cit.url) {
        citHtmlParts.push(`<p style="font-size:12px;margin:4px 0;color:#444"><a id="cite-${cit.index}"></a>[${cit.index}] <a href="${cit.url}" style="color:#1a73e8;text-decoration:none" target="_blank" rel="noopener">${cit.title}</a></p>`);
      } else {
        citHtmlParts.push(`<p style="font-size:12px;margin:4px 0;color:#444"><a id="cite-${cit.index}"></a>[${cit.index}] ${cit.title}</p>`);
      }
    }
    bodyHtml += "\n" + citHtmlParts.join("\n");

    // Text citations
    bodyText += "\n\n—— 参考来源 ——\n";
    for (const cit of renumberedCitations) {
      bodyText += `[${cit.index}] ${cit.title}\n`;
      if (cit.url) bodyText += `    ${cit.url}\n`;
    }
  }

  // 6. 计算正文字符数（不含 footer）
  const bodyCharCount = bodyTextParts.join("\n\n").length;

  const payload: EmailWritePayload = {
    subject,
    bodyHtml,
    bodyText,
    bodyCharCount,
    citations: renumberedCitations,
    trustScore: result.trustScore ?? 0.5,
    documentStyle: result.documentStyle ?? "email",
    paragraphScores: paragraphScores.length > 0 ? paragraphScores : undefined,
    sourceTree: sourceTree.length > 0 ? sourceTree : undefined,
  };

  logger.info(
    `[EmailPayloadBuilder] 转换完成: subject="${payload.subject}", bodyLen=${bodyCharCount}, htmlLen=${bodyHtml.length}, citations=${payload.citations.length} (renumbered from ${rawCitations.length}), paragraphScores=${paragraphScores.length}, sourceTree=${sourceTree.length}`,
  );

  return payload;
}
