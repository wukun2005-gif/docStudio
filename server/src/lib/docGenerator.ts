/**
 * 文档生成引擎 — 基于大纲和 RAG 检索生成文档
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { hybridSearch } from "./hybridSearch.js";
import { logger } from "./logger.js";
import type { OutlineSection } from "./narrativeEngine.js";

// ── 文档生成 ──────────────────────────────────────────

export interface GenerateDocRequest {
  title: string;
  outline: OutlineSection[];
  format: "docx" | "pptx" | "xlsx" | "html";
  providerPreference?: string[];
  modelId?: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
  signal?: AbortSignal;
}

export interface GenerateDocResult {
  content: string;
  sections: Array<{
    title: string;
    content: string;
    sources: Array<{ chunkId: string; content: string; score: number }>;
  }>;
  trustScore: number;
}

/** 为每个章节检索相关知识 */
function retrieveForSection(sectionTitle: string, description?: string): Array<{ chunkId: string; content: string; score: number }> {
  const query = description ? `${sectionTitle} ${description}` : sectionTitle;
  const results = hybridSearch(query, { limit: 3, useQueryExpansion: false });
  return results.map((r) => ({
    chunkId: r.chunkId,
    content: r.content,
    score: r.score,
  }));
}

/** 生成单个章节内容 */
async function generateSection(
  section: OutlineSection,
  context: string,
  config: GenerateDocRequest,
): Promise<string> {
  const sources = retrieveForSection(section.title, section.description);
  const sourceText = sources.map((s, i) => `[${i + 1}] ${s.content}`).join("\n\n");

  const prompt = `你是一个文档写作助手。根据以下信息生成文档章节内容。

章节标题：${section.title}
章节描述：${section.description ?? "无"}
${section.children.length > 0 ? `子章节：${section.children.map((c) => c.title).join(", ")}` : ""}

参考信息：
${sourceText || "（无参考信息）"}

上下文：
${context || "（无上下文）"}

要求：
1. 内容准确，基于参考信息
2. 语言流畅，专业
3. 如果参考信息不足，基于常识补充，但不要编造数据
4. 输出纯文本，不要 markdown 格式`;

  const providerApiKeys: Record<string, string> = {};
  for (const pid of config.providerPreference ?? []) {
    const key = config.apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const { response } = await registry.runWithFallback(
    config.providerPreference ?? ["openai", "deepseek"],
    {
      modelId: config.modelId ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      apiKey: "",
      temperature: 0.7,
      signal: config.signal,
    },
    undefined, undefined,
    providerApiKeys,
    config.providerBaseUrls,
  );

  if (response.error) {
    logger.error(`[DocGenerator] 章节生成失败: ${response.error.message}`);
    return `[生成失败: ${section.title}]`;
  }

  return response.text;
}

/** 递归生成大纲所有章节 */
async function generateSections(
  outline: OutlineSection[],
  parentContext: string,
  config: GenerateDocRequest,
): Promise<GenerateDocResult["sections"]> {
  const sections: GenerateDocResult["sections"] = [];

  for (const section of outline) {
    // 生成当前章节
    const content = await generateSection(section, parentContext, config);
    const sources = retrieveForSection(section.title, section.description);

    sections.push({
      title: section.title,
      content,
      sources,
    });

    // 递归生成子章节
    if (section.children.length > 0) {
      const childSections = await generateSections(
        section.children,
        `${parentContext}\n\n${section.title}: ${content}`,
        config,
      );
      sections.push(...childSections);
    }
  }

  return sections;
}

/** 完整文档生成 */
export async function generateDocument(config: GenerateDocRequest): Promise<GenerateDocResult> {
  logger.info(`[DocGenerator] 开始生成: ${config.title}`);

  const sections = await generateSections(config.outline, "", config);

  // 合并为完整文档
  const content = sections.map((s) => `${s.title}\n\n${s.content}`).join("\n\n");

  // 计算信任度分数（基于来源质量）
  const allScores = sections.flatMap((s) => s.sources.map((src) => src.score));
  const trustScore = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0.5;

  logger.info(`[DocGenerator] 生成完成: ${sections.length} 章节, trustScore=${trustScore.toFixed(2)}`);

  return { content, sections, trustScore };
}

// ── 格式转换 ──────────────────────────────────────────

/** 转换为 HTML */
export function toHtml(result: GenerateDocResult): string {
  const sections = result.sections.map((s) => {
    const paragraphs = s.content.split("\n").filter((p) => p.trim()).map((p) => `<p>${p}</p>`).join("\n");
    return `<section><h2>${s.title}</h2>\n${paragraphs}</section>`;
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${result.sections[0]?.title ?? "文档"}</title></head>
<body>
<h1>${result.sections[0]?.title ?? "文档"}</h1>
${sections.join("\n<hr>\n")}
</body>
</html>`;
}
