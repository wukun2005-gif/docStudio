/**
 * Tool Executor — LLM tool calling + 跨源融合重排 + re-inject
 *
 * 流程：
 * 1. 所有轮次都用 tool_choice=auto：LLM 自主判断是否调用 web_search 或其他工具
 *    - 不再强制第一轮搜索，完全由 LLM 根据问题需求自主决定
 * 2. 无 tool calls → LLM 直接回答，结束 loop
 * 3. 跨源融合（RAG + Web）→ 三级降级重排 → re-inject → 最终回答
 */
import { logger } from "./logger.js";
import { mcpClient } from "../mcp/mcpClient.js";
import type { ToolDefinition, ToolCall } from "../providers/openai.js";
import { localRerank, remoteRerank, type RerankInput, type RerankerConfig } from "./reranker.js";
import { dbAll } from "./dbQuery.js";

const MAX_TOOL_ROUNDS = 3;
const TOP_K = 5;

interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ToolExecutorInput {
  systemPrompt: string;
  userPrompt: string;
  ragCitations: Array<{ source: string; score: number; excerpt: string; sourceId?: string }>;
  callLLM: (overrides?: {
    messages?: LLMMessage[];
    tools?: ToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
    timeoutMs?: number;
    /** temperature 覆盖；不传时使用 buildLLMCall 的默认值 */
    temperature?: number;
  }) => Promise<{ text: string; toolCalls?: ToolCall[]; error?: { code: string; message: string } }>;
  query: string;
  rerankerConfig?: { baseUrl: string; apiKey: string; modelId: string };
  /** 每次 LLM 调用的超时（毫秒），照搬 patentExaminator */
  timeoutMs?: number;
  /** 文档格式 — 影响输出文件类型 */
  documentFormat?: "docx" | "pptx" | "xlsx" | "html";
  /** 文档风格 ID — 从 userRequest 动态识别或用户指定，影响 citation 处理 */
  documentStyle?: string;
  /** 全局引用编号偏移量（照搬 patentExaminator：确保每个章节的引用编号全局唯一） */
  globalCitationOffset?: number;
  /**
   * RAG 门控：跳过 tool calling 循环（调用①），直接进入 fuseAndRank + Re-inject（调用②）。
   * 当 RAG 结果充足（>=3 条且平均分 >= 0.4）时设为 true，省去一次 LLM 调用。
   * Re-inject 已兼容「没有草稿」的模式：finalAnswer 为空时从零生成。
   */
  skipToolCalling?: boolean;
  /**
   * 强制工具调用：当 RAG 来源不足（< 3 条）时设为 true，
   * 第一轮 tool_choice = "required"，强制 LLM 调用 web_search 获取外部信息。
   * 避免 LLM 在知识库信息不足时凭空生成内容。
   */
  forceToolUse?: boolean;
}

interface FusedCitation {
  title: string;
  url: string;
  snippet: string;
  engine: string; // "rag" | "web"
  /** reranker 相关性分数（照搬 patentExaminator：用于显示相似度） */
  score?: number;
  /** 知识库来源 ID（用于生成文件链接） */
  sourceId?: string;
}

export interface ToolExecutorOutput {
  answer: string;
  webSearchCitations: Array<{ title: string; url: string; snippet: string; score?: number }>;
  mergedCitations: Array<{ title: string; url: string; snippet: string; source: string; score?: number; sourceId?: string }>;
  toolRounds: number;
}

/** 统计各来源数量（用于日志） */
function countSources(citations: FusedCitation[]): string {
  const rag = citations.filter((c) => c.engine === "rag").length;
  const web = citations.filter((c) => c.engine !== "rag").length;
  return `RAG=${rag}, Web=${web}`;
}

/**
 * 移除 LLM 输出中超出有效范围的 [N] 引用标记。
 * 在 re-inject 之后调用，防止 LLM 幻觉出不在 validRange 内的编号。
 * 此时内容是纯文本（尚未经过 cleanContent 的 HTML 转换），正则匹配可靠。
 */
function stripInvalidCitations(text: string, validMin: number, validMax: number): string {
  // 找出所有 [N] 标记，替换超出范围的为不带标记的纯文本
  return text.replace(/\[(\d+)\]/g, (match, numStr) => {
    const n = parseInt(numStr, 10);
    if (n < validMin || n > validMax) {
      return ""; // 直接删除，不保留任何标记
    }
    return match; // 在有效范围内，保留
  });
}

