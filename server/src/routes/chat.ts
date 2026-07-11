/**
 * Chat API 路由
 * Feature #5: Chat Box 交互
 */
import { Router } from "express";
import { handleChat } from "../lib/chatRouter.js";
import { generateOutline, getTemplates, getTemplateById } from "../lib/narrativeEngine.js";
import { logger } from "../lib/logger.js";
import { CASE_1782966166476 } from "../providers/fixtures/case-1782966166476.js";
import { readOutlineFromDb } from "../lib/stubDataReader.js";

export const chatRouter = Router();

/** POST /api/chat — Chat 交互 */
chatRouter.post("/", async (req, res) => {
  try {
    const { message, conversationHistory, providerPreference, modelId, apiKey, providerBaseUrls, documentContext } = req.body;

    if (!message) {
      res.status(400).json({ ok: false, error: "message is required" });
      return;
    }

    // Stub mode：不调 LLM，从 DB 读取真实 case outline
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    if (isStubMode) {
      const dbOutline = readOutlineFromDb();
      if (dbOutline) {
        logger.info(`[Chat] Chat stub mode (DB): returning outline with ${dbOutline.length} sections`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: "已为您生成大纲，请确认后生成 Excel 文档。",
          suggestedOutline: dbOutline,
          stub: true,
        });
      } else {
        logger.info(`[Chat] Chat stub mode (fixture fallback): returning case 1782966166476 outline`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: "已为您生成大纲，请确认后生成 Excel 文档。",
          suggestedOutline: CASE_1782966166476.outline,
          stub: true,
        });
      }
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

    // Stub mode：不调 LLM，从 DB 读取真实 case outline
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    if (isStubMode) {
      const dbOutline = readOutlineFromDb();
      if (dbOutline) {
        logger.info(`[Chat] Outline stub mode (DB): returning outline with ${dbOutline.length} sections`);
        res.json({ ok: true, outline: dbOutline, stub: true });
      } else {
        logger.info(`[Chat] Outline stub mode (fixture fallback): returning case 1782966166476 outline`);
        res.json({ ok: true, outline: CASE_1782966166476.outline, stub: true });
      }
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
