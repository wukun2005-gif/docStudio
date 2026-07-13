/**
 * Chat API 路由
 * Feature #5: Chat Box 交互
 */
import { Router } from "express";
import { handleChat } from "../lib/chatRouter.js";
import { generateOutline, getTemplates, getTemplateById } from "../lib/narrativeEngine.js";
import { logger } from "../lib/logger.js";
import { CASE_1782966166476 } from "../providers/fixtures/case-1782966166476.js";
import { CASE_1783257530743 } from "../providers/fixtures/case-1783257530743.js";
import { readOutlineFromDb, readWordOutlineFromDb, readOutlookOutlineFromDb } from "../lib/stubDataReader.js";

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
      const format = req.body.format as string | undefined;
      const isWord = format === "word";
      const isPpt = format === "ppt";
      const isEmail = format === "email";

      if (isPpt) {
        // PPT stub 模式：使用 case-1783257530743 fixture 大纲
        const pptOutline = CASE_1783257530743.outline;
        logger.info(`[Chat] Chat stub mode (PPT fixture): returning outline with ${pptOutline.length} sections`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: "已为您生成大纲，请确认后生成 PPT 演示文稿。",
          suggestedOutline: pptOutline,
          stub: true,
        });
        return;
      }

      if (isEmail) {
        const emailOutline = readOutlookOutlineFromDb();
        logger.info(`[Chat] Chat stub mode (Email DB): returning outline with ${emailOutline?.length ?? 0} sections`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: "已为您生成邮件大纲，请确认后生成邮件。",
          suggestedOutline: emailOutline ?? [
            { title: "邮件开头（问候+简要目的）" },
            { title: "本周核心工作进展" },
            { title: "下周计划与需要协调事项" },
          ],
          stub: true,
        });
        return;
      }

      const dbOutline = isWord ? readWordOutlineFromDb() : readOutlineFromDb();
      if (dbOutline) {
        logger.info(`[Chat] Chat stub mode (${isWord ? "Word" : "Excel"} DB): returning outline with ${dbOutline.length} sections`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: isWord ? "已为您生成大纲，请确认后生成 Word 文档。" : "已为您生成大纲，请确认后生成 Excel 文档。",
          suggestedOutline: dbOutline,
          stub: true,
        });
      } else {
        logger.info(`[Chat] Chat stub mode (${isWord ? "Word" : "Excel"} fixture fallback): returning case outline`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: isWord ? "已为您生成大纲，请确认后生成 Word 文档。" : "已为您生成大纲，请确认后生成 Excel 文档。",
          suggestedOutline: isWord ? [] : CASE_1782966166476.outline,
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
      const format = req.body.format as string | undefined;
      const isWord = format === "word";
      const isPpt = format === "ppt";

      if (isPpt) {
        // PPT stub 模式：使用 case-1783257530743 fixture 大纲
        const pptOutline = CASE_1783257530743.outline;
        logger.info(`[Chat] Outline stub mode (PPT fixture): returning outline with ${pptOutline.length} sections`);
        res.json({ ok: true, outline: pptOutline, stub: true });
        return;
      }

      const dbOutline = isWord ? readWordOutlineFromDb() : readOutlineFromDb();
      if (dbOutline) {
        logger.info(`[Chat] Outline stub mode (${isWord ? "Word" : "Excel"} DB): returning outline with ${dbOutline.length} sections`);
        res.json({ ok: true, outline: dbOutline, stub: true });
      } else {
        logger.info(`[Chat] Outline stub mode (${isWord ? "Word" : "Excel"} fixture fallback): returning case outline`);
        res.json({ ok: true, outline: isWord ? [] : CASE_1782966166476.outline, stub: true });
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
