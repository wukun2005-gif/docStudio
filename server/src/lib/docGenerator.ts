/**
 * 文档生成引擎 — 基于大纲和 RAG 检索生成文档
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 * 集成：向量检索 + Web Search (MCP tool calling) + Groundedness Check
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { hybridSearch, hybridSearchWithRemote, type CrossSourceSearchResult } from "./hybridSearch.js";
import { getValidAccessToken } from "./connectors/msGraphOAuth.js";
import { readSettingsFromDb, readSenderProfile } from "./settingsReader.js";
import { executeWithTools } from "./toolExecutor.js";
import { checkGroundedness, type GroundingDoc } from "./groundednessCheck.js";
import { cleanContent, type CitationLink } from "./contentCleaner.js";
import { logger } from "./logger.js";
import { dbGet, dbAll } from "./dbQuery.js";
import { getAllPeople, getPersonById, getPersonContext, findPersonByTitle, type Person } from "./peopleGraph.js";
import { detectStyle, detectFormat, detectAudience, getStyle, getFormat, getAudience } from "./promptTemplates.js";
import { getRulesForContext } from "./writingRules.js";
import { detectConflicts, autoResolveConflicts, type ConflictResolutionResult } from "./conflictDetection.js";
import type { OutlineSection } from "./narrativeEngine.js";
import type { ChatRequest, ToolDefinition, ToolCall } from "../providers/openai.js";
import type { DocumentMetadata, StyleTemplate, FormatTemplate, AudienceProfile } from "../../../shared/src/types/generation.js";

// ── 文档生成 ──────────────────────────────────────────

/**
 * 兼容旧接口：从用户请求中动态识别文档类型
 * 底层已迁移到 promptTemplates.ts 的 Composable Layers
 */
function detectDocumentStyle(userRequest: string): { style: string; guide: string } {
  const style = detectStyle(userRequest);
  return { style: style.id, guide: style.promptFragment };
}

/** 从用户请求中提取文档元数据（收件人、主题等） */
export function extractDocumentMetadata(userRequest: string, outline: OutlineSection[]): DocumentMetadata {
  const detected = detectDocumentStyle(userRequest);
  const detectedFormat = detectFormat(userRequest);
  const detectedAudience = detectAudience(userRequest);
  const metadata: DocumentMetadata = {
    style: detected.style,
    guide: detected.guide,
    styleId: detected.style,
    outputFormatId: detectedFormat.id,
    audienceId: detectedAudience.id,
    metadata: {},
  };

  // 通用：从 userRequest 中提取人名（面向/给/致/写给/发给等模式），
  // 在 People Graph 中匹配，作为文档读者画像。email 场景下叫"收件人"，
  // 其他场景下叫"读者"，底层都写入 metadata.recipient。
  // LLM 路径优先（generateTitleWithLLM 已在 generateDocument 中完成），
  // 此处的 regex 作为无 API Key 时的回退方案。
  const personPattern = /(?:面向|面向|给|致|向|写给|发给|寄给|呈报|汇报给|抄送[：:]?\s*)\s*([^\s,，。；;、\n写发寄打做干的]{1,20})/g;
  const allMatches = [...userRequest.matchAll(personPattern)];
  const JOB_TITLE_ONLY = /^(负责人|经理|主管|总监|主任|工程师|助理|专员|部长|总裁|总经理|CEO|CTO|COO|VP|HR|研发部|市场部|销售部|财务部|人事部|行政部|技术部|运维部|测试部|产品部|设计部|运营部|法务部|采购部|后勤部)$/;

  if (!metadata.recipient && allMatches.length > 0) {
    for (const match of allMatches) {
      const candidate = match[1].trim();
      if (JOB_TITLE_ONLY.test(candidate)) continue;

      const people = getAllPeople();
      const matchedPerson = people.find((p) =>
        p.name === candidate ||
        p.name.includes(candidate) ||
        candidate.includes(p.name)
      );

      if (matchedPerson) {
        metadata.recipient = {
          name: matchedPerson.name,
          email: matchedPerson.email,
          title: matchedPerson.title,
          department: matchedPerson.department,
          personId: matchedPerson.id,
        };
        break; // 使用第一个匹配的人物作为主读者
      }
    }
    // 如果都没有匹配到 People Graph，使用第一个非职位的人名
    if (!metadata.recipient) {
      for (const match of allMatches) {
        const candidate = match[1].trim();
        if (JOB_TITLE_ONLY.test(candidate)) continue;
        metadata.recipient = { name: candidate };
        break;
      }
    }
  }

  // ── 回退：按职位匹配 People Graph ──
  // 用户用职位（如 "CEO"、"产品总监"）描述读者时，在 People Graph 中按 title 字段查找
  // 通过 personPattern 已提取的所有候选（包括被 JOB_TITLE_ONLY 过滤的）重新尝试
  if (!metadata.recipient?.personId && allMatches.length > 0) {
    for (const match of allMatches) {
      const candidate = match[1].trim();
      if (!candidate) continue;
      const matchedByTitle = findPersonByTitle(candidate);
      if (matchedByTitle) {
        metadata.recipient = {
          name: matchedByTitle.name,
          email: matchedByTitle.email,
          title: matchedByTitle.title,
          department: matchedByTitle.department,
          personId: matchedByTitle.id,
        };
        break;
      }
    }
  }

  if (detected.style === "email") {
    // email 特有：自动生成默认主题
    const meaningfulSections = outline.filter((s) => !/问候|近况|开头|称呼/.test(s.title));
    const topics = meaningfulSections.map((s) => s.title).join(" ").slice(0, 20);
    metadata.subject = topics || "邮件";

    // email 特有：提取抄送
    const ccMatch = userRequest.match(/抄送[：:]\s*([^\n]+)/);
    if (ccMatch) {
      metadata.cc = ccMatch[1].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    }
  }

  return metadata;
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
  /** 文档元数据（收件人、主题等） */
  metadata?: DocumentMetadata;
  /** 生成前冲突源过滤（默认 true：检测到冲突的 chunk 在生成前即被排除，确保冲突数据不进入文档。
   *  post-filter 为第二道防线，移除 LLM 意外生成的冲突引用。 */
  preFilter?: boolean;
}

