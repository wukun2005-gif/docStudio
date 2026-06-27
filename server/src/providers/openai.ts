/**
 * OpenAI-compatible adapter 基类
 * 大部分 LLM provider 都兼容 OpenAI API 格式
 */
import { getModelCapabilities } from "./model-capabilities-registry.js";

// ── 推理模型检测 ──────────────────────────────────────────

const REASONING_MODEL_PATTERNS = /mimo|r1\b|o[134]\b|reasoner|thinking|gemini-\d|glm-\d|k2\.[56]|deepseek-v[34]|kimi-k2|gpt-5|doubao-seed-\d|qwen3|qwq/i;
const REASONING_MAX_TOKENS_MULTIPLIER = 4;

// L1 运行时缓存：modelId → isReasoning（从 API 响应中学到的）
const thinkingModelCache = new Map<string, boolean>();

/** 从 API 响应中学习：如果模型使用了 thinking tokens，缓存为 thinking 模型 */
export function learnThinkingCapability(modelId: string, thinkingTokens: number | undefined): void {
  if (thinkingTokens && thinkingTokens > 0) {
    thinkingModelCache.set(modelId, true);
  }
}

/** 判断模型是否为推理模型 — 三层查询 */
export function isReasoningModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  // 1. 运行时缓存
  if (thinkingModelCache.has(modelId)) {
    return thinkingModelCache.get(modelId)!;
  }
  // 2. 静态能力声明
  const caps = getModelCapabilities(modelId);
  if (caps.isReasoning) {
    return true;
  }
  // 3. regex 兜底
  return REASONING_MODEL_PATTERNS.test(modelId);
}

/** 静态判断（不含运行时缓存）— evalMode 过滤用，保证跨调用一致性 */
export function isReasoningModelStatic(modelId: string): boolean {
  const caps = getModelCapabilities(modelId);
  if (caps.isReasoning) return true;
  return REASONING_MODEL_PATTERNS.test(modelId);
}

export function resolveMaxTokens(modelId: string | undefined, requestedMaxTokens?: number): number {
  const base = requestedMaxTokens ?? 4096;
  if (isReasoningModel(modelId)) {
    // 照搬 patentExaminator：推理模型 4x maxTokens，但按模型声明的 maxOutputTokens 封顶
    const caps = modelId ? getModelCapabilities(modelId) : undefined;
    const cap = caps?.maxOutputTokens ?? 65_536;
    return Math.min(base * REASONING_MAX_TOKENS_MULTIPLIER, cap);
  }
  return base;
}

