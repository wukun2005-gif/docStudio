/**
 * Settings API — 用户配置管理 + 模型目录
 *
 * 存储在 user_settings 表：
 * - 旧格式：key = 'provider_{id}', value = JSON(单个 provider 配置)
 * - 新格式：key = 'provider_all', value = JSON(AppSettings)
 */
import { Router } from "express";
import { getDb } from "../lib/db.js";
import { setApiKey, removeApiKey } from "../security/keyStore.js";
import { clearSettingsCache } from "../lib/settingsReader.js";
import { getModelCatalog } from "../providers/model-capabilities-registry.js";
import { registry } from "../providers/registry.js";
import { validateExternalUrl, BlockedUrlError } from "../lib/urlValidation.js";
import { PRESET_MODEL_PROVIDERS, PRESET_SEARCH_PROVIDERS } from "../../../shared/src/types/provider.js";
import { logger } from "../lib/logger.js";
import type { AppSettings, ProviderConnection, ProviderId, SearchProviderId } from "../../../shared/src/types/provider.js";

export const settingsRouter = Router();

/** GET /api/settings — 获取所有设置 */
settingsRouter.get("/", (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM user_settings").all() as Array<{ key: string; value: string }>;
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json({ ok: true, settings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Settings] GET 失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/settings/:key — 获取单个设置 */
settingsRouter.get("/:key", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM user_settings WHERE key = ?").get(req.params.key) as { value: string } | undefined;
    if (!row) {
      res.json({ ok: true, value: null });
      return;
    }
    try {
      res.json({ ok: true, value: JSON.parse(row.value) });
    } catch {
      res.json({ ok: true, value: row.value });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/settings/:key — 更新设置 */
settingsRouter.put("/:key", (req, res) => {
  try {
    const db = getDb();
    const value = typeof req.body.value === "string" ? req.body.value : JSON.stringify(req.body.value);
    db.prepare(
      "INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(req.params.key, value);

    // 如果是 provider 配置，同步更新 keyStore 和缓存
    if (req.params.key.startsWith("provider_")) {
      const providerId = req.params.key.replace("provider_", "");
      try {
        const config = JSON.parse(value);
        if (config.apiKey) {
          setApiKey(providerId, config.apiKey);
        }
      } catch {
        // ignore
      }
      clearSettingsCache();
    }

    logger.info(`[Settings] 更新: ${req.params.key}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Settings] PUT 失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/settings/:key — 删除设置 */
settingsRouter.delete("/:key", (req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM user_settings WHERE key = ?").run(req.params.key);

    if (req.params.key.startsWith("provider_")) {
      const providerId = req.params.key.replace("provider_", "");
      removeApiKey(providerId);
      clearSettingsCache();
    }

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/settings/providers — 批量更新所有配置（LLM providers + search + knowledge） */
settingsRouter.post("/providers", (req, res) => {
  try {
    const { providers, enableProviderFallback, searchProviders, knowledgeProviders, knowledge } = req.body as {
      providers: Array<{
        providerId: string;
        apiKey?: string;
        apiKeyRef?: string;
        baseUrl?: string;
        defaultModelId?: string;
        modelIds?: string[];
        modelFallbacks?: string[];
        enabled?: boolean;
        enableModelFallback?: boolean;
      }>;
      enableProviderFallback?: boolean;
      searchProviders?: Array<{
        providerId: string;
        name?: string;
        apiKeyRef?: string;
        baseUrl?: string;
        enabled?: boolean;
      }>;
      knowledgeProviders?: Array<{
        providerType: string;
        providerId: string;
        displayName?: string;
        baseUrl?: string;
        apiKeyRef?: string;
        modelId?: string;
        availableModels?: string[];
        enabled?: boolean;
      }>;
      knowledge?: { enabled: boolean; topK?: number; scoreThreshold?: number };
    };

    if (!Array.isArray(providers)) {
      res.status(400).json({ ok: false, error: "providers must be an array" });
      return;
    }

    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    // 构建 AppSettings 格式（包含所有配置）
    const appSettings: AppSettings = {
      providers: providers.map((p) => ({
        providerId: p.providerId as ProviderId,
        apiKeyRef: p.apiKeyRef ?? p.apiKey ?? "",
        modelIds: p.modelIds ?? [],
        defaultModelId: p.defaultModelId ?? "",
        modelFallbacks: p.modelFallbacks ?? [],
        enabled: p.enabled ?? true,
        enableModelFallback: p.enableModelFallback ?? false,
        baseUrl: p.baseUrl,
      })),
      enableProviderFallback: enableProviderFallback ?? true,
      ...(searchProviders ? { searchProviders: searchProviders.map((sp) => ({
        providerId: sp.providerId as SearchProviderId,
        name: sp.name ?? sp.providerId,
        apiKeyRef: sp.apiKeyRef ?? "",
        baseUrl: sp.baseUrl,
        enabled: sp.enabled ?? false,
      })) } : {}),
      ...(knowledgeProviders ? { knowledgeProviders: knowledgeProviders.map((kp) => ({
        providerType: kp.providerType as "embedding" | "reranker",
        providerId: kp.providerId,
        displayName: kp.displayName ?? kp.providerId,
        baseUrl: kp.baseUrl ?? "",
        apiKeyRef: kp.apiKeyRef ?? "",
        modelId: kp.modelId ?? "",
        availableModels: kp.availableModels ?? [],
        enabled: kp.enabled ?? false,
      })) } : {}),
      ...(knowledge ? { knowledge } : {}),
    };

    const tx = db.transaction(() => {
      // 存储新格式（完整 AppSettings）
      upsert.run("provider_all", JSON.stringify(appSettings));

      // 同时存储旧格式（每个 provider 独立行），向后兼容
      for (const p of providers) {
        upsert.run(`provider_${p.providerId}`, JSON.stringify(p));
        const apiKey = p.apiKeyRef ?? p.apiKey;
        if (apiKey) {
          setApiKey(p.providerId, apiKey);
        }
      }
    });
    tx();

    clearSettingsCache();
    logger.info(`[Settings] 批量更新: ${providers.length} providers, ${searchProviders?.length ?? 0} search, ${knowledgeProviders?.length ?? 0} knowledge`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Settings] POST providers 失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── Provider 模型目录 ──────────────────────────────────────────

/** GET /api/providers/presets — 获取预置 provider 列表（含 baseUrl/keyPlaceholder） */
settingsRouter.get("/providers/presets", (_req, res) => {
  res.json({ ok: true, presets: PRESET_MODEL_PROVIDERS });
});

/** GET /api/providers/models — 获取所有 provider 的静态模型目录（含能力元数据） */
settingsRouter.get("/providers/models", (_req, res) => {
  try {
    const catalog = getModelCatalog();
    res.json({ ok: true, catalog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/providers/:providerId/models — 查询 provider 可用模型（需要 API Key） */
settingsRouter.post("/providers/:providerId/models", async (req, res) => {
  const providerId = req.params.providerId as ProviderId;
  const { apiKey, baseUrl } = req.body as { apiKey?: string; baseUrl?: string };

  if (!apiKey) {
    res.status(400).json({ ok: false, error: "apiKey is required" });
    return;
  }

  if (baseUrl) {
    try {
      validateExternalUrl(baseUrl);
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      throw err;
    }
  }

  const adapter = registry.get(providerId);
  if (!adapter) {
    res.status(404).json({ ok: false, error: `Unknown provider: ${providerId}` });
    return;
  }

  try {
    const models = await adapter.listModels(apiKey, baseUrl);
    const modelIds = models.map((m) => m.id);
    res.json({ ok: true, providerId, models: modelIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Settings] 查询模型失败: ${providerId} — ${message}`);
    res.status(502).json({ ok: false, error: message });
  }
});

/** POST /api/providers/:providerId/verify-model — 验证单个模型可调用 */
settingsRouter.post("/providers/:providerId/verify-model", async (req, res) => {
  const providerId = req.params.providerId as ProviderId;
  const { apiKey, baseUrl, modelId } = req.body as { apiKey?: string; baseUrl?: string; modelId?: string };

  if (!apiKey || !modelId) {
    res.status(400).json({ ok: false, error: "apiKey and modelId are required" });
    return;
  }

  const adapter = registry.get(providerId);
  if (!adapter) {
    res.status(404).json({ ok: false, error: `Unknown provider: ${providerId}` });
    return;
  }

  const base = baseUrl || adapter.defaultBaseUrl;
  try {
    const fetchRes = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (fetchRes.ok) {
      logger.info(`[verify-model] ${providerId}/${modelId}: OK`);
      res.json({ ok: true, modelId });
    } else {
      const body = await fetchRes.text().catch(() => "");
      logger.warn(`[verify-model] ${providerId}/${modelId}: HTTP ${fetchRes.status} — ${body.slice(0, 200)}`);
      res.json({ ok: false, modelId, error: `HTTP ${fetchRes.status}: ${body.slice(0, 200)}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[verify-model] ${providerId}/${modelId}: ${message}`);
    res.json({ ok: false, modelId, error: message });
  }
});

// ── Search Provider 验证 ──────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

/** POST /api/settings/verify-search-key — 验证搜索 API Key */
settingsRouter.post("/verify-search-key", async (req, res) => {
  const { providerId, apiKey, baseUrl } = req.body as {
    providerId?: SearchProviderId;
    apiKey?: string;
    baseUrl?: string;
  };

  if (!providerId || !apiKey) {
    res.status(400).json({ ok: false, error: "providerId and apiKey are required" });
    return;
  }

  try {
    if (baseUrl) validateExternalUrl(baseUrl);

    if (providerId === "tavily") {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: "test", max_results: 1, include_answer: false }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        res.json({ ok: true, providerId, message: "Tavily API Key 有效" });
      } else {
        const text = await response.text().catch(() => "");
        res.json({ ok: false, providerId, error: `Key 无效 (${response.status}): ${text.slice(0, 100)}` });
      }
    } else if (providerId === "serpapi") {
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", "test");
      url.searchParams.set("num", "1");
      url.searchParams.set("api_key", apiKey);
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.ok) {
        res.json({ ok: true, providerId, message: "SerpAPI Key 有效" });
      } else {
        const text = await response.text().catch(() => "");
        res.json({ ok: false, providerId, error: `Key 无效 (${response.status}): ${text.slice(0, 100)}` });
      }
    } else if (providerId === "epo") {
      const colonIdx = apiKey.indexOf(":");
      if (colonIdx === -1) {
        res.json({ ok: false, providerId, error: "EPO OPS 需要 Consumer Key:Consumer Secret 格式" });
        return;
      }
      const consumerKey = apiKey.slice(0, colonIdx);
      const consumerSecret = apiKey.slice(colonIdx + 1);
      const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
      const response = await fetch("https://ops.epo.org/3.2/auth/accesstoken", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        res.json({ ok: true, providerId, message: "EPO OPS Consumer Key/Secret 有效" });
      } else {
        const text = await response.text().catch(() => "");
        res.json({ ok: false, providerId, error: `EPO 认证失败 (${response.status}): ${text.slice(0, 100)}` });
      }
    } else if (providerId === "serper") {
      const endpoint = (baseUrl || "https://google.serper.dev") + "/search";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: "test", num: 1 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        res.json({ ok: true, providerId, message: "Serper.dev API Key 有效" });
      } else {
        const text = await response.text().catch(() => "");
        res.json({ ok: false, providerId, error: `Key 无效 (${response.status}): ${text.slice(0, 100)}` });
      }
    } else {
      res.status(400).json({ ok: false, error: `不支持的搜索 provider: ${providerId}` });
    }
  } catch (err) {
    logger.error(`[Settings] Verify search key error: ${String(err)}`);
    const message = err instanceof BlockedUrlError ? err.message : "验证失败，请稍后重试";
    res.json({ ok: false, providerId, error: message });
  }
});

/** POST /api/settings/knowledge/providers/test — 测试 Embedding/Reranker 连接 */
settingsRouter.post("/knowledge/providers/test", async (req, res) => {
  const { providerType, baseUrl, apiKey, modelId } = req.body as {
    providerType?: string;
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
  };

  if (!providerType || !baseUrl || !apiKey || !modelId) {
    res.status(400).json({ ok: false, error: "providerType, baseUrl, apiKey, modelId are required" });
    return;
  }

  try {
    validateExternalUrl(baseUrl);

    // 通过查询 /models 端点验证连通性
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.ok) {
      res.json({ ok: true, message: `${providerType === "embedding" ? "Embedding" : "Reranker"} 连接成功` });
    } else {
      const text = await response.text().catch(() => "");
      res.json({ ok: false, error: `连接失败 (${response.status}): ${text.slice(0, 100)}` });
    }
  } catch (err) {
    logger.error(`[Settings] Knowledge provider test error: ${String(err)}`);
    const message = err instanceof BlockedUrlError ? err.message : "连接测试失败，请稍后重试";
    res.json({ ok: false, error: message });
  }
});
