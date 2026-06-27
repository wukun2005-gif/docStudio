/**
 * 集中式数据库操作模块 — i-Write
 *
 * 所有对数据库的读写都通过本模块进行，自动附加审计日志。
 * 将来扩展功能只要调用这里导出的函数即可，不需要关心 better-sqlite3 的细节。
 *
 * 设计来源: patentExaminator 的 writeAudit + syncDb 模式。
 *
 * 提供的原语:
 *   dbRun(sql, params, audit)   — INSERT / UPDATE / DELETE，自动记录审计
 *   dbGet<T>(sql, params)       — 查询单行
 *   dbAll<T>(sql, params)       — 查询多行
 *   dbTransaction(fn)           — 事务；fn 内的 dbRun 自动归属同一事务
 *   prepareStmt(sql)            — 性能敏感场景下手动 prepare（不审计）
 *
 * 审计规则:
 *   - 写操作（dbRun）默认开启审计；调用方可传 audit: false 关闭（内部迁移、种子数据）。
 *   - 审计字段 oldData / newData 由本模块自动读取（INSERT 只记 newData，
 *     UPDATE/DELETE 先 SELECT 旧值再写）。
 *   - 审计写文件 server/data/db-audit.log，不写数据库（避免循环触发）。
 */
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import { logAudit, type AuditOperation } from "./auditLog.js";

export interface AuditContext {
  table: string;
  recordId: string;
  source?: string;
  /** 强制指定 operation；默认由 SQL 关键字推断 */
  operation?: AuditOperation;
  /** 跳过自动读取旧值（批量场景调用方自己提供 oldData） */
  skipReadOld?: boolean;
  /** 调用方提供的 oldData，覆盖自动读取 */
  oldData?: unknown;
  /** 调用方提供的 newData，覆盖 SQL params 的默认序列化 */
  newData?: unknown;
}

const SQL_INSERT_RE = /^\s*(INSERT|REPLACE)\b/i;
const SQL_UPDATE_RE = /^\s*UPDATE\b/i;
const SQL_DELETE_RE = /^\s*DELETE\b/i;
const SQL_UPSERT_RE = /\bON\s+CONFLICT\b.*\bDO\s+UPDATE\b/i;

function inferOp(sql: string): AuditOperation {
  if (SQL_UPSERT_RE.test(sql)) return "UPDATE";
  if (SQL_INSERT_RE.test(sql)) return "INSERT";
  if (SQL_UPDATE_RE.test(sql)) return "UPDATE";
  if (SQL_DELETE_RE.test(sql)) return "DELETE";
  return "UPDATE";
}

/**
 * 从 SQL 文本提取表名（用于审计 table 字段）
 * 支持 INSERT INTO tbl / UPDATE tbl / DELETE FROM tbl / INSERT OR REPLACE INTO tbl
 */
