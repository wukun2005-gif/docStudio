/**
 * 统一入库 Pipeline — 所有知识源共用
 *
 * 流程: 提取文本 → 预处理 → 智能分块 → 去噪 → 存储 → Embedding
 *
 * 所有渠道（本地上传、GitHub、OneDrive、SharePoint）的数据预处理
 * 和向量化必须走这个 pipeline，不能各自造轮子。
 */

import crypto from "crypto";
import path from "path";
import {
  addSource,
  addChunks,
  addVectors,
  findDuplicateByHash,
  computeTextHash,
  updateSourceStatus,
  markChunksEmbedded,
  findEmbeddedHashes,
  getSourceById,
  deleteSource,
  findSourcesByFilePath,
} from "./knowledgeDb.js";
import { preprocessText } from "./textPreprocess.js";
import { chunkText as smartChunk, isNoise, isGarbled } from "./textChunker.js";
import { logger } from "./logger.js";

// ── Embedding 配置 ──────────────────────────────────────

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

// ── 入库结果 ────────────────────────────────────────────

export interface IngestResult {
  sourceId: string;
  status: "ok" | "duplicate" | "empty" | "error";
  chunkCount: number;
  embeddedCount: number;
  error?: string;
}

// ── 入库选项 ────────────────────────────────────────────

export interface IngestOptions {
  /** 文件内容（Buffer 或 string） */
  content: Buffer | string;
  /** 文件名（用于文本提取和类型检测） */
  fileName: string;
  /** 知识源类型 */
  sourceType: string;
  /** 自定义 sourceId（不传则自动生成 UUID） */
  sourceId?: string;
  /** 文件 URL（远程源用） */
  url?: string;
  /** 文件路径（远程源用） */
  filePath?: string;
  /** 内容 hash（不传则自动计算） */
  contentHash?: string;
  /** 是否跳过重复检查 */
  skipDuplicateCheck?: boolean;
  /** Embedding 配置（不传则跳过 embedding） */
  embedding?: EmbeddingConfig;
}

// ── 文本提取 ────────────────────────────────────────────

/** 剥离 HTML 标签，保留文本内容 */
function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<\/?(br|p|div|li|tr|h[1-6]|blockquote|section|article)[^>]*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

/** 提取 EML 邮件正文 */
function extractEml(buffer: Buffer): string {
  const raw = buffer.toString("utf-8");
  const headerEnd = raw.indexOf("\r\n\r\n");
  const bodyStart = headerEnd >= 0 ? headerEnd + 4 : raw.indexOf("\n\n") + 2;
  let body = raw.slice(bodyStart);

  const encoding = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1]?.toLowerCase();
  if (encoding === "quoted-printable") {
    body = body.replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  if (raw.includes("text/html") || body.trim().startsWith("<")) {
    return stripHtml(body);
  }

  return body.trim();
}

/**
 * 从文件内容中提取文本
 *
 * 支持: TXT, MD, HTML, EML, JSON, DOCX, PPTX, XLSX, PDF
 */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if ([".txt", ".md", ".markdown"].includes(ext)) {
    return buffer.toString("utf-8");
  }

  if ([".html", ".htm"].includes(ext)) {
    return stripHtml(buffer.toString("utf-8"));
  }

  if (ext === ".eml") {
    return extractEml(buffer);
  }

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

  if (ext === ".docx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml")?.async("text");
      if (docXml) {
        const paragraphs = docXml.split(/<\/w:p>/);
        const texts: string[] = [];
        for (const p of paragraphs) {
          const matches = p.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
          if (matches) {
            texts.push(matches.map((m) => m.replace(/<[^>]+>/g, "")).join(""));
          }
        }
        return texts.filter((t) => t.trim()).join("\n\n");
      }
    } catch { /* fallback */ }
    return "";
  }

  if (ext === ".pptx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const slides: string[] = [];
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.startsWith("ppt/slides/slide") && name.endsWith(".xml")) {
          const content = await (file as any).async("text");
          const matches = content.match(/<a:t>([^<]+)<\/a:t>/g);
          if (matches) {
            const slideText = matches.map((m: string) => m.replace(/<[^>]+>/g, "")).join(" ");
            if (slideText.trim()) slides.push(slideText.trim());
          }
        }
      }
      return slides.join("\n\n");
    } catch { /* fallback */ }
    return "";
  }

  if (ext === ".xlsx") {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const rows: string[] = [];
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml")) {
          const content = await (file as any).async("text");
          const rowMatches = content.match(/<row[^>]*>([\s\S]*?)<\/row>/g);
          if (rowMatches) {
            for (const row of rowMatches) {
              const cells = row.match(/<v>([^<]+)<\/v>/g);
              if (cells) {
                const rowText = cells.map((c: string) => c.replace(/<[^>]+>/g, "")).join(" | ");
                if (rowText.trim()) rows.push(rowText.trim());
              }
            }
          }
        }
      }
      return rows.join("\n");
    } catch { /* fallback */ }
    return "";
  }

  if (ext === ".pdf") {
    const text = buffer.toString("utf-8");
    return text.replace(/[^\x20-\x7E一-鿿\n]/g, " ").replace(/\s+/g, " ").trim();
  }

  // 未知格式：尝试 UTF-8
  return buffer.toString("utf-8");
}

