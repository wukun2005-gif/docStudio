/**
 * 文档生成 API 路由
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { Router } from "express";
import crypto from "crypto";
import { generateDocument, toHtml } from "../lib/docGenerator.js";
import { exportDocument, type ExportFormat } from "../lib/docExporter.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { OutlineSection } from "../lib/narrativeEngine.js";

export const generationRouter = Router();

/** POST /api/generation/generate — 一键生成文档 */
generationRouter.post("/generate", async (req, res) => {
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    const runId = crypto.randomUUID();

    // 创建生成记录
    const db = getDb();
    db.prepare(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`)
      .run(runId, title, JSON.stringify(outline), format ?? "html", "generating");

    // 生成文档
    const result = await generateDocument({
      title,
      outline: outline as OutlineSection[],
      format: format ?? "html",
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
      userRequest,
    });

    // 更新记录
    const htmlContent = toHtml(result);
    db.prepare(`UPDATE generation_runs SET content = ?, status = 'done', trust_score = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(htmlContent, result.trustScore, runId);

    logger.info(`[Generation] 文档生成完成: ${title}`);

    res.json({
      ok: true,
      runId,
      content: htmlContent,
      sections: result.sections,
      trustScore: result.trustScore,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 生成失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/history — 获取生成历史 */
generationRouter.get("/history", (_req, res) => {
  try {
    const db = getDb();
    const runs = db.prepare("SELECT id, title, format, status, trust_score, created_at FROM generation_runs ORDER BY created_at DESC LIMIT 50").all();
    res.json({ ok: true, runs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/:id — 获取生成详情 */
generationRouter.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.id);
    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }
    res.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/:id/export/:format — 导出文档 */
generationRouter.get("/:id/export/:format", (req, res) => {
  try {
    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    const format = req.params.format as ExportFormat;
    if (!["docx", "pptx", "xlsx"].includes(format)) {
      res.status(400).json({ ok: false, error: "Invalid format" });
      return;
    }

    const outline = run.outline ? JSON.parse(run.outline) : [];
    const sections = outline.map((s: any) => ({
      title: s.title,
      content: s.description ?? "",
      level: s.level,
    }));

    const result = exportDocument(format, run.title, sections);

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(run.title)}${result.extension}"`);
    res.send(result.buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 导出失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/generation/:id/content — 更新文档内容（在线编辑 Feature #16） */
generationRouter.put("/:id/content", (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ ok: false, error: "content is required" });
      return;
    }

    const db = getDb();
    db.prepare("UPDATE generation_runs SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(content, req.params.id);

    logger.info(`[Generation] 文档内容已更新: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
