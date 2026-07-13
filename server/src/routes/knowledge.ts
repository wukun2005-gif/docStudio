/**
 * 知识库 API 路由 — 完整 RAG Pipeline
 *
 * 所有渠道共用统一分块 pipeline（ingestion.ts）:
 * 提取文本 → 预处理 → 智能分块 → 去噪 → 存储 → Embedding
 */
import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  getAllSources,
  deleteSource,
  getAllChunks,
  getAllVectors,
  getStats,
  clearKnowledgeDb,
  computeTextHash,
  getUnembeddedChunks,
  addRemoteIndex,
  getRemoteIndexesByType,
  getRemoteIndexByRemoteId,
  deleteRemoteIndex,
  addSyncJob,
  updateSyncJob,
  getSyncJobsByType,
} from "../lib/knowledgeDb.js";
import { ingestFile, getFileType, embedBatch, embedChunks, type EmbeddingConfig } from "../lib/ingestion.js";
import { hybridSearch } from "../lib/hybridSearch.js";
import { rerank, type RerankInput } from "../lib/reranker.js";
import { readSettingsFromDb } from "../lib/settingsReader.js";
import { logger } from "../lib/logger.js";
import { dbGet, dbAll } from "../lib/dbQuery.js";
import {
  cloneRepo,
  listRepoFiles,
  readFileContent,
  computeFileHash,
  syncRepo,
  isRepoCloned,
  removeRepo,
} from "../lib/connectors/githubRepo.js";
import { syncEmailsToKB, syncContactsToKB, clearOutlookKB, getOutlookKBStatus } from "../lib/connectors/outlookKB.js";
import { getValidAccessToken } from "../lib/connectors/msGraphOAuth.js";

export const knowledgeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    try {
      const decoded = Buffer.from(file.originalname, "latin1").toString("utf-8");
      if (!decoded.includes("�")) {
        file.originalname = decoded;
      }
    } catch { /* keep original */ }
    cb(null, true);
  },
});

// ── Embedding 配置（内存单例） ──────────────────────────

let embeddingConfig: EmbeddingConfig | null = null;

/** 初始化 embedding 配置（优先请求体 → keyStore → .env） */
function getEmbeddingConfig(body?: Record<string, unknown>): EmbeddingConfig | null {
  // 1. 请求体中的 embedding 配置（自动测试用）
  if (body?.embedding && typeof body.embedding === "object") {
    const emb = body.embedding as Record<string, string>;
    if (emb.baseUrl && emb.apiKey && emb.modelId) {
      embeddingConfig = {
        baseUrl: emb.baseUrl.replace(/\/+$/, ""),
        apiKey: emb.apiKey,
        modelId: emb.modelId,
      };
      return embeddingConfig;
    }
  }
  // 使用已缓存的配置
  if (embeddingConfig) return embeddingConfig;
  // 2. 从用户设置页读取（生产环境）
  const dbSettings = readSettingsFromDb();
  if (dbSettings.knowledgeEmbedding) {
    embeddingConfig = {
      baseUrl: dbSettings.knowledgeEmbedding.baseUrl.replace(/\/+$/, ""),
      apiKey: dbSettings.knowledgeEmbedding.apiKey,
      modelId: dbSettings.knowledgeEmbedding.modelId,
    };
    return embeddingConfig;
  }
  // 3. 从环境变量加载（自动测试用）
  if (process.env.siliconflow_Key) {
    embeddingConfig = {
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: process.env.siliconflow_Key,
      modelId: "BAAI/bge-m3",
    };
    return embeddingConfig;
  }
  return null;
}

// ── API Routes ──────────────────────────────────────

/** POST /api/knowledge/upload — 上传 + 预处理 + 分块 + Embedding（复用统一分块 pipeline） */
knowledgeRouter.post("/upload", upload.any(), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ ok: false, error: "没有上传文件" });
      return;
    }

    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);

    const results: Array<{ id: string; name: string; status: string; chunks?: number; embedded?: number }> = [];

    for (const file of files) {
      // 复用统一分块 pipeline
      const result = await ingestFile({
        content: file.buffer,
        fileName: file.originalname,
        sourceType: getFileType(file.originalname),
        embedding: embConfig ?? undefined,
      });

      results.push({
        id: result.sourceId,
        name: file.originalname,
        status: result.status,
        chunks: result.chunkCount,
        embedded: result.embeddedCount,
      });
    }

    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Knowledge] 上传失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/knowledge/embed — 对已有 chunks 补做 embedding */
