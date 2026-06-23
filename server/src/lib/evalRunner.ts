/**
 * Offline Evaluation Runner — 离线评估运行器
 *
 * Feature #39: 10+ 指标评估
 * Feature #40: 评估报告管理
 *
 * 对 Golden Set 中的每个问题运行 RAG pipeline，
 * 计算检索质量和生成质量指标，生成评估报告。
 */
import crypto from "crypto";
import { getDb } from "./db.js";
import { logger } from "./logger.js";
import { getGoldenSet, type GoldenQuestion } from "./goldenSetGenerator.js";
import { hybridSearch, type SearchResult } from "./hybridSearch.js";
import { registry } from "../providers/registry.js";
import { multiJudgeContinuous, parseScoreFromText } from "./multiJudge.js";

// ── Types ──────────────────────────────────────────────

export interface EvalConfig {
  label: string;
  providerId: string;
  modelId: string;
}

export interface EvalResult {
  goldenId: string;
  query: string;
  configLabel: string;
  recallAtK: number;
  ndcgAtK: number;
  faithfulness: number;
  groundedness: number;
  coherence: number;
  fluency: number;
  completeness: number;
  answerCorrectness: number;
  factCoverage: number;
  durationMs: number;
  actualAnswer: string;
  error?: string;
}

export interface EvalReport {
  runId: string;
  timestamp: string;
  configs: EvalConfigSummary[];
  questionCount: number;
  questionBreakdown: EvalResult[];
  durationMs?: number;
}

export interface EvalConfigSummary {
  label: string;
  avgRecall: number;
  avgNdcg: number;
  avgFaithfulness: number;
  avgGroundedness: number;
  avgCoherence: number;
  avgFluency: number;
  avgCompleteness: number;
  avgAnswerCorrectness: number;
  avgFactCoverage: number;
  avgDurationMs: number;
  passRate: number;
}

// ── Golden Set Loading ─────────────────────────────────

function loadGoldenQuestions(): GoldenQuestion[] {
  return getGoldenSet();
}

// ── RAG Pipeline ───────────────────────────────────────