export function extractTable(sql: string): string {
  const m =
    sql.match(/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO)\s+["`]?([\w]+)["`]?/i) ??
    sql.match(/^\s*UPDATE\s+["`]?([\w]+)["`]?/i) ??
    sql.match(/^\s*DELETE\s+FROM\s+["`]?([\w]+)["`]?/i);
  return m ? m[1] : "unknown";
}

/**
 * 从 SQL + params 推断 recordId。
 * sync_data 表保留纯 record_id（与旧 logAudit 格式兼容）；store_name 在 readRow 时再提取。
 * 其它表：UPDATE/DELETE 取 WHERE 最后一个占位符；INSERT 取第一个占位符。
 */
function inferRecordId(sql: string, params: unknown[]): string | undefined {
  if (params.length === 0) return undefined;
  if (/sync_data/i.test(sql)) {
    const recIdx = sql.match(/record_id\s*=\s*\?/i) ? findParamIndex(sql, /record_id\s*=\s*\?/i) : -1;
    if (recIdx >= 0 && params[recIdx] !== undefined) {
      return String(params[recIdx]);
    }
  }
  if (SQL_UPDATE_RE.test(sql) || SQL_DELETE_RE.test(sql)) {
    return String(params[params.length - 1]);
  }
  return String(params[0]);
}

/** 找出 SQL 中匹配正则的第 n 个 ? 的索引（0-based） */
function findParamIndex(sql: string, re: RegExp): number {
  const match = sql.match(re);
  if (!match) return -1;
  const before = sql.slice(0, match.index! + match[0].length);
  return (before.match(/\?/g) ?? []).length - 1;
}

/** 从 SQL + params 提取 sync_data 的 store_name（仅 sync_data 表使用） */
function extractSyncStore(sql: string, params: unknown[]): string | undefined {
  if (!/sync_data/i.test(sql)) return undefined;
  // 优先匹配占位符形式 store_name = ?
  const qIdx = findParamIndex(sql, /store_name\s*=\s*\?/i);
  if (qIdx >= 0 && params[qIdx] !== undefined) return String(params[qIdx]);
  // 退而求其次：匹配字面量形式 store_name = 'xxx' 或 store_name = "xxx"
  const litMatch = sql.match(/store_name\s*=\s*['"]([^'"]+)['"]/i);
  if (litMatch) return litMatch[1];
  return undefined;
}

/** 读取单行主键对应的整行数据（用于审计 oldData / newData） */
function readRow(table: string, recordId: string, storeName?: string): unknown {
  const db = getDb();
  if (table === "user_settings") {
    const row = db.prepare("SELECT value FROM user_settings WHERE key = ?").get(recordId) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }
  if (table === "sync_data") {
    if (!storeName) return undefined;
    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?")
      .get(storeName, recordId) as { data: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.data);
    } catch {
      return row.data;
    }
  }
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId) as Record<string, unknown> | undefined;
  return row;
}

/** 从 SQL params 中提取 value 字段（user_settings 场景） */
function extractSettingsValue(sql: string, params: unknown[]): unknown {
  if (!/user_settings/i.test(sql)) return undefined;
  // INSERT INTO user_settings (key, value, ...) VALUES (?, ?, ...)
  // 第二个占位符是 value
  const valueParam = params[1];
  if (typeof valueParam === "string") {
    try {
      return JSON.parse(valueParam);
    } catch {
      return valueParam;
    }
  }
  return valueParam;
}

/**
 * 执行写操作 — INSERT / UPDATE / DELETE
 * 自动审计（除非 audit 为 false）。
 * 返回 RunResult（changes, lastInsertRowid）。
 */
export function dbRun(
  sql: string,
  params: unknown[] = [],
  audit?: AuditContext | false,
): Database.RunResult {
  const db = getDb();
  const stmt = db.prepare(sql);

  if (audit === false) {
    return stmt.run(...params);
  }

  const ctx = audit ?? {
    table: extractTable(sql),
    recordId: inferRecordId(sql, params) ?? "unknown",
  };
  const op = ctx.operation ?? inferOp(sql);
  const syncStore = ctx.table === "sync_data" ? extractSyncStore(sql, params) : undefined;

  // 写前读取旧值（UPDATE/DELETE）
  let oldData: unknown = ctx.oldData;
  if (oldData === undefined && !ctx.skipReadOld && (op === "UPDATE" || op === "DELETE")) {
    oldData = readRow(ctx.table, ctx.recordId, syncStore);
  }

  const result = stmt.run(...params);

  // 写后读取新值（INSERT/UPDATE）
  let newData: unknown = ctx.newData;
  if (newData === undefined && (op === "INSERT" || op === "UPDATE")) {
    // user_settings 特殊处理：直接用 params 中的 value（避免再次读库）
    const settingsValue = extractSettingsValue(sql, params);
    if (settingsValue !== undefined) {
      newData = settingsValue;
    } else {
      newData = readRow(ctx.table, ctx.recordId, syncStore);
    }
  }

  try {
    logAudit({
      table: syncStore ? `${ctx.table}/${syncStore}` : ctx.table,
      operation: op,
      recordId: ctx.recordId,
      oldData,
      newData,
      source: ctx.source,
    });
  } catch (e) {
    // 审计失败不阻断业务
    console.warn(`[dbQuery] audit failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/** 查询单行 */
export function dbGet<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** 查询多行 */
export function dbAll<T = unknown>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/**
 * 事务 — fn 内的 dbRun 与原生 db.prepare().run() 共享同一事务。
 * 注意：本函数不会自动审计；事务内各 dbRun 调用独立记录审计。
 */
export function dbTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)() as T;
}

/**
 * 手动 prepare（性能敏感批量场景）。
 * 调用方负责保证审计；推荐改用 dbRun 循环或 dbTransaction + dbRun。
 */
export function prepareStmt(sql: string): Database.Statement {
  return getDb().prepare(sql);
}

/**
 * 批量 upsert — 针对 user_settings 的便捷函数。
 * 一次事务写入多行，每行独立审计。
 */
export function bulkUpsertSettings(
  entries: Array<{ key: string; value: unknown }>,
  source: string,
): void {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const selectOld = db.prepare("SELECT value FROM user_settings WHERE key = ?");

  const run = db.transaction(() => {
    for (const e of entries) {
      const oldRow = selectOld.get(e.key) as { value: string } | undefined;
      let oldData: unknown;
      if (oldRow) {
        try { oldData = JSON.parse(oldRow.value); } catch { oldData = oldRow.value; }
      }
      const valueStr = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
      upsert.run(e.key, valueStr);
      let newData: unknown = e.value;
      if (typeof e.value === "string") {
        try { newData = JSON.parse(e.value); } catch { newData = e.value; }
      }
      logAudit({
        table: "user_settings",
        operation: oldRow ? "UPDATE" : "INSERT",
        recordId: e.key,
        oldData,
        newData,
        source,
      });
    }
  });
  run();
}

/**
 * 批量执行任意 SQL（在事务内）。
 * 每条记录独立审计。
 */
export function bulkRun(
  items: Array<{ sql: string; params?: unknown[]; audit: AuditContext }>,
): Database.RunResult[] {
  const results: Database.RunResult[] = [];
  dbTransaction(() => {
    for (const it of items) {
      results.push(dbRun(it.sql, it.params ?? [], it.audit));
    }
  });
  return results;
}
