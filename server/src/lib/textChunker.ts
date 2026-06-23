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
