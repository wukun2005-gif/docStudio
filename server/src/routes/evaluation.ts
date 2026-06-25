/**
 * 评估 API 路由
 * Feature #20-23: 评估体系
 */
import { Router } from "express";
import crypto from "crypto";
import { evaluateOnline, computeTrustScore } from "../lib/evalMetrics.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { logAudit } from "../lib/auditLog.js";
import { readSettingsFromDb } from "../lib/settingsReader.js";

export const evaluationRouter = Router();

/** POST /api/evaluation/evaluate — 在线评估 */
evaluationRouter.post("/evaluate", async (req, res) => {
  try {
    const { runId, content, sources } = req.body;

    if (!content) {
      res.status(400).json({ ok: false, error: "content is required" });
      return;
    }

    // 从 DB 读取用户配置的 provider（与 docGenerator 一致）
    const dbSettings = readSettingsFromDb();

    if (!dbSettings.providerPreference?.length || !dbSettings.modelId) {
      res.status(400).json({ ok: false, error: "请先在设置页配置 LLM Provider" });
      return;
    }

    const metrics = await evaluateOnline({
      content,
      sources: sources ?? [],
      providerPreference: dbSettings.providerPreference,
      modelId: dbSettings.modelId,
      providerBaseUrls: dbSettings.providerBaseUrls,
    });

    const trustScore = computeTrustScore(metrics);

    // 评估失败（全 0）时不写入 DB，让前端下次重试
    const isFailed = trustScore === 0;
    if (isFailed) {
      logger.warn(`[Evaluation] 评估返回全 0，跳过写入 DB`);
      res.json({ ok: true, metrics, trustScore });
      return;
    }

    // 保存评估结果
    if (runId) {
      const db = getDb();
      const evalId = crypto.randomUUID();
      db.prepare(`INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`)
        .run(evalId, runId, JSON.stringify(metrics));

      logAudit({
        table: "trust_evaluations",
        operation: "INSERT",
        recordId: evalId,
        newData: { runId, metrics },
        source: "evaluation",
      });

      // 更新 generation_runs 的 trust_score
      db.prepare("UPDATE generation_runs SET trust_score = ? WHERE id = ?").run(trustScore, runId);

      logAudit({
        table: "generation_runs",
        operation: "UPDATE",
        recordId: runId,
        newData: { trustScore },
        source: "evaluation",
      });
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

// ── Golden Set（Feature #37）────────────────────────────

/** POST /api/evaluation/golden-set/generate — 生成 Golden Set */
evaluationRouter.post("/golden-set/generate", async (req, res) => {
  try {
    const { providerId, modelId, apiKey, questionCount } = req.body;
    if (!providerId || !modelId || !apiKey) {
      res.status(400).json({ ok: false, error: "providerId, modelId, apiKey are required" });
      return;
    }
    const { generateGoldenSet } = await import("../lib/goldenSetGenerator.js");
    const questions = await generateGoldenSet(providerId, modelId, apiKey, questionCount);
    res.json({ ok: true, generated: questions.length, questions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Evaluation] Golden Set generation error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/golden-set — 获取 Golden Set */
evaluationRouter.get("/golden-set", (_req, res) => {
  try {
    const { getGoldenSet, getGoldenSetStats } = require("../lib/goldenSetGenerator.js");
    const questions = getGoldenSet();
    const stats = getGoldenSetStats();
    res.json({ ok: true, questions, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/evaluation/golden-set — 清空 Golden Set */
evaluationRouter.delete("/golden-set", (_req, res) => {
  try {
    const { clearGoldenSet } = require("../lib/goldenSetGenerator.js");
    clearGoldenSet();
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── 离线评估（Feature #38-39）───────────────────────────

/** POST /api/evaluation/offline/run — 运行离线评估 */
evaluationRouter.post("/offline/run", async (req, res) => {
  try {
    const { configs, judgeApiKeys } = req.body;
    if (!configs || !Array.isArray(configs)) {
      res.status(400).json({ ok: false, error: "configs array is required" });
      return;
    }
    const { runEvaluation } = await import("../lib/evalRunner.js");
    const report = await runEvaluation(configs, { judgeApiKeys });
    res.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Evaluation] Offline evaluation error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/offline/reports — 获取离线评估报告列表 */
evaluationRouter.get("/offline/reports", (_req, res) => {
  try {
    const { getReports } = require("../lib/evalRunner.js");
    const reports = getReports();
    res.json({ ok: true, reports });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/offline/reports/:id — 获取单个报告 */
evaluationRouter.get("/offline/reports/:id", (req, res) => {
  try {
    const { getReportById } = require("../lib/evalRunner.js");
    const report = getReportById(req.params.id);
    if (!report) {
      res.status(404).json({ ok: false, error: "Report not found" });
      return;
    }
    res.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/evaluation/offline/reports/:id — 删除报告 */
evaluationRouter.delete("/offline/reports/:id", (req, res) => {
  try {
    const { deleteReport } = require("../lib/evalRunner.js");
    const deleted = deleteReport(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Report not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── Metrics Collector（Feature #40）─────────────────────

/** GET /api/evaluation/metrics/stats — 获取指标统计 */
evaluationRouter.get("/metrics/stats", (_req, res) => {
  try {
    const { metricsCollector } = require("../lib/metricsCollector.js");
    const stats = metricsCollector.getStats();
    res.json({ ok: true, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/evaluation/metrics/recent — 获取最近指标 */
evaluationRouter.get("/metrics/recent", (req, res) => {
  try {
    const { metricsCollector } = require("../lib/metricsCollector.js");
    const limit = parseInt(req.query.limit as string) || 50;
    const records = metricsCollector.getRecent(limit);
    res.json({ ok: true, records });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
