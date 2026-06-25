/**
 * 文档生成引擎 — 基于大纲和 RAG 检索生成文档
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 * 集成：向量检索 + Web Search (MCP tool calling) + Groundedness Check
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { hybridSearch } from "./hybridSearch.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { executeWithTools } from "./toolExecutor.js";
import { checkGroundedness, type GroundingDoc } from "./groundednessCheck.js";
import { cleanContent, type CitationLink } from "./contentCleaner.js";
import { logger } from "./logger.js";
import { getDb } from "./db.js";
import type { OutlineSection } from "./narrativeEngine.js";
import type { ChatRequest, ToolDefinition, ToolCall } from "../providers/openai.js";

// ── 文档生成 ──────────────────────────────────────────

/** 从用户请求中动态识别文档类型，生成格式指引 */
function detectDocumentStyle(userRequest: string): { style: "email" | "ppt" | "table" | "code" | "report" | "general"; guide: string } {
  const req = userRequest.toLowerCase();

  // 邮件类
  if (/邮件|email|mail|写信|致函/.test(req)) {
    return {
      style: "email",
      guide: `这是一封邮件。请按邮件格式输出：
- 第一行写主题/标题
- 开头写称呼（如"XXX，你好："）
- 正文分段落，每段一个要点
- 结尾写问候语（如"此致"、"祝好"、"Best regards"）
- 最后署名
不要使用 markdown 格式（不要 # 标题、**粗体**、- 列表），用纯文本段落。`,
    };
  }

  // PPT/演示文稿
  if (/ppt|演示|slides|幻灯片|presentation/i.test(req)) {
    return {
      style: "ppt",
      guide: `这是一份演示文稿。请按 PPT 格式输出：
- 每个章节对应一页幻灯片
- 用要点列表（bullet points）呈现，每页 3-5 个要点
- 每个要点简洁有力，不超过 20 字
- 可以在页末加备注说明`,
    };
  }

  // 表格/Excel
  if (/表格|excel|sheet|数据表|报表|清单/i.test(req)) {
    return {
      style: "table",
      guide: `这是一个表格/数据文档。请按表格格式输出：
- 用 markdown 表格格式（| 列1 | 列2 | ... |）
- 表头清晰，列名简洁
- 数据对齐，内容精炼`,
    };
  }

  // 代码/技术文档
  if (/代码|code|api|sdk|技术文档|readme|接口/i.test(req)) {
    return {
      style: "code",
      guide: `这是一份技术文档。请按技术文档格式输出：
- 包含清晰的标题层级
- 代码用代码块包裹
- 参数说明用列表呈现
- 包含示例`,
    };
  }

  // 报告/汇报
  if (/报告|汇报|report|总结|分析/i.test(req)) {
    return {
      style: "report",
      guide: `这是一份报告。请按报告格式输出：
- 有清晰的标题和章节结构
- 每个章节有小标题
- 内容分段落，逻辑清晰
- 重要信息用粗体标注`,
    };
  }

  // 通用文档（默认）
  return {
    style: "general",
    guide: `请按正式文档格式输出，语言专业流畅，结构清晰。`,
  };
}

export interface GenerateDocRequest {
  title: string;
  outline: OutlineSection[];
  format: "docx" | "pptx" | "xlsx" | "html";
  providerPreference?: string[];
  modelId?: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
  signal?: AbortSignal;
  /** 用户原始需求（传递给 LLM 以理解文档类型） */
  userRequest?: string;
}

