/**
 * Tool Executor — LLM tool calling + 跨源融合重排 + re-inject
 *
 * 流程（照搬 patentExaminator toolExecutor.ts）：
 * 1. 第 1 轮：加载 MCP tools，强制 tool_choice=required 调用搜索
 *    - 不支持 required 的模型自动降级为 auto
 * 2. 后续轮次：LLM 自主判断是否继续搜索（tool_choice=auto）
 * 3. 无 tool calls → LLM 直接回答，结束 loop
 * 4. 跨源融合（RAG + Web）→ 三级降级重排 → re-inject → 最终回答
 */
import { logger } from "./logger.js";
import { mcpClient } from "../mcp/mcpClient.js";
import type { ToolDefinition, ToolCall } from "../providers/openai.js";
import { localRerank, type RerankInput } from "./reranker.js";

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
  ragCitations: Array<{ source: string; score: number; excerpt: string }>;
  callLLM: (overrides?: {
    messages?: LLMMessage[];
    tools?: ToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
    timeoutMs?: number;
  }) => Promise<{ text: string; toolCalls?: ToolCall[]; error?: { code: string; message: string } }>;
  query: string;
  rerankerConfig?: { baseUrl: string; apiKey: string; modelId: string };
  /** 每次 LLM 调用的超时（毫秒），照搬 patentExaminator */
  timeoutMs?: number;
  /** 文档格式 — 影响输出文件类型 */
  documentFormat?: "docx" | "pptx" | "xlsx" | "html";
  /** 文档风格 — 从 userRequest 动态识别，影响 citation 处理 */
  documentStyle?: "email" | "ppt" | "table" | "code" | "report" | "general";
}

interface FusedCitation {
  title: string;
  url: string;
  snippet: string;
  engine: string; // "rag" | "web"
  /** reranker 相关性分数（照搬 patentExaminator：用于显示相似度） */
  score?: number;
}

export interface ToolExecutorOutput {
  answer: string;
  webSearchCitations: Array<{ title: string; url: string; snippet: string }>;
  mergedCitations: Array<{ title: string; url: string; snippet: string; source: string; score?: number }>;
  toolRounds: number;
}

