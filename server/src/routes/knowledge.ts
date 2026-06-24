/**
 * 知识库 API 路由 — 完整 RAG Pipeline
 *
 * 流程: 提取文本 → 预处理 → 分块 → 去噪 → 存储 → Embedding → 向量入库
 */
import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  addSource,
  getAllSources,
  deleteSource,
  addChunks,
  addVectors,
  getAllChunks,
  getAllVectors,
  getStats,
  clearKnowledgeDb,
  findDuplicateByHash,
  computeTextHash,
  updateSourceStatus,
  markChunksEmbedded,
  findEmbeddedHashes,
  getUnembeddedChunks,
} from "../lib/knowledgeDb.js";
import { preprocessText } from "../lib/textPreprocess.js";
import { chunkText as smartChunk, isNoise, isGarbled } from "../lib/textChunker.js";
import { hybridSearch } from "../lib/hybridSearch.js";
import { rerank, type RerankInput } from "../lib/reranker.js";
import { readSettingsFromDb } from "../lib/settingsReader.js";
import { logger } from "../lib/logger.js";
import { getDb } from "../lib/db.js";

export const knowledgeRouter = Router();
const db = getDb();

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

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

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

// ── Embedding API 调用 ─────────────────────────────────

const EMBED_BATCH_SIZE = 50;
const EMBED_TIMEOUT = 30_000;

/** 调用远程 embedding API */
async function embedBatch(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const url = `${config.baseUrl}/embeddings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      input: texts.map((t) => t.slice(0, 500)), // 截断到 500 字符
    }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Embedding API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data.map((d) => d.embedding);
}

/** 对 chunks 做 embedding 并入库 */
async function embedChunks(
  chunkRecords: Array<{ id: string; content: string }>,
  config: EmbeddingConfig,
): Promise<{ embedded: number; errors: string[] }> {
  // 计算 text_hash，跳过已 embedding 的
  const hashes = chunkRecords.map((c) => computeTextHash(c.content));
  const embeddedHashes = findEmbeddedHashes(hashes);

  const toEmbed: Array<{ id: string; content: string; hash: string }> = [];
  for (let i = 0; i < chunkRecords.length; i++) {
    if (!embeddedHashes.has(hashes[i])) {
      toEmbed.push({ ...chunkRecords[i], hash: hashes[i] });
    }
  }

  // 过滤太短的 chunks（和噪声过滤阈值一致）
  const validChunks = toEmbed.filter((c) => c.content.length >= 10);
  const skippedCount = toEmbed.length - validChunks.length + embeddedHashes.size;

  if (validChunks.length === 0) {
    logger.info(`[Embed] 所有 chunks 已有 embedding 或太短，跳过`);
    return { embedded: 0, errors: [] };
  }

  logger.info(`[Embed] 待处理: ${validChunks.length} chunks (跳过 ${skippedCount} 个已embedding/太短)`);

  // 按文本长度排序（短的先处理，减少 padding 浪费）
  validChunks.sort((a, b) => a.content.length - b.content.length);

  const errors: string[] = [];
  let embeddedCount = 0;
  for (let i = 0; i < validChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = validChunks.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vectors = await embedBatch(
        batch.map((c) => c.content),
        config,
      );

      const vectorRecords = batch.map((c, idx) => ({
        chunkId: c.id,
        embedding: vectors[idx],
        modelId: config.modelId,
      }));

      addVectors(vectorRecords);
      markChunksEmbedded(batch.map((c) => c.id));
      embeddedCount += batch.length;

      logger.info(`[Embed] 进度: ${embeddedCount}/${validChunks.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      logger.error(`[Embed] 批次失败 (${batch.length} chunks): ${msg}`);
      // 继续处理下一批
    }
  }

  return { embedded: embeddedCount, errors };
}

// ── 文本提取辅助函数 ──────────────────────────────────

