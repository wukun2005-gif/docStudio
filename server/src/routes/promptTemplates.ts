/**
 * Prompt Templates CRUD API
 *
 * 提供文档风格、输出格式、读者画像模板的查询和自定义管理
 */
import { Router } from "express";
import {
  getAllStyles,
  getAllFormats,
  getAllAudiences,
  getStyle,
  getFormat,
  getAudience,
  saveCustomTemplate,
  deleteCustomTemplate,
} from "../lib/promptTemplates.js";
import { detectStyle, detectFormat, detectAudience } from "../lib/promptTemplates.js";
import { localizeStyle, localizeFormat, localizeAudience } from "../lib/promptTemplates.js";
import { readLanguage } from "../lib/serverI18n.js";
import { logger } from "../lib/logger.js";

export const promptTemplatesRouter = Router();

// ── 查询所有模板 ─────────────────────────────────────

/** GET /api/prompt-templates/styles — 获取所有 Style 模板 */
promptTemplatesRouter.get("/styles", (req, res) => {
  try {
    const language = readLanguage(req);
    res.json({ ok: true, data: getAllStyles().map((s) => localizeStyle(s, language)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/** GET /api/prompt-templates/formats — 获取所有 Format 模板 */
promptTemplatesRouter.get("/formats", (req, res) => {
  try {
    const language = readLanguage(req);
    res.json({ ok: true, data: getAllFormats().map((f) => localizeFormat(f, language)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/** GET /api/prompt-templates/audiences — 获取所有 Audience 模板 */
promptTemplatesRouter.get("/audiences", (req, res) => {
  try {
    const language = readLanguage(req);
    res.json({ ok: true, data: getAllAudiences().map((a) => localizeAudience(a, language)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── 自动检测 ─────────────────────────────────────────

/** POST /api/prompt-templates/detect — 从用户请求文本自动推断 style/format/audience */
promptTemplatesRouter.post("/detect", (req, res) => {
  try {
    const { userRequest } = req.body;
    if (!userRequest) {
      res.status(400).json({ ok: false, error: "userRequest is required" });
      return;
    }

    const language = readLanguage(req);
    const style = detectStyle(userRequest);
    const format = detectFormat(userRequest);
    const audience = detectAudience(userRequest);

    res.json({
      ok: true,
      // id 保持原值供业务判断，只有 name/description 跟随语言
      data: {
        style: localizeStyle(style, language),
        format: localizeFormat(format, language),
        audience: localizeAudience(audience, language),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── 自定义模板 CRUD ──────────────────────────────────

/** POST /api/prompt-templates/styles — 创建/更新自定义 Style */
promptTemplatesRouter.post("/styles", (req, res) => {
  try {
    const { id, name, description, promptFragment } = req.body;
    if (!id || !name || !promptFragment) {
      res.status(400).json({ ok: false, error: "id, name, promptFragment are required" });
      return;
    }

    saveCustomTemplate("prompt_styles", id, { name, description, promptFragment, isBuiltin: false });
    res.json({ ok: true, data: getStyle(id) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/** DELETE /api/prompt-templates/styles/:id — 删除自定义 Style */
promptTemplatesRouter.delete("/styles/:id", (req, res) => {
  try {
    const { id } = req.params;
    const style = getStyle(id);
    if (style.isBuiltin) {
      res.status(400).json({ ok: false, error: "Cannot delete builtin style" });
      return;
    }

    const deleted = deleteCustomTemplate("prompt_styles", id);
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/** POST /api/prompt-templates/audiences — 创建/更新自定义 Audience */
promptTemplatesRouter.post("/audiences", (req, res) => {
  try {
    const { id, name, guidance } = req.body;
    if (!id || !name || !guidance) {
      res.status(400).json({ ok: false, error: "id, name, guidance are required" });
      return;
    }

    saveCustomTemplate("prompt_audiences", id, { name, guidance, isBuiltin: false });
    res.json({ ok: true, data: getAudience(id) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/** DELETE /api/prompt-templates/audiences/:id — 删除自定义 Audience */
promptTemplatesRouter.delete("/audiences/:id", (req, res) => {
  try {
    const { id } = req.params;
    const audience = getAudience(id);
    if (audience.isBuiltin) {
      res.status(400).json({ ok: false, error: "Cannot delete builtin audience" });
      return;
    }

    const deleted = deleteCustomTemplate("prompt_audiences", id);
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});
