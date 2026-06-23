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
import { PRESET_MODEL_PROVIDERS } from "../../../shared/src/types/provider.js";
import { logger } from "../lib/logger.js";
import type { AppSettings, ProviderConnection, ProviderId } from "../../../shared/src/types/provider.js";

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

/** POST /api/settings/providers — 批量更新 provider 配置 */
settingsRouter.post("/providers", (req, res) => {
  try {
    const { providers, enableProviderFallback } = req.body as {
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
    };

    if (!Array.isArray(providers)) {
      res.status(400).json({ ok: false, error: "providers must be an array" });
      return;
    }

    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    // 构建 AppSettings 格式
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
    logger.info(`[Settings] 批量更新 ${providers.length} 个 provider`);
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