/** 剥离 HTML 标签，保留文本内容 */
function stripHtml(html: string): string {
  // 移除 script/style 标签及其内容
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  // 将 <br>, <p>, <div>, <li>, <tr>, <h1>-<h6> 等块级标签转为换行
  text = text.replace(/<\/?(br|p|div|li|tr|h[1-6]|blockquote|section|article)[^>]*\/?>/gi, "\n");
  // 剩余标签直接移除
  text = text.replace(/<[^>]+>/g, " ");
  // 解码常见 HTML 实体
  text = text.replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
  // 清理多余空白
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

/** 提取 EML 邮件正文 */
function extractEml(buffer: Buffer): string {
  const raw = buffer.toString("utf-8");
  // 分离 header 和 body（空行分隔）
  const headerEnd = raw.indexOf("\r\n\r\n");
  const bodyStart = headerEnd >= 0 ? headerEnd + 4 : raw.indexOf("\n\n") + 2;
  let body = raw.slice(bodyStart);

  // 处理 quoted-printable 编码
  const encoding = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1]?.toLowerCase();
  if (encoding === "quoted-printable") {
    body = body.replace(/=\r?\n/g, "") // 软换行
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  // 如果 body 是 HTML，剥离标签
  if (raw.includes("text/html") || body.trim().startsWith("<")) {
    return stripHtml(body);
  }

  return body.trim();
}

// ── 文本提取 ────────────────────────────────────────

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  // 纯文本格式
  if ([".txt", ".md", ".markdown"].includes(ext)) {
    return buffer.toString("utf-8");
  }

  // HTML — 剥离标签，保留文本
  if ([".html", ".htm"].includes(ext)) {
    const html = buffer.toString("utf-8");
    return stripHtml(html);
  }

  // EML — 提取正文（可能含 HTML）
  if (ext === ".eml") {
    return extractEml(buffer);
  }

  // JSON（Teams 聊天等）
  if (ext === ".json") {
    try {
      const json = JSON.parse(buffer.toString("utf-8"));
      if (json.messages && Array.isArray(json.messages)) {
        return json.messages.map((m: any) => `${m.date} ${m.time} ${m.user}: ${m.content}`).join("\n");
      }
      return JSON.stringify(json, null, 2);
    } catch {
      return buffer.toString("utf-8");
    }
  }

  // DOCX
  if (ext === ".docx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml")?.async("text");
      if (docXml) {
        const matches = docXml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
        if (matches) return matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
      }
    } catch { /* fallback */ }
    return "";
  }

  // PPTX
  if (ext === ".pptx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.startsWith("ppt/slides/slide") && name.endsWith(".xml")) {
          const content = await (file as any).async("text");
          const matches = content.match(/<a:t>([^<]+)<\/a:t>/g);
          if (matches) texts.push(...matches.map((m: string) => m.replace(/<[^>]+>/g, "")));
        }
      }
      return texts.join(" ");
    } catch { /* fallback */ }
    return "";
  }

  // XLSX
  if (ext === ".xlsx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml")) {
          const content = await (file as any).async("text");
          const matches = content.match(/<v>([^<]+)<\/v>/g);
          if (matches) texts.push(...matches.map((m: string) => m.replace(/<[^>]+>/g, "")));
        }
      }
      return texts.join(" ");
    } catch { /* fallback */ }
    return "";
  }

  // PDF（简化版提取）
  if (ext === ".pdf") {
    const text = buffer.toString("utf-8");
    return text.replace(/[^\x20-\x7E一-鿿\n]/g, " ").replace(/\s+/g, " ").trim();
  }

  return buffer.toString("utf-8");
}

function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
    ".txt": "txt", ".md": "md", ".markdown": "md",
    ".html": "html", ".htm": "html",
    ".eml": "email", ".json": "json",
    ".xlsx": "excel", ".pptx": "ppt",
  };
  return map[ext] ?? "txt";
}

// ── API Routes ──────────────────────────────────────