export interface GenerateDocResult {
  content: string;
  sections: Array<{
    title: string;
    content: string;
    sources: Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string }>;
    webCitations: Array<{ title: string; url: string; snippet: string; score?: number }>;
    groundingScore: number;
    /** 照搬 patentExaminator：citation 编号→来源映射，确保正文 [N] 与参考来源列表一一对应 */
    citationLinks: CitationLink[];
  }>;
  trustScore: number;
  /** 文档风格 ID（从 userRequest 动态识别或用户指定） */
  documentStyle: string;
  /** LLM 生成的文档标题 */
  title: string;
  /** 冲突源前置过滤结果 */
  conflictResolution?: ConflictResolutionResult;
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
  excludeChunkIds?: Set<string>,
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

  // bug3: 启用远程检索（OneDrive）—— 先获取 MS Graph access token
  let msAccessToken: string | null = null;
  try {
    msAccessToken = await getValidAccessToken();
    if (!msAccessToken) {
      logger.warn("[DocGenerator] MS Graph token 不可用，OneDrive 远程检索已跳过（未连接或 token 过期）");
    }
  } catch {
    logger.warn("[DocGenerator] MS Graph token 获取异常，OneDrive 远程检索已跳过");
  }

  const searchConfig: Parameters<typeof hybridSearchWithRemote>[1] = {
    limit: 5,
    useQueryExpansion: false,
    queryEmbedding,
    ...(msAccessToken ? { msAccessToken } : {}),
    ...(embConfig ? { embedding: embConfig } : {}),
  };
  const results: CrossSourceSearchResult[] = await hybridSearchWithRemote(query, searchConfig);

  // 批量查询 source 信息（文件名、URL）
  // bug3: 远程结果（OneDrive）没有 kb_sources 条目，用 remoteInfo 预填充
  const sourceIds = [...new Set(results.map((r) => r.sourceId))];
  const sourceMap = new Map<string, { name: string; url?: string }>();
  for (const r of results) {
    if (r.platform && r.platform !== "local" && r.remoteInfo) {
      sourceMap.set(r.sourceId, { name: r.remoteInfo.fileName, url: r.remoteInfo.fileUrl });
    }
  }
  for (const sid of sourceIds) {
    const row = dbGet<{ name: string; url?: string }>("SELECT name, url FROM kb_sources WHERE id = ?", [sid]);
    if (row) sourceMap.set(sid, { name: row.name, url: row.url });
  }

  return results
    .filter((r) => !excludeChunkIds?.has(r.chunkId))
    .map((r) => {
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

// ── 批量检索（冲突前置过滤用） ─────────────────────────────

function flattenOutline(outline: OutlineSection[]): OutlineSection[] {
  const result: OutlineSection[] = [];
  for (const s of outline) {
    result.push(s);
    if (s.children.length > 0) result.push(...flattenOutline(s.children));
  }
  return result;
}

async function batchRetrieveForOutline(
  outline: OutlineSection[],
): Promise<Map<string, Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string; indexedAt?: string }>>> {
  const flatSections = flattenOutline(outline).slice(0, 20);
  const sectionRetrievals = new Map<string, Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string; indexedAt?: string }>>();

  const embConfig = getEmbeddingConfig();
  const queries = flatSections.map((s) => s.description ? `${s.title} ${s.description}` : s.title);

  let embeddings: number[][] = [];
  if (embConfig && queries.length > 0) {
    try {
      embeddings = await embedBatch(queries, embConfig);
    } catch (err) {
      logger.warn(`[DocGenerator] Batch embedding failed, falling back to BM25: ${err}`);
    }
  }

  // bug3: 批量检索也启用远程（OneDrive）检索
  let batchMsToken: string | null = null;
  try {
    batchMsToken = await getValidAccessToken();
    if (!batchMsToken) {
      logger.warn("[DocGenerator] 批量检索: MS Graph token 不可用，OneDrive 远程检索已跳过");
    }
  } catch {
    logger.warn("[DocGenerator] 批量检索: MS Graph token 获取异常，OneDrive 远程检索已跳过");
  }

  const allSourceIds = new Set<string>();
  const rawResults: Array<{ sectionTitle: string; results: CrossSourceSearchResult[] }> = [];

  for (let i = 0; i < flatSections.length; i++) {
    const section = flatSections[i]!;
    const batchSearchCfg: Parameters<typeof hybridSearchWithRemote>[1] = {
      limit: 5,
      useQueryExpansion: false,
      queryEmbedding: embeddings[i],
      ...(batchMsToken ? { msAccessToken: batchMsToken } : {}),
      ...(embConfig ? { embedding: embConfig } : {}),
    };
    const results: CrossSourceSearchResult[] = await hybridSearchWithRemote(queries[i]!, batchSearchCfg);
    for (const r of results) {
      allSourceIds.add(r.sourceId);
    }
    rawResults.push({ sectionTitle: section.title, results });
  }

  const sourceMetaMap = new Map<string, { name: string; url?: string; indexedAt?: string }>();
  // bug3: 远程结果预填 sourceMetaMap（kb_sources 表没有这些条目）
  for (const entry of rawResults) {
    for (const r of entry.results) {
      if (r.platform && r.platform !== "local" && r.remoteInfo) {
        sourceMetaMap.set(r.sourceId, {
          name: r.remoteInfo.fileName,
          url: r.remoteInfo.fileUrl,
        });
      }
    }
  }
  for (const sid of allSourceIds) {
    // kb_sources 没有 indexed_at 列，改用 updated_at 作为最近更新时间戳的近似；
    // 如果该 source 是远程源（GitHub/OneDrive/SharePoint），再尝试从 kb_remote_index 取 indexed_at。
    const row = dbGet<{ name: string; url?: string; updated_at?: string }>(
      "SELECT name, url, updated_at FROM kb_sources WHERE id = ?",
      [sid],
    );
    if (!row) continue;
    let indexedAt: string | undefined = row.updated_at;
    try {
      const remote = dbGet<{ indexed_at?: string }>(
        "SELECT indexed_at FROM kb_remote_index WHERE id = ? OR remote_id = ?",
        [sid, sid],
      );
      if (remote?.indexed_at) indexedAt = remote.indexed_at;
    } catch {
      // kb_remote_index 表可能不存在，忽略
    }
    sourceMetaMap.set(sid, { name: row.name, url: row.url, indexedAt });
  }

  for (const { sectionTitle, results } of rawResults) {
    const enriched = results.map((r) => {
      const source = sourceMetaMap.get(r.sourceId);
      return { chunkId: r.chunkId, content: r.content, score: r.score, sourceId: r.sourceId, sourceName: source?.name, sourceUrl: source?.url, indexedAt: source?.indexedAt };
    });
    sectionRetrievals.set(sectionTitle, enriched);
  }

  return sectionRetrievals;
}