async function runRAGQuery(
  query: string,
  config: EvalConfig,
  apiKey: string,
): Promise<{ answer: string; sources: string[]; durationMs: number }> {
  const startMs = Date.now();

  try {
    // 1. Hybrid Search (includes query expansion)
    const searchResults = hybridSearch(query, { limit: 5 });

    // 2. Generate answer via LLM
    const context = searchResults.map(r => r.content).join("\n\n");
    const sourceIds = searchResults.map(r => r.sourceId ?? "unknown");

    const result = await registry.runWithFallback(
      [config.providerId],
      {
        modelId: config.modelId,
        messages: [
          {
            role: "system",
            content: "你是文档生成助手。基于提供的知识库内容回答用户问题。回答要准确、完整，基于提供的内容。如果知识库中没有相关信息，请明确说明。",
          },
          {
            role: "user",
            content: `知识库内容：\n${context}\n\n用户问题：${query}`,
          },
        ],
        apiKey,
        maxTokens: 2000,
        temperature: 0.3,
      },
      { [config.providerId]: apiKey },
    );

    const durationMs = Date.now() - startMs;

    if (result.response.error) {
      return { answer: "", sources: [], durationMs };
    }

    return {
      answer: result.response.text,
      sources: sourceIds,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    logger.warn(`[EvalRunner] RAG query failed: ${err}`);
    return { answer: "", sources: [], durationMs };
  }
}

// ── Metric Computation ─────────────────────────────────

async function computeFaithfulness(
  answer: string,
  context: string,
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer || !context) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。评估生成的回答是否基于提供的知识库内容。输出 JSON: {\"score\": 0-1}",
      user: `知识库内容：\n${context}\n\n生成的回答：\n${answer}\n\n请评估回答的 Faithfulness（基于知识库内容的程度），输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

async function computeCoherence(
  answer: string,
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。评估文档的逻辑连贯性。输出 JSON: {\"score\": 0-1}",
      user: `文档内容：\n${answer}\n\n请评估文档的 Coherence（逻辑连贯性），输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

async function computeFluency(
  answer: string,
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。评估文档的语言流畅度。输出 JSON: {\"score\": 0-1}",
      user: `文档内容：\n${answer}\n\n请评估文档的 Fluency（语言流畅度），输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

async function computeCompleteness(
  answer: string,
  query: string,
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer || !query) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。评估文档对用户问题的完整回答程度。输出 JSON: {\"score\": 0-1}",
      user: `用户问题：${query}\n\n生成的回答：\n${answer}\n\n请评估回答的 Completeness（完整度），输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

async function computeAnswerCorrectness(
  answer: string,
  expectedAnswer: string,
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer || !expectedAnswer) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。对比生成的回答和期望回答的正确性。输出 JSON: {\"score\": 0-1}",
      user: `期望回答：\n${expectedAnswer}\n\n生成的回答：\n${answer}\n\n请评估生成回答与期望回答的一致性，输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

async function computeFactCoverage(
  answer: string,
  facts: string[],
  judgeApiKeys: Record<string, string>,
): Promise<number> {
  if (!answer || facts.length === 0) return 0;

  const result = await multiJudgeContinuous(
    {
      system: "你是文档质量评估专家。评估回答覆盖了多少关键事实点。输出 JSON: {\"score\": 0-1}",
      user: `关键事实点：\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n生成的回答：\n${answer}\n\n请评估回答覆盖了多少关键事实点，输出 0-1 的分数。`,
    },
    judgeApiKeys,
    parseScoreFromText,
  );

  return result.aggregated;
}

// ── Report Building ────────────────────────────────────

function buildReport(
  runId: string,
  configs: EvalConfig[],
  questionCount: number,
  results: EvalResult[],
): EvalReport {
  const configSummaries: EvalConfigSummary[] = configs.map((config) => {
    const configResults = results.filter((r) => r.configLabel === config.label);
    const successResults = configResults.filter((r) => !r.error);

    return {
      label: config.label,
      avgRecall: avg(successResults.map(r => r.recallAtK)),
      avgNdcg: avg(successResults.map(r => r.ndcgAtK)),
      avgFaithfulness: avg(successResults.map(r => r.faithfulness)),
      avgGroundedness: avg(successResults.map(r => r.groundedness)),
      avgCoherence: avg(successResults.map(r => r.coherence)),
      avgFluency: avg(successResults.map(r => r.fluency)),
      avgCompleteness: avg(successResults.map(r => r.completeness)),
      avgAnswerCorrectness: avg(successResults.map(r => r.answerCorrectness)),
      avgFactCoverage: avg(successResults.map(r => r.factCoverage)),
      avgDurationMs: avg(configResults.map(r => r.durationMs)),
      passRate: configResults.length > 0
        ? configResults.filter(r => r.faithfulness > 0.7).length / configResults.length
        : 0,
    };
  });

  return {
    runId,
    timestamp: new Date().toISOString(),
    configs: configSummaries,
    questionCount,
    questionBreakdown: results,
  };
}

// ── Database Persistence ───────────────────────────────

function saveReport(report: EvalReport): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO eval_reports (id, config, results, summary, created_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    report.runId,
    JSON.stringify(report.configs),
    JSON.stringify(report.questionBreakdown),
    JSON.stringify({
      questionCount: report.questionCount,
      durationMs: report.durationMs,
    }),
  );
  logger.info(`[EvalRunner] Saved report ${report.runId}`);
}

// ── Public API ─────────────────────────────────────────

export async function runEvaluation(
  configs: EvalConfig[],
  options?: {
    judgeApiKeys?: Record<string, string>;
    onProgress?: (current: number, total: number, phase: string) => void;
  }
): Promise<EvalReport> {
  const judgeApiKeys = options?.judgeApiKeys ?? {};
  const questions = loadGoldenQuestions();

  if (questions.length === 0) {
    logger.warn("[EvalRunner] No golden questions found");
    const now = new Date();
    const runId = `eval-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    return {
      runId,
      timestamp: now.toISOString(),
      configs: configs.map(c => ({
        label: c.label,
        avgRecall: 0, avgNdcg: 0, avgFaithfulness: 0, avgGroundedness: 0,
        avgCoherence: 0, avgFluency: 0, avgCompleteness: 0,
        avgAnswerCorrectness: 0, avgFactCoverage: 0, avgDurationMs: 0, passRate: 0,
      })),
      questionCount: 0,
      questionBreakdown: [],
    };
  }

  logger.info(`[EvalRunner] Starting evaluation: ${configs.length} configs x ${questions.length} questions`);

  const allResults: EvalResult[] = [];
  const now = new Date();
  const runId = `eval-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const startMs = Date.now();

  for (const config of configs) {
    const apiKey = judgeApiKeys[config.providerId] ?? "";
    if (!apiKey) {
      logger.warn(`[EvalRunner] No API key for ${config.providerId}, skipping`);
      continue;
    }

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]!;
      options?.onProgress?.(i + 1, questions.length, `评估 ${config.label}`);

      try {
        // Run RAG pipeline
        const ragResult = await runRAGQuery(question.query, config, apiKey);

        // Compute metrics
        const faithfulness = await computeFaithfulness(ragResult.answer, ragResult.answer, judgeApiKeys);
        const coherence = await computeCoherence(ragResult.answer, judgeApiKeys);
        const fluency = await computeFluency(ragResult.answer, judgeApiKeys);
        const completeness = await computeCompleteness(ragResult.answer, question.query, judgeApiKeys);
        const answerCorrectness = await computeAnswerCorrectness(ragResult.answer, question.expectedAnswer, judgeApiKeys);
        const factCoverage = await computeFactCoverage(ragResult.answer, question.mustIncludeFacts, judgeApiKeys);

        const result: EvalResult = {
          goldenId: question.id,
          query: question.query,
          configLabel: config.label,
          recallAtK: 0, // 需要实际检索结果计算
          ndcgAtK: 0,
          faithfulness,
          groundedness: faithfulness, // 简化：groundedness ≈ faithfulness
          coherence,
          fluency,
          completeness,
          answerCorrectness,
          factCoverage,
          durationMs: ragResult.durationMs,
          actualAnswer: ragResult.answer.slice(0, 2000),
        };

        allResults.push(result);
        logger.info(`[EvalRunner] Q=${question.id} faith=${faithfulness.toFixed(2)} coh=${coherence.toFixed(2)} ${ragResult.durationMs}ms`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        allResults.push({
          goldenId: question.id,
          query: question.query,
          configLabel: config.label,
          recallAtK: 0, ndcgAtK: 0, faithfulness: 0, groundedness: 0,
          coherence: 0, fluency: 0, completeness: 0,
          answerCorrectness: 0, factCoverage: 0,
          durationMs: 0,
          actualAnswer: "",
          error: errorMsg,
        });
      }
    }
  }

  const report = buildReport(runId, configs, questions.length, allResults);
  report.durationMs = Date.now() - startMs;

  saveReport(report);
  logger.info(`[EvalRunner] Evaluation complete: ${allResults.length} results, report=${report.runId}`);
  return report;
}

export function getReports(): EvalReport[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, config, results, summary FROM eval_reports ORDER BY created_at DESC"
  ).all() as Array<{
    id: string;
    config: string;
    results: string;
    summary: string;
  }>;

  return rows.map(r => {
    const configs = safeParseJson<EvalConfigSummary[]>(r.config, []);
    const results = safeParseJson<EvalResult[]>(r.results, []);
    const summary = safeParseJson<{ questionCount?: number; durationMs?: number }>(r.summary, {});

    return {
      runId: r.id,
      timestamp: r.id.replace("eval-", ""),
      configs,
      questionCount: summary.questionCount ?? 0,
      questionBreakdown: results,
      durationMs: summary.durationMs,
    };
  });
}

export function getReportById(runId: string): EvalReport | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, config, results, summary FROM eval_reports WHERE id = ?"
  ).get(runId) as {
    id: string;
    config: string;
    results: string;
    summary: string;
  } | undefined;

  if (!row) return null;

  const configs = safeParseJson<EvalConfigSummary[]>(row.config, []);
  const results = safeParseJson<EvalResult[]>(row.results, []);
  const summary = safeParseJson<{ questionCount?: number; durationMs?: number }>(row.summary, {});

  return {
    runId: row.id,
    timestamp: row.id.replace("eval-", ""),
    configs,
    questionCount: summary.questionCount ?? 0,
    questionBreakdown: results,
    durationMs: summary.durationMs,
  };
}

export function deleteReport(runId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM eval_reports WHERE id = ?").run(runId);
  return result.changes > 0;
}

// ── Helpers ────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
