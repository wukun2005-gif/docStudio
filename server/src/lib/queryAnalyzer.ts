/**
 * Query Analyzer — LLM-based NLU separation of content points vs format requirements
 *
 * 解决问题：用户 query 混合了内容要求（"团队规模与结构"）和格式要求（"标题区分隔线页码统一风格"）。
 * 旧方案用 regex 穷举删除指令词（buildRagQuery），无法覆盖所有格式。
 * 新方案用一次 LLM 调用，从用户 query + outline 中分离两类信息。
 *
 * 使用场景：
 * 1. RAG 检索（bug5）：用 contentPoints 构建检索 query，避免格式词污染 BM25
 * 2. 完整度检查（Bug4）：用 contentPoints 作为要验证的要点列表，忽略 formatRequirements
 */

import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens } from "./llmUtils.js";
import { jsonrepair } from "jsonrepair";
import type { OutlineSection } from "./narrativeEngine.js";

export interface SectionContentPoints {
  /** 章节标题（与 outline 中的 title 对应） */
  title: string;
  /** 该章节的内容要点 */
  contentPoints: string[];
}

export interface QueryAnalysis {
  /** 内容要点：用户希望文档覆盖的具体知识/数据/分析维度（全局平铺，用于完整度检查） */
  contentPoints: string[];
  /** 格式要求：排版、配色、图表类型、结构等非内容性要求 */
  formatRequirements: string[];
  /** 按章节分配的内容要点（用于 RAG 检索，避免跨章节污染） */
  sectionContentPoints: SectionContentPoints[];
}

const QUERY_ANALYZER_SYSTEM = `你是一个文档需求分析助手。你的任务是从用户的文档生成请求中，将内容要求和格式要求分离，并将内容要点分配到对应的章节。

**内容要求（content_points）**：用户希望文档覆盖的具体知识、数据、分析维度。
- 例如："团队规模与结构"、"部门分布"、"Q3核心功能交付情况"、"代码审查覆盖率与缺陷率"
- 这些是可以通过检索知识库来支撑的实质性内容

**格式要求（format_points）**：排版、配色、图表类型、结构、视觉风格等非内容性要求。
- 例如："每页3个信息点"、"深色专业配色"、"标题区分隔线页码统一"、"饼图展示职级分布"
- 也包括：图表类型要求（"用折线图展示趋势"）、表格结构要求（"表格包含仓库|提交数|PR合并数"）、文档格式（"PPT 5页"）
- 这些是设计/排版指令，不影响内容完整度判定

分类规则：
1. 如果一个要点同时包含内容和格式（如"用柱状图展示各部门人数"），拆分：内容="各部门人数"，格式="柱状图"
2. "从XXX获取"是数据来源提示，不是内容要点也不是格式要求 — 忽略
3. 表格列名（如"仓库 | 提交数 | PR合并数"）是格式要求（指定表格结构），不是内容要点
4. 图表类型（如"饼图"、"折线图"、"甘特图"）是格式要求
5. 纯视觉/排版（如"左右分栏"、"上下结构"、"紧凑排列"）是格式要求

**内容要点分配规则**：
- 将每个内容要点分配到最相关的章节中
- 一个内容要点只属于一个章节，不要重复分配
- 根据章节标题和描述判断归属，而非仅靠关键词匹配
- 例如"团队成员贡献度分析"应分配到"团队效能与协作分析"章节，而非"团队概览"章节

输出 JSON（不要输出 markdown 代码块）：
{
  "sections": [
    { "title": "章节1标题", "content_points": ["要点1", "要点2", ...] },
    { "title": "章节2标题", "content_points": ["要点1", "要点2", ...] },
    ...
  ],
  "format_points": ["格式要求1", "格式要求2", ...]
}`;

/**
 * 分析用户请求，分离内容要点和格式要求
 * 
 * @param userRequest 用户原始请求
 * @param outline 文档大纲（提供章节结构上下文）
 * @param providerId LLM provider
 * @param apiKey API key
 * @param modelId 模型 ID
 * @returns QueryAnalysis 或 null（LLM 调用失败时）
 */
