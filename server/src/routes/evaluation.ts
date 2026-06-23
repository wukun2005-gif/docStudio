/**
 * 评估 API 路由
 * Feature #20-23: 评估体系
 */
import { Router } from "express";
import crypto from "crypto";
import { evaluateOnline, computeTrustScore } from "../lib/evalMetrics.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";

export const evaluationRouter = Router();

/** POST /api/evaluation/evaluate — 在线评估 */
evaluationRouter.post("/evaluate", async (req, res) => {
  try {
    const { runId, content, sources, providerPreference, modelId, apiKey, providerBaseUrls } = req.body;

    if (!content) {
      res.status(400).json({ ok: false, error: "content is required" });
      return;
    }

    const metrics = await evaluateOnline({
      content,
      sources: sources ?? [],
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
    });

    const trustScore = computeTrustScore(metrics);

    // 保存评估结果
    if (runId) {
      const db = getDb();
      const evalId = crypto.randomUUID();
      db.prepare(`INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`)
        .run(evalId, runId, JSON.stringify(metrics));

      // 更新 generation_runs 的 trust_score
      db.prepare("UPDATE generation_runs SET trust_score = ? WHERE id = ?").run(trustScore, runId);
    }

    res.json({ ok: true, metrics, trustScore });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Evaluation] 评估失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/:runId — 获取评估结果 */
evaluationRouter.get("/:runId", (req, res) => {
  try {
    const db = getDb();
    const evaluations = db.prepare(
      "SELECT * FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC"
    ).all(req.params.runId);

    res.json({ ok: true, evaluations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/history/trend — 历史趋势（Feature #22） */
evaluationRouter.get("/history/trend", (_req, res) => {
  try {
    const db = getDb();
    const runs = db.prepare(
      "SELECT id, title, trust_score, created_at FROM generation_runs WHERE trust_score IS NOT NULL ORDER BY created_at DESC LIMIT 50"
    ).all();

    res.json({ ok: true, trend: runs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/insights/quality — 质量洞察（Feature #23） */
evaluationRouter.get("/insights/quality", (_req, res) => {
  try {
    const db = getDb();

    // 按文档类型分析质量趋势
    const byFormat = db.prepare(
      "SELECT format, COUNT(*) as count, AVG(trust_score) as avg_score FROM generation_runs WHERE trust_score IS NOT NULL GROUP BY format"
    ).all();

    // 最近评估详情
    const recent = db.prepare(
      "SELECT metrics FROM trust_evaluations ORDER BY created_at DESC LIMIT 10"
    ).all() as Array<{ metrics: string }>;

    const avgMetrics = recent.length > 0
      ? recent.reduce(
          (acc, r) => {
            const m = JSON.parse(r.metrics);
            return {
              faithfulness: acc.faithfulness + (m.faithfulness ?? 0),
              groundedness: acc.groundedness + (m.groundedness ?? 0),
              coherence: acc.coherence + (m.coherence ?? 0),
              fluency: acc.fluency + (m.fluency ?? 0),
              completeness: acc.completeness + (m.completeness ?? 0),
            };
          },
          { faithfulness: 0, groundedness: 0, coherence: 0, fluency: 0, completeness: 0 },
        )
      : null;

    if (avgMetrics) {
      const n = recent.length;
      avgMetrics.faithfulness /= n;
      avgMetrics.groundedness /= n;
      avgMetrics.coherence /= n;
      avgMetrics.fluency /= n;
      avgMetrics.completeness /= n;
    }

    res.json({ ok: true, byFormat, avgMetrics });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
