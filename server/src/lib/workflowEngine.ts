/**
 * Workflow Engine — 多步骤文档生成流程
 *
 * Feature #44: Workflow 定义
 * Feature #45: Workflow 执行
 * Feature #46: Workflow 触发
 *
 * 用户定义多步骤流程，按步骤自动执行，步骤间数据传递。
 */
import crypto from "crypto";
import { getDb } from "./db.js";
import { logger } from "./logger.js";
import { generateDocument } from "./docGenerator.js";
import { registry } from "../providers/registry.js";

// ── Types ──────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  name: string;
  type: "generate" | "analyze" | "merge" | "export";
  config: {
    query?: string;
    template?: string;
    format?: "docx" | "pptx" | "xlsx";
    mergeWith?: string[]; // step IDs to merge with
    prompt?: string;
  };
  dependsOn: string[]; // step IDs this step depends on
  status: "pending" | "running" | "done" | "error";
  result?: unknown;
  error?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: "draft" | "running" | "done" | "error";
  triggerType: "manual" | "auto";
  triggerConfig?: {
    watchFiles?: string[];
    schedule?: string; // cron expression
  };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "done" | "error";
  stepResults: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

// ── Database ───────────────────────────────────────────

function ensureWorkflowTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      steps         TEXT NOT NULL,           -- JSON: WorkflowStep[]
      trigger_type  TEXT DEFAULT 'manual',
      trigger_config TEXT,                   -- JSON
      status        TEXT DEFAULT 'draft',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status        TEXT DEFAULT 'running',
      step_results  TEXT,                   -- JSON
      started_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at   TEXT,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs ON workflow_runs(workflow_id);
  `);
}

function saveWorkflow(workflow: Workflow): void {
  ensureWorkflowTable();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO workflows (id, name, description, steps, trigger_type, trigger_config, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    workflow.id,
    workflow.name,
    workflow.description,
    JSON.stringify(workflow.steps),
    workflow.triggerType,
    JSON.stringify(workflow.triggerConfig ?? {}),
    workflow.status,
  );
}

function loadWorkflow(id: string): Workflow | null {
  ensureWorkflowTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as {
    id: string;
    name: string;
    description: string;
    steps: string;
    trigger_type: string;
    trigger_config: string;
    status: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: safeParseJson<WorkflowStep[]>(row.steps, []),
    triggerType: row.trigger_type as Workflow["triggerType"],
    triggerConfig: safeParseJson<Workflow["triggerConfig"]>(row.trigger_config, {}),
    status: row.status as Workflow["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadAllWorkflows(): Workflow[] {
  ensureWorkflowTable();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all() as Array<{
    id: string;
    name: string;
    description: string;
    steps: string;
    trigger_type: string;
    trigger_config: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    steps: safeParseJson<WorkflowStep[]>(row.steps, []),
    triggerType: row.trigger_type as Workflow["triggerType"],
    triggerConfig: safeParseJson<Workflow["triggerConfig"]>(row.trigger_config, {}),
    status: row.status as Workflow["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function saveWorkflowRun(run: WorkflowRun): void {
  ensureWorkflowTable();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO workflow_runs (id, workflow_id, status, step_results, started_at, finished_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.workflowId,
    run.status,
    JSON.stringify(run.stepResults),
    run.startedAt,
    run.finishedAt ?? null,
    run.error ?? null,
  );
}

// ── Workflow CRUD ──────────────────────────────────────

export function createWorkflow(
  name: string,
  description: string,
  steps: Omit<WorkflowStep, "status" | "result" | "error">[],
  triggerType: Workflow["triggerType"] = "manual",
  triggerConfig?: Workflow["triggerConfig"],
): Workflow {
  const workflow: Workflow = {
    id: `wf-${crypto.randomUUID().slice(0, 8)}`,
    name,
    description,
    steps: steps.map(s => ({ ...s, status: "pending" })),
    triggerType,
    triggerConfig,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveWorkflow(workflow);
  return workflow;
}

export function updateWorkflow(id: string, updates: Partial<Pick<Workflow, "name" | "description" | "steps" | "triggerType" | "triggerConfig">>): Workflow | null {
  const existing = loadWorkflow(id);
  if (!existing) return null;

  const updated: Workflow = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveWorkflow(updated);
  return updated;
}

export function deleteWorkflow(id: string): boolean {
  ensureWorkflowTable();
  const db = getDb();
  db.prepare("DELETE FROM workflow_runs WHERE workflow_id = ?").run(id);
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getWorkflow(id: string): Workflow | null {
  return loadWorkflow(id);
}

export function listWorkflows(): Workflow[] {
  return loadAllWorkflows();
}

// ── Workflow Execution ─────────────────────────────────

export async function executeWorkflow(
  workflowId: string,
  options?: {
    providerId?: string;
    modelId?: string;
    apiKey?: string;
    input?: Record<string, unknown>;
  },
): Promise<WorkflowRun> {
  const workflow = loadWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const run: WorkflowRun = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    workflowId,
    status: "running",
    stepResults: options?.input ?? {},
    startedAt: new Date().toISOString(),
  };

  saveWorkflowRun(run);

  try {
    // Build execution order (topological sort)
    const executionOrder = buildExecutionOrder(workflow.steps);

    for (const stepId of executionOrder) {
      const step = workflow.steps.find(s => s.id === stepId);
      if (!step) continue;

      logger.info(`[Workflow] Executing step: ${step.name} (${step.type})`);
      step.status = "running";

      try {
        const result = await executeStep(step, run.stepResults, options);
        step.result = result;
        step.status = "done";
        run.stepResults[step.id] = result;
      } catch (err) {
        step.status = "error";
        step.error = err instanceof Error ? err.message : String(err);
        logger.error(`[Workflow] Step failed: ${step.name}: ${step.error}`);
        throw err;
      }
    }

    run.status = "done";
    run.finishedAt = new Date().toISOString();
  } catch (err) {
    run.status = "error";
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
  }

  saveWorkflowRun(run);
  return run;
}

async function executeStep(
  step: WorkflowStep,
  previousResults: Record<string, unknown>,
  options?: { providerId?: string; modelId?: string; apiKey?: string },
): Promise<unknown> {
  const providerId = options?.providerId ?? "openai";
  const modelId = options?.modelId ?? "gpt-4o-mini";
  const apiKey = options?.apiKey ?? "";

  switch (step.type) {
    case "generate": {
      const query = step.config.query ?? "";
      // Replace placeholders with previous step results
      const resolvedQuery = resolvePlaceholders(query, previousResults);

      const result = await generateDocument({
        title: step.name,
        outline: [{
          id: "main",
          title: step.name,
          level: 0,
          children: [],
          description: resolvedQuery,
        }],
        format: "docx",
        providerPreference: [providerId],
        modelId,
        apiKey,
      });

      return result.content;
    }

    case "analyze": {
      const prompt = step.config.prompt ?? "";
      const resolvedPrompt = resolvePlaceholders(prompt, previousResults);

      const result = await registry.runWithFallback(
        [providerId],
        {
          modelId,
          messages: [
            { role: "system", content: "你是文档分析助手。" },
            { role: "user", content: resolvedPrompt },
          ],
          apiKey,
          maxTokens: 2000,
        },
        undefined, undefined,
        { [providerId]: apiKey },
      );

      return result.response.text;
    }

    case "merge": {
      const mergeWith = step.config.mergeWith ?? [];
      const contents = mergeWith
        .map(id => previousResults[id])
        .filter(Boolean)
        .map(String);

      return contents.join("\n\n---\n\n");
    }

    case "export": {
      // Export is handled after workflow completes
      return previousResults;
    }

    default:
      return null;
  }
}

function buildExecutionOrder(steps: WorkflowStep[]): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(stepId: string) {
    if (visited.has(stepId)) return;
    visited.add(stepId);

    const step = steps.find(s => s.id === stepId);
    if (!step) return;

    for (const depId of step.dependsOn) {
      visit(depId);
    }

    order.push(stepId);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return order;
}

function resolvePlaceholders(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = data[key];
    if (value === undefined) return `{{${key}}}`;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

// ── Workflow Run History ───────────────────────────────

export function getWorkflowRuns(workflowId: string): WorkflowRun[] {
  ensureWorkflowTable();
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC"
  ).all(workflowId) as Array<{
    id: string;
    workflow_id: string;
    status: string;
    step_results: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRun["status"],
    stepResults: safeParseJson<Record<string, unknown>>(row.step_results, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
  }));
}

// ── Helpers ────────────────────────────────────────────

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
