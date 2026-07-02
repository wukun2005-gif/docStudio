/**
 * 通用 KV CRUD API 路由
 * 照搬 patentExaminator 方案：/api/data/:store 通用 CRUD
 *
 * 所有 DB 访问通过 lib/dbQuery.ts，自动审计。
 */
import { Router } from "express";
import express from "express";
import { dbRun, dbGet, dbAll } from "../lib/dbQuery.js";
import { logger } from "../lib/logger.js";

export const dataRouter = Router();

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** GET /api/data/:store — 获取指定 store 的所有记录 */
dataRouter.get("/:store", (req, res) => {
  try {
    const store = req.params.store;
    const trashOnly = req.query.trash === "true";
    if (!store) { res.status(400).json({ ok: false, error: "store is required" }); return; }

    const rows = dbAll<{ record_id: string; data: string }>(
      "SELECT record_id, data FROM sync_data WHERE store_name = ?",
      [store],
    );

    const records: Array<Record<string, unknown>> = [];
    const needsTitleFix: Array<{ record: Record<string, unknown>; recordId: string }> = [];
    const needsWorkflowFix: Array<{ record: Record<string, unknown>; recordId: string }> = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data);
        const record = { id: row.record_id, ...parsed };
        const isDeleted = !!record.deletedAt;

        // 根据 trashOnly 参数过滤
        if (store === "cases") {
          if (trashOnly && !isDeleted) continue;
          if (!trashOnly && isDeleted) continue;
        }

        records.push(record);
        if (store === "cases" && !isDeleted && (!record.title || record.title === "新文档") && record.createdAt) {
          needsTitleFix.push({ record, recordId: row.record_id });
        }
        if (store === "cases" && !isDeleted && record.workflowState === "generating") {
          needsWorkflowFix.push({ record, recordId: row.record_id });
        }
      } catch {
        logger.warn(`[Data] Corrupted JSON in store=${store} record=${row.record_id}, skipping`);
      }
    }

    // 动态修正 case 标题：用最近的 generation run 标题
    if (needsTitleFix.length > 0) {
      const runs = dbAll<{ id: string; title: string; created_at: string }>(
        "SELECT id, title, created_at FROM generation_runs WHERE title IS NOT NULL AND title != '' AND title != '新文档' ORDER BY created_at DESC",
      );
      for (const { record, recordId } of needsTitleFix) {
        const caseTime = new Date(record.createdAt as string).getTime() / 1000;
        let bestTitle = "";
        let bestDiff = Infinity;
        for (const run of runs) {
          const runTime = new Date(run.created_at).getTime() / 1000;
          const diff = Math.abs(runTime - caseTime);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestTitle = run.title;
          }
        }
        if (bestTitle && bestDiff < 86400) {
          record.title = bestTitle;
          const fullData = { ...record };
          delete fullData.id;
          dbRun(
            "UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = 'cases' AND record_id = ?",
            [JSON.stringify(fullData), recordId],
            { table: "sync_data", recordId, source: "data_api", newData: fullData },
          );
          logger.debug(`[Data] 动态修正 case 标题: "新文档" → "${bestTitle}" (case: ${record.id})`);
        }
      }
    }

    // 动态修正 case workflowState：用 generation_runs 真实状态校准
    if (needsWorkflowFix.length > 0) {
      const runIds = needsWorkflowFix
        .map((r) => (r.record.lastRunId as string | undefined) || "")
        .filter((id) => id.length > 0);
      const runsMap = new Map<string, string>();
      if (runIds.length > 0) {
        const placeholder = runIds.map(() => "?").join(",");
        const runs = dbAll<{ id: string; status: string }>(
          `SELECT id, status FROM generation_runs WHERE id IN (${placeholder})`,
          runIds,
        );
        for (const r of runs) runsMap.set(r.id, r.status);
      }
      for (const { record, recordId } of needsWorkflowFix) {
        const lastRunId = (record.lastRunId as string | undefined) || "";
        const runStatus = lastRunId ? runsMap.get(lastRunId) : undefined;
        let newState: string | undefined;
        if (runStatus === "done") newState = "completed";
        else if (runStatus === "crashed") newState = "error";
        else if (!lastRunId) {
          // 没有 lastRunId，用 created_at 时间戳找最近的 run
          const caseCreated = new Date((record.createdAt as string) || Date.now()).getTime() / 1000;
          const latestRun = dbGet<{ id: string; status: string; created_at: string }>(
            "SELECT id, status, created_at FROM generation_runs ORDER BY ABS(strftime('%s', created_at) - ?) ASC LIMIT 1",
            [caseCreated.toString()],
          );
          if (latestRun) {
            const diff = Math.abs(new Date(latestRun.created_at).getTime() / 1000 - caseCreated);
            if (diff < 86400) {
              if (latestRun.status === "done") newState = "completed";
              else if (latestRun.status === "crashed") newState = "error";
            }
          }
        }
        // 兜底：run 被删了、状态异常等无法判断的情况，标记为 error 防止永久卡在"正在生成文档"
        if (!newState) newState = "error";
        if (newState) {
          record.workflowState = newState;
          const fullData = { ...record };
          delete fullData.id;
          dbRun(
            "UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = 'cases' AND record_id = ?",
            [JSON.stringify(fullData), recordId],
            { table: "sync_data", recordId, source: "data_api", newData: fullData },
          );
          logger.info(`[Data] 动态修正 case workflowState: generating → ${newState} (case: ${record.id})`);
        }
      }
    }

    res.json({ ok: true, records });
  } catch (err) {
    logger.error("[Data] GET error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** POST /api/data/:store/query — 按字段过滤记录 */
dataRouter.post("/:store/query", express.json(), (req, res) => {
  try {
    const store = req.params.store;
    const { field, value } = req.body as { field: string; value: unknown };
    if (!field) { res.status(400).json({ ok: false, error: "field is required" }); return; }

    const rows = dbAll<{ record_id: string; data: string }>(
      "SELECT record_id, data FROM sync_data WHERE store_name = ?",
      [store],
    );

    const records: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      try {
        const record = { id: row.record_id, ...JSON.parse(row.data) };
        if (record[field] === value) records.push(record);
      } catch {
        // skip corrupted
      }
    }

    res.json({ ok: true, records });
  } catch (err) {
    logger.error("[Data] QUERY error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** GET /api/data/:store/:id — 获取指定记录 */
dataRouter.get("/:store/:id", (req, res) => {
  try {
    const store = req.params.store;
    const id = req.params.id;

    const row = dbGet<{ data: string }>(
      "SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?",
      [store, id],
    );

    if (!row) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    let record: Record<string, unknown>;
    try {
      record = { id, ...JSON.parse(row.data) };
    } catch {
      res.status(500).json({ ok: false, error: "Corrupted data" });
      return;
    }

    res.json({ ok: true, record });
  } catch (err) {
    logger.error("[Data] GET by id error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** POST /api/data/:store — 创建记录 */
dataRouter.post("/:store", express.json(), (req, res) => {
  try {
    const store = req.params.store;
    const { id, ...data } = req.body as { id: string; [key: string]: unknown };
    if (!id) { res.status(400).json({ ok: false, error: "id is required" }); return; }

    dbRun(
      "INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))",
      [store, id, JSON.stringify(data)],
      { table: "sync_data", recordId: id, source: "data_api", newData: data },
    );

    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] CREATE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** PUT /api/data/:store/:id — 更新记录 */
dataRouter.put("/:store/:id", express.json(), (req, res) => {
  try {
    const store = req.params.store;
    const id = req.params.id;
    const data = req.body;

    const result = dbRun(
      "UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = ? AND record_id = ?",
      [JSON.stringify(data), store, id],
      { table: "sync_data", recordId: id, source: "data_api", newData: data },
    );

    if (result.changes === 0) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] UPDATE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** DELETE /api/data/:store/:id — 删除记录（软删除或永久删除） */
dataRouter.delete("/:store/:id", (req, res) => {
  try {
    const store = req.params.store;
    const id = req.params.id;
    const permanent = req.query.permanent === "true";

    if (permanent) {
      // 永久删除
      const result = dbRun(
        "DELETE FROM sync_data WHERE store_name = ? AND record_id = ?",
        [store, id],
        { table: "sync_data", recordId: id, source: "data_api", operation: "DELETE" },
      );

      if (result.changes === 0) {
        res.status(404).json({ ok: false, error: "Record not found" });
        return;
      }

      logger.info(`[Data] 永久删除: store=${store} id=${id}`);
      res.json({ ok: true, id });
      return;
    }

    // 软删除：设置 deletedAt
    const row = dbGet<{ data: string }>(
      "SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?",
      [store, id],
    );

    if (!row) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(row.data);
    } catch {
      res.status(500).json({ ok: false, error: "Corrupted data" });
      return;
    }

    record.deletedAt = new Date().toISOString();
    const newData = JSON.stringify(record);

    dbRun(
      "UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = ? AND record_id = ?",
      [newData, store, id],
      { table: "sync_data", recordId: id, source: "data_api", newData: record },
    );

    logger.info(`[Data] 软删除: store=${store} id=${id}`);
    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] DELETE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** POST /api/data/:store/:id/restore — 从回收站恢复记录 */
dataRouter.post("/:store/:id/restore", express.json(), (req, res) => {
  try {
    const store = req.params.store;
    const id = req.params.id;

    const row = dbGet<{ data: string }>(
      "SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?",
      [store, id],
    );

    if (!row) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(row.data);
    } catch {
      res.status(500).json({ ok: false, error: "Corrupted data" });
      return;
    }

    if (!record.deletedAt) {
      res.status(400).json({ ok: false, error: "Record is not in trash" });
      return;
    }

    delete record.deletedAt;
    const newData = JSON.stringify(record);

    dbRun(
      "UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = ? AND record_id = ?",
      [newData, store, id],
      { table: "sync_data", recordId: id, source: "data_api", newData: record },
    );

    logger.info(`[Data] 恢复: store=${store} id=${id}`);
    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] RESTORE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});