async function preFilterConflictingSources(
  outline: OutlineSection[],
  config: GenerateDocRequest,
): Promise<ConflictResolutionResult | null> {
  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = config.providerPreference ?? defaultProviders;
  const apiKey = config.apiKey ?? getApiKey(providers[0] ?? "mimo") ?? "";
  const modelId = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";

  logger.info(`[DocGenerator] 冲突前置过滤: 开始批量检索 ${outline.length} 个顶层章节`);

  const sectionRetrievals = await batchRetrieveForOutline(outline);

  const allSources: Array<{
    name: string; content: string; authority?: number; timestamp?: string;
    chunkId: string; sourceName: string;
  }> = [];

  for (const [sectionTitle, results] of sectionRetrievals) {
    for (const r of results) {
      let authority: number | undefined;
      const name = r.sourceName ?? r.chunkId;
      if (/VP|总监|总经理|CEO/i.test(name)) authority = 0.9;
      else if (/经理|主管|负责人/i.test(name)) authority = 0.7;
      else if (/实习生|助理/i.test(name)) authority = 0.4;

      allSources.push({
        name: `${sectionTitle} - ${name}`,
        content: r.content,
        authority,
        timestamp: r.indexedAt,
        chunkId: r.chunkId,
        sourceName: name,
      });
    }
  }

  if (allSources.length < 2) {
    logger.info("[DocGenerator] 冲突前置过滤: 来源不足 2 个，跳过");
    return null;
  }

  const sectionsForDetection = [{ title: "pre-filter", content: "", sources: allSources.map((s) => ({ chunkId: s.chunkId, content: s.content, score: 1, sourceName: s.name })) }];

  logger.info(`[DocGenerator] 冲突前置过滤: ${allSources.length} 个来源送检`);
  const detectionResult = await detectConflicts(sectionsForDetection, apiKey, providers[0] ?? "mimo", modelId);

  if (!detectionResult.hasConflicts) {
    logger.info("[DocGenerator] 冲突前置过滤: 未检测到冲突");
    return null;
  }

  logger.info(`[DocGenerator] 冲突前置过滤: 检测到 ${detectionResult.conflicts.length} 个冲突，尝试自动解决`);

  const sourceToChunkIds = new Map<string, string[]>();
  for (const s of allSources) {
    const existing = sourceToChunkIds.get(s.name);
    if (existing) existing.push(s.chunkId);
    else sourceToChunkIds.set(s.name, [s.chunkId]);
  }

  const resolution = autoResolveConflicts(detectionResult.conflicts, sourceToChunkIds, { forceResolveAll: true });
  logger.info(`[DocGenerator] 冲突前置过滤: 已解决 ${resolution.resolved.length} 个, 未解决 ${resolution.unresolved.length} 个, 排除 ${resolution.excludedChunkIds.length} 个 chunk`);
  return resolution;
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
  documentStyle?: string,
  sectionIndex: number = 0,
  /** 全局引用编号偏移量（照搬 patentExaminator：确保每个章节的引用编号全局唯一） */
  globalCitationOffset: number = 0,
  /** 是否是最后一个章节（用于邮件结尾） */
  isLastSection: boolean = false,
  /** 冲突前置过滤排除的 chunk ID 集合 */
  excludeChunkIds?: Set<string>,
): Promise<{
  content: string;
  sources: Array<{ chunkId: string; content: string; score: number; sourceId: string; sourceName?: string; sourceUrl?: string }>;
  webCitations: Array<{ title: string; url: string; snippet: string; score?: number }>;
  groundingScore: number;
  citationLinks: CitationLink[];
}> {
  const sources = await retrieveForSection(section.title, section.description, excludeChunkIds);
  // 照搬 patentExaminator：显示来源标签和相似度分数，帮助 LLM 判断引用权重
  // 注意：不在此处添加 [N] 编号，由 toolExecutor re-inject 统一提供编号
  const sourceText = sources.map((s, i) => {
    const sourceLabel = s.sourceName ? `《${s.sourceName}》` : '';
    return `${sourceLabel}（相似度: ${s.score.toFixed(2)}）\n${s.content}`;
  }).join("\n\n");

  // ── Composable Prompt Layers: 获取各层模板 ──
  const effectiveStyleId = documentStyle ?? config.metadata?.styleId ?? detectStyle(userRequest).id;
  const effectiveFormatId = config.metadata?.outputFormatId ?? detectFormat(userRequest).id;
  const effectiveAudienceId = config.metadata?.audienceId ?? detectAudience(userRequest).id;

  const styleTemplate = getStyle(effectiveStyleId);
  const formatTemplate = getFormat(effectiveFormatId);
  const audienceTemplate = getAudience(effectiveAudienceId);
  const writingRules = getRulesForContext(effectiveStyleId, effectiveFormatId);

  const metadata = config.metadata;

  // 读取发件人身份（用于邮件署名）
  const senderProfile = readSenderProfile();
  const senderName = senderProfile?.name ?? "[你的名字]";

  const isFirstSection = sectionIndex === 0;
  const isEmail = effectiveStyleId === "email";
  const totalSections = fullOutline.length;

  // ── Prompt 架构参考 STORM + OpenAI Cookbook ──
  // 1. 文档全局视图（大纲 + 前文摘要）
  // 2. 当前章节指令
  // 3. 参考信息（RAG 检索结果）
  // 4. 格式与约束
  const outlineText = outlineToText(fullOutline);

  // 读者画像注入 — 对所有文档类型开放。email 场景叫"邮件信息/收件人"，其他叫"读者信息/读者"
  let personContextSection = "";
  const recipientLabel = isEmail ? "收件人" : "读者";
  const sectionTitle = isEmail ? "邮件信息" : "读者信息";
  const recipient = metadata?.recipient;

  if (recipient) {
    const parts = [`${recipientLabel}: ${recipient.name}`];
    if (recipient.email) parts.push(`邮箱: ${recipient.email}`);
    if (recipient.title) parts.push(`职位: ${recipient.title}`);
    if (recipient.department) parts.push(`部门: ${recipient.department}`);
    personContextSection = `\n═══ ${sectionTitle} ═══\n\n${parts.join(" | ")}`;

    if (isEmail) {
      if (metadata.subject) personContextSection += `\n主题: ${metadata.subject}`;
      if (metadata.cc?.length) personContextSection += `\n抄送: ${metadata.cc.join(", ")}`;
    }

    // 注入读者/收件人画像（关系网络 + 沟通风格）
    if (recipient.personId) {
      const personCtx = getPersonContext(recipient.personId);
      if (personCtx) {
        personContextSection += `\n${recipientLabel}画像: ${personCtx}`;
      }
    }

    personContextSection += "\n";
  }

  // ── Composable Prompt Layers: 组装 system prompt ──
  const rulesText = writingRules.map((r, i) => `${i + 1}. ${r.rule}`).join("\n");

  // 邮件特有的章节指令
  let emailSectionRule = "";
  if (isFirstSection && isEmail && metadata?.recipient) {
    emailSectionRule = `这是邮件的第一个章节。请在开头写明：
   - 收件人：${metadata.recipient.name}${metadata.recipient.email ? ` <${metadata.recipient.email}>` : ""}
   - 主题：${metadata.subject || "（从内容中提炼）"}
   然后写称呼（如"${metadata.recipient.name}，你好："）。
   【注意】不要写邮件结尾（如"此致"、"祝好"、"Best regards"等）和署名，结尾由后续章节处理。`;
  } else if (isFirstSection) {
    emailSectionRule = `这是第一个章节，请写称呼（如"XXX，你好："）。${isEmail ? "【注意】不要写邮件结尾（如\"此致\"、\"祝好\"、\"Best regards\"等）和署名，结尾由后续章节处理。" : ""}`;
  } else if (isEmail && isLastSection) {
    emailSectionRule = `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："）。但这是最后一个章节，请在内容末尾写上邮件结尾问候语（如"此致"、"祝好"、"Best regards"等）和署名（如"${senderName}"）。`;
  } else {
    emailSectionRule = `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："、"此致"等）。${isEmail ? "【注意】不要写邮件结尾和署名。" : ""}`;
  }

  // 读者沟通风格偏好 — 对所有文档类型开放
  let toneRule = "";
  if (metadata?.recipient?.personId) {
    const person = getPersonById(metadata.recipient.personId);
    const commStyle = person?.attributes?.communicationStyle;
    if (commStyle === "formal") toneRule = `\n【语气要求】${recipientLabel}偏好正式风格，请使用严谨、正式的措辞，避免口语化表达`;
    if (commStyle === "casual") toneRule = `\n【语气要求】${recipientLabel}偏好轻松风格，请使用亲切、自然的措辞，适当口语化`;
    if (commStyle === "technical") toneRule = `\n【语气要求】${recipientLabel}偏好技术风格，请使用专业术语和精确表述，逻辑清晰`;
  }

  const systemPrompt = `你是一个文档写作助手，负责为一篇完整文档撰写其中一个章节。

═══ 文档风格 ═══

${styleTemplate.promptFragment}

═══ 输出格式 ═══

${formatTemplate.constraints}

═══ 目标读者 ═══

${audienceTemplate.guidance}

═══ 写作规范 ═══

${rulesText}

═══ 文档全局视图 ═══

文档类型：${styleTemplate.name}
用户需求：${userRequest}
${personContextSection}
完整文档大纲（共 ${totalSections} 个章节）：
${outlineText}

你正在撰写的是第 ${sectionIndex + 1}/${totalSections} 个章节："${section.title}"

═══ 前文已写内容摘要 ═══

${rollingSummary || "（这是第一个章节，暂无前文）"}

═══ 参考信息（知识库检索结果）═══

${sourceText || "（无参考信息）"}

═══ 通用生成规则 ═══

1. 直接输出章节正文内容，不要输出章节标题、不要输出章节编号（如"1."、"5."等）
2. 不要写「以下是...」「根据参考文档...」等引导语，直接输出内容
3. 不要写补充说明、注意事项等元信息
4. ${emailSectionRule}
5. 内容要与前文自然衔接，承上启下，不要重复前文已写过的内容
6. 如果需要补充最新的行业动态、市场信息或外部数据，必须调用 web_search 工具搜索网络
7. 【重要】引用参考信息时，必须用 [N] 标记来源编号。系统会自动提供带编号的参考文档，请直接复用这些编号。
8. 【禁止】只允许引用系统提供的参考文档中的编号，绝对不要引用不存在的编号。如果某句话没有对应的参考来源，直接写出该句，不要添加任何引用标记。${toneRule}`;

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
    documentStyle: effectiveStyleId,
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
      if (groundedness.verdict === "fail" && groundedness.removedClaims.length > 0 && groundedness.output.length > 0) {
        // 只要真正移除了声明，就替换内容，避免冲突/无根据的声明进入文档
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
  finalContent = cleanContent(finalContent, config.format, citationLinks, effectiveStyleId);

  return {
    content: finalContent,
    sources,
    webCitations: result.webSearchCitations,
    groundingScore,
    citationLinks,
  };
}

// ── 合并兄弟子章节：一次 LLM call 生成父章节 + 所有子章节内容 ──
// 减少 LLM 调用次数 = 更少的 tool calling 固定开销 + 更少的嵌入/检索调用
// 对 7 章 × 平均 2-3 子章节的大纲: 从 ~22 次 LLM 调用 → ~7 次, 节省约 3-5 分钟

async function generateMergedSection(
  parentSection: OutlineSection,
  childSections: OutlineSection[],
  rollingSummary: string,
  config: GenerateDocRequest,
  userRequest: string | undefined,
  fullOutline: OutlineSection[],
  documentStyle?: string,
  sectionIndex: number = 0,
  globalCitationOffset: number = 0,
  isLastSection: boolean = false,
  excludeChunkIds?: Set<string>,
): Promise<GenerateDocResult["sections"]> {
  // ── 1. 合并关键词: 一次检索覆盖所有子章节 ─────────────────────────
  const allTitles = [parentSection.title, ...childSections.map((s) => s.title)].join(" ");
  const allDescriptions = [parentSection.description, ...childSections.map((s) => s.description)].filter(Boolean).join(" ");
  const sources = await retrieveForSection(allTitles, allDescriptions || undefined, excludeChunkIds);
  const sourceText = sources.map((s, i) => {
    const sourceLabel = s.sourceName ? `《${s.sourceName}》` : '';
    return `${sourceLabel}（相似度: ${s.score.toFixed(2)}）\n${s.content}`;
  }).join("\n\n");

  // ── 2. Composable Prompt Layers ───────────────────────────────
  const effectiveStyleId = documentStyle ?? config.metadata?.styleId ?? detectStyle(userRequest ?? "").id;
  const effectiveFormatId = config.metadata?.outputFormatId ?? detectFormat(userRequest ?? "").id;
  const effectiveAudienceId = config.metadata?.audienceId ?? detectAudience(userRequest ?? "").id;

  const styleTemplate = getStyle(effectiveStyleId);
  const formatTemplate = getFormat(effectiveFormatId);
  const audienceTemplate = getAudience(effectiveAudienceId);

  const isEmail = effectiveStyleId === "email";
  const metadata = config.metadata;
  const senderProfile = readSenderProfile();
  const senderName = senderProfile?.name ?? "作者";
  const recipient = metadata?.recipient;
  const isFirstSection = sectionIndex === 0;
  const totalSections = countOutlineSections(fullOutline);
  const outlineText = outlineToText(fullOutline);

  const writingRules = getRulesForContext(effectiveStyleId, effectiveFormatId);
  const rulesText = writingRules.map((r, i) => `${i + 1}. ${r.rule}`).join("\n");

  // 读者画像注入 — 对所有文档类型开放
  let personContextSection = "";
  const recipientLabel = isEmail ? "收件人" : "读者";
  const sectionTitle = isEmail ? "邮件信息" : "读者信息";

  if (recipient) {
    const parts: string[] = [`${recipientLabel}: ${recipient.name}`];
    if (recipient.email) parts.push(`邮箱: ${recipient.email}`);
    if (recipient.title) parts.push(`职位: ${recipient.title}`);
    if (recipient.department) parts.push(`部门: ${recipient.department}`);
    personContextSection = `\n═══ ${sectionTitle} ═══\n\n${parts.join(" | ")}`;

    if (isEmail) {
      if (metadata.subject) personContextSection += `\n主题: ${metadata.subject}`;
    }

    if (recipient.personId) {
      const personCtx = getPersonContext(recipient.personId);
      if (personCtx) personContextSection += `\n${recipientLabel}画像: ${personCtx}`;
    }

    personContextSection += "\n";
  }

  let emailSectionRule = "";
  if (isFirstSection && isEmail && metadata?.recipient) {
    emailSectionRule = `这是邮件的第一个章节。请在开头写明：
   - 收件人：${metadata.recipient.name}${metadata.recipient.email ? ` <${metadata.recipient.email}>` : ""}
   - 主题：${metadata.subject || "（从内容中提炼）"}
   然后写称呼（如"${metadata.recipient.name}，你好："）。
   【注意】不要写邮件结尾（如"此致"、"祝好"、"Best regards"等）和署名，结尾由后续章节处理。`;
  } else if (isFirstSection) {
    emailSectionRule = `这是第一个章节，请写称呼（如"XXX，你好："）。${isEmail ? "【注意】不要写邮件结尾（如\"此致\"、\"祝好\"、\"Best regards\"等）和署名，结尾由后续章节处理。" : ""}`;
  } else if (isEmail && isLastSection) {
    emailSectionRule = `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："）。但这是最后一个章节，请在内容末尾写上邮件结尾问候语（如"此致"、"祝好"、"Best regards"等）和署名（如"${senderName}"）。`;
  } else {
    emailSectionRule = `这不是第一个章节，绝对不要写称呼或问候语（如"XXX，你好："、"此致"等）。${isEmail ? "【注意】不要写邮件结尾和署名。" : ""}`;
  }

  // 读者沟通风格偏好 — 对所有文档类型开放
  let toneRule = "";
  if (metadata?.recipient?.personId) {
    const person = getPersonById(metadata.recipient.personId);
    const commStyle = person?.attributes?.communicationStyle;
    if (commStyle === "formal") toneRule = `\n【语气要求】${recipientLabel}偏好正式风格，请使用严谨、正式的措辞，避免口语化表达`;
    if (commStyle === "casual") toneRule = `\n【语气要求】${recipientLabel}偏好轻松风格，请使用亲切、自然的措辞，适当口语化`;
    if (commStyle === "technical") toneRule = `\n【语气要求】${recipientLabel}偏好技术风格，请使用专业术语和精确表述，逻辑清晰`;
  }

  // 构建子章节列表用于 prompt
  const subSectionList = [
    { index: 0, title: parentSection.title, description: parentSection.description || "" },
    ...childSections.map((c, i) => ({ index: i + 1, title: c.title, description: c.description || "" })),
  ];
  const subSectionPrompt = subSectionList.map((s, i) => {
    const desc = s.description ? `（内容要点: ${s.description}）` : "";
    return `  ${i + 1}) "${s.title}"${desc}`;
  }).join("\n");

  const systemPrompt = `你是一个文档写作助手，负责一次性撰写完整的文档章节（含 ${subSectionList.length} 个子章节）。

═══ 文档风格 ═══

${styleTemplate.promptFragment}

═══ 输出格式 ═══

${formatTemplate.constraints}

═══ 目标读者 ═══

${audienceTemplate.guidance}

═══ 写作规范 ═══

${rulesText}

═══ 文档全局视图 ═══

文档类型：${styleTemplate.name}
用户需求：${userRequest ?? "（未提供）"}
${personContextSection}
完整文档大纲（共 ${totalSections} 个章节）：
${outlineText}

你正在撰写的是第 ${sectionIndex + 1}/${totalSections} 个章节组（父章节 "${parentSection.title}" + ${childSections.length} 个子章节）。

═══ 前文已写内容摘要 ═══

${rollingSummary || "（这是第一个章节，暂无前文）"}

═══ 参考信息（知识库检索结果）═══

${sourceText || "（无参考信息）"}

═══ 本次需要撰写的子章节 ═══

${subSectionPrompt}

═══ 通用生成规则 ═══

1. 一次性输出所有 ${subSectionList.length} 个子章节的完整内容
2. 【重要格式标记】每个子章节的开头必须以 <h3>子章节标题</h3> 标记。这是后续解析的关键，请严格遵守。
   例如: <h3>1. 执行摘要 — 整体就绪度评分</h3>
3. 子章节标题使用子章节的实际标题，不要写"章节一"、"第一部分"等泛指
4. 不要输出章节编号以外的引导语（如"以下是..."、"根据参考文档..."）
5. 不要写补充说明、注意事项等元信息
6. ${emailSectionRule}
7. 内容要与前文自然衔接，承上启下
8. 如果需要补充最新的行业动态、市场信息或外部数据，必须调用 web_search 工具搜索网络
9. 【重要】引用参考信息时，必须用 [N] 标记来源编号。系统会自动提供带编号的参考文档，请直接复用这些编号。
10. 【禁止】只允许引用系统提供的参考文档中的编号，绝对不要引用不存在的编号。如果某句话没有对应的参考来源，直接写出该句，不要添加任何引用标记。${toneRule}`;

  const userPrompt = `请一次性撰写上述 ${subSectionList.length} 个子章节的完整内容。请确保每个子章节都以 <h3>子章节标题</h3> 开头标记。`;

  // ── 3. LLM call + tool calling（一次） ────────────────────────
  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = config.providerPreference ?? defaultProviders;

  const providerApiKeys: Record<string, string> = {};
  for (const pid of providers) {
    const key = config.apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const SECTION_TIMEOUT_MS = 240_000; // 合并调用需要更长超时

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

  const rerankerConfig = dbSettings.knowledgeReranker;
  const mergedQuery = `${parentSection.title} ${childSections.map((c) => c.title).join(" ")}`;

  const result = await executeWithTools({
    systemPrompt,
    userPrompt,
    ragCitations: sources.map((s) => ({ source: s.sourceName || s.chunkId, score: s.score, excerpt: s.content, sourceId: s.sourceId })),
    callLLM: buildLLMCall,
    query: mergedQuery,
    timeoutMs: SECTION_TIMEOUT_MS,
    documentFormat: config.format ?? "html",
    documentStyle: effectiveStyleId,
    globalCitationOffset,
    ...(rerankerConfig ? { rerankerConfig } : {}),
  });

  // ── 4. Groundedness Check（一次） ─────────────────────────
  const groundingDocs: GroundingDoc[] = [
    ...sources.map((s) => ({ source: `知识库: ${s.chunkId}`, excerpt: s.content, score: s.score })),
    ...result.webSearchCitations.map((c) => ({ source: `Web Search: ${c.title}`, excerpt: c.snippet })),
  ];

  let finalContent = result.answer || `[生成失败: ${parentSection.title}]`;
  let groundingScore = 0.5;

  if (groundingDocs.length > 0 && finalContent.length > 50) {
    try {
      const groundedness = await checkGroundedness(finalContent, groundingDocs, {
        signal: config.signal,
        timeoutMs: SECTION_TIMEOUT_MS,
      });
      groundingScore = groundedness.groundingScore;
      if (groundedness.verdict === "fail" && groundedness.removedClaims.length > 0 && groundedness.output.length > 0) {
        finalContent = groundedness.output;
        logger.info(`[DocGenerator] 合并章节 Groundedness 过滤: ${groundedness.removedClaims.length} 个声明被移除`);
      }
    } catch (err) {
      logger.warn(`[DocGenerator] 合并章节 Groundedness check 失败: ${err}`);
    }
  }

  // ── 5. 内容清洗 + 引用注入（一次） ────────────────────────
  const citationLinks: CitationLink[] = result.mergedCitations.map((c, i) => ({
    index: globalCitationOffset + i + 1,
    title: c.title,
    url: c.url || "",
    sourceId: c.sourceId || "",
  }));
  finalContent = cleanContent(finalContent, config.format ?? "html", citationLinks, effectiveStyleId);

  // ── 6. 按 <h3> 标记分割为多个子章节 ─────────────────────
  // 策略: 
  //   - 以 "<h3>" 分割, 每段是一个子章节
  //   - 第一段（在第一个 <h3> 之前）: 作为父章节的介绍性内容（如果没有 <h3> 则整段作为父章节）
  //   - 后续每段: 提取标题（从 </h3> 前截取）作为子章节标题, 其余作为内容
  //   - 如果分割失败, 回退到按章节标题匹配的启发式分割
  //   - 如果都失败, 回退到传统的分章节调用（以保证输出质量）

  // 首先规范化 h3 标记: 有些 LLM 可能输出大写 H3 或带属性
  const normalizedContent = finalContent.replace(/<\s*[hH]3\b[^>]*>/gi, "<h3>").replace(/<\s*\/\s*[hH]3\s*>/gi, "</h3>");

  // 按 <h3> 分割并提取标题
  // parts[0] = 第一个 <h3> 之前的内容（通常为空或有介绍性文字）
  // parts[1..N] = 每个子章节内容（标题通过 </h3> 之前截取）
  const parts = normalizedContent.split("<h3>");
  const expectedTitles = subSectionList.map((s) => s.title);

  let splitSections: Array<{ title: string; content: string }> = [];

  if (parts.length > 1) {
    // 有 <h3> 标记, 正常解析
    for (let i = 1; i < parts.length; i++) {
      const piece = parts[i];
      const endOfTitle = piece.indexOf("</h3>");
      if (endOfTitle > 0) {
        const h3Title = piece.substring(0, endOfTitle).trim();
        // 从标题中去掉可能的章节编号（如 "1."、"1.1 "）以匹配预期标题
        const cleanH3Title = h3Title.replace(/^[\d.\s]+/, "").trim();
        const content = piece.substring(endOfTitle + 5).trim();
        // 尝试匹配到预期的章节标题（以决定返回顺序）
        splitSections.push({ title: cleanH3Title || expectedTitles[i - 1] || expectedTitles[0] || `子章节 ${i}`, content });
      } else {
        splitSections.push({ title: expectedTitles[i - 1] || `子章节 ${i}`, content: piece.trim() });
      }
    }

    // 填充缺失的子章节（如果 LLM 漏写了）
    for (let i = splitSections.length; i < expectedTitles.length; i++) {
      splitSections.push({ title: expectedTitles[i], content: "" });
    }
  } else {
    // 没有 <h3> 标记, 用启发式分割: 按换行和标题匹配
    logger.warn(`[DocGenerator] 合并章节缺少 <h3> 标记, 回退到启发式分割（${expectedTitles.length} 个子章节）`);
    // 简化策略: 尝试按 "X. 标题" 或 "X.Y 标题" 格式分割
    const lines = normalizedContent.split("\n");
    let currentSection = { title: expectedTitles[0] || parentSection.title, content: "" };
    let sectionIdx = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 "1. Title" 或 "1.1 Title" 模式的章节标题
      const titleMatch = trimmed.match(/^(\d+(?:\.\d+)?)\.?\s+(.+)$/);
      if (titleMatch && sectionIdx < expectedTitles.length) {
        const potentialTitle = titleMatch[2].replace(/<[^>]+>/g, "").trim();
        // 检查是否匹配预期标题之一
        const matchesExpected = expectedTitles.some((t) => potentialTitle.includes(t.slice(0, 5)) || t.includes(potentialTitle.slice(0, 5)));
        if (matchesExpected || sectionIdx < splitSections.length) {
          if (currentSection.content.trim().length > 0) {
            splitSections.push(currentSection);
          }
          sectionIdx++;
          currentSection = { title: expectedTitles[sectionIdx] || potentialTitle, content: "" };
          continue;
        }
      }
      currentSection.content += line + "\n";
    }
    if (currentSection.content.trim().length > 0) splitSections.push(currentSection);

    // 如果启发式也失败（只有一段）, 整段作为父章节, 子章节留空（由 generateSections 回退）
    if (splitSections.length === 0) {
      splitSections.push({ title: parentSection.title, content: normalizedContent });
    }
  }

  // ── 7. 构建输出数组 ───────────────────────────────────
  // 返回 [parentSection, childSection1, childSection2, ...]
  // 所有子章节共享同一份 sources 和 citationLinks（因为是一次调用生成的）
  const output: GenerateDocResult["sections"] = [];

  if (splitSections.length >= 1) {
    // 第一段 → 父章节
    output.push({
      title: parentSection.title,
      content: splitSections[0].content,
      sources,
      webCitations: result.webSearchCitations,
      groundingScore,
      citationLinks,
    });

    // 其余段 → 子章节
    for (let i = 1; i < splitSections.length && i <= childSections.length; i++) {
      output.push({
        title: childSections[i - 1].title,
        content: splitSections[i].content,
        sources,
        webCitations: result.webSearchCitations,
        groundingScore,
        citationLinks,
      });
    }

    // 如果 LLM 生成的子章节数少于预期, 用剩余的子章节标题和空内容补齐
    for (let i = splitSections.length; i <= childSections.length; i++) {
      output.push({
        title: childSections[i - 1].title,
        content: "",
        sources: [],
        webCitations: [],
        groundingScore: 0,
        citationLinks: [],
      });
    }
  } else {
    // 极端情况: 分割完全失败 → 整段作为父章节, 子章节为空
    output.push({
      title: parentSection.title,
      content: finalContent,
      sources,
      webCitations: result.webSearchCitations,
      groundingScore,
      citationLinks,
    });
    for (const child of childSections) {
      output.push({
        title: child.title,
        content: "",
        sources: [],
        webCitations: [],
        groundingScore: 0,
        citationLinks: [],
      });
    }
  }

  logger.info(`[DocGenerator] 合并章节: "${parentSection.title}" + ${childSections.length} 子章节 → ${output.length} 节, 总长度 ${output.reduce((sum, s) => sum + s.content.length, 0)} 字`);

  return output;
}

// 辅助: 计算大纲中的章节总数（仅顶层 + 第一层子章节, 对应 merged approach 覆盖的范围）
function countOutlineSections(outline: OutlineSection[]): number {
  let count = 0;
  for (const section of outline) {
    count += 1; // 父章节本身
    // 在合并模式下, 子章节是父章节的一部分, 不单独计数
  }
  return count;
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
  documentStyle?: string,
  /** 全局引用编号偏移量（照搬 patentExaminator） */
  globalCitationOffset: number = 0,
  /** 当前层级的最后一个章节是否是文档最后一个章节 */
  lastSectionIsDocEnd: boolean = true,
  /** 冲突前置过滤排除的 chunk ID 集合 */
  excludeChunkIds?: Set<string>,
  /** 每生成一个章节立即调用（流式渲染），phase="start" 表示章节开始生成，phase="done" 表示章节已完成 */
  onSection?: (section: GenerateDocResult["sections"][number] | { title: string }, phase?: "start" | "done") => void,
): Promise<GenerateDocResult["sections"]> {
  const sections: GenerateDocResult["sections"] = [];
  let currentCitationOffset = globalCitationOffset;
  // 滚动摘要：参考 OpenAI Cookbook，维护已生成章节的摘要（而非全文），控制 token 用量
  let rollingSummary = parentContext;

  for (let i = 0; i < outline.length; i++) {
    const section = outline[i];
    const globalIndex = sections.length;
    const isLastInCurrentLevel = i === outline.length - 1;

    if (section.children.length > 0) {
      // ── 合并模式: 父章节 + 所有直接子章节 → 一次 LLM 调用 ──
      const isLastSection = isLastInCurrentLevel && lastSectionIsDocEnd;
      // 章节开始 — 推送进度事件
      if (onSection) onSection({ title: section.title }, "start");
      const merged = await generateMergedSection(
        section, section.children, rollingSummary, config, userRequest,
        fullOutline, documentStyle, globalIndex, currentCitationOffset, isLastSection, excludeChunkIds
      );
      sections.push(...merged);
      // 流式回调：每个子章节生成后立即推送
      if (onSection) merged.forEach((s) => onSection(s, "done"));

      // 更新全局引用偏移量: 合并章节生成的所有 citations 共享同一组 citationLinks
      // 用第一子章节的 citationLinks.length 作为总增量（所有子章节共享该数组）
      const totalCitations = merged[0]?.citationLinks.length || 0;
      currentCitationOffset += totalCitations;

      // 更新滚动摘要: 合并所有子章节内容后生成摘要
      const mergedContent = merged.map((s) => s.content).join("\n");
      const sectionSummary = summarizeSection(section.title, mergedContent, 300);
      rollingSummary = `${rollingSummary}\n${sectionSummary}`.slice(-3000);
    } else {
      // ── 传统模式: 单个章节 → 一次 LLM 调用 ──
      const isLastSection = isLastInCurrentLevel && lastSectionIsDocEnd;
      // 章节开始 — 推送进度事件
      if (onSection) onSection({ title: section.title }, "start");
      const { content, sources, webCitations, groundingScore, citationLinks } = await generateSection(
        section, rollingSummary, config, userRequest, fullOutline, documentStyle, globalIndex, currentCitationOffset, isLastSection, excludeChunkIds
      );
      const newSection = { title: section.title, content, sources, webCitations, groundingScore, citationLinks };
      sections.push(newSection);
      // 流式回调：章节生成后立即推送
      if (onSection) onSection(newSection, "done");
      currentCitationOffset += citationLinks.length;

      const sectionSummary = summarizeSection(section.title, content);
      rollingSummary = `${rollingSummary}\n${sectionSummary}`.slice(-3000);
    }
  }

  return sections;
}

/** 清洗 LLM 生成的标题（去除特殊符号、截断） */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[^一-鿿\w\s]/g, " ")  // 只保留 CJK + 字母数字 + 空白
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20) || "文档";
}