export interface GenerateDocResult {
  content: string;
  sections: Array<{
    title: string;
    content: string;
    sources: Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string }>;
    webCitations: Array<{ title: string; url: string; snippet: string }>;
    groundingScore: number;
    /** 照搬 patentExaminator：citation 编号→来源映射，确保正文 [N] 与参考来源列表一一对应 */
    citationLinks: CitationLink[];
  }>;
  trustScore: number;
  /** 文档风格（从 userRequest 动态识别） */
  documentStyle: "email" | "ppt" | "table" | "code" | "report" | "general";
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
): Promise<Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string }>> {
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

  // 批量查询 source 信息（文件名、URL）
  const sourceIds = [...new Set(results.map((r) => r.sourceId))];
  const sourceMap = new Map<string, { name: string; url?: string }>();
  const db = getDb();
  for (const sid of sourceIds) {
    const row = db.prepare("SELECT name, url FROM kb_sources WHERE id = ?").get(sid) as { name: string; url?: string } | undefined;
    if (row) sourceMap.set(sid, { name: row.name, url: row.url });
  }

  return results.map((r) => {
    const source = sourceMap.get(r.sourceId);
    return {
      chunkId: r.chunkId,
      content: r.content,
      score: r.score,
      sourceId: r.sourceId,
      sourceName: source?.name,
      sourceUrl: source?.url,
    };
  });
}

// ── 章节生成（带 tool calling + groundedness check） ────────

/** 将大纲转为可读的目录文本（参考 STORM：每章节 prompt 都包含完整大纲） */
function outlineToText(outline: OutlineSection[], indent: number = 0): string {
  return outline.map((s, i) => {
    const prefix = "  ".repeat(indent);
    const num = indent === 0 ? `${i + 1}.` : `${indent}.${i + 1}.`;
    const desc = s.description ? ` — ${s.description}` : "";
    const line = `${prefix}${num} ${s.title}${desc}`;
    const children = s.children.length > 0 ? outlineToText(s.children, indent + 1) : "";
    return children ? `${line}\n${children}` : line;
  }).join("\n");
}