export async function analyzeQuery(
  userRequest: string,
  outline: OutlineSection[],
  providerId: string,
  apiKey: string | undefined,
  modelId: string | undefined,
): Promise<QueryAnalysis | null> {
  const dbSettings = readSettingsFromDb();
  const providers = [providerId];
  const providerApiKeys: Record<string, string> = {};
  const key = apiKey ?? getApiKey(providerId);
  if (key) providerApiKeys[providerId] = key;

  // 使用与评估任务相同的模型选择逻辑
  const effectiveModelId = modelId ?? dbSettings.modelId ?? "mimo-v2-pro";
  const maxTokens = resolveEvalMaxTokens(effectiveModelId);

  // 构建大纲摘要
  const outlineSummary = outline.map((s, i) => {
    const children = s.children?.map(c => `  - ${c.title}`).join("\n") ?? "";
    return `第${i + 1}章【${s.title}】${s.description ?? ""}${children ? "\n" + children : ""}`;
  }).join("\n");

  const userPrompt = `## 用户原始请求

\`\`\`
${userRequest}
\`\`\`

## 文档大纲

${outlineSummary}

请从用户请求中提取内容要点和格式要求。`;

  try {
    logger.info(`[QueryAnalyzer] 开始分析: model=${effectiveModelId}, outlineSections=${outline.length}`);

    const jsonSchema = {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content_points: { type: "array", items: { type: "string" } },
            },
            required: ["title", "content_points"],
          },
        },
        format_points: { type: "array", items: { type: "string" } },
      },
      required: ["sections", "format_points"],
    };

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: QUERY_ANALYZER_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        apiKey: "",
        maxTokens,
        temperature: 0,
        timeoutMs: 30_000,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "query_analysis", strict: true, schema: jsonSchema },
        },
      },
      undefined, undefined,
      providerApiKeys,
      dbSettings.providerBaseUrls,
    );

    if (response.error) {
      logger.warn(`[QueryAnalyzer] LLM 调用失败: ${response.error.message}`);
      return null;
    }

    const text = response.text?.trim() ?? "";
    if (!text) {
      logger.warn(`[QueryAnalyzer] LLM 返回空内容`);
      return null;
    }

    let parsed: { sections?: { title?: string; content_points?: string[] }[]; format_points?: string[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = JSON.parse(jsonrepair(text));
    }

    // 解析按章节分配的内容要点
    const sectionContentPoints: SectionContentPoints[] = [];
    if (Array.isArray(parsed.sections)) {
      for (const sec of parsed.sections) {
        const title = typeof sec?.title === "string" ? sec.title.trim() : "";
        const points = Array.isArray(sec?.content_points)
          ? sec!.content_points.filter(p => typeof p === "string" && p.trim())
          : [];
        if (title && points.length > 0) {
          sectionContentPoints.push({ title, contentPoints: points });
        }
      }
    }

    // 全局平铺 contentPoints（用于完整度检查）
    const contentPoints = sectionContentPoints.flatMap(s => s.contentPoints);
    const formatRequirements = Array.isArray(parsed.format_points) ? parsed.format_points.filter(p => typeof p === "string" && p.trim()) : [];

    logger.info(`[QueryAnalyzer] 分析完成: sections=${sectionContentPoints.length}, contentPoints=${contentPoints.length}, formatRequirements=${formatRequirements.length}`);
    for (const sec of sectionContentPoints) {
      logger.info(`[QueryAnalyzer] 章节"${sec.title}": ${sec.contentPoints.join(" | ")}`);
    }
    logger.info(`[QueryAnalyzer] formatRequirements: ${formatRequirements.join(" | ")}`);

    return { contentPoints, formatRequirements, sectionContentPoints };
  } catch (err) {
    logger.warn(`[QueryAnalyzer] 分析失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 从 QueryAnalysis 构建按章节分组的 RAG 检索关键词
 * 
 * 优先使用 LLM 分配的 sectionContentPoints（语义准确），
 * fallback 到关键词匹配（已修复大小写不一致 bug）。
 * 如果 analysis 为 null（LLM 失败），fallback 到原始 title + description。
 */
export function buildRagQueryFromAnalysis(
  sectionTitle: string,
  sectionDescription: string | undefined,
  analysis: QueryAnalysis | null,
): string {
  if (!analysis) {
    // Fallback: 使用原始 title + description（不经过 regex 清理）
    // reranker 会处理指令词污染问题
    return sectionDescription ? `${sectionTitle} ${sectionDescription}` : sectionTitle;
  }

  // 优先：LLM 已按章节分配 contentPoints，直接查找匹配的章节
  if (analysis.sectionContentPoints.length > 0) {
    // 精确匹配章节标题
    let matched = analysis.sectionContentPoints.find(
      s => s.title === sectionTitle,
    );
    // 模糊匹配（LLM 可能微调了标题措辞）
    if (!matched) {
      matched = analysis.sectionContentPoints.find(
        s => s.title.includes(sectionTitle) || sectionTitle.includes(s.title),
      );
    }
    if (matched && matched.contentPoints.length > 0) {
      // 清理 contentPoints 中的元数据（如"（从People Graph获取）"、"（需调用API）"等）
      // 这些是数据来源说明，不是检索关键词，会污染 RAG 检索
      const cleanedPoints = matched.contentPoints.map(p =>
        p.replace(/（从[^）]*获取）/g, "")
         .replace(/\(从[^)]*获取\)/g, "")
         .replace(/（需[^）]*）/g, "")
         .replace(/\(需[^)]*\)/g, "")
         .replace(/（调用[^）]*）/g, "")
         .replace(/\(调用[^)]*\)/g, "")
         .trim()
      ).filter(p => p.length > 0);
      const query = `${sectionTitle} ${cleanedPoints.join(" ")}`;
      logger.info(`[QueryAnalyzer] RAG query (section-mapped): title="${sectionTitle}" → ${cleanedPoints.length} points`);
      return query;
    }
    // LLM 未分配该章节的 contentPoints → fallback 到关键词匹配
    logger.warn(`[QueryAnalyzer] 章节"${sectionTitle}"未在 sectionContentPoints 中找到，fallback 到关键词匹配`);
  }

  // Fallback: 关键词匹配（已修复大小写不一致 bug）
  const titleKeywords = extractKeywords(sectionTitle);
  const relevantPoints = analysis.contentPoints.filter(point => {
    const pointKeywords = extractKeywords(point);
    // 精确匹配（extractKeywords 已统一小写）
    return pointKeywords.some(kw => titleKeywords.includes(kw));
  });

  if (relevantPoints.length > 0) {
    return `${sectionTitle} ${relevantPoints.join(" ")}`;
  }

  // 如果没有匹配的 contentPoint，只用 title
  return sectionTitle;
}

/** 从文本中提取关键词（用于匹配）
 *  对英文按空格分词，对中文按 2-gram 分词，确保匹配不会漏掉
 *  所有 token 统一小写，避免 "Q3" vs "q3" 不匹配的 bug
 */
function extractKeywords(text: string): string[] {
  // 移除标点和常见虚词
  const cleaned = text
    .replace(/[【】\[\]()（）{}<>《》""''':：;；，。、！？\-\—\|]/g, " ")
    .replace(/\b(的|了|和|与|或|在|是|有|为|从|到|及|等|关于|需要|覆盖|包括|展示|介绍|分析|详细|情况|数据|信息|内容)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens: string[] = [];
  // 英文/数字按空格分词
  const words = cleaned.split(" ");
  for (const w of words) {
    if (/^[a-zA-Z0-9]+$/.test(w)) {
      if (w.length >= 2) tokens.push(w.toLowerCase());
      continue;
    }
    // 中文混合文本：提取所有连续 2-4 字子串作为关键词
    const seg = w.replace(/\s/g, "");
    if (seg.length >= 2 && seg.length <= 6) {
      tokens.push(seg.toLowerCase());
    } else if (seg.length > 6) {
      // 长句提取 2-gram 和 3-gram（统一小写，修复 "Q3" vs "q3" 不匹配 bug）
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.slice(i, i + 2).toLowerCase());
        if (i < seg.length - 2) tokens.push(seg.slice(i, i + 3).toLowerCase());
      }
    }
  }
  return [...new Set(tokens)]; // 去重
}
