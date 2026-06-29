/**
 * Provider Registry — 12 providers + 三级 fallback
 *
 * 三级 Fallback 策略（从 patentExaminator 迁移）：
 * 1. Model Fallback: 每个 provider 内部有 model fallback 列表
 * 2. Provider Fallback: 按 providerPreference 依次尝试不同 provider
 * 3. Retry: 每个请求最多重试 2 次，指数退避
 *
 * 错误分类：
 * - 401 (auth-failed): 不重试，不 fallback
 * - 429 (quota-exceeded): 不重试当前 provider，尝试下一个
 * - 5xx/network: 重试，然后 fallback
 */
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./openai.js";
import { readSettingsFromDb } from "../lib/settingsReader.js";
import {
  OpenAICompatibleAdapter,
  isReasoningModel,
  isReasoningModelStatic,
  resolveMaxTokens,
} from "./openai.js";
import { PRESET_MODEL_PROVIDERS } from "../../../shared/src/types/provider.js";
import { logger } from "../lib/logger.js";

const BACKOFF_DELAYS = [500, 1500];
const MAX_RETRIES = 2;
const MAX_TOTAL_ATTEMPTS = 8;
const TIMEOUT_MS = 240_000;

// ── 会话级配额耗尽冷却 ──────────────────────────────────────
// 当模型返回 insufficient_quota 错误时，将其加入此 Set，
// 本 session 内后续 fallback chain 遍历时直接跳过，不再重试。

