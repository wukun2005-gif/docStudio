/**
 * Golden Set Generator — 自动生成评估集
 *
 * Feature #37: 自动生成问题 + 期望答案
 *
 * 从知识库中采样 chunk，调用 LLM 生成问题和期望答案，
 * 存入 golden_set 表，用于离线评估。
 */
import crypto from "crypto";
import { getDb } from "./db.js";
import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { getAllSources, getChunksBySourceId } from "./knowledgeDb.js";

// ── Types ──────────────────────────────────────────────

export interface GoldenQuestion {
  id: string;
  query: string;
  expectedAnswer: string;
  expectedSources: string[];
  mustIncludeFacts: string[];
  expectedSource: "kb_only" | "web_only" | "cross_source" | "no_answer";
  category: string;
  difficulty: "easy" | "medium" | "hard";
  generatedBy: string;
}

// ── Matrix Allocation ──────────────────────────────────

interface MatrixCell {
  expectedSource: GoldenQuestion["expectedSource"];
  category: string;
}

const ALL_CELLS: MatrixCell[] = [
  { expectedSource: "kb_only", category: "weekly_report" },
  { expectedSource: "kb_only", category: "research_report" },
  { expectedSource: "kb_only", category: "meeting_notes" },
  { expectedSource: "kb_only", category: "product_spec" },
  { expectedSource: "cross_source", category: "weekly_report" },
  { expectedSource: "cross_source", category: "research_report" },
  { expectedSource: "no_answer", category: "weekly_report" },
  { expectedSource: "no_answer", category: "research_report" },
];

function buildMatrixAllocation(providerCount: number, questionCount?: number): MatrixCell[][] {
  let cells = ALL_CELLS;
  if (questionCount && questionCount > 0 && questionCount !== ALL_CELLS.length) {
    if (questionCount < ALL_CELLS.length) {
      const step = ALL_CELLS.length / questionCount;
      cells = Array.from({ length: questionCount }, (_, i) => ALL_CELLS[Math.floor(i * step)]!);
    } else {
      cells = [];
      while (cells.length < questionCount) {
        for (const cell of ALL_CELLS) {
          if (cells.length >= questionCount) break;
          cells.push(cell);
        }
      }
    }
  }

  const allocation: MatrixCell[][] = Array.from({ length: providerCount }, () => []);
  for (let i = 0; i < cells.length; i++) {
    allocation[i % providerCount]!.push(cells[i]!);
  }
  return allocation;
}

// ── Chunk Sampling ─────────────────────────────────────

function sampleChunks(count: number): Array<{ content: string; sourceName: string; sourceId: string }> {
  const sources = getAllSources();
  if (sources.length === 0) return [];

  const results: Array<{ content: string; sourceName: string; sourceId: string }> = [];
  const chunksPerSource = Math.max(1, Math.ceil(count / sources.length));

  for (const source of sources) {
    const chunks = getChunksBySourceId(source.id);
    const selected = chunks
      .filter(c => c.content.length > 100)
      .slice(0, chunksPerSource);

    for (const chunk of selected) {
      results.push({
        content: chunk.content,
        sourceName: source.name,
        sourceId: source.id,
      });
    }
  }

  // Shuffle
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [results[i], results[j]] = [results[j]!, results[i]!];
  }

  return results.slice(0, count);
}

// ── LLM Call ───────────────────────────────────────────

interface GeneratedQuestion {
  query: string;
  expected_answer: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  must_include_facts: string[];
}

function buildPrompt(cell: MatrixCell, chunks: Array<{ content: string; sourceName: string }>): string {
  const contextBlock = chunks.map((c, i) =>
    `文档${i + 1} [${c.sourceName}]:\n${c.content.slice(0, 500)}`
  ).join("\n\n");

  const sourceHint = cell.expectedSource === "no_answer"
    ? "⚠️ 这是一个「无法回答」类问题：请生成一个当前知识库无法可靠回答的问题。"
    : cell.expectedSource === "cross_source"
      ? "⚠️ 这是一个需要跨文档综合的问题。"
      : "";

  return `你是文档评估集生成器。请基于以下知识库内容，生成一个用于测试文档生成质量的问题。

文档类型：${cell.category}
来源类型：${cell.expectedSource}
${sourceHint}

知识库内容：
${contextBlock}

要求：
1. 问题应该是用户在实际工作中会提出的真实问题
2. 参考答案应完整准确（200-500字）
3. 列出答案必须包含的 3-8 个关键事实点
4. 难度根据问题的复杂度判断（easy/medium/hard）

请严格输出以下 JSON 格式，不要输出其他内容：
{
  "query": "用户问题",
  "expected_answer": "完整参考答案（200-500字）",
  "difficulty": "easy|medium|hard",
  "must_include_facts": ["事实1", "事实2", "事实3"]
}`;
}

