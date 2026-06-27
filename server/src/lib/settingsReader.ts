/**
 * Settings 读取模块 — 从 DB 读取用户 provider 配置
 *
 * 供各 LLM 消费模块共用，避免代码重复。
 * 结果缓存，避免每次请求都读 DB。
 */
import { dbGet, dbAll } from "./dbQuery.js";
import { logger } from "./logger.js";
import type { AppSettings, ProviderConnection, ProviderId } from "../../../shared/src/types/provider.js";

export interface DbSettings {
  providerPreference?: string[];
  modelId?: string;
  modelFallbacks?: Record<string, string[]>;
  enableModelFallback?: Record<string, boolean>;
  providerBaseUrls?: Record<string, string>;
  providerApiKeys?: Record<string, string>;
  enableProviderFallback?: boolean;
  // Knowledge / RAG 配置
  knowledgeEnabled?: boolean;
  knowledgeEmbedding?: { baseUrl: string; apiKey: string; modelId: string };
  knowledgeReranker?: { baseUrl: string; apiKey: string; modelId: string };
  // Search providers
  searchProviders?: Array<{ providerId: string; apiKey: string; baseUrl?: string; enabled: boolean }>;
  // 发件人身份（当前用户）
  senderProfile?: { name: string; title?: string; department?: string; email?: string };
}

let cachedSettings: DbSettings | null = null;

/**
 * 从 DB 的 user_settings 表读取用户 provider 配置。
 * 存储格式：key = 'provider_all', value = JSON(AppSettings)
 *
 * 向后兼容：也支持旧格式（key = 'provider_{id}' 的独立行）。
 */
export function readSettingsFromDb(): DbSettings {
  if (cachedSettings) return cachedSettings;

  try {
    // 优先读取新格式（provider_all）
    const row = dbGet<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = ?",
      ["provider_all"],
    );

    if (row) {
      const settings: AppSettings = JSON.parse(row.value);
      cachedSettings = parseAppSettings(settings);
      logger.info(`[SettingsReader] 从 DB 读取 settings（新格式）: providers=${cachedSettings.providerPreference?.length ?? 0}`);
      return cachedSettings;
    }

    // Fallback：旧格式（provider_{id} 独立行）
    const rows = dbAll<{ key: string; value: string }>(
      "SELECT key, value FROM user_settings WHERE key LIKE 'provider_%' AND key != 'provider_all'",
    );

    if (rows.length > 0) {
      const providers: ProviderConnection[] = [];
      for (const r of rows) {
        try {
          const config = JSON.parse(r.value);
          providers.push({
            providerId: r.key.replace("provider_", "") as ProviderId,
            apiKeyRef: config.apiKey ?? "",
            modelIds: config.modelIds ?? [],
            defaultModelId: config.defaultModelId ?? "",
            modelFallbacks: config.modelFallbacks ?? [],
            enabled: config.enabled ?? true,
            enableModelFallback: config.enableModelFallback ?? false,
            baseUrl: config.baseUrl,
          });
        } catch { /* skip malformed rows */ }
      }
      cachedSettings = parseAppSettings({ providers, enableProviderFallback: true });
      logger.info(`[SettingsReader] 从 DB 读取 settings（旧格式）: providers=${providers.length}`);
      return cachedSettings;
    }

    cachedSettings = {};
    return cachedSettings;
  } catch (err) {
    logger.warn(`[SettingsReader] 读取 DB settings 失败: ${err}`);
    cachedSettings = {};
    return cachedSettings;
  }
}

/** 读取发件人身份配置（独立于 provider 缓存，每次实时读取） */
export function readSenderProfile(): { name: string; title?: string; department?: string; email?: string } | null {
  try {
    const row = dbGet<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", ["sender_profile"]);
    if (!row) return null;
    const profile = JSON.parse(row.value);
    if (profile && typeof profile.name === "string" && profile.name.trim()) {
      return profile;
    }
    return null;
  } catch {
    return null;
  }
}

/** 解析 AppSettings 为 DbSettings */
function parseAppSettings(settings: AppSettings): DbSettings {
  const enabledProviders = (settings.providers ?? []).filter(
    (p) => p.enabled && p.apiKeyRef
  );

  const providerPreference = enabledProviders.map((p) => p.providerId);
  const modelId = enabledProviders[0]?.defaultModelId ?? "";

  const modelFallbacks: Record<string, string[]> = {};
  const enableModelFallback: Record<string, boolean> = {};
  const providerBaseUrls: Record<string, string> = {};
  const providerApiKeys: Record<string, string> = {};

  for (const p of settings.providers ?? []) {
    modelFallbacks[p.providerId] = p.modelFallbacks ?? p.modelIds ?? [];
    enableModelFallback[p.providerId] = p.enableModelFallback ?? false;
    if (p.baseUrl) providerBaseUrls[p.providerId] = p.baseUrl;
    if (p.apiKeyRef) providerApiKeys[p.providerId] = p.apiKeyRef;
  }

  // Knowledge embedding / reranker
  const knowledgeProviders = settings.knowledgeProviders ?? [];
  const embProvider = knowledgeProviders.find(
    (p) => p.providerType === "embedding" && p.enabled && p.apiKeyRef
  );
  const rerankerProvider = knowledgeProviders.find(
    (p) => p.providerType === "reranker" && p.enabled && p.apiKeyRef
  );

  // Search providers
  const searchProviders = (settings.searchProviders ?? [])
    .filter((p) => p.enabled && p.apiKeyRef)
    .map((p) => ({ providerId: p.providerId, apiKey: p.apiKeyRef, baseUrl: p.baseUrl, enabled: p.enabled }));

  return {
    providerPreference,
    modelId,
    modelFallbacks,
    enableModelFallback,
    providerBaseUrls,
    providerApiKeys,
    enableProviderFallback: settings.enableProviderFallback ?? true,
    knowledgeEnabled: settings.knowledge?.enabled ?? false,
    ...(embProvider ? { knowledgeEmbedding: { baseUrl: embProvider.baseUrl, apiKey: embProvider.apiKeyRef, modelId: embProvider.modelId } } : {}),
    ...(rerankerProvider ? { knowledgeReranker: { baseUrl: rerankerProvider.baseUrl, apiKey: rerankerProvider.apiKeyRef, modelId: rerankerProvider.modelId } } : {}),
    ...(searchProviders.length > 0 ? { searchProviders } : {}),
  };
}

/** 清除 settings 缓存（settings 更新后调用） */
export function clearSettingsCache(): void {
  cachedSettings = null;
}

/**
 * 自动填充请求中缺失的 settings 字段。
 * 如果请求体中没有 providerPreference/modelId 等字段，从 DB 读取并填充。
 */
export function fillMissingSettings<T extends {
  providerPreference?: string[] | undefined;
  modelId?: string | undefined;
  providerBaseUrls?: Record<string, string> | undefined;
}>(req: T): T {
  const dbSettings = readSettingsFromDb();

  if (!req.providerPreference || req.providerPreference.length === 0) {
    (req as Record<string, unknown>).providerPreference = dbSettings.providerPreference;
  }
  if (!req.modelId) {
    (req as Record<string, unknown>).modelId = dbSettings.modelId;
  }
  if (!req.providerBaseUrls && dbSettings.providerBaseUrls) {
    (req as Record<string, unknown>).providerBaseUrls = dbSettings.providerBaseUrls;
  }

  return req;
}
