/**
 * Settings API — 用户配置管理
 * 存储在 user_settings 表
 */
import { Router } from "express";
import { getDb } from "../lib/db.js";
import { setApiKey, removeApiKey } from "../security/keyStore.js";
import { logger } from "../lib/logger.js";

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

    // 如果是 provider 配置，同步更新 keyStore
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
    const { providers } = req.body as {
      providers: Array<{
        providerId: string;
        apiKey?: string;
        baseUrl?: string;
        defaultModelId?: string;
        enabled?: boolean;
      }>;
    };

    if (!Array.isArray(providers)) {
      res.status(400).json({ ok: false, error: "providers must be an array" });
      return;
    }

    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    const tx = db.transaction(() => {
      for (const p of providers) {
        upsert.run(`provider_${p.providerId}`, JSON.stringify(p));
        if (p.apiKey) {
          setApiKey(p.providerId, p.apiKey);
        }
      }
    });
    tx();

    logger.info(`[Settings] 批量更新 ${providers.length} 个 provider`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