/** 统计各来源数量（用于日志） */
function countSources(citations: FusedCitation[]): string {
  const rag = citations.filter((c) => c.engine === "rag").length;
  const web = citations.filter((c) => c.engine !== "rag").length;
  return `RAG=${rag}, Web=${web}`;
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

  // RAG 结果转为统一格式
  const ragAsFused: FusedCitation[] = ragCitations.map((c) => ({
    title: c.source,
    url: "",
    snippet: c.excerpt,
    engine: "rag",
  }));

  // 合并所有结果
  const allResults = [...ragAsFused, ...uniqueWeb];
  logger.info(`[Rerank] 融合输入: ${countSources(allResults)} = ${allResults.length} 候选`);

  if (allResults.length === 0) {
    return { citations: [] };
  }

  // 转为 reranker 输入格式（base score 统一为 0，让 reranker 完全自主判断相关性）
  const rerankInput: RerankInput[] = allResults.map((r, i) => ({
    chunkId: `fusion_${i}`,
    text: `${r.title} ${r.snippet}`,
    metadata: { engine: r.engine, url: r.url },
    score: 0,
  }));

  // 优先级 1：远程 reranker API
  if (rerankerConfig) {
    try {
      const rerankUrl = rerankerConfig.baseUrl.endsWith("/v1")
        ? `${rerankerConfig.baseUrl}/rerank`
        : `${rerankerConfig.baseUrl}/v1/rerank`;
      const documents = rerankInput.map((r) => r.text);
      logger.info(`[Rerank] 远程 Rerank: ${documents.length} 候选, model=${rerankerConfig.modelId}`);
      const res = await fetch(rerankUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rerankerConfig.apiKey}` },
        body: JSON.stringify({ model: rerankerConfig.modelId, query, documents, top_n: TOP_K }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ index: number; relevance_score: number }> };
        const results = data.results ?? [];
        // 照搬 patentExaminator：保存 reranker 分数到 FusedCitation
        const reranked = results
          .filter((r) => r.index >= 0 && r.index < allResults.length)
          .map((r) => ({
            ...allResults[r.index]!,
            score: r.relevance_score,
          }))
          .filter((c): c is FusedCitation => !!c);
        const finalCitations = reranked.slice(0, TOP_K);
        logger.info(`[Rerank] 远程 Rerank 完成: ${reranked.length} → top${TOP_K}=${finalCitations.length} (${countSources(finalCitations)})`);
        return { citations: finalCitations };
      }
      logger.warn(`[Rerank] 远程 Rerank 失败 (${res.status})，降级到本地`);
    } catch (err) {
      logger.warn(`[Rerank] 远程 Rerank 错误，降级到本地: ${err}`);
    }
  }

  // 优先级 2：本地启发式算法
  try {
    const reranked = localRerank(rerankInput, query);
    // 照搬 patentExaminator：保存 reranker 分数到 FusedCitation
    const localCitations = reranked
      .slice(0, TOP_K)
      .map((r) => {
        const idx = parseInt(r.chunkId.replace("fusion_", ""));
        return {
          ...allResults[idx],
          score: r.score,
        };
      })
      .filter((c): c is FusedCitation => !!c);
    logger.info(`[Rerank] 本地启发式 完成: ${reranked.length} → top${TOP_K}=${localCitations.length} (${countSources(localCitations)})`);
    return { citations: localCitations };
  } catch (err) {
    logger.warn(`[Rerank] 本地启发式失败，按原始顺序取 top${TOP_K}: ${err}`);
    return { citations: allResults.slice(0, TOP_K) };
  }
}

// ── 主函数 ──────────────────────────────────────────

export async function executeWithTools(input: ToolExecutorInput): Promise<ToolExecutorOutput> {
  const { systemPrompt, userPrompt, ragCitations, callLLM, query, rerankerConfig, timeoutMs, documentFormat, documentStyle } = input;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const webSearchResults: Array<{ title: string; url: string; snippet: string }> = [];
  let toolRounds = 0;
  let finalAnswer = "";
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

  // Tool loop（照搬 patentExaminator: 第1轮 required 强制搜索，后续 auto）
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // 第 1 轮强制搜索，后续轮次 LLM 自主判断
    let toolChoice: "auto" | "required" = round === 0 ? "required" : "auto";
    logger.info(`[ToolExecutor] LLM call #${round + 1} (tool_choice=${toolChoice})`);

    let result = await callLLM({ messages, tools, tool_choice: toolChoice, timeoutMs });

    // 如果 required 不被模型支持，降级为 auto 重试
    if (result.error && toolChoice === "required") {
      logger.warn(`[ToolExecutor] tool_choice=required 不支持，降级为 auto`);
      toolChoice = "auto";
      result = await callLLM({ messages, tools, tool_choice: toolChoice, timeoutMs });
    }

    if (result.error) {
      logger.warn(`[ToolExecutor] LLM error in round ${round + 1}: ${result.error.message}`);
      finalAnswer = result.text || "";
      break;
    }

    // 无 tool calls → LLM 决定直接回答
    if (!result.toolCalls || result.toolCalls.length === 0) {
      logger.info(`[ToolExecutor] LLM returned direct answer`);
      finalAnswer = result.text;
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

  // Step 3: 跨源融合排序（照搬 patentExaminator fuseAndRank）
  const totalCandidates = ragCitations.length + webSearchResults.length;
  logger.info(`[ToolExecutor] 跨源融合: RAG=${ragCitations.length} + Web=${webSearchResults.length} = ${totalCandidates} 候选`);
  const fuseResult = totalCandidates > 0
    ? await fuseAndRank(query, ragCitations, webSearchResults, rerankerConfig)
    : { citations: [] as FusedCitation[] };
  let { citations } = fuseResult;

  // Step 4: Re-inject with reranked citations（照搬 patentExaminator re-inject 逻辑）
  if (toolRounds > 0 && citations.length > 0) {
    logger.info(`[ToolExecutor] Re-inject: injecting ${citations.length} docs (${countSources(citations)})`);
    // 照搬 patentExaminator：显示来源标签和相似度分数
    const docsSection = citations
      .map((c, i) => {
        const link = c.url ? `[${c.title}](${c.url})` : `《${c.title}》`;
        const tag = c.engine === "rag" ? "（知识库）" : "（网络搜索）";
        const scoreInfo = c.score !== undefined ? `（相似度: ${c.score.toFixed(2)}）` : '';
        return `[${i + 1}] ${tag} ${link}${scoreInfo}\n${c.snippet}`;
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

    // 照搬 patentExaminator：所有格式都添加 citation 标记，保证内容真实性
    citationInstructions.push(
      "**最重要：每句话结尾必须标注来源编号 [N]！**",
      "",
      "规则：",
      "1. 基于参考文档回答，不编造信息",
      "2. 每句话末尾用 [N] 标注来源",
      "3. [N] 对应上方文档序号",
      "4. 如果某句话没有对应文档，直接写出该句，不要添加任何标记",
      "5. 不要写「以下是...」「根据参考文档...」等引导语，直接输出内容",
      "6. 不要写补充说明、注意事项等元信息",
    );

    if (isEmail) {
      // 邮件格式：额外的格式要求（但保留 citation 标记）
      citationInstructions.push(
        "7. 输出纯文本，不要 markdown 格式（不要 # 标题、**粗体** 等）",
      );
    }

    if (finalAnswer) {
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
      // LLM 未返回直接回答 → 基于文档生成
      messages.push({
        role: "user",
        content: [...citationInstructions, "", "请回答用户的问题。"].join("\n"),
      });
    }

    const finalResult = await callLLM({ messages, timeoutMs });
    finalAnswer = finalResult.text;
  }

  logger.info(`[ToolExecutor] Done: toolRounds=${toolRounds}, webResults=${webSearchResults.length}, answerLen=${finalAnswer.length}`);

  return {
    answer: finalAnswer,
    webSearchCitations: webSearchResults,
    mergedCitations: citations.map((c) => ({ title: c.title, url: c.url, snippet: c.snippet, source: c.engine, score: c.score })),
    toolRounds,
  };
}
