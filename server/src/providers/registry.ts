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
import { getModelCapabilities } from "./model-capabilities-registry.js";
import { readSettingsFromDb } from "../lib/settingsReader.js";
import {
  OpenAICompatibleAdapter,
  isReasoningModel,
  resolveMaxTokens,
} from "./openai.js";
import { PRESET_MODEL_PROVIDERS } from "../../../shared/src/types/provider.js";
import { logger } from "../lib/logger.js";

const MAX_RETRIES = 2;
const MAX_TOTAL_ATTEMPTS = 8;
const TIMEOUT_MS = 240_000;

// ── Circuit Breaker（三态机，per-model 隔离 + 任务周期） ──────
// 照搬 LiteLLM / Portkey / OpenAI SDK 的断路器模式：
//   CLOSED  → 连续失败达阈值 → OPEN
//   OPEN    → 任务周期变化    → HALF_OPEN（允许探测）
//   HALF_OPEN → 成功          → CLOSED
//   HALF_OPEN → 失败          → OPEN（重置冷却）
//
// 任务周期（taskEpoch）：每次文档生成任务开始时递增。
// 断路器仅在任务周期变化时才允许 HALF_OPEN 探测 — 同一次任务内
// 已断路的模型不会再次被尝试，避免 50 分钟的任务中反复 ping-pong。

const enum CBState { CLOSED, OPEN, HALF_OPEN }

/** 永久性错误码 — 冷却无法解决，在任务周期内永远不探测 */
const PERMANENT_ERROR_CODES = new Set(["quota-exceeded", "auth-failed"]);

/** 全局任务周期计数器。调用 startNewTaskEpoch() 递增 */
let currentTaskEpoch = 0;

class CircuitBreaker {
  state = CBState.CLOSED;
  failureCount = 0;
  lastFailureTime = 0;
  lastErrorCode = "";
  openedAtEpoch = 0;            // 进入 OPEN 状态时的任务周期

  /** 自适应学习：从 API 错误中学习的模型参数限制 */
  learnedMaxTokens?: number;    // 模型实际的 max_tokens 上限

  constructor(
    readonly modelId: string,
    readonly failureThreshold: number = 3,
    readonly cooldownMs: number = 30_000,
  ) {}

  /** 是否为永久性错误（quota 耗尽 / 认证失败 → 同任务周期内永不探测） */
  private get isPermanent(): boolean {
    return PERMANENT_ERROR_CODES.has(this.lastErrorCode);
  }

  /** 是否允许执行。
   *  OPEN + 不同任务周期 → HALF_OPEN（允许探测）
   *  OPEN + 同任务周期 + 永久错误 → 永不探测
   *  OPEN + 同任务周期 + 临时错误 → 不探测（等下一任务） */
  canExecute(): boolean {
    if (this.state === CBState.CLOSED) return true;
    if (this.state === CBState.OPEN) {
      // 永久性错误：同任务周期内绝不探测
      if (this.isPermanent && this.openedAtEpoch === currentTaskEpoch) {
        return false;
      }
      // 任务周期已变化 → 允许探测
      if (this.openedAtEpoch !== currentTaskEpoch) {
        this.state = CBState.HALF_OPEN;
        logger.info(`[CB] ${this.modelId} OPEN → HALF_OPEN（新任务周期 epoch=${currentTaskEpoch}，允许探测）`);
        return true;
      }
      // 同任务周期内：不探测，等任务结束
      return false;
    }
    // HALF_OPEN — 允许探测请求通过
    return true;
  }

  /** 记录成功。HALF_OPEN → CLOSED 恢复 */
  recordSuccess(): void {
    if (this.state === CBState.HALF_OPEN) {
      logger.info(`[CB] ${this.modelId} HALF_OPEN → CLOSED（探测成功，恢复）`);
    }
    this.state = CBState.CLOSED;
    this.failureCount = 0;
    this.lastErrorCode = "";
    this.openedAtEpoch = 0;
  }