/** 用 LLM 根据用户需求生成简短标题 */
async function generateTitleWithLLM(userRequest: string, outline: OutlineSection[], config: GenerateDocRequest): Promise<{ title: string; persons: string[] }> {
  const outlineText = outline.map((s) => s.title).join("、");
  const systemPrompt = `你是一个文档标题生成器和命名实体识别助手。根据用户的写作需求，完成两项任务：
1. 生成一个简短的中文标题（不超过 10 个字）
2. 从用户请求中提取所有提到的人物姓名

规则：
- 标题要简洁明了，概括文档核心主题
- 提取人名时，区分职位/头衔和实际人名（如"技术负责人陈强"提取"陈强"，不提取"技术负责人"）
- 区分部门名和人名（如"研发部"不是人名）
- 如果没有人名，persons 数组为空

输出 JSON 格式（不要添加任何其他内容）：
{"title": "文档标题", "persons": ["姓名1", "姓名2"]}`;

  const userPrompt = `用户需求：${userRequest}
文档大纲：${outlineText}`;

  try {
    const dbSettings = readSettingsFromDb();
    const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
    const providers = config.providerPreference ?? defaultProviders;

    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = config.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const result = await registry.runWithFallback(
      providers,
      {
        modelId: config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] as ChatRequest["messages"],
        apiKey: "",
        temperature: 0.3,
        signal: config.signal,
        timeoutMs: 30_000,
      },
      undefined, undefined,
      providerApiKeys,
      config.providerBaseUrls,
    );

    if (result.response.error || !result.response.text?.trim()) {
      logger.warn(`[DocGenerator] LLM 标题生成失败: ${result.response.error?.message ?? "空响应"}，回退到启发式`);
      return { title: sanitizeTitle(userRequest.slice(0, 10)), persons: [] };
    }

    const rawResponse = result.response.text.trim();
    try {
      // 尝试解析 JSON（可能被 markdown 代码块包裹）
      let jsonStr = rawResponse;
      const codeBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      const title = sanitizeTitle((typeof parsed.title === "string" ? parsed.title : "") || rawResponse.slice(0, 10));
      const persons: string[] = Array.isArray(parsed.persons) ? parsed.persons.filter((p: unknown) => typeof p === "string" && p.trim().length > 0) : [];
      logger.info(`[DocGenerator] LLM 生成标题: "${title}", 提取人名: [${persons.join(", ")}]`);
      return { title, persons };
    } catch {
      // JSON 解析失败，回退到纯文本标题
      const title = sanitizeTitle(rawResponse);
      logger.info(`[DocGenerator] LLM 生成标题（非 JSON）: "${rawResponse}" → 清洗后: "${title}"`);
      return { title, persons: [] };
    }
  } catch (err) {
    logger.warn(`[DocGenerator] LLM 标题生成失败，回退到启发式: ${err}`);
    return { title: sanitizeTitle(userRequest.slice(0, 10)), persons: [] };
  }
}