const quotaExhaustedModels = new Set<string>();

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
    // 注册 12 个内置 providers（从 patentExaminator 迁移）
    for (const preset of PRESET_MODEL_PROVIDERS) {
      this.register(new GenericProvider(preset.id, preset.baseUrl));
    }
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * 三级 fallback 的 chat 请求
   *
   * @param providerPreference - provider 尝试顺序
   * @param req - chat 请求
   * @param modelFallbacks - 每个 provider 的 model fallback 列表
   * @param enableModelFallback - 每个 provider 是否启用 model fallback
   * @param providerApiKeys - 每个 provider 的 API key
   * @param providerBaseUrls - 每个 provider 的 base URL
   */
  async runWithFallback(
    providerPreference: string[],
    req: ChatRequest,
    modelFallbacks?: Partial<Record<string, string[]>>,
    enableModelFallback?: Partial<Record<string, boolean>>,
    providerApiKeys?: Record<string, string>,
    providerBaseUrls?: Record<string, string>,
  ): Promise<{ response: ChatResponse; attempts: AttemptRecord[] }> {
    // 自动从 DB 读取 fallback 配置（如果调用者没有传递）
    // 照搬 patentExaminator: LLM 调用函数不需要关心 fallback 细节
    if (!modelFallbacks || !enableModelFallback) {
      const dbSettings = readSettingsFromDb();
      modelFallbacks = modelFallbacks ?? dbSettings.modelFallbacks ?? {};
      enableModelFallback = enableModelFallback ?? dbSettings.enableModelFallback ?? {};
    }

    const attempts: AttemptRecord[] = [];
    let totalAttempts = 0;

    for (const pid of providerPreference) {
      const adapter = this.adapters.get(pid);
      if (!adapter) {
        logger.warn(`[Registry] Provider ${pid} not found, skipping`);
        attempts.push({ providerId: pid, ok: false, errorCode: "adapter-not-found", message: `Provider not found: ${pid}` });
        continue;
      }

      const providerBaseUrl = providerBaseUrls?.[pid];
      const providerApiKey = providerApiKeys?.[pid];
      const enabled = enableModelFallback?.[pid] ?? true;
      const configuredFallbacks = modelFallbacks?.[pid] ?? null;

      logger.info(`[Registry] 尝试 provider=${pid}, hasApiKey=${!!providerApiKey}, baseUrl=${providerBaseUrl ?? "default"}`);

      // 构建请求（合并 provider 级别的 apiKey 和 baseUrl）
      const buildReq = (base: ChatRequest, overrides: Partial<ChatRequest>): ChatRequest => {
        const result = { ...base, ...overrides };
        if (providerApiKey) result.apiKey = providerApiKey;
        if (providerBaseUrl) result.baseUrl = providerBaseUrl;
        return result;
      };

      // Model fallback 路径
      if (enabled && configuredFallbacks && configuredFallbacks.length > 0) {
        let models = req.modelId
          ? [req.modelId, ...configuredFallbacks.filter((m) => m !== req.modelId)]
          : configuredFallbacks;

        // 评估模式：fallback 链中的推理模型容易因长 thinking 超时，
        // 但用户主动选择的首选模型保留（resolveEvalMaxTokens 已 cap 到 4096 防止超时）
        if (req.evalMode) {
          const primary = req.modelId ? models.filter((m) => m === req.modelId) : [];
          const fallbacks = models.filter((m) => m !== req.modelId && !isReasoningModelStatic(m));
          const filtered = [...primary, ...fallbacks];
          if (filtered.length < models.length) {
            logger.info(`[Registry] evalMode: 从 fallback 链过滤推理模型（保留首选 ${req.modelId}）, ${models.length} → ${filtered.length}`);
            models = filtered;
          }
        }

        // 过滤配额已耗尽的模型（会话级冷却）
        // 保留用户主动选择的首选模型（可能是新配额恢复的调用）
        const preFilterCount = models.length;
        models = models.filter((m) => m === req.modelId || !quotaExhaustedModels.has(m));
        if (models.length < preFilterCount) {
          const skipped = preFilterCount - models.length;
          logger.warn(`[Registry] 跳过 ${skipped} 个配额耗尽的模型: ${Array.from(quotaExhaustedModels).join(", ")}`);
        }

        logger.info(`[Registry] ${pid} fallback chain: initialModel=${req.modelId ?? "default"}, models=[${models.slice(0, 5).join(", ")}${models.length > 5 ? `, ...+${models.length - 5}` : ""}]`);

        for (const modelId of models) {
          totalAttempts++;
          if (totalAttempts > MAX_TOTAL_ATTEMPTS) {
            return { response: buildMaxAttemptsError(attempts), attempts };
          }

          try {
            const result = await this.executeWithRetry(adapter, buildReq(req, { modelId }));
            attempts.push(...result.attempts);

            // L3 截断检测
            const resp = result.response;
            // 排除 tool-call 响应：text 为空但有 toolCalls 是正常行为，不是截断
            const hasToolCalls = !!(resp.toolCalls && resp.toolCalls.length > 0);
            const isTruncated = resp.text.length < 50 &&
              !resp.error &&
              !hasToolCalls &&
              !isReasoningModel(modelId) &&
              resp.tokenUsage != null &&
              resp.tokenUsage.output < 100;

            if (isTruncated) {
              logger.warn(`[ModelAdapt] Possible truncation for ${modelId}, retrying with 4x maxTokens`);
              // 注意：不再调用 learnThinkingCapability(modelId, 1) — 那是 hack，
              // 会把非推理模型错误地缓存为推理模型，导致后续请求的 maxTokens 越界。
              // 真正的 thinking tokens 由 openai adapter 从 API 响应中学习。
              const retryReq = buildReq(req, { modelId, maxTokens: resolveMaxTokens(modelId, req.maxTokens) });
              try {
                const retryResult = await this.executeWithRetry(adapter, retryReq);
                attempts.push(...retryResult.attempts);
                return { response: retryResult.response, attempts };
              } catch {
                return { response: resp, attempts };
              }
            }

            return { response: result.response, attempts };
          } catch (error) {
            const errInfo = classifyError(error);
            const inner = (error as Error & { attempts?: AttemptRecord[] }).attempts;
            if (inner) attempts.push(...inner);
            else attempts.push({ providerId: pid, ok: false, errorCode: errInfo.code, message: errInfo.message });

            // 会话级冷却：配额耗尽的模型加入黑名单，后续请求直接跳过
            if (errInfo.code === "quota-exceeded") {
              quotaExhaustedModels.add(modelId);
              logger.warn(`[Registry] 模型 ${modelId} 配额耗尽，加入会话级冷却（跳过后续重试）`);
            }

            if (errInfo.code === "auth-failed") {
              return { response: buildErrorResponse(errInfo), attempts };
            }
          }
        }
        // All model fallbacks failed, try next provider
        logger.warn(`[Registry] All models failed for provider=${pid}, trying next`);
        continue;
      }

      // 无 model fallback 路径
      totalAttempts++;
      if (totalAttempts > MAX_TOTAL_ATTEMPTS) {
        return { response: buildMaxAttemptsError(attempts), attempts };
      }

      try {
        const result = await this.executeWithRetry(adapter, buildReq(req, {}));
        attempts.push(...result.attempts);

        // L3 截断检测
        const resp = result.response;
        const hasToolCalls = !!(resp.toolCalls && resp.toolCalls.length > 0);
        const isTruncated = resp.text.length < 50 &&
          !resp.error &&
          !hasToolCalls &&
          !isReasoningModel(req.modelId) &&
          resp.tokenUsage != null &&
          resp.tokenUsage.output < 100;

        if (isTruncated) {
          logger.warn(`[ModelAdapt] Possible truncation for ${req.modelId}, retrying with 4x maxTokens`);
          const retryReq = buildReq(req, { maxTokens: resolveMaxTokens(req.modelId, req.maxTokens) });
          try {
            const retryResult = await this.executeWithRetry(adapter, retryReq);
            attempts.push(...retryResult.attempts);
            return { response: retryResult.response, attempts };
          } catch {
            return { response: resp, attempts };
          }
        }

        return { response: result.response, attempts };
      } catch (error) {
        const errInfo = classifyError(error);
        const inner = (error as Error & { attempts?: AttemptRecord[] }).attempts;
        if (inner) attempts.push(...inner);
        else attempts.push({ providerId: pid, ok: false, errorCode: errInfo.code });

        // 会话级冷却：配额耗尽的模型加入黑名单，后续请求直接跳过
        if (errInfo.code === "quota-exceeded" && req.modelId) {
          quotaExhaustedModels.add(req.modelId);
          logger.warn(`[Registry] 模型 ${req.modelId} 配额耗尽，加入会话级冷却（跳过后续重试）`);
        }

        if (errInfo.code === "auth-failed") {
          return { response: buildErrorResponse(errInfo), attempts };
        }
      }
    }

    const attemptSummary = attempts.map((a) => `${a.providerId}(${a.errorCode ?? "unknown"})`).join(", ");
    return {
      response: {
        text: "",
        rawResponse: null,
        error: { code: "all-providers-failed", message: `All providers failed: ${attemptSummary}`, retryable: false },
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

  /**
   * 单个 provider 内的重试逻辑（照搬 patentExaminator: AbortController + setTimeout 超时包装）
   */
  private async executeWithRetry(
    adapter: ProviderAdapter,
    req: ChatRequest,
  ): Promise<{ response: ChatResponse; attempts: AttemptRecord[] }> {
    const attempts: AttemptRecord[] = [];
    let lastError: unknown;
    let lastErrInfo: ErrorInfo | undefined;

    const clientSignal = req.signal;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        logger.info(`[Registry] 重试 attempt=${attempt}/${MAX_RETRIES}, delay=${BACKOFF_DELAYS[attempt - 1] ?? 3000}ms`);
        await sleep(BACKOFF_DELAYS[attempt - 1] ?? 3000);
      }

      // 客户端断连检测
      if (clientSignal?.aborted) {
        throw new Error("Request aborted by client");
      }

      // 照搬 patentExaminator: 每次尝试创建独立的 AbortController + setTimeout
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), req.timeoutMs ?? TIMEOUT_MS);

      // 客户端 abort 传播到 timeout controller
      const onClientAbort = () => timeoutController.abort();
      clientSignal?.addEventListener("abort", onClientAbort);

      logger.info(`[Registry] 调用 LLM: provider=${adapter.id}, model=${req.modelId ?? "default"}, attempt=${attempt + 1}/${MAX_RETRIES + 1}, timeout=${req.timeoutMs ?? TIMEOUT_MS}ms`);
      const startTime = Date.now();

      try {
        const response = await adapter.chat({ ...req, signal: timeoutController.signal });
        const duration = Date.now() - startTime;
        logger.info(`[Registry] LLM 响应: provider=${adapter.id}, duration=${duration}ms, error=${response.error ? response.error.message : "none"}, text长度=${response.text?.length ?? 0}`);

        if (!response.error) {
          attempts.push({ providerId: adapter.id, ok: true });
          clearTimeout(timeout);
          clientSignal?.removeEventListener("abort", onClientAbort);
          return { response, attempts };
        }

        lastError = response;
        lastErrInfo = classifyError(response);
        attempts.push({ providerId: adapter.id, ok: false, errorCode: lastErrInfo.code, message: lastErrInfo.message });

        // 超时日志（照搬 patentExaminator）
        if (lastErrInfo.code === "timeout") {
          const timeoutMs = req.timeoutMs ?? TIMEOUT_MS;
          logger.warn(`[Registry] ${adapter.id} attempt ${attempt + 1}/${MAX_RETRIES + 1} timed out after ${timeoutMs}ms, model=${req.modelId ?? "default"}`);
        }

        // 401/400: 不重试
        if (lastErrInfo.code === "auth-failed" || lastErrInfo.code === "bad-request") {
          throw Object.assign(new Error(lastErrInfo.message), { attempts: [...attempts] });
        }

        // 429: 不重试，直接 fallback
        if (lastErrInfo.code === "quota-exceeded") {
          throw Object.assign(new Error(lastErrInfo.message), { attempts: [...attempts] });
        }

        // 不可重试的错误
        if (!lastErrInfo.retryable) {
          throw Object.assign(new Error(lastErrInfo.message), { attempts: [...attempts] });
        }
      } catch (error) {
        lastError = error;
        lastErrInfo = classifyError(error);
        attempts.push({ providerId: adapter.id, ok: false, errorCode: lastErrInfo.code, message: lastErrInfo.message });

        // 超时日志已在上方 response.error 分支打印，此处不重复

        // 客户端断连 — 不浪费重试
        if (clientSignal?.aborted) {
          (error as Error & { attempts: AttemptRecord[] }).attempts = [...attempts];
          throw error;
        }

        // 超时、401、429、400: 不重试，直接 fallback
        if (lastErrInfo.code === "timeout" || lastErrInfo.code === "auth-failed" || lastErrInfo.code === "quota-exceeded" || lastErrInfo.code === "bad-request") {
          (error as Error & { attempts: AttemptRecord[] }).attempts = [...attempts];
          throw error;
        }
      } finally {
        clearTimeout(timeout);
        clientSignal?.removeEventListener("abort", onClientAbort);
      }

      // 最后一次重试失败
      if (attempt === MAX_RETRIES) {
        (lastError as Error & { attempts: AttemptRecord[] }).attempts = [...attempts];
        throw lastError;
      }
    }

    throw lastError;
  }
}

