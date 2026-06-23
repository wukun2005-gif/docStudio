/**
 * OpenAI-compatible adapter 基类
 * 大部分 LLM provider 都兼容 OpenAI API 格式
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
}

export interface ChatResponse {
  text: string;
  tokenUsage?: { input: number; output: number; total: number };
  thinkingTokens?: number;
  rawResponse: unknown;
  error?: { code: string; message: string; retryable: boolean };
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
    const timeoutMs = req.timeoutMs ?? 120_000;

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.responseFormat) {
      body.response_format = req.responseFormat;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(timeoutMs),
      });

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
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      return {
        text: data.choices?.[0]?.message?.content ?? "",
        tokenUsage: data.usage
          ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens }
          : undefined,
        rawResponse: data,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
    const timeoutMs = req.timeoutMs ?? 120_000;

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(timeoutMs),
    });

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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
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