/** 从 MCP server 获取 tool 定义，转为 OpenAI 格式 */
async function loadMcpTools(): Promise<ToolDefinition[]> {
  const mcpTools = await mcpClient.getTools();
  return mcpTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries((t.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, {
            type: (v.type as string) ?? "string",
            description: (v.description as string) ?? "",
          }])
        ),
        required: (t.inputSchema.required as string[]) ?? [],
      },
    },
  }));
}

// ── 跨源融合重排（照搬 patentExaminator fuseAndRank） ────────

/**
 * 跨源融合：RAG + Web Search 结果合并后用 reranker 排序
 *
 * 三级降级：远程 reranker API → 本地 cross-encoder → 本地启发式算法
 * （i-Write 暂无 cross-encoder，所以是两级：远程 API → 本地启发式）
 */
async function fuseAndRank(
  query: string,
  ragCitations: ToolExecutorInput["ragCitations"],
  webResults: Array<{ title: string; url: string; snippet: string }>,
  rerankerConfig?: ToolExecutorInput["rerankerConfig"],
): Promise<{ citations: FusedCitation[] }> {
  // Web Search 去重
  const seen = new Set<string>();
  const uniqueWeb: FusedCitation[] = [];
  for (const r of webResults) {
    const key = r.url.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueWeb.push({ ...r, engine: "web" });
    }
  }
  if (uniqueWeb.length < webResults.length) {
    logger.info(`[Rerank] Web 去重: ${webResults.length} → ${uniqueWeb.length}`);
  }

  // RAG 结果转为统一格式（保留 sourceId 用于知识库文件链接）
  // 批量查询 source URL，citation 链接指向原始文件
  const ragSourceIds = [...new Set(ragCitations.map((c) => c.sourceId).filter(Boolean))] as string[];
  const sourceUrlMap = new Map<string, string>();
  if (ragSourceIds.length > 0) {
    try {
      const placeholders = ragSourceIds.map(() => "?").join(",");
      const rows = dbAll<{ id: string; url: string }>(`SELECT id, url FROM kb_sources WHERE id IN (${placeholders}) AND url IS NOT NULL`, ragSourceIds);
      for (const row of rows) {
        sourceUrlMap.set(row.id, row.url);
      }
    } catch (err) {
      logger.warn(`[ToolExecutor] 查询 source URL 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── rag citations 按 sourceId 去重：同一文件的不同 chunk 合并成一个 citation ──
  // 同一 sourceId 下保留第一个出现的（通常分数最高），避免 LLM 对同一文件分配多个编号
  const ragDedupMap = new Map<string, typeof ragCitations[0]>();
  for (const c of ragCitations) {
    const key = c.sourceId || `fallback:${c.source || ""}`;
    if (!ragDedupMap.has(key)) {
      ragDedupMap.set(key, c);
    }
  }
  const dedupedRagCitations = [...ragDedupMap.values()];
  const ragAsFused: FusedCitation[] = dedupedRagCitations.map((c) => ({
    title: c.source,
    url: (c.sourceId && sourceUrlMap.get(c.sourceId)) || "",
    snippet: c.excerpt,
    engine: "rag",
    sourceId: c.sourceId,
  }));

  // 合并所有结果
  const allResults = [...ragAsFused, ...uniqueWeb];
  // 去重摘要：仅在发生去重时打印
  const ragDropped = ragCitations.length - dedupedRagCitations.length;
  const webDropped = webResults.length - uniqueWeb.length;
  if (ragDropped > 0 || webDropped > 0) {
    logger.info(`[Rerank] 去重: RAG ${ragCitations.length}→${dedupedRagCitations.length}(${ragDropped > 0 ? `-${ragDropped}` : ""}), Web ${webResults.length}→${uniqueWeb.length}(${webDropped > 0 ? `-${webDropped}` : ""}), 融合=${allResults.length} 候选`);
  }

  if (allResults.length === 0) {
    return { citations: [] };
  }

  // 转为 reranker 输入格式（base score 统一为 0，让 reranker 完全自主判断相关性）
  const rerankItems = allResults.map((r, i) => ({
    id: `fusion_${i}`,
    text: `${r.title} ${r.snippet}`,
    score: 0,
  }));

  // 调用统一的 reranker 入口（远程 API 优先 → 本地启发式 fallback）
  const reranked = await remoteRerank(query, rerankItems, rerankerConfig as RerankerConfig | undefined, TOP_K);

  // 将 reranker 分数回写到 FusedCitation
  const finalCitations: FusedCitation[] = reranked
    .map((r) => {
      const idx = parseInt(r.id.replace("fusion_", ""));
      return {
        ...allResults[idx],
        score: r.score,
      };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);
  logger.info(`[Rerank] fuseAndRank 完成: ${reranked.length} → top${TOP_K}=${finalCitations.length} (${countSources(finalCitations)})`);
  return { citations: finalCitations };
}

// ── 主函数 ──────────────────────────────────────────

export async function executeWithTools(input: ToolExecutorInput): Promise<ToolExecutorOutput> {
  const { systemPrompt, userPrompt, ragCitations, callLLM, query, rerankerConfig, timeoutMs, documentFormat, documentStyle, globalCitationOffset = 0, skipToolCalling = false, forceToolUse = false } = input;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const webSearchResults: Array<{ title: string; url: string; snippet: string }> = [];
  let toolRounds = 0;
  let finalAnswer = "";

  if (!skipToolCalling) {
    let tools: ToolDefinition[] = [];

    // 预加载 MCP tools
    try {
      tools = await loadMcpTools();
      logger.info(`[ToolExecutor] MCP tools loaded: ${tools.length}`);
    } catch (err) {
      logger.warn(`[ToolExecutor] MCP tools unavailable, falling back to plain LLM: ${err}`);
      const result = await callLLM({ messages, timeoutMs });
      return { answer: result.text || "", webSearchCitations: [], mergedCitations: [], toolRounds: 0 };
    }

    if (tools.length === 0) {
      logger.warn(`[ToolExecutor] No MCP tools registered, falling back to plain LLM`);
      const result = await callLLM({ messages, timeoutMs });
      return { answer: result.text || "", webSearchCitations: [], mergedCitations: [], toolRounds: 0 };
    }

    // RAG 门控信号：forceToolUse=true 时，第一轮强制 tool_choice=required
    // （当前 MCP 仅注册 web_search 一个 tool，required 等同强制搜索）
    if (forceToolUse) {
      logger.info(`[ToolExecutor] forceToolUse: RAG 来源不足，第一轮强制 web_search`);
    }

    // Tool loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let toolChoice: "auto" | "required" = "auto";

      // 第一轮：RAG 不足时强制调用工具（=web_search）
      if (forceToolUse && round === 0 && tools.length > 0) {
        toolChoice = "required";
        // 注入系统消息提示 LLM 知识库不足（防重复注入）
        const alreadyHinted = messages.some(
          (m) => m.role === "system" && m.content.includes("知识库检索结果不足"),
        );
        if (!alreadyHinted) {
          messages.push({
            role: "system",
            content: "知识库检索结果不足，必须调用 web_search 搜索网络获取最新信息。不要凭空编造内容。",
          });
        }
      }

      // ── web_search 门控：第 2+ 轮时，如果 RAG 已充分命中，提示 LLM 跳过搜索 ──
      if (round === 1 && ragCitations.length >= 3 && webSearchResults.length > 0) {
        const avgScore = ragCitations.reduce((s, c) => s + c.score, 0) / ragCitations.length;
        if (avgScore >= 0.4) {
          messages.push({
            role: "system",
            content: `【提示】知识库已检索到 ${ragCitations.length} 条高度相关文档（平均相似度 ${avgScore.toFixed(2)}）。如果这些文档已足够回答问题，请直接回答，无需再调用 web_search。仅在知识库明显不足时才搜索网络。`,
          });
          logger.info(`[ToolExecutor] RAG 门控: ${ragCitations.length} docs, avgScore=${avgScore.toFixed(2)}, 提示 LLM 优先使用知识库`);
        }
      }

      logger.info(`[ToolExecutor] LLM call #${round + 1} (tool_choice=${toolChoice}, web_search=${webSearchResults.length})`);

      const result = await callLLM({ messages, tools, tool_choice: toolChoice, timeoutMs });

      if (result.error) {
        logger.warn(`[ToolExecutor] LLM error in round ${round + 1}: ${result.error.message}`);
        finalAnswer = result.text || "";
        break;
      }

      // 无 tool calls → LLM 决定直接回答（不需要重试）
      if (!result.toolCalls || result.toolCalls.length === 0) {
        logger.info(`[ToolExecutor] LLM returned direct answer (web_search_results: ${webSearchResults.length})`);
        finalAnswer = result.text;
        // [DEBUG-CITATION] 追踪 LLM call #1 direct answer 的 [N] 数量
        const directCitations = [...finalAnswer.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));
        const directUnique = [...new Set(directCitations)].sort((a, b) => a - b);
        logger.info(`[DEBUG-CITATION] LLM call #${round + 1} direct answer: [${directUnique.join(",") || "NONE"}](${directCitations.length}), len=${finalAnswer.length}`);
        break;
      }

      // 执行工具
      toolRounds++;
      messages.push({
        role: "assistant",
        content: result.text || "",
        tool_calls: result.toolCalls,
      });

      for (const tc of result.toolCalls) {
        logger.info(`[ToolExecutor] Executing tool: ${tc.function.name}`);
        try {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const toolResult = await mcpClient.callTool(tc.function.name, args);

          // 解析搜索结果
          if (tc.function.name === "web_search" && toolResult.content?.[0]?.text) {
            try {
              const parsed = JSON.parse(toolResult.content[0].text) as {
                results?: Array<{ title: string; url: string; content: string }>;
              };
              if (parsed.results) {
                for (const r of parsed.results) {
                  webSearchResults.push({ title: r.title, url: r.url, snippet: r.content });
                }
              }
            } catch (parseErr) {
              logger.warn(`[ToolExecutor] web_search 结果 JSON 解析失败: ${parseErr}`);
            }
          }

          messages.push({
            role: "tool",
            content: toolResult.content?.[0]?.text ?? "No result",
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        } catch (err) {
          logger.warn(`[ToolExecutor] Tool ${tc.function.name} failed: ${err}`);
          messages.push({
            role: "tool",
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }
      }
    }
  } else {
    logger.info(`[ToolExecutor] RAG 门控: 跳过调用① (tool calling)，直接进入 Re-inject。RAG=${ragCitations.length} docs, avgScore=${(ragCitations.reduce((s, c) => s + c.score, 0) / (ragCitations.length || 1)).toFixed(2)}`);
  }

  // Step 3: 跨源融合排序（照搬 patentExaminator fuseAndRank）
  // 预计算去重后数量，使日志与 fuseAndRank 内部一致
  const ragUniqueSourceIds = new Set(ragCitations.map(c => c.sourceId || `fallback:${c.source || ""}`));
  const webUniqueUrls = new Set(webSearchResults.map(r => r.url.toLowerCase()));
  const ragDeduped = ragUniqueSourceIds.size;
  const webDeduped = webUniqueUrls.size;
  const totalCandidates = ragCitations.length + webSearchResults.length;
  const totalDeduped = ragDeduped + webDeduped;
  const dedupNote = (ragDeduped !== ragCitations.length || webDeduped !== webSearchResults.length)
    ? ` (去重后: RAG=${ragDeduped} + Web=${webDeduped} = ${totalDeduped})`
    : "";
  logger.info(`[ToolExecutor] 跨源融合: RAG=${ragCitations.length} + Web=${webSearchResults.length} = ${totalCandidates} 候选${dedupNote}`);
  const fuseResult = totalCandidates > 0
    ? await fuseAndRank(query, ragCitations, webSearchResults, rerankerConfig)
    : { citations: [] as FusedCitation[] };
  let { citations } = fuseResult;

  // Step 4: Re-inject with reranked citations（照搬 patentExaminator re-inject 逻辑）
  // 照搬 patentExaminator：只要 citations 就 re-inject，确保 LLM 使用融合后的编号
  if (citations.length > 0) {
    logger.info(`[ToolExecutor] Re-inject: injecting ${citations.length} docs (${countSources(citations)})`);
    // 照搬 patentExaminator：显示来源标签和相似度分数
    // 使用全局偏移量确保编号与 LLM prompt 中的编号一致
    const docsSection = citations
      .map((c, i) => {
        const link = c.url ? `[${c.title}](${c.url})` : `《${c.title}》`;
        const tag = c.engine === "rag" ? "（知识库）" : "（网络搜索）";
        const scoreInfo = c.score !== undefined ? `（相似度: ${c.score.toFixed(2)}）` : '';
        return `[${globalCitationOffset + i + 1}] ${tag} ${link}${scoreInfo}\n${c.snippet}`;
      })
      .join("\n\n");

    const isEmail = documentStyle === "email";

    const citationInstructions = [
      "## 参考文档（按相关性排序）",
      "",
      docsSection,
      "",
      "## 回答要求（必须严格遵守）",
      "",
    ];

    // Citation 为内容真实性提供唯一保障：每个事实声明必须有文档支撑
    // 显式列出所有可用编号，避免 LLM 把 [N] 当字面量输出而非替换为实际编号
    const availableNumbers = citations.map((_, i) => `[${globalCitationOffset + i + 1}]`).join(", ");
    const validRange = `[${globalCitationOffset + 1}] 到 [${globalCitationOffset + citations.length}]`;
    citationInstructions.push(
      `**硬性要求：你必须基于上方参考文档撰写内容，每个事实声明、数据、具体描述后必须标注来源编号。**`,
      "",
      `可用的引用编号是：${availableNumbers}`,
      `（即 ${validRange}，不要使用此范围之外的任何编号！）`,
      "",
      "⚠️ 注意：[N] 是占位符，你必须在正文中替换为上方列出的具体编号（如 [${globalCitationOffset + 1}]、[${globalCitationOffset + 2}] 等），不要原样输出 [N]！",
      "",
      "规则（违反任何一条，输出将被判定为幻觉并丢弃）：",
      "1. 每个段落中至少有一个引用标记（如 [${globalCitationOffset + 1}]）",
      "2. 所有具体数据（数字、日期、百分比、人名、指标）必须标注引用来源",
      "3. 所有事实声明必须标注引用来源",
      "4. 引用编号必须对应上方文档的序号，编号必须在上方参考文档中存在",
      "5. 绝对不要编造事实或虚假编号",
      "6. 不要写「以下是...」「根据参考文档...」等引导语，直接输出内容",
      "7. 不要写补充说明、注意事项等元信息",
    );

    if (isEmail) {
      // 邮件格式：额外的格式要求（但保留 citation 标记）
      citationInstructions.push(
        "7. 输出纯文本，不要 markdown 格式（不要 # 标题、**粗体** 等）",
      );
    }

    // 检测 finalAnswer 是否为 LLM 内部规划文本而非实际内容
    // 典型模式："用户要求我撰写..."、"让我分析..."、"我需要搜索..."等
    const isPlanningText = finalAnswer && /\b(?:用户要求|让我\s*(?:分析|搜索|整理|看看|检查)|我需要\s*(?:搜索|分析|查找|更多)|现在需要写|前文已经涵盖|参考信息[：:])/i.test(finalAnswer);

    if (finalAnswer && !isPlanningText) {
      // LLM 已返回直接回答 → 让它基于已有回答重写（所有格式都添加 citation 标记）
      messages.push({
        role: "user",
        content: [
          ...citationInstructions,
          "",
          "## 你之前的回答（需要基于参考文档重写）",
          "",
          finalAnswer,
          "",
          "请基于参考文档重新整理以上回答，为每句话添加 [N] 引用标记。直接输出内容，不要写引导语。",
        ].join("\n"),
      });
    } else {
      if (isPlanningText) {
        logger.warn(`[ToolExecutor] 检测到 LLM 返回规划文本而非实际内容，丢弃并从零生成。文本快照: ${finalAnswer!.slice(0, 120)}`);
      }
      // LLM 未返回直接回答，或返回的是规划文本 → 基于文档从零生成
      messages.push({
        role: "user",
        content: [
          ...citationInstructions,
          "",
          "## 最终任务：撰写章节正文",
          "",
          "你现在必须直接输出章节的完整正文内容。这是最终输出，不再有下一轮。",
          "",
          "禁止事项（违反将导致输出被丢弃）：",
          "- 禁止输出任何思考过程、分析步骤、规划性文字",
          "- 禁止输出\"让我...\"、\"我需要...\"、\"用户要求...\"、\"前文已经涵盖...\"等元说明",
          "- 禁止输出\"参考信息：\"、\"现在需要写...\"等过渡性文字",
          "- 只输出章节正文本身，包括段落和引用标记（必须使用上方列出的具体编号如 [${globalCitationOffset + 1}]，不要写 [N]）",
          "",
          "请撰写章节内容：",
        ].join("\n"),
      });
    }

    const finalResult = await callLLM({ messages, timeoutMs, temperature: 0 });
    finalAnswer = finalResult.text;

    // [DEBUG-CITATION] 追踪 re-inject 后 LLM 输出的 [N] 数量
    const reInjectCitations = [...finalAnswer.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));
    const reInjectUnique = [...new Set(reInjectCitations)].sort((a, b) => a - b);
    logger.info(`[DEBUG-CITATION] Re-inject LLM output: [${reInjectUnique.join(",") || "NONE"}](${reInjectCitations.length}), len=${finalAnswer.length}, prevAnswerLen=${finalAnswer === finalResult.text ? "same" : "diff"}`);

    // 立即校验并移除超出有效范围的 [N] 引用标记（防止 LLM 幻觉）
    // 必须在 re-inject 之后做，此时 LLM 已知有效编号范围
    if (citations.length > 0) {
      const validMin = globalCitationOffset + 1;
      const validMax = globalCitationOffset + citations.length;
      const beforeLen = finalAnswer.length;
      finalAnswer = stripInvalidCitations(finalAnswer, validMin, validMax);
      if (finalAnswer.length !== beforeLen) {
        logger.info(`[ToolExecutor] 移除超出范围 [${validMin}-${validMax}] 的引用标记, text长度 ${beforeLen} → ${finalAnswer.length}`);
      }

      // 零引用重试：LLM 未生成任何 [N] 标记时，用更强的指令重试一次
      const afterStripCitations = [...finalAnswer.matchAll(/\[(\d+)\]/g)];
      if (afterStripCitations.length === 0) {
        logger.warn(`[ToolExecutor] Re-inject LLM 未生成任何 [N] 引用标记 (len=${finalAnswer.length})，重试（从零生成模式）`);

        // 用「从零生成」路径替换最后一条 user 消息，加入更强的引用要求
        messages[messages.length - 1] = {
          role: "user",
          content: [
            ...citationInstructions,
            "",
            "## 最终任务：撰写章节正文（必须包含引用标记）",
            "",
            `⚠️ 上次生成的内容完全没有引用标记，这是严重违规！`,
            "你现在必须直接输出章节的完整正文内容，每个事实声明、数据、具体描述后必须有引用标记。",
            `请使用上方列出的可用编号（${availableNumbers}），不要原样输出 [N]！`,
            "",
            "禁止事项（违反将导致输出被丢弃）：",
            "- 禁止输出任何思考过程、分析步骤、规划性文字",
            "- 禁止输出\"让我...\"、\"我需要...\"等元说明",
            `- 每个段落中至少有一个引用标记（从 ${availableNumbers} 中选择）`,
            "- 所有具体数据（数字、日期、百分比、人名、指标）必须标注引用来源",
            "- 只输出章节正文本身，包括段落和引用标记",
            "",
            "请撰写章节内容：",
          ].join("\n"),
        };

        const retryResult = await callLLM({ messages, timeoutMs, temperature: 0 });
        finalAnswer = retryResult.text;

        // 追踪重试后的 [N] 数量
        const retryCitations = [...finalAnswer.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1]));
        const retryUnique = [...new Set(retryCitations)].sort((a, b) => a - b);
        logger.info(`[DEBUG-CITATION] Re-inject retry output: [${retryUnique.join(",") || "NONE"}](${retryCitations.length}), len=${finalAnswer.length}`);

        // 重试结果也要校验范围
        finalAnswer = stripInvalidCitations(finalAnswer, validMin, validMax);
      }
    }
  }

  logger.info(`[ToolExecutor] Done: toolRounds=${toolRounds}, webResults=${webSearchResults.length}, answerLen=${finalAnswer.length}`);

  // 将 fuseAndRank 产生的 score 回写到 webSearchCitations（按 URL 匹配）
  const scoredWebCitations = webSearchResults.map((w) => {
    const matched = citations.find((c) => c.url === w.url);
    return { ...w, score: matched?.score };
  });

  return {
    answer: finalAnswer,
    webSearchCitations: scoredWebCitations,
    mergedCitations: citations.map((c) => ({ title: c.title, url: c.url, snippet: c.snippet, source: c.engine, score: c.score, sourceId: c.sourceId })),
    toolRounds,
  };
}