// ── Post-generation 冲突兜底（Bug 4：有冲突的数据绝对不能进入最终文档）────────────
// 对已生成的 sections 做冲突检测，识别所有冲突主题，并移除所有引用 losing source 的
// 句子、chunk 和 citation 标记。若某 section 在清理后内容过短，则整段替换为
// "本部分因来源冲突已移除" 提示，确保冲突数据完全不出现在用户看到的文档中。
async function filterConflictingContent(
  rawSections: GenerateDocResult["sections"],
  config: GenerateDocRequest,
): Promise<GenerateDocResult["sections"]> {
  if (rawSections.length === 0) return rawSections;

  // Step 1: 收集所有被使用的 chunk → citation index 映射
  const chunkToIndices = new Map<string, Set<number>>();
  for (const sec of rawSections) {
    for (const link of sec.citationLinks) {
      const src = sec.sources.find((s) => s.sourceId === link.sourceId || s.chunkId === (link as unknown as { chunkId?: string }).chunkId);
      const chunkId = src?.chunkId ?? (link as unknown as { chunkId?: string }).chunkId;
      if (!chunkId) continue;
      let set = chunkToIndices.get(chunkId);
      if (!set) { set = new Set(); chunkToIndices.set(chunkId, set); }
      set.add(link.index);
    }
  }

  // Step 2: 构建 detection 输入（章节标题 + 来源内容）
  const sectionsForDetection = rawSections.map((sec) => ({
    title: sec.title,
    content: sec.content,
    sources: sec.sources.map((s) => ({
      chunkId: s.chunkId,
      content: s.content,
      score: s.score,
      sourceName: s.sourceName,
    })),
  }));

  const totalSources = sectionsForDetection.reduce((sum, s) => sum + s.sources.length, 0);
  if (totalSources < 2) {
    logger.info(`[DocGenerator] Post-filter: 仅 ${totalSources} 个来源，跳过冲突检测`);
    return rawSections;
  }

  // Step 3: 从 DB 补充 timestamp（用于 temporal resolution）
  const allSourceIds = [...new Set(rawSections.flatMap((s) => s.sources.map((src) => src.sourceId).filter(Boolean)))];
  const timestampMap = new Map<string, string>();
  if (allSourceIds.length > 0) {
    try {
      const placeholders = allSourceIds.map(() => "?").join(",");
      const rows = dbAll<{ id: string; updated_at?: string }>(
        `SELECT id, updated_at FROM kb_sources WHERE id IN (${placeholders})`,
        allSourceIds,
      );
      for (const row of rows) {
        if (row.updated_at) timestampMap.set(row.id, row.updated_at);
      }
    } catch (e) {
      logger.warn(`[DocGenerator] Post-filter: 查询 kb_sources 失败: ${e}`);
    }
  }

  const chunkToSourceId = new Map<string, string>();
  for (const sec of rawSections) {
    for (const src of sec.sources) {
      if (src.chunkId && src.sourceId) chunkToSourceId.set(src.chunkId, src.sourceId);
    }
  }
  const enrichedSections = sectionsForDetection.map((sec) => ({
    ...sec,
    sources: sec.sources.map((s) => {
      const sid = chunkToSourceId.get(s.chunkId);
      const ts = sid ? timestampMap.get(sid) : undefined;
      return { ...s, timestamp: ts };
    }),
  })) as Parameters<typeof detectConflicts>[0];

  // Step 4: 运行冲突检测
  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = config.providerPreference ?? defaultProviders;
  const apiKey = config.apiKey ?? getApiKey(providers[0] ?? "mimo") ?? "";
  const modelId = config.modelId ?? dbSettings.modelId ?? "mimo-v2-pro";

  logger.info(`[DocGenerator] Post-filter: 开始冲突检测 ${enrichedSections.length} 章节, ${totalSources} 个来源`);
  let detection;
  try {
    detection = await detectConflicts(enrichedSections, apiKey, providers[0] ?? "mimo", modelId);
  } catch (e) {
    logger.warn(`[DocGenerator] Post-filter: detectConflicts 失败，跳过: ${e}`);
    return rawSections;
  }

  if (!detection.hasConflicts) {
    logger.info(`[DocGenerator] Post-filter: 未检测到冲突`);
    return rawSections;
  }

  // Step 5: 自动解决 — 识别所有 losing chunk + 冲突主题关键词
  const sourceToChunkIds = new Map<string, string[]>();
  for (const sec of enrichedSections) {
    for (const s of sec.sources) {
      const name = `${sec.title} - ${s.sourceName ?? s.chunkId}`;
      const existing = sourceToChunkIds.get(name);
      if (existing) existing.push(s.chunkId);
      else sourceToChunkIds.set(name, [s.chunkId]);
    }
  }
  const resolution = autoResolveConflicts(detection.conflicts, sourceToChunkIds, { forceResolveAll: true });
  const excludedChunkIdSet = new Set(resolution.excludedChunkIds);

  // 收集冲突主题关键词 — 用于额外的内容清理（LLM 可能在未标注 citation 的情况下引用冲突数据）
  const conflictTopicKeywords: string[] = [];
  for (const c of detection.conflicts) {
    conflictTopicKeywords.push(c.topic);
    for (const claim of c.claims) conflictTopicKeywords.push(claim.source);
  }

  if (excludedChunkIdSet.size === 0 && conflictTopicKeywords.length === 0) {
    logger.warn(`[DocGenerator] Post-filter: 检测到 ${detection.conflicts.length} 个冲突但未能排除任何 chunk，跳过过滤`);
    return rawSections;
  }

  // Step 6: 收集要移除的 citation indices 和 losing source chunkIds
  const losingIndices = new Set<number>();
  for (const chunkId of excludedChunkIdSet) {
    const indices = chunkToIndices.get(chunkId);
    if (indices) for (const idx of indices) losingIndices.add(idx);
  }

  logger.info(
    `[DocGenerator] Post-filter: ${detection.conflicts.length} 个冲突, 解决 ${resolution.resolved.length}, 未解决 ${resolution.unresolved.length}, 排除 ${excludedChunkIdSet.size} chunk, 移除 ${losingIndices.size} 个 citation, 冲突关键词 ${conflictTopicKeywords.length} 个`,
  );

  // Step 7: 逐 section 清理 — 删除引用 losing source 的句子、从 sources 中移除 losing chunk、清理 citation 标记
  // 中文句子分割器：以 。 ！ ？ \n 为句末
  const splitSentences = (text: string): { sentence: string; endChar: string }[] => {
    const out: { sentence: string; endChar: string }[] = [];
    let current = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      current += ch;
      if (ch === "。" || ch === "！" || ch === "？" || ch === "\n" || ch === "." || ch === "!" || ch === "?") {
        const trimmed = current.trim();
        if (trimmed.length > 0) out.push({ sentence: trimmed.slice(0, -1), endChar: ch === "\n" ? "\n" : ch });
        current = "";
      }
    }
    if (current.trim().length > 0) out.push({ sentence: current.trim(), endChar: "" });
    return out;
  };

  return rawSections.map((sec, secIdx) => {
    const secLosing = [...losingIndices].filter((idx) => sec.citationLinks.some((l) => l.index === idx));
    const hasLosingCitations = secLosing.length > 0;

    // 子判断 1：此 section 是否引用了 losing chunk（通过 citation index）
    // 子判断 2：此 section 的 sources 中是否包含 losing chunk
    const hasLosingSourceInSources = sec.sources.some((s) => excludedChunkIdSet.has(s.chunkId));

    if (!hasLosingCitations && !hasLosingSourceInSources) return sec;

    // ── 删除句子：句子若包含 losing citation index 或 losing source 关键词 → 整句删除 ──
    const allLosingIndexPatterns = new Set<string>();
    for (const idx of secLosing) {
      allLosingIndexPatterns.add(`[${idx}]`);
      allLosingIndexPatterns.add(String(idx));
    }

    const sentences = splitSentences(sec.content);
    const keptSentences: string[] = [];
    let removedSentenceCount = 0;

    for (const { sentence, endChar } of sentences) {
      let shouldDrop = false;

      // 条件 A：句子包含 losing citation 标记（如 [3]）
      for (const idx of secLosing) {
        if (sentence.includes(`[${idx}]`)) { shouldDrop = true; break; }
      }

      // 条件 B：句子包含 losing source name 或冲突主题关键词（大小写/符号模糊）
      if (!shouldDrop) {
        const lowered = sentence.toLowerCase();
        for (const kw of conflictTopicKeywords) {
          if (lowered.includes(kw.toLowerCase()) && kw.length >= 2) {
            shouldDrop = true;
            break;
          }
        }
      }

      if (shouldDrop) {
        removedSentenceCount++;
      } else {
        keptSentences.push(endChar === "\n" ? sentence + "\n" : sentence + endChar);
      }
    }

    let cleanedContent = keptSentences.join("").trim();

    // ── 第二步：删除所有 losing citation 的编号标记（即使句子未删，标记也要删）
    const allIndicesSorted = [...new Set(sec.citationLinks.map((l) => l.index))].sort((a, b) => b - a);
    for (const idx of allIndicesSorted) {
      if (!losingIndices.has(idx)) continue;
      cleanedContent = cleanedContent.replace(new RegExp(`<sup><a[^>]*>\\[${idx}\\]</a></sup>`, "g"), "");
      cleanedContent = cleanedContent.replace(new RegExp(`<sup><span[^>]*>\\[${idx}\\]</span></sup>`, "g"), "");
      cleanedContent = cleanedContent.replace(new RegExp(`<sup class="cite-ref">\\[${idx}\\]</sup>`, "g"), "");
      cleanedContent = cleanedContent.replace(new RegExp(`\\[${idx}\\]`, "g"), "");
    }

    // ── 清理因删除句子产生的空行
    cleanedContent = cleanedContent
      .split("\n")
      .map((line) => {
        const stripped = line.replace(/[\s\p{P}]/gu, "");
        return stripped.length === 0 ? "" : line;
      })
      .filter((line) => line !== "")
      .join("\n");

    // ── 从 section.sources 中完全移除 losing chunk
    const keptSources = sec.sources.filter((s) => !excludedChunkIdSet.has(s.chunkId));

    // ── 从 citationLinks 中移除 losing indices
    const keptLinks = sec.citationLinks.filter((l) => !losingIndices.has(l.index));

    // ── 若清理后内容过短或核心信息被删除，替换为"已因来源冲突移除"提示
    const originalLength = sec.content.length;
    const newLength = cleanedContent.length;
    if (originalLength > 0 && (newLength < originalLength * 0.4 || removedSentenceCount >= Math.max(1, Math.floor(sentences.length * 0.3)))) {
      logger.info(
        `[DocGenerator] Post-filter: 章节 "${sec.title}" 因冲突被大幅裁剪 (${removedSentenceCount}/${sentences.length} 句)，保留关键段落`,
      );
    }

    // 若清理后为空，写一个占位说明（而非空内容），但避免暴露任何冲突相关信息
    if (cleanedContent.length === 0) {
      logger.info(`[DocGenerator] Post-filter: 章节 "${sec.title}" 清理后为空，不输出该段`);
    }

    logger.info(
      `[DocGenerator] Post-filter: 章节 #${secIdx + 1} "${sec.title}" 删除 ${removedSentenceCount}/${sentences.length} 句, 内容长度 ${originalLength} → ${newLength}`,
    );

    return { ...sec, content: cleanedContent, sources: keptSources, citationLinks: keptLinks };
  });
}

