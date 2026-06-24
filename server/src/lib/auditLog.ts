/**
 * 数据库审计日志模块
 * 照搬 patentExaminator 方案：记录所有 INSERT/UPDATE/DELETE 操作
 */
import { getDb } from "./db.js";
import { logger } from "./logger.js";

export type AuditOperation = "INSERT" | "UPDATE" | "DELETE";

export interface AuditLogEntry {
  table: string;
  operation: AuditOperation;
  recordId: string;
  oldData?: unknown;
  newData?: unknown;
  source?: string;
}

/**
 * 记录审计日志 — 同步写入 audit_log 表
 * 异常不抛出，仅 warn 日志（审计失败不应阻断业务）
 */
export function logAudit(entry: AuditLogEntry): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (table_name, operation, record_id, old_data, new_data, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.table,
      entry.operation,
      entry.recordId,
      entry.oldData != null ? JSON.stringify(entry.oldData) : null,
      entry.newData != null ? JSON.stringify(entry.newData) : null,
      entry.source ?? null,
    );
  } catch (err) {
    logger.warn(`[AuditLog] 写入失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 查询审计日志
 */
export function queryAuditLogs(options?: {
  table?: string;
  recordId?: string;
  source?: string;
  limit?: number;
}): Array<{
  id: number;
  timestamp: string;
  table_name: string;
  operation: string;
  record_id: string;
  old_data: string | null;
  new_data: string | null;
  source: string | null;
}> {
  const db = getDb();
  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const params: unknown[] = [];

  if (options?.table) {
    sql += " AND table_name = ?";
    params.push(options.table);
  }
  if (options?.recordId) {
    sql += " AND record_id = ?";
    params.push(options.recordId);
  }
  if (options?.source) {
    sql += " AND source = ?";
    params.push(options.source);
  }

  sql += " ORDER BY timestamp DESC";
  sql += ` LIMIT ${options?.limit ?? 100}`;

  return db.prepare(sql).all(...params) as any[];
}