  /** 记录失败。达到阈值后 CLOSED/HALF_OPEN → OPEN。已 OPEN 则忽略 */
  recordFailure(code: string): void {
    if (this.state === CBState.OPEN) return; // 已断路，不重复记录
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.lastErrorCode = code;
    if (this.state === CBState.HALF_OPEN) {
      this.state = CBState.OPEN;
      this.openedAtEpoch = currentTaskEpoch;
      logger.warn(`[CB] ${this.modelId} HALF_OPEN → OPEN（探测失败: ${code}${this.isPermanent ? "，本任务周期内不再探测" : ""}）`);
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CBState.OPEN;
      this.openedAtEpoch = currentTaskEpoch;
      const permNote = this.isPermanent ? "，本任务周期内不再探测" : `，等待下一任务周期`;
      logger.warn(`[CB] ${this.modelId} CLOSED → OPEN（连续 ${this.failureCount} 次失败: ${code}${permNote}）`);
    }
  }

  get isOpen(): boolean { return this.state === CBState.OPEN; }
}

/** per-model 断路器注册表 */
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(modelId: string): CircuitBreaker {
  let cb = breakers.get(modelId);
  if (!cb) {
    cb = new CircuitBreaker(modelId);
    breakers.set(modelId, cb);
  }
  return cb;
}

/** 开始新的任务周期。应在每次文档生成任务开始时调用。
 *  所有断路器保持在当前状态，但 canExecute() 会因 epoch 变化
 *  而允许 HALF_OPEN 探测。永久性错误（quota/auth）的断路器也会重置。 */
export function startNewTaskEpoch(): void {
  currentTaskEpoch++;
  // 永久性错误的断路器：新任务周期开始时重置（用户可能已充值/换 key）
  for (const [modelId, cb] of breakers) {
    if (cb.isOpen && PERMANENT_ERROR_CODES.has(cb.lastErrorCode)) {
      cb.state = CBState.CLOSED;
      cb.failureCount = 0;
      cb.lastErrorCode = "";
      cb.openedAtEpoch = 0;
      logger.info(`[CB] ${modelId} 永久错误断路器已重置（新任务周期 epoch=${currentTaskEpoch}）`);
    }
  }
  logger.info(`[Registry] 新任务周期: epoch=${currentTaskEpoch}`);
}

/** 重置所有断路器（调试用） */
export function resetAllBreakers(): void {
  for (const [modelId, cb] of breakers) {
    cb.state = CBState.CLOSED;
    cb.failureCount = 0;
    cb.lastErrorCode = "";
    cb.openedAtEpoch = 0;
    cb.learnedMaxTokens = undefined;
  }
  logger.info(`[Registry] 所有断路器已重置`);
}

/** 兼容旧 API（被外部模块引用） */
export function isModelQuotaExhausted(modelId: string): boolean {
  const cb = breakers.get(modelId);
  return cb ? cb.isOpen && cb.lastErrorCode === "quota-exceeded" : false;
}
export function isModelTimeoutCooldown(modelId: string): boolean {
  const cb = breakers.get(modelId);
  return cb ? cb.isOpen && cb.lastErrorCode === "timeout" : false;
}

// ── 指数退避 + jitter ─────────────────────────────────────────
// delay = random(0, min(cap, base * 2^attempt))
// 添加 jitter 防止惊群效应（thundering herd）

function backoffDelay(attempt: number, baseMs = 1000, capMs = 60_000): number {
  const exponential = Math.min(capMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * exponential);
}

// ── 错误分类（基于 HTTP status code，不猜消息措辞） ──────────
// 照搬 OpenAI SDK / LiteLLM 的分类策略：
//   retryable — 是否可在 adapter 层重试
//   circuitBreaker — 是否计入断路器失败计数
//   fatal — 是否为不可恢复的致命错误（不尝试 fallback）

interface ClassifiedError {
  code: string;
  message: string;
  retryable: boolean;
  circuitBreaker: boolean;
  fatal: boolean;
}