async function callLLM(
  providerId: string,
  modelId: string,
  apiKey: string,
  prompt: string,
): Promise<GeneratedQuestion | null> {
  try {
    const result = await registry.runWithFallback(
      [providerId],
      {
        modelId,
        messages: [
          { role: "system", content: "你是文档评估集生成助手。严格输出 JSON，不要输出其他内容。" },
          { role: "user", content: prompt },
        ],
        apiKey,
        temperature: 0.7,
        maxTokens: 1024,
      },
      { [providerId]: apiKey },
    );

    if (result.response.error) {
      logger.warn(`[GoldenSet] LLM error: ${result.response.error.message}`);
      return null;
    }

    const text = result.response.text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]!) as Record<string, unknown>;
    const query = typeof parsed.query === "string" ? parsed.query : "";
    const expected_answer = typeof parsed.expected_answer === "string" ? parsed.expected_answer : "";
    if (!query || !expected_answer) return null;

    const difficulty = typeof parsed.difficulty === "string" ? parsed.difficulty : "medium";
    const validDifficulties = ["easy", "medium", "hard"];

    const must_include_facts = Array.isArray(parsed.must_include_facts)
      ? (parsed.must_include_facts as unknown[]).filter((f): f is string => typeof f === "string")
      : [];

    return {
      query,
      expected_answer,
      category: "",
      difficulty: validDifficulties.includes(difficulty) ? difficulty as "easy" | "medium" | "hard" : "medium",
      must_include_facts,
    };
  } catch (err) {
    logger.warn(`[GoldenSet] LLM call failed: ${err}`);
    return null;
  }
}

// ── Database ───────────────────────────────────────────

function insertGoldenQuestion(q: GoldenQuestion): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO golden_set
      (id, question, expected_answer, expected_sources, category, difficulty)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    q.id,
    q.query,
    q.expectedAnswer,
    JSON.stringify(q.expectedSources),
    q.category,
    q.difficulty,
  );
}

// ── Public API ─────────────────────────────────────────

export async function generateGoldenSet(
  providerId: string,
  modelId: string,
  apiKey: string,
  questionCount: number = 8,
): Promise<GoldenQuestion[]> {
  const allocation = buildMatrixAllocation(1, questionCount);
  const cells = allocation[0] ?? [];
  if (cells.length === 0) return [];

  logger.info(`[GoldenSet] Generating ${cells.length} questions`);

  const results: GoldenQuestion[] = [];

  for (const cell of cells) {
    const chunks = sampleChunks(3);
    if (chunks.length === 0) {
      logger.warn("[GoldenSet] No chunks available, skipping");
      continue;
    }

    const prompt = buildPrompt(cell, chunks);
    const generated = await callLLM(providerId, modelId, apiKey, prompt);
    if (!generated) continue;

    const question: GoldenQuestion = {
      id: `gs-${crypto.randomUUID().slice(0, 8)}`,
      query: generated.query,
      expectedAnswer: generated.expected_answer,
      expectedSources: chunks.map(c => c.sourceName),
      mustIncludeFacts: generated.must_include_facts,
      expectedSource: cell.expectedSource,
      category: cell.category,
      difficulty: generated.difficulty,
      generatedBy: `${providerId}/${modelId}`,
    };

    insertGoldenQuestion(question);
    results.push(question);
  }

  logger.info(`[GoldenSet] Generated ${results.length}/${cells.length} questions`);
  return results;
}

export function getGoldenSet(): GoldenQuestion[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, question, expected_answer, expected_sources, category, difficulty FROM golden_set ORDER BY created_at"
  ).all() as Array<{
    id: string;
    question: string;
    expected_answer: string;
    expected_sources: string;
    category: string;
    difficulty: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    query: r.question,
    expectedAnswer: r.expected_answer,
    expectedSources: safeParseJson(r.expected_sources, []),
    mustIncludeFacts: [],
    expectedSource: "kb_only" as const,
    category: r.category,
    difficulty: r.difficulty as "easy" | "medium" | "hard",
    generatedBy: "unknown",
  }));
}

export function getGoldenSetStats(): { total: number; byCategory: Record<string, number>; byDifficulty: Record<string, number> } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM golden_set").get() as { c: number }).c;

  const categoryRows = db.prepare("SELECT category, COUNT(*) as c FROM golden_set GROUP BY category").all() as Array<{ category: string; c: number }>;
  const byCategory: Record<string, number> = {};
  for (const r of categoryRows) byCategory[r.category] = r.c;

  const difficultyRows = db.prepare("SELECT difficulty, COUNT(*) as c FROM golden_set GROUP BY difficulty").all() as Array<{ difficulty: string; c: number }>;
  const byDifficulty: Record<string, number> = {};
  for (const r of difficultyRows) byDifficulty[r.difficulty] = r.c;

  return { total, byCategory, byDifficulty };
}

export function clearGoldenSet(): void {
  const db = getDb();
  db.prepare("DELETE FROM golden_set").run();
  logger.info("[GoldenSet] Cleared golden set");
}

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
