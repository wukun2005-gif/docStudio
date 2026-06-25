#!/usr/bin/env node
/**
 * 测试日志包装器
 * 运行命令，同时将 stdout/stderr 写入 tests/logs/ 下的时间戳日志文件。
 * 非当天的旧日志自动清理。
 *
 * 用法: node tests/log-runner.mjs <command> [args...]
 * 示例: node tests/log-runner.mjs vitest run
 */
import { spawn } from "child_process";
import { mkdirSync, rmSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { backupDatabases } from "./backup-db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 每天首次跑测试时自动备份用户数据库（保留最近 7 天）
try { backupDatabases(); } catch { /* backup failure should not block tests */ }
const LOG_DIR = join(__dirname, "logs");
mkdirSync(LOG_DIR, { recursive: true });

// 清理非当天的旧日志
const _now = new Date();
const todayPrefix = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
try {
  for (const file of readdirSync(LOG_DIR)) {
    if (file.endsWith(".log") && !file.includes(todayPrefix)) {
      rmSync(join(LOG_DIR, file));
    }
  }
} catch { /* ignore */ }

// 生成日志文件名
const _pad = (n) => String(n).padStart(2, "0");
const timestamp = `${todayPrefix}T${_pad(_now.getHours())}-${_pad(_now.getMinutes())}-${_pad(_now.getSeconds())}`;
const logFile = join(LOG_DIR, `${timestamp}.log`);

// 获取要运行的命令
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node tests/log-runner.mjs <command> [args...]");
  process.exit(1);
}

const [cmd, ...cmdArgs] = args;
const child = spawn(cmd, cmdArgs, { stdio: ["inherit", "pipe", "pipe"] });

const logLines = [];

child.stdout.on("data", (data) => {
  process.stdout.write(data);
  logLines.push(data.toString());
});

child.stderr.on("data", (data) => {
  process.stderr.write(data);
  logLines.push(data.toString());
});

child.on("close", (code) => {
  try {
    writeFileSync(logFile, logLines.join(""));
  } catch { /* ignore */ }
  process.exit(code ?? 0);
});