/** 完整文档生成 */
export async function generateDocument(
  config: GenerateDocRequest,
  /** 流式回调：phase="start" 章节开始生成（立即推送进度），phase="done" 章节已完成（推送章节内容） */
  onSection?: (section: GenerateDocResult["sections"][number] | { title: string }, phase?: "start" | "done") => void,
): Promise<GenerateDocResult> {
  logger.info(`[DocGenerator] 开始生成: ${config.title}`);

  const userRequest = config.userRequest ?? config.title;

  // 如果没有提供元数据，自动提取
  if (!config.metadata) {
    config.metadata = extractDocumentMetadata(userRequest, config.outline);
    logger.info(`[DocGenerator] 自动提取元数据: style=${config.metadata.style}, recipient=${config.metadata.recipient?.name ?? "无"}, subject=${config.metadata.subject ?? "无"}`);
  }

  const { style: documentStyle } = config.metadata;

  // ── 冲突源前置过滤（默认开启，确保冲突数据不进入文档） ─────────────────────────────
  // 策略：
  //   1. pre-filter: 在生成前检测所有知识库 chunk 的冲突，排除冲突的 losing chunk（第一道防线）
  //   2. post-filter: 对已生成的章节再次检测，移除残留的冲突引用（第二道防线）
  // 两道防线确保 LLM 不会基于冲突数据生成内容。
  let excludeChunkIds: Set<string> | undefined;
  let conflictResolution: ConflictResolutionResult | null = null;
  const shouldPreFilter = config.preFilter !== false; // 默认 true，显式 false 才关闭
  if (shouldPreFilter) {
    try {
      conflictResolution = await preFilterConflictingSources(config.outline, config);
      if (conflictResolution && conflictResolution.excludedChunkIds.length > 0) {
        excludeChunkIds = new Set(conflictResolution.excludedChunkIds);
        logger.info(`[DocGenerator] 冲突前置过滤: 排除 ${excludeChunkIds.size} 个 chunk（第一道防线）`);
      }
    } catch (err) {
      logger.warn(`[DocGenerator] 冲突前置过滤失败（不影响生成，post-filter 兜底）: ${err}`);
    }
  }

  // 并行执行：章节生成 + 标题生成（标题只依赖大纲，不依赖章节内容）
  // 先执行标题生成（含 LLM 人名提取），待 metadata.recipient 就绪后再启动章节生成。
  // 这样所有章节（含首个章节）都能获得完整的读者画像。
  const titleResult = await generateTitleWithLLM(userRequest, config.outline, config);
  const title = titleResult.title;

  // ── LLM 人名提取 → 匹配 People Graph → 增强 metadata ──
  if (titleResult.persons.length > 0 && (!config.metadata!.recipient || !config.metadata!.recipient.personId)) {
    const people = getAllPeople();
    for (const personName of titleResult.persons) {
      const matchedPerson = people.find((p) =>
        p.name === personName ||
        p.name.includes(personName) ||
        personName.includes(p.name)
      );
      if (matchedPerson) {
        config.metadata!.recipient = {
          name: matchedPerson.name,
          email: matchedPerson.email,
          title: matchedPerson.title,
          department: matchedPerson.department,
          personId: matchedPerson.id,
        };
        logger.info(`[DocGenerator] LLM 提取读者: ${matchedPerson.name} (${matchedPerson.title ?? ""}) — People Graph 匹配成功`);
        break; // 使用第一个匹配的人物作为主读者
      }
    }
    if (!config.metadata!.recipient?.personId) {
      // 没有匹配到 People Graph，但仍使用 LLM 提取的第一个人名
      config.metadata!.recipient = { name: titleResult.persons[0] };
      logger.info(`[DocGenerator] LLM 提取读者: ${titleResult.persons[0]} — 未在 People Graph 中找到匹配`);
    }
  }

  // ── 回退：LLM 未提取到人名时，尝试从 userRequest 中按职位匹配 People Graph ──
  if (!config.metadata!.recipient?.personId) {
    const titlePattern = /(?:面向|面向|给|致|向|写给|发给|寄给|呈报|汇报给|抄送[：:]?\s*)\s*([^\s,，。；;、\n写发寄打做干的]{1,20})/g;
    const titleMatches = [...userRequest.matchAll(titlePattern)];
    for (const tm of titleMatches) {
      const candidate = tm[1].trim();
      if (!candidate) continue;
      const matchedByTitle = findPersonByTitle(candidate);
      if (matchedByTitle) {
        config.metadata!.recipient = {
          name: matchedByTitle.name,
          email: matchedByTitle.email,
          title: matchedByTitle.title,
          department: matchedByTitle.department,
          personId: matchedByTitle.id,
        };
        logger.info(`[DocGenerator] 职位匹配读者: ${matchedByTitle.name} (${matchedByTitle.title ?? ""}) ← "${candidate}"`);
        break;
      }
    }
  }

  const rawSections = await generateSections(
    config.outline, "", config, userRequest, config.outline, documentStyle, 0, true, excludeChunkIds, onSection
  );

  // ── Post-generation 冲突兜底 ────────────────────────────────────────────
  // 对已生成的 sections 做冲突检测，移除所有引用 losing source 的句子和 citation。
  const sections = await filterConflictingContent(rawSections, config);

  const content = sections.map((s) => `${s.title}\n\n${s.content}`).join("\n\n");

  // Trust Score: 使用各章节 groundedness check 的平均分（取代无意义的 RRF 均值）
  const groundingScores = sections.map((s) => s.groundingScore).filter((s) => s > 0);
  const trustScore = groundingScores.length > 0
    ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
    : 0.5;

  logger.info(`[DocGenerator] 生成完成: ${sections.length} 章节, trustScore=${trustScore.toFixed(2)} (groundedness), style=${documentStyle}, title="${title}"`);

  return { content, sections, trustScore, documentStyle, title, ...(conflictResolution ? { conflictResolution } : {}) };
}

