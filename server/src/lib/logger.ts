/**
 * 日志模块 — 使用本地时间，同时输出到 console 和实时日志文件
 */
import fs from "node:fs";
import path from "node:path";
import { localShort } from "../../../shared/src/datetime.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[CURRENT_LEVEL];
}

function timestamp(): string {
  return localShort();
}

// ---- 文件日志状态 ----
let logFilePath: string | null = null;

/** 初始化文件日志。必须在使用 logger 前调用一次。返回日志文件路径。 */
export function initFileLogging(runId: string, filePath: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  logFilePath = filePath;

  // 写入文件头（truncate 模式，每次启动覆盖）
  const header = `╔══════════════════════════════════════════════════════════════╗
║  i-Write Server Log
║  Server Run ID: ${runId}
║  Started: ${timestamp()}
║  Log File: ${logFilePath}
╚══════════════════════════════════════════════════════════════╝
`;
  try {
    fs.writeFileSync(logFilePath, header + "\n", "utf-8");
  } catch {
    // 文件写入失败不影响 console 输出
  }

  return logFilePath;
}

/** 返回当前日志文件路径（未初始化时返回 null） */
export function getLogFilePath(): string | null {
  return logFilePath;
}

function writeToFile(line: string): void {
  if (!logFilePath) return;
  try {
    fs.appendFileSync(logFilePath, line + "\n", "utf-8");
  } catch {
    // 静默失败，不中断主流程
  }
}

export const logger = {
  debug(msg: string): void {
    if (!shouldLog("debug")) return;
    const line = `[${timestamp()}] [DEBUG] ${msg}`;
    console.debug(line);
    writeToFile(line);
  },
  info(msg: string): void {
    if (!shouldLog("info")) return;
    const line = `[${timestamp()}] [INFO] ${msg}`;
    console.info(line);
    writeToFile(line);
  },
  warn(msg: string): void {
    if (!shouldLog("warn")) return;
    const line = `[${timestamp()}] [WARN] ${msg}`;
    console.warn(line);
    writeToFile(line);
  },
  error(msg: string): void {
    if (!shouldLog("error")) return;
    const line = `[${timestamp()}] [ERROR] ${msg}`;
    console.error(line);
    writeToFile(line);
  },
};
