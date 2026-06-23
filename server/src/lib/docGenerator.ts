/**
 * 文档生成引擎 — 基于大纲和 RAG 检索生成文档
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 * 集成：向量检索 + Web Search (MCP tool calling)
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { hybridSearch } from "./hybridSearch.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { executeWithTools } from "./toolExecutor.js";
import { logger } from "./logger.js";
import type { OutlineSection } from "./narrativeEngine.js";
import type { ChatRequest, ToolDefinition, ToolCall } from "../providers/openai.js";

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

// ── Embedding（复用 knowledge.ts 的逻辑） ──────────────

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

async function embedBatch(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const url = `${config.baseUrl}/embeddings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.modelId, input: texts.map((t) => t.slice(0, 500)) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Embedding API error ${resp.status}`);
  const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

function getEmbeddingConfig(): EmbeddingConfig | null {
  const dbSettings = readSettingsFromDb();
  if (dbSettings.knowledgeEmbedding) return dbSettings.knowledgeEmbedding;
  if (process.env.siliconflow_Key) {
    return { baseUrl: "https://api.siliconflow.cn/v1", apiKey: process.env.siliconflow_Key, modelId: "BAAI/bge-m3" };
  }
  return null;
}

// ── RAG 检索（带向量） ──────────────────────────────────

async function retrieveForSection(
  sectionTitle: string,
  description?: string,
): Promise<Array<{ chunkId: string; content: string; score: number }>> {
  const query = description ? `${sectionTitle} ${description}` : sectionTitle;

  // 尝试获取 query embedding
  let queryEmbedding: number[] | undefined;
  const embConfig = getEmbeddingConfig();
  if (embConfig) {
    try {
      const vectors = await embedBatch([query], embConfig);
      queryEmbedding = vectors[0];
    } catch (err) {
      logger.warn(`[DocGenerator] Query embedding failed, falling back to BM25: ${err}`);
    }
  }

  const results = hybridSearch(query, { limit: 3, useQueryExpansion: false, queryEmbedding });
  return results.map((r) => ({ chunkId: r.chunkId, content: r.content, score: r.score }));
}

// ── 章节生成（带 tool calling） ──────────────────────────

async function generateSection(
  section: OutlineSection,
  context: string,
  config: GenerateDocRequest,
  userRequest: string,
): Promise<{ content: string; sources: Array<{ chunkId: string; content: string; score: number }> }> {
  const sources = await retrieveForSection(section.title, section.description);
  const sourceText = sources.map((s, i) => `[${i + 1}] ${s.content}`).join("\n\n");

  const systemPrompt = `你是一个文档写作助手。根据以下信息生成文档章节内容。

章节标题：${section.title}
章节描述：${section.description ?? "无"}
${section.children.length > 0 ? `子章节：${section.children.map((c) => c.title).join(", ")}` : ""}

参考信息（知识库）：
${sourceText || "（无参考信息）"}

上下文：
${context || "（无上下文）"}

要求：
1. 内容准确，基于参考信息
2. 语言流畅，专业
3. 如果参考信息不足，可以使用 web_search 工具搜索最新信息
4. 输出纯文本，不要 markdown 格式`;

  const userPrompt = `用户原始需求：${userRequest}\n\n请为"${section.title}"章节生成内容。`;

  // 从用户设置读取 provider 优先级
  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = config.providerPreference ?? defaultProviders;

  const providerApiKeys: Record<string, string> = {};
  for (const pid of providers) {
    const key = config.apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const buildLLMCall = (overrides?: {
    messages?: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>;
    tools?: ToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
  }) => {
    return registry.runWithFallback(
      providers,
      {
        modelId: config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
        messages: (overrides?.messages ?? [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]) as ChatRequest["messages"],
        apiKey: "",
        temperature: 0.7,
        signal: config.signal,
        tools: overrides?.tools,
        tool_choice: overrides?.tool_choice,
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    ).then((r) => ({ text: r.response.text, toolCalls: r.response.toolCalls, error: r.response.error }));
  };

  // 使用 toolExecutor（含 web search）
  const result = await executeWithTools({
    systemPrompt,
    userPrompt,
    ragCitations: sources.map((s) => ({ source: s.chunkId, score: s.score, excerpt: s.content })),
    callLLM: buildLLMCall,
    query: `${section.title} ${section.description ?? ""}`,
  });

  return { content: result.answer || `[生成失败: ${section.title}]`, sources };
}

// ── 递归生成 ──────────────────────────────────────────

async function generateSections(
  outline: OutlineSection[],
  parentContext: string,
  config: GenerateDocRequest,
  userRequest: string,
): Promise<GenerateDocResult["sections"]> {
  const sections: GenerateDocResult["sections"] = [];

  for (const section of outline) {
    const { content, sources } = await generateSection(section, parentContext, config, userRequest);
    sections.push({ title: section.title, content, sources });

    if (section.children.length > 0) {
      const childSections = await generateSections(
        section.children,
        `${parentContext}\n\n${section.title}: ${content}`,
        config,
        userRequest,
      );
      sections.push(...childSections);
    }
  }

  return sections;
}

/** 完整文档生成 */
export async function generateDocument(config: GenerateDocRequest & { userRequest?: string }): Promise<GenerateDocResult> {
  logger.info(`[DocGenerator] 开始生成: ${config.title}`);

  const sections = await generateSections(config.outline, "", config, config.userRequest ?? config.title);

  const content = sections.map((s) => `${s.title}\n\n${s.content}`).join("\n\n");

  const allScores = sections.flatMap((s) => s.sources.map((src) => src.score));
  const trustScore = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0.5;

  logger.info(`[DocGenerator] 生成完成: ${sections.length} 章节, trustScore=${trustScore.toFixed(2)}`);

  return { content, sections, trustScore };
}

// ── 格式转换 ──────────────────────────────────────────

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
