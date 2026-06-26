/**
 * 通用文本分块器 — 适配 i-Write 各类文档
 *
 * 策略: 按段落/标题分块，带重叠
 * PRD 参数: chunk_size=512 tokens, chunk_overlap=64 tokens
 * 中文近似: 1 token ≈ 1.5 字符 → 512 tokens ≈ 340 字符, 64 tokens ≈ 45 字符
 */

const MIN_CHUNK = 80;    // 最小块（字符）
const MAX_CHUNK = 500;   // 最大块（≈512 tokens）
const OVERLAP = 45;      // 重叠（≈64 tokens）

export interface TextChunk {
  text: string;
  idx: number;
  metadata: Record<string, unknown>;
}

/** 判断是否为表格行 */
function isTableLine(line: string): boolean {
  const cols = line.split(/[\t|│]/).filter(Boolean);
  return cols.length >= 3;
}

/** 判断是否为标题行 */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // 第X章、第X节、X.X.X.X、#标题、中文序号
  return /^(第.{1,5}[章节]|#{1,3}\s|\d+\.\d+[\.\d]*\s|[一二三四五六七八九十]+[、.])/.test(t);
}

/** 合并短块到相邻块 */
function mergeShortChunks(chunks: TextChunk[]): TextChunk[] {
  if (chunks.length <= 1) return chunks;
  const merged: TextChunk[] = [];
  let i = 0;
  while (i < chunks.length) {
    const cur = chunks[i];
    if (cur.text.length < MIN_CHUNK && merged.length > 0) {
      // 合并到前一个块
      const prev = merged[merged.length - 1];
      prev.text += "\n\n" + cur.text;
    } else if (cur.text.length < MIN_CHUNK && i + 1 < chunks.length) {
      // 合并到下一个块
      const next = chunks[i + 1];
      next.text = cur.text + "\n\n" + next.text;
    } else {
      merged.push({ ...cur, idx: merged.length });
    }
    i++;
  }
  return merged.map((c, idx) => ({ ...c, idx }));
}

/** 拆分过长块（带重叠） */
function splitLongChunk(chunk: TextChunk): TextChunk[] {
  if (chunk.text.length <= MAX_CHUNK) return [chunk];
  const paragraphs = chunk.text.split(/\n{2,}/);
  const result: TextChunk[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_CHUNK && current.length > 0) {
      result.push({ text: current.trim(), idx: result.length, metadata: chunk.metadata });
      // 取当前块末尾 OVERLAP 字符作为下一块的开头（重叠）
      if (OVERLAP > 0 && current.length > OVERLAP) {
        const overlapText = current.slice(-OVERLAP);
        // 找到重叠文本中的段落边界，避免切断句子
        const breakIdx = overlapText.indexOf("\n");
        current = breakIdx >= 0
          ? current.slice(current.length - OVERLAP + breakIdx + 1) + "\n\n" + para
          : overlapText + "\n\n" + para;
      } else {
        current = para;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) {
    result.push({ text: current.trim(), idx: result.length, metadata: chunk.metadata });
  }
  return result;
}

/** 主分块函数 */
export function chunkText(text: string, fileName: string): TextChunk[] {
  const lines = text.split("\n");
  const rawChunks: TextChunk[] = [];
  let currentSection = "";
  let currentText = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (isHeading(trimmed)) {
      // 遇到标题，先保存当前积累的文本
      if (currentText.trim().length > 0) {
        rawChunks.push({
          text: currentText.trim(),
          idx: rawChunks.length,
          metadata: { section: currentSection, fileName },
        });
      }
      currentSection = trimmed;
      currentText = trimmed + "\n";
    } else if (isTableLine(trimmed)) {
      // 表格行: 连续表格行合并为一个块
      currentText += trimmed + "\n";
    } else {
      currentText += trimmed + "\n";
    }
  }
  // 最后一块
  if (currentText.trim().length > 0) {
    rawChunks.push({
      text: currentText.trim(),
      idx: rawChunks.length,
      metadata: { section: currentSection, fileName },
    });
  }

  // 合并短块 + 拆分长块（带重叠）
  let chunks = mergeShortChunks(rawChunks);
  const expanded: TextChunk[] = [];
  for (const c of chunks) {
    expanded.push(...splitLongChunk(c));
  }
  return expanded.map((c, idx) => ({ ...c, idx }));
}

/** 噪声过滤 */
export function isNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 10) return true;
  if (/^[\d\s.,%]+$/.test(t)) return true;
  if (/^\W+$/.test(t)) return true;
  return false;
}