/** 根据文件名获取知识源类型 */
export function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
    ".txt": "txt", ".md": "md", ".markdown": "md",
    ".html": "html", ".htm": "html",
    ".eml": "email", ".json": "json",
    ".xlsx": "excel", ".pptx": "ppt",
    // 代码文件
    ".ts": "code", ".tsx": "code", ".js": "code", ".jsx": "code",
    ".py": "code", ".java": "code", ".go": "code", ".rs": "code",
    ".c": "code", ".cpp": "code", ".h": "code", ".hpp": "code",
    ".rb": "code", ".php": "code", ".swift": "code", ".kt": "code",
    ".scala": "code", ".sh": "code", ".bash": "code",
    ".sql": "code", ".graphql": "code", ".proto": "code",
    ".yaml": "code", ".yml": "code", ".toml": "code",
  };
  return map[ext] ?? "txt";
}

// ── Embedding ───────────────────────────────────────────

const EMBED_BATCH_SIZE = 10;
const EMBED_TIMEOUT = 30_000;

/** 调用远程 embedding API */
export async function embedBatch(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (texts.length === 0) return [];

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const url = `${config.baseUrl}/embeddings`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        input: texts.map((t) => t.slice(0, 500)),
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT),
    });

    if (resp.ok) {
      const data = (await resp.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data.map((d) => d.embedding);
    }

    // 可重试的状态码：429(限流)、500/502/503/504(服务端错误)
    const retryable = resp.status === 429 || resp.status >= 500;
    const errText = await resp.text().catch(() => "");

    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`Embedding API error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
    logger.warn(`[Ingest] Embedding 请求失败 (${resp.status}), ${attempt + 1}/${MAX_RETRIES} 次重试, 等待 ${Math.round(delay)}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error("Embedding 重试耗尽");
}

