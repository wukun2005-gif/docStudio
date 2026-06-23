/**
 * 简单的日志模块
 */

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
  return new Date().toISOString();
}

export const logger = {
  debug(msg: string): void {
    if (shouldLog("debug")) console.debug(`[${timestamp()}] [DEBUG] ${msg}`);
  },
  info(msg: string): void {
    if (shouldLog("info")) console.info(`[${timestamp()}] [INFO] ${msg}`);
  },
  warn(msg: string): void {
    if (shouldLog("warn")) console.warn(`[${timestamp()}] [WARN] ${msg}`);
  },
  error(msg: string): void {
    if (shouldLog("error")) console.error(`[${timestamp()}] [ERROR] ${msg}`);
  },
};
