/**
 * Chat API 路由
 * Feature #5: Chat Box 交互
 */
import { Router } from "express";
import { handleChat } from "../lib/chatRouter.js";
import { generateOutline, getTemplates, getTemplateById } from "../lib/narrativeEngine.js";
import { logger } from "../lib/logger.js";
import { pickLang, readLanguage } from "../lib/serverI18n.js";
import { getDemoCase } from "../providers/fixtures/case-1783257530743-en.js";
import { CASE_1782966166476 } from "../providers/fixtures/case-1782966166476.js";
import { CASE_1783257530743 } from "../providers/fixtures/case-1783257530743.js";
import { readOutlineFromDb, readWordOutlineFromDb, readOutlookOutlineFromDb } from "../lib/stubDataReader.js";

export const chatRouter = Router();

/** POST /api/chat — Chat 交互 */
chatRouter.post("/", async (req, res) => {
  try {
    const { message, conversationHistory, providerPreference, modelId, apiKey, providerBaseUrls, documentContext } = req.body;
    // 语言统一从 readLanguage 取（body → query → x-docstudio-language → Accept-Language），避免调用方漏传
    const language = readLanguage(req);

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
        const pptOutline = getDemoCase(CASE_1783257530743, language).outline;
        logger.info(`[Chat] Chat stub mode (PPT fixture): returning outline with ${pptOutline.length} sections`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: pickLang(language, "已为您生成大纲，请确认后生成 PPT 演示文稿。", "Outline generated — confirm it to create the PowerPoint deck."),
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
          reply: pickLang(language, "已为您生成邮件大纲，请确认后生成邮件。", "Email outline generated — confirm it to create the email."),
          suggestedOutline: emailOutline ?? [
            { title: pickLang(language, "邮件开头（问候+简要目的）", "Email opening (greeting + brief purpose)") },
            { title: pickLang(language, "本周核心工作进展", "Key progress this week") },
            { title: pickLang(language, "下周计划与需要协调事项", "Next week's plan and items needing coordination") },
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
          reply: isWord
            ? pickLang(language, "已为您生成大纲，请确认后生成 Word 文档。", "Outline generated — confirm it to create the Word document.")
            : pickLang(language, "已为您生成大纲，请确认后生成 Excel 文档。", "Outline generated — confirm it to create the Excel workbook."),
          suggestedOutline: dbOutline,
          stub: true,
        });
      } else {
        logger.info(`[Chat] Chat stub mode (${isWord ? "Word" : "Excel"} fixture fallback): returning case outline`);
        res.json({
          ok: true,
          type: "outline_request",
          reply: isWord
            ? pickLang(language, "已为您生成大纲，请确认后生成 Word 文档。", "Outline generated — confirm it to create the Word document.")
            : pickLang(language, "已为您生成大纲，请确认后生成 Excel 文档。", "Outline generated — confirm it to create the Excel workbook."),
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
      language,
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
    // 语言统一从 readLanguage 取（body → query → x-docstudio-language → Accept-Language）
    const language = readLanguage(req);

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
        const pptOutline = getDemoCase(CASE_1783257530743, language).outline;
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