/** 对 chunks 做 embedding 并入库 */
export async function embedChunks(
  chunkRecords: Array<{ id: string; content: string }>,
  config: EmbeddingConfig,
): Promise<{ embedded: number; errors: string[] }> {
  const hashes = chunkRecords.map((c) => computeTextHash(c.content));
  const embeddedHashes = findEmbeddedHashes(hashes);

  const toEmbed: Array<{ id: string; content: string; hash: string }> = [];
  for (let i = 0; i < chunkRecords.length; i++) {
    if (!embeddedHashes.has(hashes[i])) {
      toEmbed.push({ ...chunkRecords[i], hash: hashes[i] });
    }
  }

  const validChunks = toEmbed.filter((c) => c.content.length >= 10);
  const skippedCount = toEmbed.length - validChunks.length + embeddedHashes.size;

  if (validChunks.length === 0) {
    logger.info(`[Ingest] 所有 chunks 已有 embedding 或太短，跳过`);
    return { embedded: 0, errors: [] };
  }

  logger.info(`[Ingest] 待 embedding: ${validChunks.length} chunks (跳过 ${skippedCount} 个)`);

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

      logger.info(`[Ingest] Embedding 进度: ${embeddedCount}/${validChunks.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      logger.error(`[Ingest] Embedding 批次失败: ${msg}`);
    }
  }

  return { embedded: embeddedCount, errors };
}

// ── 核心入库 Pipeline ───────────────────────────────────

/**
 * 统一入库 Pipeline — 所有知识源共用
 *
 * 流程:
 * 1. 提取文本（extractText）
 * 2. 预处理（preprocessText）
 * 3. 智能分块（smartChunk）
 * 4. 去噪 + 乱码过滤
 * 5. 存储（addSource + addChunks）
 * 6. Embedding（可选）
 *
 * @param options 入库选项
 * @returns 入库结果
 */
export async function ingestFile(options: IngestOptions): Promise<IngestResult> {
  const {
    content,
    fileName,
    sourceType,
    sourceId: customSourceId,
    url,
    filePath,
    contentHash: customHash,
    skipDuplicateCheck = false,
    embedding,
  } = options;

  // 计算内容 hash
  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const rawHash = customHash ?? computeTextHash(buffer.toString("utf-8"));

  // 过滤测试文件：不会向知识库中摄入测试/固件/脚本文件
  const normalizedPath = (filePath ?? fileName).replace(/\\/g, "/");
  if (
    /\/tests?\//i.test(normalizedPath) ||
    /[\/\\]__tests?__[\/\\]/i.test(normalizedPath) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java)$/i.test(fileName)
  ) {
    logger.info(`[Ingest] 跳过测试/固件文件: ${fileName}`);
    return { sourceId: customSourceId ?? crypto.randomUUID(), status: "empty", chunkCount: 0, embeddedCount: 0 };
  }

  // 重复检查（非稳定 sourceId 时用 content hash 去重）
  if (!skipDuplicateCheck && !customSourceId) {
    const existingId = findDuplicateByHash(rawHash);
    if (existingId) {
      return { sourceId: existingId, status: "duplicate", chunkCount: 0, embeddedCount: 0 };
    }
  }

  // 稳定 sourceId：同一标识符的旧数据先清理（CASCADE 自动删 chunks + vectors）
  if (customSourceId) {
    const existing = getSourceById(customSourceId);
    if (existing) {
      if (existing.contentHash === rawHash) {
        // 内容未变，无需重新入库
        return { sourceId: customSourceId, status: "duplicate", chunkCount: 0, embeddedCount: 0 };
      }
      // 内容变化：删除旧记录（CASCADE DELETE 自动清理关联 chunks 和 vectors）
      deleteSource(customSourceId);
      logger.info(`[Ingest] 清理旧版本: ${existing.name} (${customSourceId.slice(0, 12)}...), 内容已变化`);
    }
    // 过渡期清理：删除同一 filePath 下的旧 UUID 格式重复源
    if (filePath) {
      const oldDupes = findSourcesByFilePath(filePath);
      for (const dupe of oldDupes) {
        if (dupe.id !== customSourceId) {
          deleteSource(dupe.id);
          logger.info(`[Ingest] 清理旧重复源: ${dupe.name} (${dupe.id.slice(0, 12)}...) → 统一为 ${customSourceId.slice(0, 12)}...`);
        }
      }
    }
  }

  const sourceId = customSourceId ?? crypto.randomUUID();

  // Step 1: 提取文本
  const rawText = await extractText(buffer, fileName);
  if (!rawText.trim()) {
    return { sourceId, status: "empty", chunkCount: 0, embeddedCount: 0 };
  }

  // Step 2: 预处理（清理页眉页脚、全角半角、日期标准化）
  const cleanText = preprocessText(rawText);

  // Step 3: 智能分块
  const chunks = smartChunk(cleanText, fileName);

  // Step 4: 去噪 + 乱码过滤
  const validChunks = chunks.filter((c) => !isNoise(c.text) && !isGarbled(c.text));

  if (validChunks.length === 0) {
    return { sourceId, status: "empty", chunkCount: 0, embeddedCount: 0 };
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
  const detectedType = sourceType ?? getFileType(fileName);
  addSource({
    id: sourceId,
    name: fileName,
    type: detectedType,
    filePath: filePath ?? fileName,
    url,
    contentHash: rawHash,
    chunkCount: validChunks.length,
    status: "processing",
  });
  addChunks(chunkRecords);

  // Step 7: Embedding（如果有配置）
  let embeddedCount = 0;
  if (embedding) {
    try {
      const embedResult = await embedChunks(chunkRecords, embedding);
      embeddedCount = embedResult.embedded;
      if (embedResult.errors.length > 0) {
        logger.error(`[Ingest] Embedding 部分失败: ${fileName}: ${embedResult.errors.join("; ")}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Ingest] Embedding 失败: ${fileName}: ${msg}`);
    }
  }

  updateSourceStatus(sourceId, "ready");

  logger.info(`[Ingest] 完成: ${fileName}, ${validChunks.length} chunks, ${embeddedCount} embedded`);
  return { sourceId, status: "ok", chunkCount: validChunks.length, embeddedCount };
}

/**
 * 批量入库 — 多个文件共用一个 embedding 配置
 */
export async function ingestFiles(
  files: Array<{ content: Buffer | string; fileName: string; sourceType?: string; url?: string; filePath?: string }>,
  embedding?: EmbeddingConfig,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  for (const file of files) {
    try {
      const result = await ingestFile({
        ...file,
        sourceType: file.sourceType ?? getFileType(file.fileName),
        embedding,
      });
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Ingest] 文件入库失败: ${file.fileName}: ${msg}`);
      results.push({
        sourceId: crypto.randomUUID(),
        status: "error",
        chunkCount: 0,
        embeddedCount: 0,
        error: msg,
      });
    }
  }

  return results;
}