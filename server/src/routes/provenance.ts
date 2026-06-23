/**
 * 生成树 API 路由
 * Feature #17-19: 生成树
 */
import { Router } from "express";
import {
  getProvenanceByRunId,
  addProvenanceNode,
  deleteProvenanceNode,
  updateProvenanceScore,
  replaceSource,
  getParagraphTree,
} from "../lib/provenanceTree.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import crypto from "crypto";

export const provenanceRouter = Router();

/** GET /api/provenance/:runId — 获取生成树 */
provenanceRouter.get("/:runId", (req, res) => {
  try {
    const nodes = getProvenanceByRunId(req.params.runId);
    res.json({ ok: true, nodes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/provenance/:runId/paragraph/:idx — 获取段落来源 */
provenanceRouter.get("/:runId/paragraph/:idx", (req, res) => {
  try {
    const nodes = getParagraphTree(req.params.runId, Number(req.params.idx));
    res.json({ ok: true, nodes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/provenance — 添加来源节点 */
provenanceRouter.post("/", (req, res) => {
  try {
    const { runId, paragraphIdx, chunkId, score, parentId } = req.body;
    const id = crypto.randomUUID();
    addProvenanceNode({ id, runId, paragraphIdx, chunkId, score, isManual: true, parentId });
    res.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/provenance/:id/replace — 替换来源（Feature #18） */
provenanceRouter.put("/:id/replace", (req, res) => {
  try {
    const { newChunkId } = req.body;
    replaceSource(req.params.id, newChunkId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/provenance/:id/score — 更新置信度 */
provenanceRouter.put("/:id/score", (req, res) => {
  try {
    const { score } = req.body;
    updateProvenanceScore(req.params.id, score);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/provenance/:id — 删除来源节点 */
provenanceRouter.delete("/:id", (req, res) => {
  try {
    deleteProvenanceNode(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