function classifyHttpError(status: number, message: string): ClassifiedError {
  // 400 Bad Request — 请求参数有问题。尝试自适应修复，修不了则计入断路器
  if (status === 400) {
    return { code: "bad-request", message, retryable: false, circuitBreaker: true, fatal: false };
  }
  // 401 Unauthorized — 密钥问题，不重试、不计入断路器、不 fallback
  if (status === 401) {
    return { code: "auth-failed", message, retryable: false, circuitBreaker: false, fatal: true };
  }
  // 403 Forbidden — 需区分 quota 耗尽 vs 其他
  if (status === 403) {
    if (/quota|insufficient/i.test(message)) {
      return { code: "quota-exceeded", message, retryable: false, circuitBreaker: true, fatal: false };
    }
    return { code: "auth-failed", message, retryable: false, circuitBreaker: false, fatal: true };
  }
  // 429 Rate Limit — 可重试，但需 backoff。不计入断路器（这是正常的限流而非故障）
  if (status === 429) {
    return { code: "rate-limited", message, retryable: true, circuitBreaker: false, fatal: false };
  }
  // 5xx Server Error — 可重试
  if (status >= 500) {
    return { code: "server-error", message, retryable: true, circuitBreaker: true, fatal: false };
  }
  // 未知状态码
  if (status > 0) {
    return { code: `http-${status}`, message, retryable: status >= 500, circuitBreaker: true, fatal: false };
  }
  // 无 HTTP status（网络错误、超时等）
  return { code: "network-error", message, retryable: true, circuitBreaker: false, fatal: false };
}

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
        // 同时过滤容量不足的模型（避免 qwen-math-turbo 等反复 400 错误）
        // 注意：不过滤不支持 structured output 的模型 — fidelity/groundedness
        // 内部已处理 SO 降级（不发送 response_format，纯文本 + parse 兜底）
        if (req.evalMode) {
          const primary = req.modelId ? models.filter((m) => m === req.modelId) : [];
          const minEvalTokens = req.maxTokens ?? 4096;
          const fallbacks = models.filter((m) => {
            if (m === req.modelId) return false;
            const breaker = getBreaker(m);
            // 断路器 OPEN → 跳过（不需要浪费时间尝试已知故障的模型）
            if (breaker.isOpen) return false;
            // 学习到的上限不足 → 跳过
            if (breaker.learnedMaxTokens != null && breaker.learnedMaxTokens < Math.min(minEvalTokens, 4096)) return false;
            const caps = getModelCapabilities(m);
            if (caps.maxOutputTokens < Math.min(minEvalTokens, 4096)) return false;
            return true;
          });
          const filtered = [...primary, ...fallbacks];
          if (filtered.length < models.length) {
            logger.info(`[Registry] evalMode: 过滤故障/低容量模型, ${models.length} → ${filtered.length} (保留首选 ${req.modelId})`);
            models = filtered;
          }
        }

        // 断路器过滤：跳过 OPEN 状态的模型
        const preFilterCount = models.length;
        const skippedModels: string[] = [];
        models = models.filter((m) => {
          const cb = getBreaker(m);
          if (!cb.canExecute()) {
            skippedModels.push(`${m}(${cb.lastErrorCode})`);
            return false;
          }
          return true;
        });
        if (skippedModels.length > 0) {
          logger.warn(`[Registry] 断路器跳过 ${skippedModels.length} 个模型: ${skippedModels.join(", ")}`);
        }

        logger.info(`[Registry] ${pid} fallback chain: initialModel=${req.modelId ?? "default"}, models=[${models.slice(0, 5).join(", ")}${models.length > 5 ? `, ...+${models.length - 5}` : ""}]`);

        for (const modelId of models) {
          totalAttempts++;
          if (totalAttempts > MAX_TOTAL_ATTEMPTS) {
            return { response: buildMaxAttemptsError(attempts), attempts };
          }

          // 动态断路器检查（并行调用期间可能有其他调用已触发断路器）
          if (!getBreaker(modelId).canExecute()) {
            logger.warn(`[Registry] 断路器动态跳过: ${modelId}（${getBreaker(modelId).lastErrorCode}）`);
            continue;
          }

          try {
            const result = await this.executeWithRetry(adapter, buildReq(req, { modelId }));
            attempts.push(...result.attempts);

            // L3 截断检测：使用 API 返回的 finish_reason，不靠正则猜测
            // finish_reason === "length" 表示模型因 max_tokens 限制被截断
            const resp = result.response;
            const isTruncated = resp.finishReason === "length" &&
              !resp.error &&
              !isReasoningModel(modelId);

            if (isTruncated) {
              logger.warn(`[ModelAdapt] Truncation detected for ${modelId} (finish_reason=length), retrying with 4x maxTokens`);
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

            // 断路器已在 executeWithRetry 中记录，此处仅处理 fatal 错误
            if (errInfo.fatal) {
              logger.warn(`[Registry] 模型 ${modelId} 致命错误（${errInfo.code}），不尝试 fallback`);
              return { response: buildErrorResponse(errInfo), attempts };
            }

            // 非致命错误 → 继续尝试下一个模型
            logger.info(`[Registry] 模型 ${modelId} 失败（${errInfo.code}），尝试 fallback 下一个`);
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

        // L3 截断检测：使用 API 返回的 finish_reason，不靠正则猜测
        // finish_reason === "length" 表示模型因 max_tokens 限制被截断
        const resp = result.response;
        const isTruncated = resp.finishReason === "length" &&
          !resp.error &&
          !isReasoningModel(req.modelId);

        if (isTruncated) {
          logger.warn(`[ModelAdapt] Truncation detected for ${req.modelId} (finish_reason=length), retrying with 4x maxTokens`);
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

        // 断路器已在 executeWithRetry 中记录。fatal 错误不尝试 fallback
        if (errInfo.fatal) {
          logger.warn(`[Registry] 模型 ${req.modelId} 致命错误（${errInfo.code}），不尝试 fallback`);
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
    const modelId = req.modelId ?? "unknown";

    // 预钳制：从断路器学习缓存中读取模型已知的 max_tokens 上限，
    // 避免每个阶段都重新触发 400 错误再自适应修复
    const breaker = getBreaker(modelId);
    if (breaker.learnedMaxTokens && (req.maxTokens ?? 4096) > breaker.learnedMaxTokens) {
      const original = req.maxTokens ?? 4096;
      req = { ...req, maxTokens: breaker.learnedMaxTokens };
      logger.info(`[Registry] 预钳制 max_tokens（学习缓存）: ${original} → ${breaker.learnedMaxTokens}, model=${modelId}`);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = backoffDelay(attempt - 1);
        logger.info(`[Registry] 重试 attempt=${attempt}/${MAX_RETRIES}, delay=${delay}ms（指数退避+jitter）`);
        await sleep(delay);
      }

      // 客户端断连检测
      if (clientSignal?.aborted) {
        throw new Error("Request aborted by client");
      }

      const timeoutController = new AbortController();
      const timeoutMs = req.timeoutMs ?? TIMEOUT_MS;
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);

      const onClientAbort = () => timeoutController.abort();
      clientSignal?.addEventListener("abort", onClientAbort);

      logger.info(`[Registry] 调用 LLM: provider=${adapter.id}, model=${modelId}, attempt=${attempt + 1}/${MAX_RETRIES + 1}, timeout=${timeoutMs}ms`);
      const startTime = Date.now();

      try {
        const response = await adapter.chat({ ...req, signal: timeoutController.signal });
        const duration = Date.now() - startTime;
        logger.info(`[Registry] LLM 响应: provider=${adapter.id}, duration=${duration}ms, error=${response.error ? response.error.message : "none"}, text长度=${response.text?.length ?? 0}`);

        if (!response.error) {
          attempts.push({ providerId: adapter.id, ok: true });
          getBreaker(modelId).recordSuccess();
          clearTimeout(timeout);
          clientSignal?.removeEventListener("abort", onClientAbort);
          return { response, attempts };
        }

        lastError = response;
        lastErrInfo = classifyError(response);
        attempts.push({ providerId: adapter.id, ok: false, errorCode: lastErrInfo.code, message: lastErrInfo.message });

        // 记录到断路器
        if (lastErrInfo.circuitBreaker) {
          getBreaker(modelId).recordFailure(lastErrInfo.code);
        }

        if (lastErrInfo.code === "timeout") {
          logger.warn(`[Registry] ${adapter.id} attempt ${attempt + 1}/${MAX_RETRIES + 1} timed out after ${timeoutMs}ms, model=${modelId}`);
        }

        // 400 bad-request: 尝试自适应修复参数（不依赖具体 API 措辞）
        if (lastErrInfo.code === "bad-request") {
          const msg = lastErrInfo.message;
          const rangeMatch = msg.match(/\[(\d+),\s*(\d+)\]/);

          // 修复1: 消息含 "max_tokens" + 合法范围 → 钳制
          if (rangeMatch && /max.tokens|max_tokens/i.test(msg)) {
            const apiMax = parseInt(rangeMatch[2], 10);
            const currentMax = req.maxTokens ?? 4096;
            if (currentMax > apiMax) {
              logger.warn(`[Registry] max_tokens 不兼容：${currentMax} → ${apiMax}`);
              req = { ...req, maxTokens: apiMax };
              // 缓存学习到的上限，避免后续阶段重复触发
              getBreaker(modelId).learnedMaxTokens = apiMax;
              clearTimeout(timeout);
              clientSignal?.removeEventListener("abort", onClientAbort);
              continue;
            }
          }

          // 修复2: total length 超限 → input + output > context window
          if (/total length|input tokens|context/i.test(msg)) {
            // 用语义线索而非数字大小来识别每个数字的角色
            // "Input tokens length is X" → input
            // "less than or equal to Y" / "up to Y" / "maximum Y" → context limit
            const inputMatch = msg.match(/input(?:\s+tokens)?\s+(?:length\s+is\s+|tokens?\s*[:=]?\s*)(\d+)/i);
            const contextMatch = msg.match(/(?:less than or equal to|must be (?:less than|<=)|up to|maximum\s+(?:context|total)?\s*(?:length|tokens)?\s*(?:is|of|:)?)\s*(\d+)/i);
            const inputTokens = inputMatch ? parseInt(inputMatch[1], 10) : 0;
            const contextLimit = contextMatch ? parseInt(contextMatch[1], 10) : 0;
            if (contextLimit > 0) {
              const safeMax = Math.max(256, contextLimit - inputTokens - 256);
              const currentMax = req.maxTokens ?? 4096;
              if (currentMax > safeMax && safeMax > 0) {
                logger.warn(`[Registry] context length 不兼容：input=${inputTokens || "?"}, context=${contextLimit}, max_tokens ${currentMax} → ${safeMax}`);
                req = { ...req, maxTokens: safeMax };
                // 缓存学习到的上限
                getBreaker(modelId).learnedMaxTokens = safeMax;
                clearTimeout(timeout);
                clientSignal?.removeEventListener("abort", onClientAbort);
                continue;
              }
            }
          }

          // 修复3: 消息含范围但无法识别参数类型 → 保守钳制 max_tokens
          if (rangeMatch && !/max.tokens|max_tokens/i.test(msg)) {
            const apiMax = parseInt(rangeMatch[2], 10);
            const currentMax = req.maxTokens ?? 4096;
            if (currentMax > apiMax && apiMax > 0) {
              logger.warn(`[Registry] 推测 max_tokens 不兼容（[1,${apiMax}]），钳制: ${currentMax} → ${apiMax}`);
              req = { ...req, maxTokens: apiMax };
              getBreaker(modelId).learnedMaxTokens = apiMax;
              clearTimeout(timeout);
              clientSignal?.removeEventListener("abort", onClientAbort);
              continue;
            }
          }
        }

        // 不可重试 → throw 给上层 fallback
        if (!lastErrInfo.retryable) {
          throw Object.assign(new Error(lastErrInfo.message), {
            attempts: [...attempts],
            status: codeToStatus(lastErrInfo.code) || 400,
            __errorCode: lastErrInfo.code,
          });
        }
      } catch (error) {
        lastError = error;
        lastErrInfo = classifyError(error);
        if (!attempts.some(a => a.errorCode === lastErrInfo!.code)) {
          attempts.push({ providerId: adapter.id, ok: false, errorCode: lastErrInfo.code, message: lastErrInfo.message });
        }

        // 记录到断路器
        if (lastErrInfo.circuitBreaker) {
          getBreaker(modelId).recordFailure(lastErrInfo.code);
        }

        // 客户端断连 — 不浪费重试
        if (clientSignal?.aborted) {
          (error as any).attempts = [...attempts];
          throw error;
        }

        // 致命错误 — 不重试，直接抛出
        if (lastErrInfo.fatal) {
          (error as any).attempts = [...attempts];
          throw error;
        }

        // 不可重试 — 抛出给上层 fallback
        if (!lastErrInfo.retryable) {
          (error as any).attempts = [...attempts];
          throw error;
        }
      } finally {
        clearTimeout(timeout);
        clientSignal?.removeEventListener("abort", onClientAbort);
      }

      // 最后一次重试失败
      if (attempt === MAX_RETRIES) {
        (lastError as any).attempts = [...attempts];
        throw lastError;
      }
    }

    throw lastError;
  }
}

// ── 错误分类（统一入口） ─────────────────────────────────────
// 所有错误统一通过此函数分类。策略：
//   1. 优先从 Error 对象提取 HTTP status（__errorCode / status）
//   2. 其次从 ChatResponse.error.code 提取
//   3. 用 classifyHttpError 按 status code 统一分类
//   4. 兜底：消息关键词匹配（仅用于无 status 的网络/超时错误）

interface ErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  circuitBreaker: boolean;  // 是否计入断路器失败计数
  fatal: boolean;            // 是否为不可恢复错误（不尝试 fallback）
}

