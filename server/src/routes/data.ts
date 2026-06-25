/**
 * 通用 KV CRUD API 路由
 * 照搬 patentExaminator 方案：/api/data/:store 通用 CRUD
 */
import { Router } from "express";
import express from "express";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { logAudit } from "../lib/auditLog.js";

export const dataRouter = Router();

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** GET /api/data/:store — 获取指定 store 的所有记录 */
dataRouter.get("/:store", (req, res) => {
  try {
    const store = req.params.store;
    if (!store) { res.status(400).json({ ok: false, error: "store is required" }); return; }

    const db = getDb();
    const rows = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?").all(store) as Array<{
      record_id: string;
      data: string;
    }>;

    const records: Array<Record<string, unknown>> = [];
    const needsTitleFix: Array<{ record: Record<string, unknown>; recordId: string }> = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data);
        const record = { id: row.record_id, ...parsed };
        records.push(record);
        // 收集需要修正标题的 case
        if (store === "cases" && (!record.title || record.title === "新文档") && record.createdAt) {
          needsTitleFix.push({ record, recordId: row.record_id });
        }
      } catch {
        logger.warn(`[Data] Corrupted JSON in store=${store} record=${row.record_id}, skipping`);
      }
    }

    // 动态修正 case 标题：用最近的 generation run 标题
    if (needsTitleFix.length > 0) {
      const runs = db.prepare("SELECT id, title, created_at FROM generation_runs WHERE title IS NOT NULL AND title != '' AND title != '新文档' ORDER BY created_at DESC").all() as Array<{ id: string; title: string; created_at: string }>;
      const caseUpdateStmt = db.prepare("UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = 'cases' AND record_id = ?");
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
          caseUpdateStmt.run(JSON.stringify(fullData), recordId);
          logger.info(`[Data] 动态修正 case 标题: "新文档" → "${bestTitle}" (case: ${record.id})`);
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

    const db = getDb();
    const rows = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?").all(store) as Array<{
      record_id: string;
      data: string;
    }>;

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

    const db = getDb();
    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get(store, id) as {
      data: string;
    } | undefined;

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

    const db = getDb();
    // 查询旧数据用于审计
    const oldRow = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get(store, id) as { data: string } | undefined;

    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run(store, id, JSON.stringify(data));

    logAudit({
      table: `sync_data/${store}`,
      operation: oldRow ? "UPDATE" : "INSERT",
      recordId: id,
      oldData: oldRow ? JSON.parse(oldRow.data) : undefined,
      newData: data,
      source: "data_api",
    });

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

    const db = getDb();
    // 查询旧数据用于审计
    const oldRow = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get(store, id) as { data: string } | undefined;

    const result = db.prepare("UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = ? AND record_id = ?")
      .run(JSON.stringify(data), store, id);

    if (result.changes === 0) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    logAudit({
      table: `sync_data/${store}`,
      operation: "UPDATE",
      recordId: id,
      oldData: oldRow ? JSON.parse(oldRow.data) : undefined,
      newData: data,
      source: "data_api",
    });

    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] UPDATE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** DELETE /api/data/:store/:id — 删除记录 */
dataRouter.delete("/:store/:id", (req, res) => {
  try {
    const store = req.params.store;
    const id = req.params.id;

    const db = getDb();
    // 查询旧数据用于审计
    const oldRow = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get(store, id) as { data: string } | undefined;

    const result = db.prepare("DELETE FROM sync_data WHERE store_name = ? AND record_id = ?")
      .run(store, id);

    if (result.changes === 0) {
      res.status(404).json({ ok: false, error: "Record not found" });
      return;
    }

    logAudit({
      table: `sync_data/${store}`,
      operation: "DELETE",
      recordId: id,
      oldData: oldRow ? JSON.parse(oldRow.data) : undefined,
      source: "data_api",
    });

    res.json({ ok: true, id });
  } catch (err) {
    logger.error("[Data] DELETE error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});
