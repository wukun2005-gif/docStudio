/**
 * Chat API 路由
 * Feature #5: Chat Box 交互
 */
import { Router } from "express";
import { handleChat } from "../lib/chatRouter.js";
import { generateOutline, getTemplates, getTemplateById } from "../lib/narrativeEngine.js";
import { logger } from "../lib/logger.js";

export const chatRouter = Router();

/** POST /api/chat — Chat 交互 */
chatRouter.post("/", async (req, res) => {
  try {
    const { message, conversationHistory, providerPreference, modelId, apiKey, providerBaseUrls, documentContext } = req.body;

    if (!message) {
      res.status(400).json({ ok: false, error: "message is required" });
      return;
    }

    const response = await handleChat({
      message,
      conversationHistory,
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
      documentContext,
    });

    res.json({ ok: true, ...response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Chat] 错误: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/chat/outline — 生成大纲 */
chatRouter.post("/outline", async (req, res) => {
  try {
    const { userRequest, templateId, providerPreference, modelId, apiKey, providerBaseUrls } = req.body;

    if (!userRequest) {
      res.status(400).json({ ok: false, error: "userRequest is required" });
      return;
    }

    const outline = await generateOutline({
      userRequest,
      templateId,
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
    });

    res.json({ ok: true, outline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Chat] 大纲生成错误: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/chat/templates — 获取叙事模板 */
chatRouter.get("/templates", (_req, res) => {
  try {
    const templates = getTemplates();
    res.json({ ok: true, templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