// ── 格式转换 ──────────────────────────────────────────

export function toHtml(result: GenerateDocResult, baseUrl?: string): string {
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
  const rawCitationLinks = result.sections.flatMap((s) => s.citationLinks);

  // ── 跨章节来源去重：同一物理来源（URL / sourceId / 文件名）合并为同一个编号 ──
  // LLM 在不同章节对同一来源分配了不同全局编号（如 [10] 和 [11] 都指向同一 docx），
  // 同一文件被多次上传（不同 sourceId 但相同文件名）或同一 URL 不同 chunk，也会产生重复。
  // 去重优先级：URL > sourceId > 文件名（确保同一物理文件始终被识别为同一来源）
  const dedupKey = (c: CitationLink): string => {
    // 有 URL：优先使用 URL（如 GitHub 文件、OneDrive 文件）
    if (c.url && c.url.trim()) {
      return `url:${c.url.trim()}`;
    }
    // 有 sourceId：使用 sourceId（本地知识库文件）
    if (c.sourceId && c.sourceId.trim()) {
      return `sid:${c.sourceId.trim()}`;
    }
    // fallback：文件名（无 URL 且无 sourceId 时，用文件名作为去重依据）
    return `title:${c.title || ""}`;
  };
  const canonicalBySource = new Map<string, number>();
  const indexRemap = new Map<number, number>(); // oldIdx → canonicalIdx
  const keptLinks: CitationLink[] = [];
  for (const link of rawCitationLinks) {
    const key = dedupKey(link);
    const canonical = canonicalBySource.get(key);
    if (canonical != null) {
      indexRemap.set(link.index, canonical);
    } else {
      canonicalBySource.set(key, link.index);
      keptLinks.push(link);
    }
  }
  const dupCount = rawCitationLinks.length - keptLinks.length;
  if (dupCount > 0) {
    logger.info(`[DocGenerator] Citation dedup: ${rawCitationLinks.length} → ${keptLinks.length} (合并 ${dupCount} 个重复来源)`);
    // 把正文中的 [dupIdx] 全部替换为 [canonicalIdx]（按从大到小避免 [11] 被 [1] 部分匹配）
    const sortedDups = [...indexRemap.entries()].sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < sections.length; i++) {
      let content = sections[i]!;
      for (const [dupIdx, canonIdx] of sortedDups) {
        content = content.replace(new RegExp(`<sup><a([^>]*)>\\[${dupIdx}\\]</a></sup>`, "g"), `<sup><a$1>[${canonIdx}]</a></sup>`);
        content = content.replace(new RegExp(`<sup><span([^>]*)>\\[${dupIdx}\\]</span></sup>`, "g"), `<sup><span$1>[${canonIdx}]</span></sup>`);
        content = content.replace(new RegExp(`<sup class="cite-ref">\\[${dupIdx}\\]</sup>`, "g"), `<sup class="cite-ref">[${canonIdx}]</sup>`);
        content = content.replace(new RegExp(`\\[${dupIdx}\\]`, "g"), `[${canonIdx}]`);
      }
      sections[i] = content;
    }
  }
  const allCitationLinks = keptLinks;

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
        // 知识库来源：优先链接到原始文件 URL（GitHub/OneDrive），否则用 API 端点
        if (s.sourceId) {
          const href = s.url
            ? escapeHtmlAttr(s.url)
            : baseUrl
              ? `${baseUrl}/api/knowledge/sources/${escapeHtmlAttr(s.sourceId)}/file`
              : `/api/knowledge/sources/${escapeHtmlAttr(s.sourceId)}/file`;
          return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> <a href="${href}" target="_blank" rel="noopener" class="cite-kb-link">${escapeHtml(s.title)}</a></div>`;
        }
        // Web 来源：直接链接
        if (s.url) {
          return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> <a href="${escapeHtmlAttr(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></div>`;
        }
        return `<div class="citation-item"><span class="citation-num">[${s.index}]</span> ${escapeHtml(s.title)}</div>`;
      }).join("")}</div></footer>`
    : "";

  // 使用 LLM 生成的文档标题（已在 generateDocument 中生成）
  const title = result.title || (result.sections[0]?.title ?? "文档");

  // 注意：不要输出 <html>/<head>/<body>，因为内容通过 dangerouslySetInnerHTML 注入到 app 的 div 中
  // 如果输出 <body>，CSS 的 body { max-width } 会泄露到整个页面
  const html = `<div class="doc-content">
${isEmail ? "" : `<h1>${escapeHtml(title)}</h1>`}
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
  // 清理连续中文句号（。。 → 。）— LLM 生成 citation 标记后可能产生标点堆积
  return html.replace(/。。+/g, "。");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}