knowledgeRouter.post("/embed", async (req, res) => {
  try {
    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);
    if (!embConfig) {
      res.status(400).json({
        ok: false,
        error: "缺少 embedding 配置，请在请求体中提供 embedding.baseUrl, embedding.apiKey, embedding.modelId，或在 .env 中配置 siliconflow_Key",
      });
      return;
    }

    const unembedded = getUnembeddedChunks();
    if (unembedded.length === 0) {
      res.json({ ok: true, message: "所有 chunks 已有 embedding", embedded: 0 });
      return;
    }

    logger.info(`[Embed] 开始补做 embedding: ${unembedded.length} chunks, config: baseUrl=${embConfig.baseUrl}, model=${embConfig.modelId}`);
    const result = await embedChunks(unembedded, embConfig);
    logger.info(`[Embed] 补做完成: ${result.embedded}/${unembedded.length} embedded, ${result.errors.length} errors`);
    res.json({ ok: true, embedded: result.embedded, total: unembedded.length, errors: result.errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Knowledge] Embed 补充失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/sources — 获取所有知识源 */
knowledgeRouter.get("/sources", (_req, res) => {
  try {
    const sources = getAllSources();
    res.json({ ok: true, sources });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/sources/:id — 获取单个知识源详情（含 chunks） */
knowledgeRouter.get("/sources/:id", (req, res) => {
  try {
    const source = dbGet<any>("SELECT * FROM kb_sources WHERE id = ?", [req.params.id]);
    if (!source) {
      return res.status(404).json({ ok: false, error: "知识源不存在" });
    }
    const chunks = dbAll<any>("SELECT id, content, chunk_index FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index", [req.params.id]);
    res.json({ ok: true, source, chunks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/sources/:id/file — 下载/预览知识源原始文件 */
knowledgeRouter.get("/sources/:id/file", (req, res) => {
  try {
    const source = dbGet<{ name: string; file_path: string; type: string }>("SELECT name, file_path, type FROM kb_sources WHERE id = ?", [req.params.id]);
    if (!source) {
      return res.status(404).json({ ok: false, error: "知识源不存在" });
    }
    if (!source.file_path) {
      // 无原始文件路径时，从数据库 chunks 重建内容返回
      const chunks = dbAll<{ content: string }>("SELECT content FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index", [req.params.id]);
      if (chunks.length === 0) {
        return res.status(404).json({ ok: false, error: "该知识源无原始文件" });
      }
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${source.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
    h1 { font-size: 1.5em; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    p { margin: 12px 0; white-space: pre-wrap; }
    .chunk { margin: 16px 0; padding: 12px; background: #f8fafc; border-left: 3px solid #3b82f6; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${source.name}</h1>
  ${chunks.map(c => `<div class="chunk"><p>${c.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p></div>`).join("\n")}
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(source.name)}.html"`);
      return res.send(html);
    }

    // 在 samples 目录下查找文件（可能在子目录中）
    const samplesDir = path.resolve(__dirname, "../../../samples");
    const subDirs = ["documents", "emails", "charts", "presentations", "spreadsheets"];
    let filePath = "";

    for (const subDir of subDirs) {
      const candidate = path.join(samplesDir, subDir, source.file_path);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    // 也检查 samples 根目录
    if (!filePath) {
      const candidate = path.join(samplesDir, source.file_path);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      // 没有物理文件时，从数据库 chunks 重建内容返回
      const chunks = dbAll<{ content: string }>("SELECT content FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index", [req.params.id]);
      if (chunks.length === 0) {
        return res.status(404).json({ ok: false, error: "文件不存在" });
      }
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${source.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
    h1 { font-size: 1.5em; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    p { margin: 12px 0; white-space: pre-wrap; }
    .chunk { margin: 16px 0; padding: 12px; background: #f8fafc; border-left: 3px solid #3b82f6; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${source.name}</h1>
  ${chunks.map(c => `<div class="chunk"><p>${c.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p></div>`).join("\n")}
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(source.name)}.html"`);
      return res.send(html);
    }

    // 设置 Content-Disposition 为 inline 让浏览器预览，而不是下载
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".html": "text/html",
      ".csv": "text/csv",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(source.name)}"`);
    res.sendFile(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/knowledge/sources/:id — 删除知识源 */
knowledgeRouter.delete("/sources/:id", (req, res) => {
  try {
    deleteSource(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/stats — 获取统计 */
knowledgeRouter.get("/stats", (_req, res) => {
  try {
    const stats = getStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/knowledge/search — 混合检索（BM25 + 向量 + RRF） */
knowledgeRouter.post("/search", async (req, res) => {
  try {
    const { query, limit = 10, embedding: embReq } = req.body as {
      query: string; limit?: number;
      embedding?: { apiKey?: string; baseUrl?: string; modelId?: string };
    };

    if (!query) {
      res.status(400).json({ ok: false, error: "缺少 query 参数" });
      return;
    }

    // 获取 embedding 配置用于向量检索
    const embCfg = getEmbeddingConfig(req.body as Record<string, unknown>);

    // BM25 检索
    const bm25Results = hybridSearch(query, { limit: limit * 2, useQueryExpansion: true });

    // 如果有向量，做混合检索
    let finalResults = bm25Results;

    if (embCfg) {
      try {
        // 对 query 做 embedding
        const queryVectors = await embedBatch([query], embCfg);
        const queryEmbedding = queryVectors[0];

        if (queryEmbedding) {
          // 向量检索
          const allVectors = getAllVectors();
          const vectorScores = allVectors.map((v) => {
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < queryEmbedding.length; i++) {
              dot += queryEmbedding[i] * v.embedding[i];
              normA += queryEmbedding[i] * queryEmbedding[i];
              normB += v.embedding[i] * v.embedding[i];
            }
            const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
            return { chunkId: v.chunkId, score };
          });

          // 动态阈值
          const sorted = vectorScores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
          const topScore = sorted[0]?.score ?? 0;
          const threshold = Math.max(topScore * 0.7, 0.1);
          const filtered = sorted.filter((s) => s.score >= threshold).slice(0, limit * 2);

          if (filtered.length > 0) {
            // RRF 融合 BM25 + 向量
            const K = 60;
            const rrfScores = new Map<string, number>();

            bm25Results.forEach((r, rank) => {
              rrfScores.set(r.chunkId, (rrfScores.get(r.chunkId) ?? 0) + 1 / (K + rank + 1));
            });
            filtered.forEach((r, rank) => {
              rrfScores.set(r.chunkId, (rrfScores.get(r.chunkId) ?? 0) + 1 / (K + rank + 1));
            });

            const allChunks = getAllChunks();
            const chunkMap = new Map(allChunks.map((c) => [c.id, c]));

            finalResults = Array.from(rrfScores.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([chunkId, score]) => {
                const chunk = chunkMap.get(chunkId);
                if (!chunk) return null;
                return {
                  chunkId,
                  content: chunk.content,
                  sourceId: chunk.sourceId,
                  score,
                  matchType: "hybrid" as const,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);
          }
        }
      } catch (err) {
        logger.warn(`[Search] 向量检索失败，降级到 BM25: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Rerank
    const rerankInput: RerankInput[] = finalResults.map((r) => ({
      chunkId: r.chunkId,
      text: r.content,
      score: r.score,
    }));

    const reranked = await rerank(rerankInput, query);

    // 构建最终结果（包含 source URL）
    const chunkMap = new Map(getAllChunks().map((c) => [c.id, c]));
    const sourceMap = new Map(getAllSources().map((s) => [s.id, s]));
    const results = reranked.slice(0, limit).map((r) => {
      const chunk = chunkMap.get(r.chunkId);
      if (!chunk) return null;
      const source = sourceMap.get(chunk.sourceId);
      return {
        chunk,
        score: r.score,
        sourceUrl: source?.url,
        sourceName: source?.name,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    res.json({ ok: true, results, total: results.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Knowledge] 搜索失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/knowledge/clear — 清空知识库 */
knowledgeRouter.delete("/clear", (_req, res) => {
  try {
    clearKnowledgeDb();
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── GitHub Repo 同步 ────────────────────────────────────

/**
 * POST /api/knowledge/github/sync — Clone + 全量索引 GitHub repo
 *
 * 复用统一分块 pipeline（ingestion.ts）：extractText → preprocess → smartChunk → 去噪 → 存储 → embedding
 */
knowledgeRouter.post("/github/sync", async (req, res) => {
  try {
    const { owner, repo, branch = "main" } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ ok: false, error: "owner and repo are required" });
      return;
    }

    const remoteId = `${owner}/${repo}`;
    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);

    const jobId = crypto.randomUUID();
    addSyncJob({ id: jobId, sourceType: "github_repo", config: { owner, repo, branch }, status: "running" });

    // 异步执行（不阻塞响应）
    res.json({ ok: true, jobId, message: "同步已开始" });

    try {
      logger.info(`[GitHubSync] 开始同步: ${remoteId} (branch: ${branch})`);
      const cloneResult = await cloneRepo(owner, repo, branch);
      const files = listRepoFiles(cloneResult.repoDir);
      logger.info(`[GitHubSync] 可索引文件: ${files.length} 个`);

      updateSyncJob(jobId, { progress: { total: files.length, processed: 0, skipped: 0, errors: 0 } });

      let processed = 0, skipped = 0, errors = 0;

      for (const fileInfo of files) {
        try {
          const fileHash = computeFileHash(fileInfo.absolutePath);
          const existing = getRemoteIndexByRemoteId("github_repo", `${remoteId}/${fileInfo.relativePath}`);
          if (existing && existing.contentHash === fileHash) { skipped++; continue; }

          const content = readFileContent(fileInfo.absolutePath, "utf-8");
          if (!content || (typeof content === "string" && content.trim().length < 10)) { skipped++; continue; }

          // 删除旧索引（如果是更新）
          if (existing) deleteSource(existing.id);

          // ★ 复用统一分块 pipeline
          const result = await ingestFile({
            content: typeof content === "string" ? content : content,
            fileName: fileInfo.relativePath,
            sourceType: "github_file",
            url: `https://github.com/${remoteId}/blob/${branch}/${fileInfo.relativePath}`,
            filePath: fileInfo.relativePath,
            contentHash: fileHash,
            skipDuplicateCheck: true,
            embedding: embConfig ?? undefined,
          });

          if (result.status === "empty") { skipped++; continue; }

          addRemoteIndex({
            id: result.sourceId,
            sourceType: "github_repo",
            remoteId: `${remoteId}/${fileInfo.relativePath}`,
            name: fileInfo.relativePath,
            url: `https://github.com/${remoteId}/blob/${branch}/${fileInfo.relativePath}`,
            metadata: { owner, repo, branch, path: fileInfo.relativePath },
            contentHash: fileHash,
            chunkCount: result.chunkCount,
            status: "indexed",
          });

          processed++;
        } catch (err) {
          errors++;
          logger.warn(`[GitHubSync] 文件处理失败: ${fileInfo.relativePath}: ${err instanceof Error ? err.message : String(err)}`);
        }

        if ((processed + skipped + errors) % 10 === 0) {
          updateSyncJob(jobId, { progress: { total: files.length, processed, skipped, errors } });
        }
      }

      // ── 清理已删除文件的残留索引 ──
      const currentPaths = new Set(files.map(f => `${remoteId}/${f.relativePath}`));
      const allIndexed = getRemoteIndexesByType("github_repo");
      const orphaned = allIndexed.filter(idx => idx.remoteId.startsWith(`${remoteId}/`) && !currentPaths.has(idx.remoteId));
      let cleaned = 0;
      for (const orphan of orphaned) {
        try {
          deleteSource(orphan.id);
          deleteRemoteIndex(orphan.id);
          cleaned++;
          logger.info(`[GitHubSync] 清理已删除文件: ${orphan.name}`);
        } catch (err) {
          logger.warn(`[GitHubSync] 清理失败: ${orphan.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (cleaned > 0) logger.info(`[GitHubSync] 共清理 ${cleaned} 个已删除文件的残留索引`);

      updateSyncJob(jobId, { status: "completed", progress: { total: files.length, processed, skipped, errors }, lastSyncAt: new Date().toISOString() });
      logger.info(`[GitHubSync] 同步完成: ${remoteId}, processed=${processed}, skipped=${skipped}, errors=${errors}, cleaned=${cleaned}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncJob(jobId, { status: "error", errorMessage: msg });
      logger.error(`[GitHubSync] 同步失败: ${remoteId}: ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[GitHubSync] 请求处理失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/knowledge/github/sync/incremental — 增量同步
 *
 * 复用统一分块 pipeline：git pull + diff → 对变化文件调用 ingestFile
 */
knowledgeRouter.post("/github/sync/incremental", async (req, res) => {
  try {
    const { owner, repo, branch = "main" } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ ok: false, error: "owner and repo are required" });
      return;
    }

    const remoteId = `${owner}/${repo}`;
    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);

    if (!isRepoCloned(owner, repo)) {
      res.status(400).json({ ok: false, error: "Repo 未 clone，请先调用 /api/knowledge/github/sync" });
      return;
    }

    const jobId = crypto.randomUUID();
    addSyncJob({ id: jobId, sourceType: "github_repo", config: { owner, repo, branch, incremental: true }, status: "running" });
    res.json({ ok: true, jobId, message: "增量同步已开始" });

    try {
      const syncResult = await syncRepo(owner, repo, branch);

      if (!syncResult.hasChanges) {
        updateSyncJob(jobId, { status: "completed", progress: { total: 0, processed: 0, skipped: 0, errors: 0 }, lastSyncAt: new Date().toISOString() });
        logger.info(`[GitHubSync] 无新变化: ${remoteId}`);
        return;
      }

      const changedFiles = [...syncResult.changedFiles, ...syncResult.addedFiles];
      const totalFiles = changedFiles.length + syncResult.deletedFiles.length;
      updateSyncJob(jobId, { progress: { total: totalFiles, processed: 0, skipped: 0, errors: 0 } });

      let processed = 0, skipped = 0, errors = 0;

      // 处理删除的文件
      for (const deletedFile of syncResult.deletedFiles) {
        try {
          const existing = getRemoteIndexByRemoteId("github_repo", `${remoteId}/${deletedFile}`);
          if (existing) { deleteSource(existing.id); deleteRemoteIndex(existing.id); }
          processed++;
        } catch (err) {
          errors++;
          logger.warn(`[GitHubSync] 删除文件处理失败: ${deletedFile}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 处理变化和新增的文件
      const repoDir = path.resolve(process.cwd(), "repos", `${owner}_${repo}`);
      for (const changedFile of changedFiles) {
        try {
          const filePath = path.join(repoDir, changedFile);
          if (!fs.existsSync(filePath)) { skipped++; continue; }

          const fileHash = computeFileHash(filePath);
          const content = fs.readFileSync(filePath, "utf-8");
          if (!content || content.trim().length < 10) { skipped++; continue; }

          // 删除旧索引
          const existing = getRemoteIndexByRemoteId("github_repo", `${remoteId}/${changedFile}`);
          if (existing) deleteSource(existing.id);

          // ★ 复用统一分块 pipeline
          const result = await ingestFile({
            content,
            fileName: changedFile,
            sourceType: "github_file",
            url: `https://github.com/${remoteId}/blob/${branch}/${changedFile}`,
            filePath: changedFile,
            contentHash: fileHash,
            skipDuplicateCheck: true,
            embedding: embConfig ?? undefined,
          });

          if (result.status === "empty") { skipped++; continue; }

          addRemoteIndex({
            id: result.sourceId,
            sourceType: "github_repo",
            remoteId: `${remoteId}/${changedFile}`,
            name: changedFile,
            url: `https://github.com/${remoteId}/blob/${branch}/${changedFile}`,
            metadata: { owner, repo, branch, path: changedFile },
            contentHash: fileHash,
            chunkCount: result.chunkCount,
            status: "indexed",
          });

          processed++;
        } catch (err) {
          errors++;
          logger.warn(`[GitHubSync] 文件处理失败: ${changedFile}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      updateSyncJob(jobId, { status: "completed", progress: { total: totalFiles, processed, skipped, errors }, lastSyncAt: new Date().toISOString() });
      logger.info(`[GitHubSync] 增量同步完成: ${remoteId}, processed=${processed}, skipped=${skipped}, errors=${errors}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncJob(jobId, { status: "error", errorMessage: msg });
      logger.error(`[GitHubSync] 增量同步失败: ${remoteId}: ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[GitHubSync] 请求处理失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/knowledge/github/status — 查看同步状态
 *
 * Query: { owner, repo }
 */
knowledgeRouter.get("/github/status", (req, res) => {
  try {
    const { owner, repo } = req.query;
    if (!owner || !repo) {
      res.status(400).json({ ok: false, error: "owner and repo are required" });
      return;
    }

    const remoteId = `${owner}/${repo}`;
    const cloned = isRepoCloned(owner as string, repo as string);

    // 获取该 repo 的所有同步任务
    const jobs = getSyncJobsByType("github_repo").filter(j => {
      const cfg = j.config;
      return cfg.owner === owner && cfg.repo === repo;
    });

    // 获取该 repo 的已索引文件
    const indexedFiles = getRemoteIndexesByType("github_repo").filter(idx =>
      idx.remoteId.startsWith(remoteId + "/"),
    );

    res.json({
      ok: true,
      status: {
        cloned,
        indexedFileCount: indexedFiles.length,
        totalChunks: indexedFiles.reduce((sum, idx) => sum + idx.chunkCount, 0),
        lastSyncJob: jobs[0] ?? null,
        recentJobs: jobs.slice(0, 5),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/sync/job/:jobId — 按 jobId 查询同步进度 */
knowledgeRouter.get("/sync/job/:jobId", (req, res) => {
  try {
    const { jobId } = req.params;
    const job = dbGet<Record<string, unknown>>("SELECT * FROM kb_sync_jobs WHERE id = ?", [jobId]);

    if (!job) {
      res.status(404).json({ ok: false, error: "任务不存在" });
      return;
    }

    // 解析 JSON 字段
    const config = typeof job.config === "string" ? JSON.parse(job.config as string) : job.config;
    const progress = typeof job.progress === "string" ? JSON.parse(job.progress as string) : job.progress;

    res.json({
      ok: true,
      job: {
        id: job.id,
        sourceType: job.source_type,
        config,
        status: job.status,
        progress,
        lastSyncAt: job.last_sync_at,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * DELETE /api/knowledge/github/repo — 删除已 clone 的 repo 及其索引
 *
 * Body: { owner, repo }
 */
knowledgeRouter.delete("/github/repo", (req, res) => {
  try {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ ok: false, error: "owner and repo are required" });
      return;
    }

    const remoteId = `${owner}/${repo}`;

    // 删除已索引的文件
    const indexedFiles = getRemoteIndexesByType("github_repo").filter(idx =>
      idx.remoteId.startsWith(remoteId + "/"),
    );
    for (const idx of indexedFiles) {
      deleteSource(idx.id);
      deleteRemoteIndex(idx.id);
    }

    // 删除本地 clone
    removeRepo(owner, repo);

    logger.info(`[GitHubSync] 已删除 repo: ${remoteId}, ${indexedFiles.length} 个索引文件`);
    res.json({ ok: true, deletedFiles: indexedFiles.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/knowledge/github/repos — 列出所有已索引的 repo
 */
knowledgeRouter.get("/github/repos", (_req, res) => {
  try {
    const indexes = getRemoteIndexesByType("github_repo");

    // 按 repo 分组
    const repoMap = new Map<string, { owner: string; repo: string; fileCount: number; totalChunks: number; lastIndexed: string }>();
    for (const idx of indexes) {
      const parts = idx.remoteId.split("/");
      if (parts.length < 3) continue;
      const repoKey = `${parts[0]}/${parts[1]}`;
      const existing = repoMap.get(repoKey);
      if (existing) {
        existing.fileCount++;
        existing.totalChunks += idx.chunkCount;
        if (idx.indexedAt > existing.lastIndexed) {
          existing.lastIndexed = idx.indexedAt;
        }
      } else {
        repoMap.set(repoKey, {
          owner: parts[0],
          repo: parts[1],
          fileCount: 1,
          totalChunks: idx.chunkCount,
          lastIndexed: idx.indexedAt,
        });
      }
    }

    res.json({
      ok: true,
      repos: Array.from(repoMap.values()),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── Outlook 邮箱知识库同步 ──────────────────────────────

/**
 * POST /api/knowledge/outlook/email/sync — 全量同步 Outlook 邮件
 */
knowledgeRouter.post("/outlook/email/sync", async (req, res) => {
  try {
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户，请先在「远程文档」中完成 OAuth 授权" });
      return;
    }

    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);
    const maxEmails = req.body.maxEmails ?? 500;

    const jobId = crypto.randomUUID();
    addSyncJob({ id: jobId, sourceType: "outlook_email", config: { maxEmails }, status: "running" });

    res.json({ ok: true, jobId, message: "邮件同步已开始" });

    try {
      logger.info(`[OutlookSync] 开始邮件同步, maxEmails=${maxEmails}`);
      updateSyncJob(jobId, { progress: { total: 0, processed: 0, skipped: 0, errors: 0 } });

      const result = await syncEmailsToKB(
        { accessToken: token },
        { maxEmails, embedding: embConfig ?? undefined },
      );

      updateSyncJob(jobId, {
        status: "completed",
        progress: { total: result.total, processed: result.processed, skipped: result.skipped, errors: result.errors },
        lastSyncAt: new Date().toISOString(),
      });
      logger.info(`[OutlookSync] 邮件同步完成: ${JSON.stringify(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncJob(jobId, { status: "error", errorMessage: msg });
      logger.error(`[OutlookSync] 邮件同步失败: ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/knowledge/outlook/contact/sync — 全量同步 Outlook 联系人
 */
knowledgeRouter.post("/outlook/contact/sync", async (req, res) => {
  try {
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户，请先在「远程文档」中完成 OAuth 授权" });
      return;
    }

    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);
    const maxContacts = req.body.maxContacts ?? 200;

    const jobId = crypto.randomUUID();
    addSyncJob({ id: jobId, sourceType: "outlook_contact", config: { maxContacts }, status: "running" });

    res.json({ ok: true, jobId, message: "联系人同步已开始" });

    try {
      logger.info(`[OutlookSync] 开始联系人同步, maxContacts=${maxContacts}`);
      updateSyncJob(jobId, { progress: { total: 0, processed: 0, skipped: 0, errors: 0 } });

      const result = await syncContactsToKB(
        { accessToken: token },
        { maxContacts, embedding: embConfig ?? undefined },
      );

      updateSyncJob(jobId, {
        status: "completed",
        progress: { total: result.total, processed: result.processed, skipped: result.skipped, errors: result.errors },
        lastSyncAt: new Date().toISOString(),
      });
      logger.info(`[OutlookSync] 联系人同步完成: ${JSON.stringify(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncJob(jobId, { status: "error", errorMessage: msg });
      logger.error(`[OutlookSync] 联系人同步失败: ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/knowledge/outlook/status — 查看 Outlook KB 同步状态
 */
knowledgeRouter.get("/outlook/status", (_req, res) => {
  try {
    const emailStatus = getOutlookKBStatus("outlook_email");
    const contactStatus = getOutlookKBStatus("outlook_contact");

    const emailJobs = getSyncJobsByType("outlook_email");
    const contactJobs = getSyncJobsByType("outlook_contact");

    res.json({
      ok: true,
      email: {
        count: emailStatus.count,
        totalChunks: emailStatus.totalChunks,
        lastJob: emailJobs[0] ?? null,
      },
      contact: {
        count: contactStatus.count,
        totalChunks: contactStatus.totalChunks,
        lastJob: contactJobs[0] ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * DELETE /api/knowledge/outlook/email — 清除已索引的邮件
 */
knowledgeRouter.delete("/outlook/email", (req, res) => {
  try {
    const count = clearOutlookKB("outlook_email");
    res.json({ ok: true, deleted: count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * DELETE /api/knowledge/outlook/contact — 清除已索引的联系人
 */
knowledgeRouter.delete("/outlook/contact", (req, res) => {
  try {
    const count = clearOutlookKB("outlook_contact");
    res.json({ ok: true, deleted: count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/knowledge/outlook/email/list — 列出已索引的邮件
 */
knowledgeRouter.get("/outlook/email/list", (_req, res) => {
  try {
    const indexes = getRemoteIndexesByType("outlook_email");
    const emails = indexes.map(idx => ({
      id: idx.remoteId,
      name: idx.name,
      url: idx.url,
      chunks: idx.chunkCount,
      indexedAt: idx.indexedAt,
      ...idx.metadata,
    }));
    res.json({ ok: true, emails });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/knowledge/outlook/contact/list — 列出已索引的联系人
 */
knowledgeRouter.get("/outlook/contact/list", (_req, res) => {
  try {
    const indexes = getRemoteIndexesByType("outlook_contact");
    const contacts = indexes.map(idx => ({
      id: idx.remoteId,
      name: idx.name,
      chunks: idx.chunkCount,
      indexedAt: idx.indexedAt,
      ...idx.metadata,
    }));
    res.json({ ok: true, contacts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