/** POST /api/knowledge/upload — 上传 + 预处理 + 分块 + Embedding */
knowledgeRouter.post("/upload", upload.any(), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ ok: false, error: "没有上传文件" });
      return;
    }

    // 获取 embedding 配置（可选，来自请求体或环境变量）
    const embConfig = getEmbeddingConfig(req.body as Record<string, unknown>);

    const results: Array<{ id: string; name: string; status: string; chunks?: number; embedded?: number }> = [];

    for (const file of files) {
      const rawHash = computeTextHash(file.buffer.toString("utf-8"));

      // 检查重复
      const existingId = findDuplicateByHash(rawHash);
      if (existingId) {
        results.push({ id: existingId, name: file.originalname, status: "duplicate" });
        continue;
      }

      const sourceId = crypto.randomUUID();
      const fileType = getFileType(file.originalname);

      // Step 1: 提取文本
      const rawText = await extractText(file.buffer, file.originalname);
      if (!rawText.trim()) {
        results.push({ id: sourceId, name: file.originalname, status: "empty" });
        continue;
      }

      // Step 2: 预处理（清理页眉页脚、全角半角、日期标准化）
      const cleanText = preprocessText(rawText);

      // Step 3: 智能分块
      const chunks = smartChunk(cleanText, file.originalname);

      // Step 4: 去噪 + 乱码过滤
      const validChunks = chunks.filter((c) => !isNoise(c.text) && !isGarbled(c.text));

      if (validChunks.length === 0) {
        results.push({ id: sourceId, name: file.originalname, status: "empty" });
        continue;
      }

      // Step 5: 构建 chunk 记录
      const chunkRecords = validChunks.map((c) => ({
        id: `${sourceId}-c${c.idx}`,
        sourceId,
        content: c.text,
        chunkIndex: c.idx,
        tokenCount: c.text.length,
        metadata: c.metadata,
      }));

      // Step 6: 存入数据库
      addSource({
        id: sourceId,
        name: file.originalname,
        type: fileType,
        filePath: file.originalname,
        contentHash: rawHash,
        chunkCount: validChunks.length,
        status: "processing",
      });
      addChunks(chunkRecords);

      // Step 7: Embedding（如果有配置）
      let embeddedCount = 0;
      if (embConfig) {
        try {
          const embedResult = await embedChunks(chunkRecords, embConfig);
          embeddedCount = embedResult.embedded;
          if (embedResult.errors.length > 0) {
            logger.error(`[Knowledge] Embedding 部分失败: ${file.originalname}: ${embedResult.errors.join("; ")}`);
          }
          updateSourceStatus(sourceId, "ready");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[Knowledge] Embedding 失败: ${file.originalname}: ${msg}`);
          updateSourceStatus(sourceId, "ready"); // 仍然标记为 ready，向量可以后续补充
        }
      } else {
        updateSourceStatus(sourceId, "ready");
      }

      results.push({
        id: sourceId,
        name: file.originalname,
        status: "ok",
        chunks: validChunks.length,
        embedded: embeddedCount,
      });
      logger.info(`[Knowledge] 上传: ${file.originalname}, ${validChunks.length} chunks, ${embeddedCount} embedded`);
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
    const source = db.prepare("SELECT * FROM kb_sources WHERE id = ?").get(req.params.id);
    if (!source) {
      return res.status(404).json({ ok: false, error: "知识源不存在" });
    }
    const chunks = db.prepare("SELECT id, content, chunk_index FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index").all(req.params.id);
    res.json({ ok: true, source, chunks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/knowledge/sources/:id/file — 下载/预览知识源原始文件 */
knowledgeRouter.get("/sources/:id/file", (req, res) => {
  try {
    const source = db.prepare("SELECT name, file_path, type FROM kb_sources WHERE id = ?").get(req.params.id) as { name: string; file_path: string; type: string } | undefined;
    if (!source) {
      return res.status(404).json({ ok: false, error: "知识源不存在" });
    }
    if (!source.file_path) {
      return res.status(404).json({ ok: false, error: "该知识源无原始文件" });
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
      return res.status(404).json({ ok: false, error: "文件不存在" });
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

    // 构建最终结果
    const chunkMap = new Map(getAllChunks().map((c) => [c.id, c]));
    const results = reranked.slice(0, limit).map((r) => {
      const chunk = chunkMap.get(r.chunkId);
      return chunk ? { chunk, score: r.score } : null;
    }).filter(Boolean);

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
