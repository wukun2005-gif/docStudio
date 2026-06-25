/**
 * 文档生成 API 路由
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { Router } from "express";
import crypto from "crypto";
import { generateDocument, toHtml } from "../lib/docGenerator.js";
import { exportDocument, type ExportFormat } from "../lib/docExporter.js";
import { buildProvenanceTree, getProvenanceByRunId } from "../lib/provenanceTree.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { logAudit } from "../lib/auditLog.js";
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

    logAudit({
      table: "generation_runs",
      operation: "INSERT",
      recordId: runId,
      newData: { title, format: format ?? "html", status: "generating" },
      source: "generation",
    });

    // 生成文档（超时由 registry 120s + docGenerator 180s 逐层保障）
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

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: runId,
      newData: { status: "done", trustScore: result.trustScore },
      source: "generation",
    });

    // 构建生成树（段落级来源追溯）
    try {
      const paragraphs = result.sections.flatMap((s, sIdx) =>
        s.sources.length > 0
          ? [{ idx: sIdx, sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })) }]
          : [],
      );
      if (paragraphs.length > 0) {
        buildProvenanceTree(runId, paragraphs);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 生成树构建失败（不影响生成）: ${treeErr}`);
    }

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

/** GET /api/generation/:id/tree — 获取生成树 */
generationRouter.get("/:id/tree", (req, res) => {
  try {
    const tree = getProvenanceByRunId(req.params.id);
    res.json({ ok: true, tree });
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

/** POST /api/generation/:runId/regenerate-section — 重新生成单个章节 */
generationRouter.post("/:runId/regenerate-section", async (req, res) => {
  try {
    const { sectionIdx, section, outline, apiKey } = req.body;
    if (sectionIdx === undefined || !section || !outline) {
      res.status(400).json({ ok: false, error: "sectionIdx, section, and outline are required" });
      return;
    }

    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.runId) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    // 用单章节大纲调用 generateDocument
    const singleOutline = [section];
    const result = await generateDocument({
      title: run.title,
      outline: singleOutline,
      format: run.format ?? "html",
      apiKey,
      userRequest: run.title,
    });

    // 重新生成完整文档 HTML：替换对应章节
    const oldContent = run.content || "";
    const fullOutline = JSON.parse(run.outline || "[]");
    // 重新生成所有章节的 HTML（用新章节替换旧章节）
    const newSectionHtml = toHtml(result);

    // 简单策略：返回新章节内容，由前端拼接
    const newSectionData = result.sections[0];

    // 更新 provenance：删除旧章节的节点，写入新节点
    try {
      const oldNodes = db.prepare("SELECT id FROM provenance_nodes WHERE run_id = ? AND paragraph_idx = ?")
        .all(req.params.runId, sectionIdx) as any[];
      for (const n of oldNodes) {
        db.prepare("DELETE FROM provenance_nodes WHERE id = ?").run(n.id);
      }
      if (newSectionData.sources.length > 0) {
        buildProvenanceTree(req.params.runId, [{
          idx: sectionIdx,
          sources: newSectionData.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })),
        }]);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 章节生成树更新失败: ${treeErr}`);
    }

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: req.params.runId,
      source: "generation.regenerate-section",
    });

    logger.info(`[Generation] 章节 ${sectionIdx} 重新生成完成`);

    res.json({
      ok: true,
      section: {
        title: newSectionData.title,
        content: newSectionData.content,
        sources: newSectionData.sources,
        webCitations: newSectionData.webCitations,
        groundingScore: newSectionData.groundingScore,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 章节重新生成失败: ${msg}`);
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

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: req.params.id,
      source: "generation",
    });

    logger.info(`[Generation] 文档内容已更新: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
