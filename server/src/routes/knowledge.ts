/**
 * 知识库 API 路由 — 上传、搜索、CRUD
 */
import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import {
  addSource,
  getAllSources,
  deleteSource,
  addChunks,
  addVectors,
  getAllVectors,
  getAllChunks,
  getChunksBySourceId,
  getStats,
  clearKnowledgeDb,
  findDuplicateByHash,
  computeTextHash,
  chunkText,
  updateSourceStatus,
} from "../lib/knowledgeDb.js";
import { logger } from "../lib/logger.js";

export const knowledgeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ── 文本提取 ────────────────────────────────────────

/** 从文件 buffer 提取纯文本 */
function extractText(buffer: Buffer, filename: string): string {
  const ext = path.extname(filename).toLowerCase();

  // 对于纯文本格式，直接返回
  if ([".txt", ".md", ".markdown", ".html", ".htm"].includes(ext)) {
    return buffer.toString("utf-8");
  }

  // PDF/DOCX 等二进制格式 — 简单提取文本（生产环境应使用专用解析库）
  if (ext === ".pdf") {
    // 简化版：尝试提取可读文本
    const text = buffer.toString("utf-8");
    // 移除 PDF 控制字符，保留可读文本
    return text.replace(/[^\x20-\x7E一-鿿\n]/g, " ").replace(/\s+/g, " ").trim();
  }

  if (ext === ".docx") {
    // 简化版：尝试从 XML 中提取文本
    const text = buffer.toString("utf-8");
    const matches = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
    if (matches) {
      return matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
    }
    return "";
  }

  // 默认当纯文本处理
  return buffer.toString("utf-8");
}

/** 判断文件类型 */
function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
    ".txt": "txt", ".md": "md", ".markdown": "md",
    ".html": "html", ".htm": "html",
  };
  return map[ext] ?? "txt";
}

// ── API Routes ──────────────────────────────────────

/** POST /api/knowledge/upload — 上传文件 */
knowledgeRouter.post("/upload", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ ok: false, error: "没有上传文件" });
      return;
    }

    const results: Array<{ id: string; name: string; status: string }> = [];

    for (const file of files) {
      const contentHash = computeTextHash(file.buffer.toString("utf-8"));

      // 检查重复
      const existingId = findDuplicateByHash(contentHash);
      if (existingId) {
        results.push({ id: existingId, name: file.originalname, status: "duplicate" });
        continue;
      }

      const sourceId = crypto.randomUUID();
      const fileType = getFileType(file.originalname);

      // 提取文本
      const text = extractText(file.buffer, file.originalname);
      if (!text.trim()) {
        results.push({ id: sourceId, name: file.originalname, status: "empty" });
        continue;
      }

      // 切片
      const chunks = chunkText(text);
      const chunkRecords = chunks.map((content, idx) => ({
        id: crypto.randomUUID(),
        sourceId,
        content,
        chunkIndex: idx,
        tokenCount: content.length, // 简化：字符数作为 token 估计
      }));

      // 保存
      addSource({
        id: sourceId,
        name: file.originalname,
        type: fileType,
        filePath: file.originalname,
        contentHash,
        chunkCount: chunks.length,
        status: "ready",
      });
      addChunks(chunkRecords);

      results.push({ id: sourceId, name: file.originalname, status: "ok" });
      logger.info(`[Knowledge] 上传成功: ${file.originalname}, ${chunks.length} chunks`);
    }

    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Knowledge] 上传失败: ${msg}`);
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

/** GET /api/knowledge/search — 搜索知识库 */
knowledgeRouter.get("/search", (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ ok: false, error: "缺少查询参数 q" });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);

    // 简单的关键词搜索（Phase 2 会实现完整的 RAG pipeline）
    const allChunks = getAllChunks();
    const queryLower = query.toLowerCase();
    const results = allChunks
      .filter((c) => c.content.toLowerCase().includes(queryLower))
      .slice(0, limit)
      .map((c) => ({
        chunk: c,
        score: 1.0, // 简化评分
        matchType: "keyword" as const,
      }));

    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
