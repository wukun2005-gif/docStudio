/**
 * Provider Registry — 多 provider + fallback 逻辑
 * - 429/quota: 尝试下一个 provider
 * - 5xx/network: 指数退避重试最多 2 次，然后下一个 provider
 * - 401: 不重试，不 fallback
 */
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./openai.js";
import { OpenAICompatibleAdapter } from "./openai.js";
import { logger } from "../lib/logger.js";

const BACKOFF_DELAYS = [500, 1500];
const MAX_RETRIES = 2;

export interface AttemptRecord {
  providerId: string;
  ok: boolean;
  errorCode?: string;
  message?: string;
}

// ── 通用 OpenAI-compatible provider ─────────────────────────

class GenericProvider extends OpenAICompatibleAdapter {
  constructor(
    id: string,
    defaultBaseUrl: string,
    private modelIds: string[] = [],
  ) {
    super();
    this.id = id;
    this.defaultBaseUrl = defaultBaseUrl;
    this.init();
  }

  id: string;
  defaultBaseUrl: string;

  supportedModels(): string[] {
    return this.modelIds;
  }
}

// ── Registry ────────────────────────────────────────────────

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor() {
    // 注册内置 providers（用户可通过 settings 添加更多）
    this.register(new GenericProvider("openai", "https://api.openai.com/v1", ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]));
    this.register(new GenericProvider("deepseek", "https://api.deepseek.com/v1", ["deepseek-chat", "deepseek-reasoner"]));
    this.register(new GenericProvider("gemini", "https://generativelanguage.googleapis.com/v1beta/openai", ["gemini-2.0-flash", "gemini-2.5-pro"]));
    this.register(new GenericProvider("openrouter", "https://openrouter.ai/api/v1", []));
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * 带 fallback 的 chat 请求
   */
  async runWithFallback(
    providerPreference: string[],
    req: ChatRequest,
    providerApiKeys?: Record<string, string>,
    providerBaseUrls?: Record<string, string>,
  ): Promise<{ response: ChatResponse; attempts: AttemptRecord[] }> {
    const attempts: AttemptRecord[] = [];
    let lastError: ChatResponse | null = null;

    for (const pid of providerPreference) {
      const adapter = this.adapters.get(pid);
      if (!adapter) {
        attempts.push({ providerId: pid, ok: false, errorCode: "adapter-not-found", message: `Provider not found: ${pid}` });
        continue;
      }

      const apiKey = providerApiKeys?.[pid] ?? req.apiKey;
      const baseUrl = providerBaseUrls?.[pid] ?? req.baseUrl;
      const effectiveReq = { ...req, apiKey, baseUrl };

      // 重试逻辑
      let lastError: ChatResponse | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, BACKOFF_DELAYS[attempt - 1]));
        }

        const response = await adapter.chat(effectiveReq);

        if (!response.error) {
          attempts.push({ providerId: pid, ok: true });
          return { response, attempts };
        }

        lastError = response;

        // 401: 不重试
        if (response.error.code === "401" || response.error.code === "403") {
          attempts.push({ providerId: pid, ok: false, errorCode: response.error.code, message: response.error.message });
          break;
        }

        // 429/quota: 不重试，直接下一个 provider
        if (response.error.code === "429") {
          attempts.push({ providerId: pid, ok: false, errorCode: "429", message: response.error.message });
          break;
        }

        // 5xx/network: 重试
        if (!response.error.retryable) {
          attempts.push({ providerId: pid, ok: false, errorCode: response.error.code, message: response.error.message });
          break;
        }

        // 最后一次重试失败
        if (attempt === MAX_RETRIES) {
          attempts.push({ providerId: pid, ok: false, errorCode: response.error.code, message: response.error.message });
        }
      }

      logger.warn(`[Registry] Provider ${pid} failed, trying next...`);
    }

    // 所有 provider 都失败
    return {
      response: lastError ?? {
        text: "",
        rawResponse: null,
        error: { code: "all-failed", message: "All providers failed", retryable: false },
      },
      attempts,
    };
  }

  /**
   * 带 fallback 的 embedding 请求
   */
  async embedWithFallback(
    providerPreference: string[],
    req: EmbeddingRequest,
    providerApiKeys?: Record<string, string>,
    providerBaseUrls?: Record<string, string>,
  ): Promise<{ response: EmbeddingResponse; attempts: AttemptRecord[] }> {
    const attempts: AttemptRecord[] = [];

    for (const pid of providerPreference) {
      const adapter = this.adapters.get(pid);
      if (!adapter?.embed) {
        attempts.push({ providerId: pid, ok: false, errorCode: "no-embed", message: `Provider ${pid} does not support embedding` });
        continue;
      }

      const apiKey = providerApiKeys?.[pid] ?? req.apiKey;
      const baseUrl = providerBaseUrls?.[pid] ?? req.baseUrl;
      const effectiveReq = { ...req, apiKey, baseUrl };

      try {
        const response = await adapter.embed(effectiveReq);
        attempts.push({ providerId: pid, ok: true });
        return { response, attempts };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ providerId: pid, ok: false, errorCode: "embed-error", message: msg });
        logger.warn(`[Registry] Embedding via ${pid} failed: ${msg}`);
      }
    }

    return {
      response: { embeddings: [] },
      attempts,
    };
  }
}

// 全局单例
export const registry = new ProviderRegistry();
