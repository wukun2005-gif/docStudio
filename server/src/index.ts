/**
 * i-Write Server 入口
 */
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import path from "path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";
import { healthRouter } from "./routes/health.js";
import { settingsRouter } from "./routes/settings.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { peopleRouter } from "./routes/people.js";
import { chatRouter } from "./routes/chat.js";
import { generationRouter } from "./routes/generation.js";
import { evaluationRouter } from "./routes/evaluation.js";
import { provenanceRouter } from "./routes/provenance.js";
import { connectorsRouter } from "./routes/connectors.js";
import { workflowsRouter } from "./routes/workflows.js";
import { dataRouter } from "./routes/data.js";
import { promptTemplatesRouter } from "./routes/promptTemplates.js";
import { getDb, closeDb } from "./lib/db.js";
import { dbRun, dbAll } from "./lib/dbQuery.js";
import { logger, initFileLogging } from "./lib/logger.js";
import { localShort } from "../../shared/src/datetime.js";

// 加载 .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "10mb" }));

// CORS
const isProduction = process.env.NODE_ENV === "production";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (isProduction ? "http://localhost:3000" : "*");
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// UTF-8 编码 — 只对 JSON 响应设置，不干扰文件上传
app.use((req, res, next) => {
  if (!req.is('multipart/form-data')) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  next();
});

// Rate limiter
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = isProduction ? 200 : 1000;

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: "请求过于频繁" });
    return;
  }
  next();
}

app.use(rateLimiter);

// Routes
app.use("/api", healthRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/people", peopleRouter);
app.use("/api/chat", chatRouter);
app.use("/api/data", dataRouter);
app.use("/api/generation", generationRouter);
app.use("/api/evaluation", evaluationRouter);
app.use("/api/provenance", provenanceRouter);
app.use("/api/connectors", connectorsRouter);
app.use("/api/workflows", workflowsRouter);
app.use("/api/prompt-templates", promptTemplatesRouter);

// 知识库文件服务 — 提供 samples 目录下的原始文件下载/预览
const samplesDir = path.resolve(__dirname, "../../samples");
app.use("/api/knowledge/files", express.static(samplesDir, {
  setHeaders: (res, filePath) => {
    // 对于 PDF/图片等文件，允许浏览器内联预览
    if (/\.(pdf|png|jpg|jpeg|gif|svg)$/i.test(filePath)) {
      res.setHeader("Content-Disposition", "inline");
    }
  },
}));

// 全局错误处理 — 捕获 multer 等错误
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ ok: false, error: `上传字段名错误: ${err.field}，期望 'files'` });
    return;
  }
  if (err.name === 'MulterError') {
    res.status(400).json({ ok: false, error: `上传错误: ${err.message}` });
    return;
  }
  next(err);
});

// 静态文件服务（client build）
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  // 跳过 API 路由，让它们返回自己的响应
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) {
      res.status(404).json({ ok: false, error: "Not found" });
    }
  });
});

// ---- 日志文件（同一 dev session 内复用） ----
const LOG_DIR = "/Users/wukun/Downloads";
const SESSION_MARKER = "/tmp/iwrite-server-session.json";

interface SessionMarker {
  logFile: string;
  startedAt: string;
}

function resolveLogFile(): string {
  // 检查是否有存活的 session marker（最近 30 秒内）
  try {
    const raw = fs.readFileSync(SESSION_MARKER, "utf-8");
    const prev: SessionMarker = JSON.parse(raw);
    const prevTime = new Date(prev.startedAt).getTime();
    if (Date.now() - prevTime < 30_000) {
      // tsx watch 重启，复用上一个文件
      return prev.logFile;
    }
  } catch {
    // marker 不存在或损坏，新建
  }

  // 新 session，生成带 datetime 的文件名
  const ts = localShort().replace(/[-: ]/g, "").slice(0, 14);
  const logFile = path.join(LOG_DIR, `iwrite-server-${ts}.log`);

  // 写入 marker
  const marker: SessionMarker = { logFile, startedAt: localShort() };
  fs.writeFileSync(SESSION_MARKER, JSON.stringify(marker), "utf-8");

  return logFile;
}

function clearSessionMarker(): void {
  try { fs.unlinkSync(SESSION_MARKER); } catch { /* ignore */ }
}

const logFile = resolveLogFile();

// ---- 生成 Server Run ID ----
const runId = (() => {
  const ts = localShort().replace(/[-: ]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(2).toString("hex");
  return `${ts}-${rand}`;
})();

initFileLogging(runId, logFile);

// 在终端显式打印日志文件名（crash 时用户也能找到）
console.log("");
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  📋 i-Write Server Log                                      ║");
console.log(`║  Server Run ID: ${runId}                              ║`);
console.log(`║  Log File    : ${logFile} ║`);
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log("");

// 启动
function start() {
  // 初始化 DB
  getDb();

  // 启动时清理所有遗留的 generating 状态记录（进程崩溃/退出导致的死锁）
  try {
    const stale = dbAll(
      "SELECT id, title FROM generation_runs WHERE status = 'generating'",
    ) as Array<{ id: string; title: string }>;
    if (stale && stale.length > 0) {
      for (const r of stale) {
        dbRun("UPDATE generation_runs SET status = 'crashed' WHERE id = ?", [r.id],
          { table: "generation_runs", recordId: r.id, source: "server.startup" });
      }
      logger.info(`[Server] 启动清理: ${stale.length} 个遗留生成任务标记为 crashed`);
    }
  } catch (e) {
    logger.warn(`[Server] 启动清理遗留任务失败: ${e}`);
  }

  app.listen(PORT, () => {
    logger.info(`[Server] i-Write server running on http://localhost:${PORT}`);
  });
}

start();

// 优雅关闭
// 注意：不在这里 clearSessionMarker()！因为 tsx watch 重启时也会发 SIGTERM，
// 如果清理了 marker，新进程就会生成新文件。marker 靠 30 秒超时自动过期。
process.on("SIGINT", () => {
  logger.info("[Server] Shutting down...");
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});