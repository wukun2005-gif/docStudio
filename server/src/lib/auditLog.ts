/**
 * 审计日志 — 记录所有数据库写操作（INSERT/UPDATE/DELETE）
 * 照搬 patentExaminator 方案：写文件，不写数据库
 * 日志文件: server/data/db-audit.log
 * 轮转: 超过 MAX_SIZE 后归档为 db-audit.1.log（仅保留 1 个备份）
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "fs";
import { join, dirname } from "path";

const DATA_DIR = process.env.DB_DIR ?? join(process.cwd(), "data");
const LOG_FILE = join(DATA_DIR, "db-audit.log");
const BACKUP_FILE = join(DATA_DIR, "db-audit.1.log");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FIELD_LEN = 500; // dataBefore/dataAfter 单字段最大字符数

try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }

export type AuditOperation = "INSERT" | "UPDATE" | "DELETE";

export interface AuditLogEntry {
  table: string;
  operation: AuditOperation;
  recordId: string;
  oldData?: unknown;
  newData?: unknown;
  source?: string;
}

/** 截断过大的数据字段，避免单行日志膨胀 */
function truncateData(data: unknown): unknown {
  if (data === undefined || data === null) return data;
  const json = JSON.stringify(data);
  if (json.length <= MAX_FIELD_LEN) return data;
  return json.slice(0, MAX_FIELD_LEN) + `… (${json.length} chars truncated)`;
}

/** 超过阈值时轮转日志文件 */
function rotateIfNeeded(): void {
  try {
    const stat = statSync(LOG_FILE);
    if (stat.size >= MAX_SIZE) {
      try { renameSync(LOG_FILE, BACKUP_FILE); } catch { /* backup may not exist */ }
    }
  } catch { /* file may not exist yet */ }
}

/**
 * 记录审计日志 — 同步写入文件
 * 异常不抛出，仅 warn 日志（审计失败不应阻断业务）
 */
export function logAudit(entry: AuditLogEntry): void {
  const ts = new Date().toISOString();
  const line = JSON.stringify({
    ts,
    table: entry.table,
    op: entry.operation,
    recordId: entry.recordId,
    dataBefore: truncateData(entry.oldData),
    dataAfter: truncateData(entry.newData),
    source: entry.source ?? null,
  });
  try {
    rotateIfNeeded();
    appendFileSync(LOG_FILE, line + "\n");
  } catch (e) {
    console.warn(`[AuditLog] write failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