// ── 错误分类 ────────────────────────────────────────────────

interface ErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

function classifyError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) return { code: "auth-failed", message: error.message, retryable: false };
    if (status === 400) return { code: "bad-request", message: error.message, retryable: false };
    if (status === 429) return { code: "quota-exceeded", message: error.message, retryable: true };
    if (status === 403 && /quota|insufficient/i.test(error.message)) {
      return { code: "quota-exceeded", message: error.message, retryable: false };
    }
    if (status === 403) return { code: "auth-failed", message: error.message, retryable: false };
    if (status && status >= 500) return { code: "server-error", message: error.message, retryable: true };
    // 超时直接 fallback 到下一个 model，不重试（照搬 patentExaminator）
    if (error.name === "AbortError") return { code: "timeout", message: "Request timed out", retryable: false };
    // 检测超时相关的错误消息（fetch abort 时 error.name 可能不是 AbortError）
    if (error.message.includes("This operation was aborted") || error.message.includes("timed out")) {
      return { code: "timeout", message: error.message, retryable: false };
    }
    return { code: "network-error", message: error.message, retryable: true };
  }
  // ChatResponse with error field
  if (typeof error === "object" && error !== null && "error" in error) {
    const resp = error as ChatResponse;
    if (resp.error) {
      const code = resp.error.code;
      if (code === "401" || (code === "403" && !/quota|insufficient/i.test(resp.error.message))) return { code: "auth-failed", message: resp.error.message, retryable: false };
      if (code === "403") return { code: "quota-exceeded", message: resp.error.message, retryable: false };
      if (code === "429") return { code: "quota-exceeded", message: resp.error.message, retryable: true };
      // 检测超时：network 错误中包含超时关键词（直接 fallback，不重试）
      if (code === "network" && (resp.error.message.includes("aborted") || resp.error.message.includes("timed out"))) {
        return { code: "timeout", message: resp.error.message, retryable: false };
      }
      // 配额耗尽（API 返回 insufficient_quota / insufficent_quota 等）：不重试，直接 fallback
      if (/quota|insufficient/i.test(code)) return { code: "quota-exceeded", message: resp.error.message, retryable: false };
      return { code, message: resp.error.message, retryable: resp.error.retryable };
    }
  }
  return { code: "unknown-error", message: String(error), retryable: false };
}

function buildErrorResponse(errInfo: ErrorInfo): ChatResponse {
  return {
    text: "",
    rawResponse: null,
    error: { code: errInfo.code, message: errInfo.message, retryable: errInfo.retryable },
  };
}

function buildMaxAttemptsError(attempts: AttemptRecord[]): ChatResponse {
  const summary = attempts.map((a) => `${a.providerId}(${a.errorCode ?? "unknown"})`).join(", ");
  return {
    text: "",
    rawResponse: null,
    error: {
      code: "max-attempts-reached",
      message: `Max total attempts (${MAX_TOTAL_ATTEMPTS}) reached: ${summary}`,
      retryable: false,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 全局单例
export const registry = new ProviderRegistry();