function classifyError(error: unknown): ErrorInfo {
  // ── 分支 1: Error 对象（被 throw 抛出的） ──
  if (error instanceof Error) {
    const meta = error as Error & { status?: number; __errorCode?: string };
    const status = meta.status;

    // __errorCode 携带了 executeWithRetry 中分类好的信息
    if (meta.__errorCode) {
      const classified = classifyHttpError(
        status || codeToStatus(meta.__errorCode),
        error.message,
      );
      return { ...classified, code: meta.__errorCode };
    }

    // 有 HTTP status → 标准分类
    if (status && status > 0) {
      return { ...classifyHttpError(status, error.message), code: classifyHttpError(status, error.message).code };
    }

    // 无 status 的兜底：超时检测（不重试，立刻 fallback，计入断路器）
    if (error.name === "AbortError" || /aborted|timed out/i.test(error.message)) {
      return { code: "timeout", message: "Request timed out", retryable: false, circuitBreaker: true, fatal: false };
    }

    // 网络错误 — 可重试，暂不计入断路器（可能是偶发）
    return { code: "network-error", message: error.message, retryable: true, circuitBreaker: false, fatal: false };
  }

  // ── 分支 2: ChatResponse 对象（adapter 返回的） ──
  if (typeof error === "object" && error !== null && "error" in error) {
    const resp = error as ChatResponse;
    if (resp.error) {
      const adapterCode = resp.error.code;
      // adapter 返回的 code 可能是 HTTP status 字符串（如 "400"）或语义码
      const status = parseInt(adapterCode, 10);
      if (!isNaN(status) && status >= 100) {
        return { ...classifyHttpError(status, resp.error.message), code: classifyHttpError(status, resp.error.message).code };
      }
      // 语义码（如 "insufficient_quota"、"network"）
      if (/quota|insufficient/i.test(adapterCode)) {
        return { code: "quota-exceeded", message: resp.error.message, retryable: false, circuitBreaker: true, fatal: false };
      }
      if (adapterCode === "empty-response") {
        // 空响应重试极少成功，直接 fallback 更高效
        return { code: "empty-response", message: resp.error.message, retryable: false, circuitBreaker: true, fatal: false };
      }
      if (adapterCode === "network") {
        // 区分超时（AbortController 触发）vs 一般网络错误
        // 超时不重试——已经等了 30s，重试只是再浪费 30s。应立刻 fallback
        if (/aborted|timed out|timeout/i.test(resp.error.message)) {
          return { code: "timeout", message: resp.error.message, retryable: false, circuitBreaker: true, fatal: false };
        }
        return { code: "network-error", message: resp.error.message, retryable: true, circuitBreaker: false, fatal: false };
      }
      return { code: adapterCode, message: resp.error.message, retryable: !!resp.error.retryable, circuitBreaker: true, fatal: false };
    }
  }

  return { code: "unknown-error", message: String(error), retryable: false, circuitBreaker: false, fatal: false };
}

/** __errorCode → HTTP status 映射（用于跨 throw/catch 边界丢失 status 时恢复） */
function codeToStatus(code: string): number {
  switch (code) {
    case "bad-request": case "model-incompatible": return 400;
    case "auth-failed": return 401;
    case "quota-exceeded": return 403;
    case "rate-limited": return 429;
    case "server-error": return 500;
    case "timeout": return 408;
    default: return 0;
  }
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