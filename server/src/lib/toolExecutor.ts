/**
 * Tool Executor — LLM 自主判断何时调用 web_search
 *
 * 流程：
 * 1. 第 1 轮：加载 MCP tools，强制 tool_choice=required 调用搜索
 * 2. 后续轮次：LLM 自主判断是否继续搜索（tool_choice=auto）
 * 3. 无 tool calls → LLM 直接回答，结束 loop
 * 4. 跨源融合（RAG + Web）→ re-inject → 最终回答
 *
 * 从 patentExaminator 照搬，简化适配 i-Write。
 */
import { logger } from "./logger.js";
import { mcpClient } from "../mcp/mcpClient.js";
import type { ToolDefinition, ToolCall } from "../providers/openai.js";
import { rerank, type RerankInput } from "./reranker.js";

const MAX_TOOL_ROUNDS = 3;

interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
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
  }) => Promise<{ text: string; toolCalls?: ToolCall[]; error?: { code: string; message: string } }>;
  query: string;
}

export interface ToolExecutorOutput {
  answer: string;
  webSearchCitations: Array<{ title: string; url: string; snippet: string }>;
  mergedCitations: Array<{ title: string; url: string; snippet: string; source: string }>;
  toolRounds: number;
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

export async function executeWithTools(input: ToolExecutorInput): Promise<ToolExecutorOutput> {
  const { systemPrompt, userPrompt, ragCitations, callLLM, query } = input;

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
    const result = await callLLM({ messages });
    return { answer: result.text || "", webSearchCitations: [], mergedCitations: [], toolRounds: 0 };
  }

  if (tools.length === 0) {
    const result = await callLLM({ messages });
    return { answer: result.text || "", webSearchCitations: [], mergedCitations: [], toolRounds: 0 };
  }

  // Tool loop（第1轮 auto 让 LLM 自主判断，不强制 required 因为部分模型不支持）
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolChoice = "auto";
    logger.info(`[ToolExecutor] LLM call #${round + 1} (tool_choice=${toolChoice})`);

    const result = await callLLM({ messages, tools, tool_choice: toolChoice });

    if (result.error) {
      logger.warn(`[ToolExecutor] LLM error in round ${round + 1}: ${result.error.message}`);
      finalAnswer = result.text || "";
      break;
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      logger.info(`[ToolExecutor] LLM returned direct answer`);
      finalAnswer = result.text;
      break;
    }

    // 执行工具
    toolRounds++;
    // assistant 消息需要保留 tool_calls 信息（OpenAI API 要求）
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
          } catch { /* not JSON */ }
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

  // 跨源融合排序（照搬 patentExaminator fuseAndRank）
  const ragAsCitations = ragCitations.map((c) => ({ title: c.source, url: "", snippet: c.excerpt, source: "rag" }));
  const webAsCitations = webSearchResults.map((r) => ({ ...r, source: "web" }));

  // 去重
  const seen = new Set<string>();
  const uniqueWeb = webAsCitations.filter((c) => {
    const key = c.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const allCandidates = [...ragAsCitations, ...uniqueWeb];
  logger.info(`[ToolExecutor] 跨源融合: RAG=${ragAsCitations.length} + Web=${uniqueWeb.length} = ${allCandidates.length} 候选`);

  // Reranker 排序（远程 API → 本地启发式）
  const TOP_K = 5;
  let finalCitations = allCandidates;

  if (allCandidates.length > 0) {
    const rerankInput: RerankInput[] = allCandidates.map((r, i) => ({
      chunkId: `fusion_${i}`,
      text: `${r.title} ${r.snippet}`,
      score: 0,
    }));

    try {
      const reranked = await rerank(rerankInput, query);
      finalCitations = reranked
        .slice(0, TOP_K)
        .map((r) => {
          const idx = parseInt(r.chunkId.replace("fusion_", ""));
          return allCandidates[idx];
        })
        .filter((c): c is NonNullable<typeof c> => !!c);
      logger.info(`[ToolExecutor] Rerank 完成: ${allCandidates.length} → top${TOP_K}=${finalCitations.length}`);
    } catch (err) {
      logger.warn(`[ToolExecutor] Rerank 失败，使用原始顺序: ${err}`);
      finalCitations = allCandidates.slice(0, TOP_K);
    }
  }

  // Re-inject with reranked citations
  if (finalCitations.length > 0) {
    const docsSection = finalCitations
      .map((c, i) => {
        const tag = c.source === "rag" ? "（知识库）" : "（网络搜索）";
        const link = c.url ? `[${c.title}](${c.url})` : c.title;
        return `[${i + 1}] ${tag} ${link}\n${c.snippet}`;
      })
      .join("\n\n");

    messages.push({
      role: "user",
      content: `## 参考文档（按相关性排序）\n\n${docsSection}\n\n## 要求\n\n基于参考文档回答，每句话结尾标注来源编号 [N]。如果参考文档中没有相关信息，说明"参考文档中未找到"。\n\n请回答用户的问题。`,
    });

    const finalResult = await callLLM({ messages });
    finalAnswer = finalResult.text;
  }

  logger.info(`[ToolExecutor] Done: toolRounds=${toolRounds}, webResults=${webSearchResults.length}, answerLen=${finalAnswer.length}`);

  return {
    answer: finalAnswer,
    webSearchCitations: webSearchResults,
    mergedCitations: finalCitations,
    toolRounds,
  };
}
