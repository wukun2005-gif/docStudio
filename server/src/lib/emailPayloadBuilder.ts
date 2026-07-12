/**
 * Email Payload Builder — 将 GenerateDocResult 转换为 EmailWritePayload 格式
 *
 * 供 Outlook Add-in 使用：将生成结果（来自 stub mode 或真实 LLM）转为
 * 可写回 Outlook 邮件正文的 payload。
 *
 * 与 Word/Excel 版本的区别：
 * - 单一 subject + 连续 body（不是 section 流）
 * - subject 来自 result.title 或 first section title
 * - body 是 sections 的纯文本拼接（去除 <section> / <h2> 包装）
 * - citations 作为脚注追加到 body 末尾
 * - 无图表（Outlook add-in 不支持富文本图表）
 */
import type { GenerateDocResult } from "./docGenerator.js";
import { logger } from "./logger.js";
import type { CitationItem } from "./stubDataReader.js";

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

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
}

/** toEmailPayload 的额外参数 */
export interface EmailPayloadExtra {
  citations?: CitationItem[];
  provenanceNodes?: ProvenanceNodeRow[];
}

// ═══════════════════════════════════════════════════════════
// HTML 解析工具
// ═══════════════════════════════════════════════════════════

/** 去除所有 HTML 标签，返回纯文本（保留段落换行） */
function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "") // 移除 citations footer
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

/** 提取邮件正文主体：去除 section 包装和 h1 标题（subject 已单独提取） */
function extractBodyHtml(html: string): string {
  if (!html) return "";

  // 1. 去除 outer <div class="doc-content"> 包装
  let content = html
    .replace(/<div class="doc-content">\s*/i, "")
    .replace(/\s*<\/div>\s*$/i, "")
    .trim();

  // 2. 去除 <style> 和 <footer> 块
  content = content
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .trim();

  // 3. 去除第一个 <h1>（如果存在，会作为 subject）
  // 注：保留后续段落和 h2/h3

  // 4. 将 <section> 标签替换为简单的换行分隔（去包装，不去内容）
  content = content
    .replace(/<section[^>]*>/gi, "")
    .replace(/<\/section>/gi, "\n\n")
    .trim();

  return content;
}

// ═══════════════════════════════════════════════════════════
// 核心导出函数
// ═══════════════════════════════════════════════════════════

/**
 * 将 GenerateDocResult 转换为 EmailWritePayload。
 *
 * 数据流：
 *   result.sections[].content (HTML) → htmlToText → 拼接为 body
 *   result.title → subject（去除 "eml: " 前缀）
 *   extra.citations → footer 引用列表
 */
export function toEmailPayload(
  result: GenerateDocResult,
  extra?: EmailPayloadExtra,
): EmailWritePayload {
  logger.info(
    `[EmailPayloadBuilder] 开始转换: ${result.sections.length} sections → Email payload, citations=${extra?.citations?.length || 0}`,
  );

  // 1. 提取 subject：优先用 result.title，去除 "eml: " 前缀
  const rawTitle = result.title || result.sections[0]?.title || "邮件草稿";
  const subject = rawTitle.replace(/^eml:\s*/i, "").trim() || "邮件草稿";

  // 2. 拼接 body：每个 section 的纯文本 + 空行分隔
  const bodyParts: string[] = [];
  for (const section of result.sections) {
    const sectionText = htmlToText(section.content);
    if (sectionText) {
      // 邮件正文直接拼接，section 标题以 "— ${title} —" 形式标注
      bodyParts.push(`— ${section.title} —\n\n${sectionText}`);
    }
  }
  let bodyText = bodyParts.join("\n\n");

  // 3. 追加 citations footer
  const citations = extra?.citations ?? [];
  if (citations.length > 0) {
    bodyText += "\n\n—— 参考来源 ——\n";
    for (const cit of citations) {
      bodyText += `[${cit.index}] ${cit.title}\n`;
      if (cit.url) bodyText += `    ${cit.url}\n`;
    }
  }

  // 4. 构造 HTML body（Outlook 富文本邮件格式）
  let bodyHtml = bodyParts
    .map((part) => {
      const lines = part.split("\n\n");
      return lines
        .map((line) => {
          if (line.startsWith("—") && line.endsWith("—")) {
            // section 标题 → h3
            return `<h3 style="color:#1a73e8;font-size:14px;margin:16px 0 8px 0">${line}</h3>`;
          }
          // 普通段落
          return `<p style="margin:8px 0;line-height:1.6">${line.replace(/\n/g, "<br>")}</p>`;
        })
        .join("\n");
    })
    .join("\n");

  if (citations.length > 0) {
    const citHtml = [
      `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px 0">`,
      `<p style="color:#666;font-size:12px;margin:8px 0"><strong>参考来源</strong></p>`,
      ...citations.map((cit) => {
        if (cit.url) {
          return `<p style="font-size:12px;margin:4px 0">[${cit.index}] <a href="${cit.url}" style="color:#1a73e8">${cit.title}</a></p>`;
        }
        return `<p style="font-size:12px;margin:4px 0">[${cit.index}] ${cit.title}</p>`;
      }),
    ].join("\n");
    bodyHtml += "\n" + citHtml;
  }

  // 5. 计算正文字符数（不含 footer）
  const bodyCharCount = bodyParts.join("\n\n").length;

  const payload: EmailWritePayload = {
    subject,
    bodyHtml,
    bodyText,
    bodyCharCount,
    citations: citations.map((c) => ({ index: c.index, title: c.title, url: c.url })),
    trustScore: result.trustScore ?? 0.5,
    documentStyle: result.documentStyle ?? "email",
  };

  logger.info(
    `[EmailPayloadBuilder] 转换完成: subject="${payload.subject}", bodyLen=${bodyCharCount}, htmlLen=${bodyHtml.length}, citations=${payload.citations.length}`,
  );

  return payload;
}