async function generateSection(
  section: OutlineSection,
  rollingSummary: string,
  config: GenerateDocRequest,
  userRequest: string,
  /** 完整大纲（参考 STORM：提供文档全局视图） */
  fullOutline: OutlineSection[],
  documentStyle?: "email" | "ppt" | "table" | "code" | "report" | "general",
  sectionIndex: number = 0,
  /** 全局引用编号偏移量（照搬 patentExaminator：确保每个章节的引用编号全局唯一） */
  globalCitationOffset: number = 0,
  /** 是否是最后一个章节（用于邮件结尾） */
  isLastSection: boolean = false,
): Promise<{
  content: string;
  sources: Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string }>;
  webCitations: Array<{ title: string; url: string; snippet: string }>;
  groundingScore: number;
  citationLinks: CitationLink[];
}> {
  const sources = await retrieveForSection(section.title, section.description);
  // 照搬 patentExaminator：显示来源标签和相似度分数，帮助 LLM 判断引用权重
  // 注意：不在此处添加 [N] 编号，由 toolExecutor re-inject 统一提供编号
  const sourceText = sources.map((s, i) => {
    const sourceLabel = s.sourceName ? `《${s.sourceName}》` : '';
    return `${sourceLabel}（相似度: ${s.score.toFixed(2)}）\n${s.content}`;
  }).join("\n\n");

  const detected = detectDocumentStyle(userRequest);
  const effectiveStyle = documentStyle ?? detected.style;
  const formatGuide = detected.guide;

  const isFirstSection = sectionIndex === 0;
  const isEmail = effectiveStyle === "email";
  const totalSections = fullOutline.length;

  // ── Prompt 架构参考 STORM + OpenAI Cookbook ──
  // 1. 文档全局视图（大纲 + 前文摘要）
  // 2. 当前章节指令
  // 3. 参考信息（RAG 检索结果）
  // 4. 格式与约束
  const outlineText = outlineToText(fullOutline);

  const systemPrompt = `你是一个文档写作助手，负责为一篇完整文档撰写其中一个章节。

═══ 文档全局视图 ═══

文档类型：${formatGuide.split('\n')[0]}
用户需求：${userRequest}

完整文档大纲（共 ${totalSections} 个章节）：
${outlineText}

你正在撰写的是第 ${sectionIndex + 1}/${totalSections} 个章节："${section.title}"

═══ 前文已写内容摘要 ═══

${rollingSummary || "（这是第一个章节，暂无前文）"}

═══ 参考信息（知识库检索结果）═══

${sourceText || "（无参考信息）"}

═══ 写作要求 ═══

1. 直接输出章节正文内容，不要输出章节标题、不要输出章节编号（如"1."、"5."等）
2. 不要写「以下是...」「根据参考文档...」等引导语，直接输出内容
3. 不要写补充说明、注意事项等元信息
4. ${isFirstSection ? `这是第一个章节，请写称呼（如"XXX，你好："）。${isEmail ? "【注意】不要写邮件结尾（如\"此致\"、\"祝好\"、\"Best regards\"等）和署名，结尾由后续章节处理。" : ""}` : isEmail && isLastSection ? `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："）。但这是最后一个章节，请在内容末尾写上邮件结尾问候语（如"此致"、"祝好"、"Best regards"等）和署名（如"[你的名字]"）。` : `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："、"此致"等）。${isEmail ? "【注意】不要写邮件结尾和署名。" : ""}`}
5. 内容要与前文自然衔接，承上启下，不要重复前文已写过的内容
6. 如果参考信息不足，可以使用 web_search 工具搜索最新信息
7. 【重要】引用参考信息时，必须用 [N] 标记来源编号。系统会自动提供带编号的参考文档，请直接复用这些编号。
8. 【禁止】只允许引用系统提供的参考文档中的编号，绝对不要引用不存在的编号。如果某句话没有对应的参考来源，直接写出该句，不要添加任何引用标记。
9. ${isEmail ? "用纯文本段落输出，不要使用 markdown 格式（不要 # 标题、**粗体**、- 列表）" : "可以用 markdown 格式组织内容"}`;

  const userPrompt = `请为"${section.title}"章节撰写内容。${section.description ? `该章节要写：${section.description}` : ""}`;

  // 从用户设置读取 provider 优先级
  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = config.providerPreference ?? defaultProviders;

  const providerApiKeys: Record<string, string> = {};
  for (const pid of providers) {
    const key = config.apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  // 照搬 patentExaminator: 章节生成需要较长超时（reasoning tokens + 长文本生成耗时）
  const SECTION_TIMEOUT_MS = 180_000;

  const buildLLMCall = (overrides?: {
    messages?: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>;
    tools?: ToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
    timeoutMs?: number;
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
        timeoutMs: overrides?.timeoutMs ?? SECTION_TIMEOUT_MS,
        tools: overrides?.tools,
        tool_choice: overrides?.tool_choice,
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    ).then((r) => ({ text: r.response.text, toolCalls: r.response.toolCalls, error: r.response.error }));
  };

  // 读取 reranker 配置（照搬 patentExaminator: 从 settings 读取并传递给 toolExecutor）
  const rerankerConfig = dbSettings.knowledgeReranker;

  // 使用 toolExecutor（含 web search + 跨源融合重排）
  // 照搬 patentExaminator：传递 globalCitationOffset 和 sourceId，确保编号全局唯一
  // 注意：source 传 sourceName（人类可读），不是 chunkId（UUID）
  const result = await executeWithTools({
    systemPrompt,
    userPrompt,
    ragCitations: sources.map((s) => ({ source: s.sourceName || s.chunkId, score: s.score, excerpt: s.content, sourceId: s.sourceId })),
    callLLM: buildLLMCall,
    query: `${section.title} ${section.description ?? ""}`,
    timeoutMs: SECTION_TIMEOUT_MS,
    documentFormat: config.format,
    documentStyle: effectiveStyle,
    globalCitationOffset,
    ...(rerankerConfig ? { rerankerConfig } : {}),
  });

  // Groundedness Check（照搬 patentExaminator: LLM-as-Judge 验证）
  const groundingDocs: GroundingDoc[] = [
    ...sources.map((s) => ({ source: `知识库: ${s.chunkId}`, excerpt: s.content, score: s.score })),
    ...result.webSearchCitations.map((c) => ({ source: `Web Search: ${c.title}`, excerpt: c.snippet })),
  ];

  let finalContent = result.answer || `[生成失败: ${section.title}]`;
  let groundingScore = 0.5; // 默认值

  if (groundingDocs.length > 0 && finalContent.length > 50) {
    try {
      const groundedness = await checkGroundedness(finalContent, groundingDocs, {
        signal: config.signal,
        timeoutMs: SECTION_TIMEOUT_MS,
      });
      groundingScore = groundedness.groundingScore;
      if (groundedness.verdict === "fail" && groundedness.removedClaims.length > 0 && groundedness.output.length > 20) {
        // 只有真正移除了声明时才替换内容，避免误杀
        finalContent = groundedness.output;
        logger.info(`[DocGenerator] Groundedness 过滤: ${groundedness.removedClaims.length} 个声明被移除`);
      }
    } catch (err) {
      logger.warn(`[DocGenerator] Groundedness check 失败: ${err}`);
    }
  }

  // 内容清洗：移除元信息、处理 citation、markdown→HTML
  // 照搬 patentExaminator：使用 mergedCitations（与 re-inject 相同的数组）确保编号一致
  const citationLinks: CitationLink[] = result.mergedCitations.map((c, i) => ({
    index: globalCitationOffset + i + 1,
    title: c.title,
    url: c.url || "",
    sourceId: c.sourceId || "",
  }));
  finalContent = cleanContent(finalContent, config.format, citationLinks, effectiveStyle);

  return {
    content: finalContent,
    sources,
    webCitations: result.webSearchCitations,
    groundingScore,
    citationLinks,
  };
}

// ── 递归生成 ──────────────────────────────────────────

/** 从章节内容生成简短摘要（用于滚动上下文，参考 OpenAI Cookbook rolling summary） */
function summarizeSection(title: string, content: string, maxLen: number = 300): string {
  // 移除 HTML 标签和引用标记
  const plain = content.replace(/<[^>]+>/g, "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= maxLen) return `【${title}】${plain}`;
  // 截取前 maxLen 字，在句子边界截断
  const truncated = plain.slice(0, maxLen);
  const lastPeriod = Math.max(truncated.lastIndexOf("。"), truncated.lastIndexOf("；"), truncated.lastIndexOf("."));
  const summary = lastPeriod > 100 ? truncated.slice(0, lastPeriod + 1) : truncated + "...";
  return `【${title}】${summary}`;
}

async function generateSections(
  outline: OutlineSection[],
  parentContext: string,
  config: GenerateDocRequest,
  userRequest: string,
  /** 完整文档大纲（顶层传入，递归时保持不变） */
  fullOutline: OutlineSection[],
  documentStyle?: "email" | "ppt" | "table" | "code" | "report" | "general",
  /** 全局引用编号偏移量（照搬 patentExaminator） */
  globalCitationOffset: number = 0,
  /** 当前层级的最后一个章节是否是文档最后一个章节 */
  lastSectionIsDocEnd: boolean = true,
): Promise<GenerateDocResult["sections"]> {
  const sections: GenerateDocResult["sections"] = [];
  let currentCitationOffset = globalCitationOffset;
  // 滚动摘要：参考 OpenAI Cookbook，维护已生成章节的摘要（而非全文），控制 token 用量
  let rollingSummary = parentContext;

  for (let i = 0; i < outline.length; i++) {
    const section = outline[i];
    const globalIndex = sections.length; // 全局章节序号（含子章节）
    const isLastInCurrentLevel = i === outline.length - 1;
    // 最后一个章节：当前层级的最后一个，且它是文档末尾（没有子章节，或者子层级递归处理）
    const isLastSection = isLastInCurrentLevel && lastSectionIsDocEnd && section.children.length === 0;
    // 照搬 patentExaminator：传递全局引用偏移量
    const { content, sources, webCitations, groundingScore, citationLinks } = await generateSection(
      section, rollingSummary, config, userRequest, fullOutline, documentStyle, globalIndex, currentCitationOffset, isLastSection
    );
    sections.push({ title: section.title, content, sources, webCitations, groundingScore, citationLinks });

    // 更新全局引用偏移量（使用融合后的 citationLinks 数量，不是原始 sources 数量）
    // 照搬 patentExaminator：mergedCitations 是实际使用的来源，编号应该基于它
    currentCitationOffset += citationLinks.length;

    // 更新滚动摘要：参考 OpenAI Cookbook，每章节生成后更新 rolling summary
    // 总长度限制 3000 字，避免 token 溢出
    const sectionSummary = summarizeSection(section.title, content);
    rollingSummary = `${rollingSummary}\n${sectionSummary}`.slice(-3000);

    if (section.children.length > 0) {
      // 如果当前章节是当前层级最后一个，且标记了 lastSectionIsDocEnd，则子层级的最后一个章节是文档末尾
      const childLastIsDocEnd = isLastInCurrentLevel && lastSectionIsDocEnd;
      const childSections = await generateSections(
        section.children,
        rollingSummary,
        config,
        userRequest,
        fullOutline,
        documentStyle,
        currentCitationOffset,
        childLastIsDocEnd,
      );
      sections.push(...childSections);
      // 更新偏移量（子章节已经增加了，使用 citationLinks 数量）
      currentCitationOffset += childSections.reduce((sum, s) => sum + s.citationLinks.length, 0);
      // 子章节生成后，更新滚动摘要
      const lastChild = childSections[childSections.length - 1];
      if (lastChild) {
        const childSummary = summarizeSection(lastChild.title, lastChild.content);
        rollingSummary = `${rollingSummary}\n${childSummary}`.slice(-3000);
      }
    }
  }

  return sections;
}

/** 完整文档生成 */
export async function generateDocument(config: GenerateDocRequest): Promise<GenerateDocResult> {
  logger.info(`[DocGenerator] 开始生成: ${config.title}`);

  const userRequest = config.userRequest ?? config.title;
  const { style: documentStyle } = detectDocumentStyle(userRequest);

  const sections = await generateSections(config.outline, "", config, userRequest, config.outline, documentStyle);

  const content = sections.map((s) => `${s.title}\n\n${s.content}`).join("\n\n");

  // Trust Score: 使用各章节 groundedness check 的平均分（取代无意义的 RRF 均值）
  const groundingScores = sections.map((s) => s.groundingScore).filter((s) => s > 0);
  const trustScore = groundingScores.length > 0
    ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
    : 0.5;

  logger.info(`[DocGenerator] 生成完成: ${sections.length} 章节, trustScore=${trustScore.toFixed(2)} (groundedness), style=${documentStyle}`);

  return { content, sections, trustScore, documentStyle };
}

// ── 格式转换 ──────────────────────────────────────────

export function toHtml(result: GenerateDocResult): string {
  const isEmail = result.documentStyle === "email";

  // 照搬 patentExaminator：编号已经是全局的，不需要重编号
  // 直接使用章节内容
  const sections = result.sections.map((s, idx) => {
    if (isEmail) {
      return s.content;
    }
    return `<section>\n<h2>${escapeHtml(s.title)}</h2>\n${s.content}\n</section>`;
  });

  // 照搬 patentExaminator：从各章节的 citationLinks 构建全局 citation 映射
  // citationLinks 的 index 已经是全局编号（globalCitationOffset + i + 1）
  const allCitationLinks = result.sections.flatMap((s) => s.citationLinks);

  // 从正文中提取被引用的全局编号 [N]
  const fullText = sections.join("\n");
  const citedIndices = new Set<number>();
  const citePattern = /\[(\d+)\]/g;
  let citeMatch;
  while ((citeMatch = citePattern.exec(fullText)) !== null) {
    citedIndices.add(parseInt(citeMatch[1], 10));
  }

  // 清理无效引用：移除没有对应 citationLink 的 [N] 标记
  const validIndices = new Set(allCitationLinks.map((c) => c.index));
  const invalidIndices = [...citedIndices].filter((idx) => !validIndices.has(idx));
  if (invalidIndices.length > 0) {
    logger.warn(`[DocGenerator] 发现 ${invalidIndices.length} 个无效引用编号: [${invalidIndices.join("], [")}]，将被移除`);
    // 从 sections 中移除无效引用标记
    const cleanedSections = sections.map((content) => {
      let cleaned = content;
      for (const invalidIdx of invalidIndices) {
        // 移除 [invalidIdx] 标记（包括 HTML 包装的版本）
        cleaned = cleaned.replace(new RegExp(`<sup><a[^>]*>\\[${invalidIdx}\\]</a></sup>`, "g"), "");
        cleaned = cleaned.replace(new RegExp(`<sup><span[^>]*>\\[${invalidIdx}\\]</span></sup>`, "g"), "");
        cleaned = cleaned.replace(new RegExp(`<sup class="cite-ref">\\[${invalidIdx}\\]</sup>`, "g"), "");
        cleaned = cleaned.replace(new RegExp(`\\[${invalidIdx}\\]`, "g"), "");
      }
      return cleaned;
    });
    // 更新 sections
    sections.length = 0;
    sections.push(...cleanedSections);

    // 重新提取被引用的全局编号（清理后无效引用已移除）
    const cleanedFullText = sections.join("\n");
    citedIndices.clear();
    let cleanedCiteMatch;
    while ((cleanedCiteMatch = citePattern.exec(cleanedFullText)) !== null) {
      citedIndices.add(parseInt(cleanedCiteMatch[1], 10));
    }
  }

  // 照搬 patentExaminator：只保留被引用的 citationLinks，按编号排序
  const citedSources = allCitationLinks
    .filter((c) => citedIndices.has(c.index))
    .sort((a, b) => a.index - b.index);

  // 照搬 patentExaminator：参考来源列表使用 [N] 编号，与正文 citation 对应
  // 注意：不使用 <ol> 自动编号，因为 citedSources 的 index 可能不连续（如 [1] 和 [3]）
  const footnotes = citedSources.length > 0
    ? `<footer class="citations"><h3>参考来源</h3><div class="citation-list">${citedSources.map((s) => {
        // 知识库来源：链接到原始文件
        if (s.sourceId) {
          return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> <a href="/api/knowledge/sources/${escapeHtmlAttr(s.sourceId)}/file" target="_blank" rel="noopener" class="cite-kb-link">${escapeHtml(s.title)}</a></div>`;
        }
        // Web 来源：直接链接
        if (s.url) {
          return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> <a href="${escapeHtmlAttr(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></div>`;
        }
        return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> ${escapeHtml(s.title)}</div>`;
      }).join("")}</div></footer>`
    : "";

  const title = isEmail ? (result.sections[0]?.title ?? "邮件") : (result.sections[0]?.title ?? "文档");

  // 注意：不要输出 <html>/<head>/<body>，因为内容通过 dangerouslySetInnerHTML 注入到 app 的 div 中
  // 如果输出 <body>，CSS 的 body { max-width } 会泄露到整个页面
  const html = `<div class="doc-content">
${isEmail ? "" : `<h1>${escapeHtml(result.sections[0]?.title ?? "文档")}</h1>`}
${sections.join(isEmail ? "\n\n" : "\n<hr>\n")}
${footnotes}
</div>`;
  console.log(`[DocGenerator] toHtml — style=${result.documentStyle}, isEmail=${isEmail}, html length=${html.length}`);
  // 输出正文引用的编号和参考来源列表，便于调试
  const citedInText = [...new Set(html.match(/\[(\d+)\]/g) ?? [])].sort((a, b) => parseInt(a.slice(1, -1)) - parseInt(b.slice(1, -1)));
  const citedInList = [...new Set(html.match(/citation-num">\[(\d+)\]/g) ?? [])].map(m => m.match(/\[(\d+)\]/)?.[0] ?? '').sort((a, b) => parseInt(a.slice(1, -1)) - parseInt(b.slice(1, -1)));
  console.log(`[DocGenerator] 正文引用编号: ${citedInText.join(', ')}`);
  console.log(`[DocGenerator] 参考来源编号: ${citedInList.join(', ')}`);
  // 输出参考来源列表的完整 HTML，便于调试
  const footerMatch = html.match(/<footer class="citations">[\s\S]*?<\/footer>/);
  if (footerMatch) {
    console.log(`[DocGenerator] 参考来源列表 HTML:\n${footerMatch[0]}`);
  }
  return html;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
