/**
 * Workflow API 路由
 *
 * Feature #44-46: Workflow 定义、执行、触发
 */
import { Router } from "express";
import {
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  executeWorkflow,
  getWorkflowRuns,
} from "../lib/workflowEngine.js";
import { logger } from "../lib/logger.js";

export const workflowsRouter = Router();

/** GET /api/workflows — 列出所有 workflows */
workflowsRouter.get("/", (_req, res) => {
  try {
    const workflows = listWorkflows();
    res.json({ ok: true, workflows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/workflows/:id — 获取单个 workflow */
workflowsRouter.get("/:id", (req, res) => {
  try {
    const workflow = getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ ok: false, error: "Workflow not found" });
      return;
    }
    res.json({ ok: true, workflow });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/workflows — 创建 workflow */
workflowsRouter.post("/", (req, res) => {
  try {
    const { name, description, steps, triggerType, triggerConfig } = req.body;
    if (!name || !steps) {
      res.status(400).json({ ok: false, error: "name and steps are required" });
      return;
    }
    const workflow = createWorkflow(name, description ?? "", steps, triggerType, triggerConfig);
    res.json({ ok: true, workflow });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/workflows/:id — 更新 workflow */
workflowsRouter.put("/:id", (req, res) => {
  try {
    const updated = updateWorkflow(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ ok: false, error: "Workflow not found" });
      return;
    }
    res.json({ ok: true, workflow: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/workflows/:id — 删除 workflow */
workflowsRouter.delete("/:id", (req, res) => {
  try {
    const deleted = deleteWorkflow(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Workflow not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/workflows/:id/execute — 执行 workflow */
workflowsRouter.post("/:id/execute", async (req, res) => {
  try {
    const { providerId, modelId, apiKey, input } = req.body;
    const run = await executeWorkflow(req.params.id, {
      providerId,
      modelId,
      apiKey,
      input,
    });
    res.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Workflows] Execute error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/workflows/:id/runs — 获取 workflow 运行历史 */
workflowsRouter.get("/:id/runs", (req, res) => {
  try {
    const runs = getWorkflowRuns(req.params.id);
    res.json({ ok: true, runs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
