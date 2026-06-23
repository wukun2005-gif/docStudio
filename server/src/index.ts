/**
 * i-Write Server 入口
 */
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { healthRouter } from "./routes/health.js";
import { settingsRouter } from "./routes/settings.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { peopleRouter } from "./routes/people.js";
import { chatRouter } from "./routes/chat.js";
import { generationRouter } from "./routes/generation.js";
import { evaluationRouter } from "./routes/evaluation.js";
import { provenanceRouter } from "./routes/provenance.js";
import { getDb, closeDb } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { injectSampleData } from "./lib/sampleDataGenerator.js";
import { injectDemoPeople } from "./lib/peopleGraph.js";

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

// UTF-8 编码
app.use((_req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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
app.use("/api/generation", generationRouter);
app.use("/api/evaluation", evaluationRouter);
app.use("/api/provenance", provenanceRouter);

// 静态文件服务（client build）
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), () => {
    res.status(404).json({ ok: false, error: "Not found" });
  });
});

// 启动
function start() {
  // 初始化 DB
  getDb();

  // 注入 sample 数据（首次启动时）
  injectSampleData();
  injectDemoPeople();

  app.listen(PORT, () => {
    logger.info(`[Server] i-Write server running on http://localhost:${PORT}`);
  });
}

start();

// 优雅关闭
process.on("SIGINT", () => {
  logger.info("[Server] Shutting down...");
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});