/** 乱码检测 */
export function isGarbled(text: string): boolean {
  const meaningful = text.replace(/[^\w一-鿿　-〿]/g, "");
  return meaningful.length / Math.max(text.length, 1) < 0.3;
}

/** 计算文本哈希 (用于去重) */
export async function computeTextHash(text: string): Promise<string> {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(normalized).digest("hex");
}

// ── 代码分块 ────────────────────────────────────────────

const CODE_MIN_CHUNK = 100;   // 代码最小块（字符）
const CODE_MAX_CHUNK = 800;   // 代码最大块（代码通常比文档块大）
const CODE_OVERLAP_LINES = 3; // 代码重叠行数

/** 语言映射：扩展名 → 语言标识 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescriptreact",
  ".js": "javascript", ".jsx": "javascriptreact",
  ".py": "python", ".java": "java", ".go": "go", ".rs": "rust",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".rb": "ruby", ".php": "php", ".swift": "swift",
  ".kt": "kotlin", ".scala": "scala",
  ".sh": "shell", ".bash": "shell",
  ".sql": "sql", ".graphql": "graphql", ".proto": "protobuf",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".md": "markdown", ".html": "html", ".css": "css",
};

/** 根据扩展名获取语言 */
export function getLanguage(ext: string): string {
  return EXT_TO_LANGUAGE[ext.toLowerCase()] ?? "text";
}

/**
 * 代码分块 — 按函数/类/模块边界分块
 *
 * 策略:
 * 1. 提取文件头部（imports/using/include 等）作为上下文前缀
 * 2. 按函数/类定义分割
 * 3. 每个块附加文件路径和语言 metadata
 * 4. 短块合并，长块按行拆分
 */
export function chunkCode(
  code: string,
  filePath: string,
  language: string,
): TextChunk[] {
  const lines = code.split("\n");

  // 1. 提取文件头部上下文（import/using/include 语句）
  const headerLines: string[] = [];
  let headerEndIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isHeaderLine(line, language)) {
      headerLines.push(lines[i]);
      headerEndIdx = i + 1;
    } else if (line === "" && headerLines.length > 0) {
      // 空行在 import 块之后，标记为头部结束
      headerEndIdx = i + 1;
    } else if (headerLines.length > 0) {
      break;
    }
  }
  const headerContext = headerLines.join("\n");

  // 2. 按函数/类边界分割代码体
  const bodyLines = lines.slice(headerEndIdx);
  const segments = splitByBoundaries(bodyLines, language);

  // 3. 构建 chunks
  const rawChunks: TextChunk[] = [];

  for (const segment of segments) {
    const segmentText = segment.join("\n").trim();
    if (segmentText.length < 10) continue; // 跳过太短的段

    // 附加文件头部上下文（如果段本身不包含 import）
    const needsHeader = headerContext && !hasOwnImports(segmentText, language);
    const fullText = needsHeader
      ? headerContext + "\n\n" + segmentText
      : segmentText;

    rawChunks.push({
      text: fullText,
      idx: rawChunks.length,
      metadata: {
        filePath,
        language,
        type: "code",
        section: extractSectionName(segment, language),
      },
    });
  }

  // 如果没有任何分块（文件太短或全是头部），把整个文件作为一个 chunk
  if (rawChunks.length === 0 && code.trim().length >= 10) {
    rawChunks.push({
      text: code.trim(),
      idx: 0,
      metadata: { filePath, language, type: "code", section: "file" },
    });
  }

  // 4. 合并短块 + 拆分长块
  let chunks = mergeShortCodeChunks(rawChunks);
  const expanded: TextChunk[] = [];
  for (const c of chunks) {
    expanded.push(...splitLongCodeChunk(c));
  }

  return expanded.map((c, idx) => ({ ...c, idx }));
}

