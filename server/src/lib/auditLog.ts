/**
 * 审计日志 — 记录所有数据库写操作（INSERT/UPDATE/DELETE）
 * 照搬 patentExaminator 方案：写文件，不写数据库
 * 日志文件: server/data/db-audit.log
 * 轮转: 超过 MAX_SIZE 后归档为 db-audit.1.log（仅保留 1 个备份）
 */
import { appendFileSync, mkdirSync, renameSync, statSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { localShort } from "../../../shared/src/datetime.js";

const DATA_DIR = process.env.DB_DIR ?? join(process.cwd(), "data");
const LOG_FILE = join(DATA_DIR, "db-audit.log");
const BACKUP_FILE = join(DATA_DIR, "db-audit.1.log");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FIELD_LEN = 500; // dataBefore/dataAfter 单字段最大字符数

/** 测试用：自定义日志文件路径 */
let _testLogFile: string | null = null;

/** 测试用：设置自定义日志文件路径 */
export function setTestLogFile(path: string): void {
  _testLogFile = path;
}

/** 测试用：清除自定义日志文件路径 */
export function clearTestLogFile(): void {
  _testLogFile = null;
}

function getLogFile(): string {
  return _testLogFile ?? LOG_FILE;
}

function getBackupFile(): string {
  return _testLogFile ? _testLogFile + ".1" : BACKUP_FILE;
}

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

export interface AuditLogRecord {
  ts: string;
  table_name: string;
  operation: AuditOperation;
  record_id: string;
  old_data: string | null;
  new_data: string | null;
  source: string | null;
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
  const logFile = getLogFile();
  try {
    const stat = statSync(logFile);
    if (stat.size >= MAX_SIZE) {
      try { renameSync(logFile, getBackupFile()); } catch { /* backup may not exist */ }
    }
  } catch { /* file may not exist yet */ }
}

/**
 * 记录审计日志 — 同步写入文件
 * 异常不抛出，仅 warn 日志（审计失败不应阻断业务）
 */
export function logAudit(entry: AuditLogEntry): void {
  const ts = localShort();
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
    appendFileSync(getLogFile(), line + "\n");
  } catch (e) {
    console.warn(`[AuditLog] write failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 查询审计日志 — 从文件读取并过滤 */
export function queryAuditLogs(filter?: {
  table?: string;
  operation?: AuditOperation;
  recordId?: string;
  source?: string;
  limit?: number;
}): AuditLogRecord[] {
  const logFile = getLogFile();
  if (!existsSync(logFile)) return [];

  let records: AuditLogRecord[] = [];
  try {
    const content = readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    records = lines.map((line) => {
      const obj = JSON.parse(line);
      return {
        ts: obj.ts,
        table_name: obj.table,
        operation: obj.op,
        record_id: obj.recordId,
        old_data: obj.dataBefore ? JSON.stringify(obj.dataBefore) : null,
        new_data: obj.dataAfter ? JSON.stringify(obj.dataAfter) : null,
        source: obj.source ?? null,
      };
    });
  } catch {
    return [];
  }

  if (filter?.table) records = records.filter((r) => r.table_name === filter.table);
  if (filter?.operation) records = records.filter((r) => r.operation === filter.operation);
  if (filter?.recordId) records = records.filter((r) => r.record_id === filter.recordId);
  if (filter?.source) records = records.filter((r) => r.source === filter.source);
  if (filter?.limit) records = records.slice(0, filter.limit);

  return records;
}