/** 仅用于测试 — 清空运行时缓存 */
export function clearThinkingCache(): void {
  thinkingModelCache.clear();
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  /** tool_calls returned by assistant (for OpenAI API compatibility) */
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
  signal?: AbortSignal;
  baseUrl?: string;
  timeoutMs?: number;
  /** 结构化输出 */
  responseFormat?: {
    type: "json_schema";
    json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
  /** 流式输出 */
  stream?: boolean;
  /** Tool definitions for function calling */
  tools?: ToolDefinition[];
  /** Tool choice strategy */
  tool_choice?: "auto" | "none" | "required";
  /** 评估模式：fallback chain 中跳过推理模型（避免长 thinking 导致超时） */
  evalMode?: boolean;
}

export interface ChatResponse {
  text: string;
  tokenUsage?: { input: number; output: number; total: number };
  thinkingTokens?: number;
  rawResponse: unknown;
  error?: { code: string; message: string; retryable: boolean };
  /** Tool calls returned by the model */
  toolCalls?: ToolCall[];
}

export interface StreamChunk {
  text?: string;
  thinkingText?: string;
  done: boolean;
  tokenUsage?: { input: number; output: number; total: number };
}

export interface EmbeddingRequest {
  modelId: string;
  input: string[];
  apiKey: string;
  baseUrl?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  tokenUsage?: { input: number; output: number; total: number };
}

export interface ModelListing {
  id: string;
}

export interface ProviderAdapter {
  id: string;
  defaultBaseUrl: string;
  supportedModels(): string[];
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream?(req: ChatRequest): AsyncGenerator<StreamChunk>;
  embed?(req: EmbeddingRequest): Promise<EmbeddingResponse>;
  listModels(apiKey: string, customBaseUrl?: string): Promise<ModelListing[]>;
}

/**
 * OpenAI-compatible adapter 基类
 * 子类只需设置 id, defaultBaseUrl, supportedModels
 */
export abstract class OpenAICompatibleAdapter implements ProviderAdapter {
  abstract id: string;
  abstract defaultBaseUrl: string;
  protected baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? "";
  }

  protected init(): void {
    if (!this.baseUrl) this.baseUrl = this.defaultBaseUrl;
  }

  abstract supportedModels(): string[];

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const base = req.baseUrl || this.baseUrl || this.defaultBaseUrl;
    const url = `${base}/chat/completions`;
    const timeoutMs = req.timeoutMs ?? 240_000;

    // ── 模型能力自适应 ──────────────────────────────────
    const caps = getModelCapabilities(req.modelId);

    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: resolveMaxTokens(req.modelId, req.maxTokens),
    };

    // Temperature 适配：钳制到模型声明的范围
    if (caps.temperature.supported) {
      const requested = req.temperature ?? 0.7;
      body.temperature = Math.max(caps.temperature.range[0], Math.min(caps.temperature.range[1], requested));
    }
    // 若模型不支持 temperature（如 DeepSeek 思考模式、Kimi K2.6），不发送该字段

    // System Prompt 路由：Gemini 风格用 systemInstruction 参数
    if (caps.systemPromptMode === "parameter") {
      const systemMsgs = req.messages.filter(m => m.role === "system");
      const otherMsgs = req.messages.filter(m => m.role !== "system");
      body.messages = otherMsgs;
      if (systemMsgs.length > 0) {
        body.systemInstruction = { parts: systemMsgs.map(m => ({ text: m.content })) };
      }
    } else {
      body.messages = req.messages;
    }

    // Structured Output 门控
    if (req.responseFormat) {
      if (caps.supportsStructuredOutput) {
        body.response_format = req.responseFormat;
      } else {
        // 降级为 json_object（DeepSeek 等不支持 json_schema）
        body.response_format = { type: "json_object" };
      }
    }

    // Function Calling 门控
    if (req.tools && req.tools.length > 0) {
      if (caps.supportsFunctionCalling) {
        body.tools = req.tools;
        if (req.tool_choice) {
          // 照搬 patentExaminator：thinking 模型通常只支持 auto，不支持 required/object
          let choice = req.tool_choice;
          if (choice === "required" && caps.supportsToolChoiceRequired === false) {
            console.warn(`[OpenAI] ${this.id}/${req.modelId} 不支持 tool_choice=required，降级为 auto`);
            choice = "auto";
          }
          body.tool_choice = choice;
        }
      }
      // 若模型不支持 function calling，不发送 tools（降级为纯文本）
    }

    try {
      console.log(`[OpenAI] HTTP 请求开始: ${this.id} -> ${url}, model=${req.modelId}, timeout=${timeoutMs}ms`);
      const startTime = Date.now();

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(timeoutMs),
      });

      console.log(`[OpenAI] HTTP 响应: ${this.id}, status=${res.status}, duration=${Date.now() - startTime}ms`);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        return {
          text: "",
          rawResponse: { status: res.status, body: errorText },
          error: {
            code: String(res.status),
            message: `API error: ${res.status} ${errorText}`,
            retryable,
          },
        };
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string; tool_calls?: ToolCall[]; reasoning_content?: string; thinking?: string; reasoning?: string } }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };

      const msg = data.choices?.[0]?.message;

      // 推理模型兼容：百炼/Kimi 等网关有时将推理内容放在 reasoning_content/thinking，
      // 而 content 为空字符串。回退到这些字段以避免得到 text.length=0 的空响应。
      let contentText = msg?.content ?? "";
      if (!contentText && msg) {
        const fallback = msg.reasoning_content ?? msg.thinking ?? msg.reasoning ?? "";
        if (fallback) {
          console.warn(`[OpenAI] ${this.id}/${req.modelId} content 为空，回退到 reasoning_content (长度=${fallback.length})`);
          contentText = fallback;
        }
      }

      // 提取 thinking tokens（不同模型返回格式不同）
      const thinkingTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      if (thinkingTokens > 0) {
        learnThinkingCapability(req.modelId, thinkingTokens);
      }

      console.log(`[OpenAI] LLM 响应成功: ${this.id}, text长度=${contentText.length}, thinkingTokens=${thinkingTokens}`);
      return {
        text: contentText,
        tokenUsage: data.usage
          ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens }
          : undefined,
        thinkingTokens: thinkingTokens > 0 ? thinkingTokens : undefined,
        rawResponse: data,
        toolCalls: msg?.tool_calls,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[OpenAI] LLM 调用失败: ${this.id}, error=${msg}`);
      const retryable = !msg.includes("401") && !msg.includes("403");
      return {
        text: "",
        rawResponse: { error: msg },
        error: { code: "network", message: msg, retryable },
      };
    }
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const base = req.baseUrl || this.baseUrl || this.defaultBaseUrl;
    const url = `${base}/chat/completions`;
    const timeoutMs = req.timeoutMs ?? 240_000;

    // 照搬 patentExaminator: chunk 级超时（120s 无新数据 → 取消流 → 降级到非 streaming）
    const STREAM_CHUNK_TIMEOUT_MS = 120_000;

    // ── 模型能力自适应（与 chat() 一致）──────────────────
    const caps = getModelCapabilities(req.modelId);

    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: resolveMaxTokens(req.modelId, req.maxTokens),
      stream: true,
    };

    // Temperature 适配
    if (caps.temperature.supported) {
      const requested = req.temperature ?? 0.7;
      body.temperature = Math.max(caps.temperature.range[0], Math.min(caps.temperature.range[1], requested));
    }

    // System Prompt 路由
    if (caps.systemPromptMode === "parameter") {
      const systemMsgs = req.messages.filter(m => m.role === "system");
      const otherMsgs = req.messages.filter(m => m.role !== "system");
      body.messages = otherMsgs;
      if (systemMsgs.length > 0) {
        body.systemInstruction = { parts: systemMsgs.map(m => ({ text: m.content })) };
      }
    } else {
      body.messages = req.messages;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchErr) {
      // 400 + streaming → 回退到非 streaming（照搬 patentExaminator）
      if (fetchErr instanceof Error && fetchErr.message.includes("400") && body.stream) {
        console.log(`[OpenAI] streaming not supported (400), retrying as non-streaming`);
        delete body.stream;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${req.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: req.signal ?? AbortSignal.timeout(timeoutMs),
          });
        } catch (retryErr) {
          yield { done: true };
          throw retryErr;
        }
      } else {
        yield { done: true };
        throw fetchErr;
      }
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      yield { done: true };
      throw new Error(`Stream API error: ${res.status} ${errorText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { done: true };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;
    let chunkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let streamTimedOut = false;

    try {
      for (;;) {
        // 照搬 patentExaminator: chunk 级超时 — 无新数据 → 取消流
        const readPromise = STREAM_CHUNK_TIMEOUT_MS > 0
          ? reader.read().finally(() => {
              if (chunkTimeoutId) { clearTimeout(chunkTimeoutId); chunkTimeoutId = undefined; }
            })
          : reader.read();

        if (STREAM_CHUNK_TIMEOUT_MS > 0) {
          chunkTimeoutId = setTimeout(() => {
            console.log(`[OpenAI] ──── CHUNK TIMEOUT ──── no data for ${STREAM_CHUNK_TIMEOUT_MS}ms, canceling stream (chunks=${chunkCount})`);
            reader.cancel("chunk timeout").catch(() => {});
          }, STREAM_CHUNK_TIMEOUT_MS);
        }

        let result: { done: boolean; value?: Uint8Array };
        try {
          result = await readPromise as { done: boolean; value?: Uint8Array };
        } catch (readErr) {
          if (readErr instanceof Error && readErr.name === "AbortError") {
            console.log(`[OpenAI] ──── STREAM ABORTED ──── chunks=${chunkCount}`);
            streamTimedOut = true;
            break;
          }
          throw readErr;
        }

        if (result.done) break;
        chunkCount++;

        buffer += decoder.decode(result.value!, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            yield { done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const text = parsed.choices?.[0]?.delta?.content;
            if (text) {
              yield { text, done: false };
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } finally {
      if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
    }

    // 流超时：降级到非 streaming（照搬 patentExaminator）
    if (streamTimedOut) {
      console.log(`[OpenAI] ──── STREAM TIMEOUT, RETRY AS NON-STREAMING ────`);
      delete body.stream;
      try {
        const retryRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${req.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: req.signal ?? AbortSignal.timeout(timeoutMs),
        });
        if (retryRes.ok) {
          const data = (await retryRes.json()) as {
            choices: Array<{ message: { content: string } }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          const msg = data.choices?.[0]?.message;
          if (msg?.content) {
            yield { text: msg.content, done: false };
          }
          yield { done: true };
          return;
        }
      } catch {
        // 非 streaming 也失败，让调用方处理
      }
    }

    yield { done: true };
  }

  async listModels(apiKey: string, customBaseUrl?: string): Promise<ModelListing[]> {
    const base = customBaseUrl || this.baseUrl || this.defaultBaseUrl;
    const url = `${base}/models`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to list models: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { data: Array<{ id: string }> };
      return data.data.map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to list models for ${this.id}: ${msg}`);
    }
  }
}