/** 判断是否为 import/using/include 行 */
function isHeaderLine(line: string, language: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 通用 import 模式
  if (/^(import |from .+ import|export .+ from|require\(|const .+ = require)/.test(trimmed)) return true;
  if (/^(using |#include |package |module )/.test(trimmed)) return true;
  if (/^(use |extern crate|use crate)/.test(trimmed)) return true;
  if (/^(\/\/ *eslint|\/\/ *@ts|\/\/ *noinspection|\/\* @)/.test(trimmed)) return true;
  if (/^['"]use strict['"]/.test(trimmed)) return true;

  return false;
}

/** 判断段内是否已有 import 语句 */
function hasOwnImports(text: string, language: string): boolean {
  const lines = text.split("\n");
  return lines.some(line => isHeaderLine(line.trim(), language));
}

/**
 * 按函数/类/模块边界分割代码行
 */
function splitByBoundaries(lines: string[], language: string): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测边界行（函数/类/模块定义）
    if (isBoundary(trimmed, language) && current.length > 0) {
      // 当前段积累了一些内容，先保存
      segments.push(current);
      current = [];
    }

    current.push(line);
  }

  // 最后一段
  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/** 判断是否为代码边界行（函数/类/模块定义） */
function isBoundary(line: string, language: string): boolean {
  if (!line) return false;

  // TypeScript/JavaScript
  if (/^(export\s+)?(async\s+)?function\s+\w/.test(line)) return true;
  if (/^(export\s+)?(default\s+)?class\s+\w/.test(line)) return true;
  if (/^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(line)) return true;
  if (/^(export\s+)?(const|let|var)\s+\w+\s*=\s*\w+/.test(line) && line.includes("=>")) return true;
  if (/^(export\s+)?interface\s+\w/.test(line)) return true;
  if (/^(export\s+)?type\s+\w/.test(line)) return true;
  if (/^(export\s+)?enum\s+\w/.test(line)) return true;

  // Python
  if (/^(class|def|async\s+def)\s+\w/.test(line)) return true;
  if (/^@\w+/.test(line)) return true; // decorator

  // Java/Kotlin/Swift
  if (/^(public|private|protected|internal)?\s*(static\s+)?(class|interface|enum|struct)\s+\w/.test(line)) return true;
  if (/^(public|private|protected|internal)?\s*(static\s+)?(suspend\s+)?(fun|func|void|int|string|bool)\s+\w/.test(line)) return true;

  // Go
  if (/^func\s+/.test(line)) return true;
  if (/^type\s+\w+\s+(struct|interface)/.test(line)) return true;

  // Rust
  if (/^(pub\s+)?(fn|struct|enum|trait|impl|mod)\s+/.test(line)) return true;

  // C/C++
  if (/^\w[\w\s\*]+\s+\w+\s*\(/.test(line) && !line.includes(";")) return true;

  // Shell
  if (/^\w+\s*\(\)\s*\{/.test(line)) return true;

  return false;
}

/** 提取段的名称（函数名/类名等） */
function extractSectionName(lines: string[], language: string): string {
  for (const line of lines.slice(0, 5)) { // 只看前 5 行
    const trimmed = line.trim();

    // 函数名
    const funcMatch = trimmed.match(/(?:function|def|fn|func|fun)\s+(\w+)/);
    if (funcMatch) return `function:${funcMatch[1]}`;

    // 类名
    const classMatch = trimmed.match(/(?:class|struct|interface|enum|trait)\s+(\w+)/);
    if (classMatch) return `class:${classMatch[1]}`;

    // 变量名（箭头函数等）
    const varMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*=/);
    if (varMatch) return `const:${varMatch[1]}`;

    // export
    const exportMatch = trimmed.match(/export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/);
    if (exportMatch) return `export:${exportMatch[1]}`;
  }

  return "block";
}

/** 合并短代码块 */
function mergeShortCodeChunks(chunks: TextChunk[]): TextChunk[] {
  if (chunks.length <= 1) return chunks;
  const merged: TextChunk[] = [];
  let i = 0;
  while (i < chunks.length) {
    const cur = chunks[i];
    if (cur.text.length < CODE_MIN_CHUNK && merged.length > 0) {
      // 合并到前一个块
      const prev = merged[merged.length - 1];
      prev.text += "\n\n" + cur.text;
    } else if (cur.text.length < CODE_MIN_CHUNK && i + 1 < chunks.length) {
      // 合并到下一个块
      const next = chunks[i + 1];
      next.text = cur.text + "\n\n" + next.text;
    } else {
      merged.push({ ...cur, idx: merged.length });
    }
    i++;
  }
  return merged.map((c, idx) => ({ ...c, idx }));
}

/** 拆分过长代码块 */
function splitLongCodeChunk(chunk: TextChunk): TextChunk[] {
  if (chunk.text.length <= CODE_MAX_CHUNK) return [chunk];

  const lines = chunk.text.split("\n");
  const result: TextChunk[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (currentLines.join("\n").length + line.length + 1 > CODE_MAX_CHUNK && currentLines.length > 0) {
      result.push({
        text: currentLines.join("\n").trim(),
        idx: result.length,
        metadata: chunk.metadata,
      });
      // 保留最后几行作为重叠
      const overlapStart = Math.max(0, currentLines.length - CODE_OVERLAP_LINES);
      currentLines = currentLines.slice(overlapStart);
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    const text = currentLines.join("\n").trim();
    if (text) {
      result.push({ text, idx: result.length, metadata: chunk.metadata });
    }
  }

  return result;
}
