/**
 * Metrics Collector — 运行时指标记录器
 *
 * 每次文档生成/评估产生一条指标记录，
 * 用于历史趋势分析和质量洞察。
 */
import crypto from "crypto";
import { localIso } from "../../../shared/src/datetime.js";
import { dbRun, dbGet, dbAll } from "./dbQuery.js";
import { logger } from "./logger.js";

export interface MetricsRecord {
  id: string;
  type: "generation" | "evaluation" | "search";
  providerId: string;
  modelId: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  errorType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

class MetricsCollector {
  record(data: Omit<MetricsRecord, "id" | "createdAt">): void {
    try {
      const id = crypto.randomUUID();
      const now = localIso();

      dbRun(`
        INSERT INTO generation_runs (id, title, config, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
      `, [
        id,
        `[${data.type}] ${data.providerId}/${data.modelId}`,
        JSON.stringify({
          type: data.type,
          providerId: data.providerId,
          modelId: data.modelId,
          durationMs: data.durationMs,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          success: data.success,
          errorType: data.errorType,
          ...data.metadata,
        }),
        data.success ? "done" : "error",
      ], { table: "generation_runs", recordId: id, source: "metrics" });
    } catch (err) {
      // Fire-and-forget: never throw, just log
      logger.warn(`[MetricsCollector] Failed to record: ${err}`);
    }
  }

  getRecent(limit: number = 50): MetricsRecord[] {
    const rows = dbAll<{
      id: string;
      title: string;
      config: string;
      status: string;
      created_at: string;
    }>("SELECT id, title, config, status, created_at FROM generation_runs ORDER BY created_at DESC LIMIT ?", [limit]);

    return rows.map(r => {
      const config = safeParseJson<Record<string, unknown>>(r.config, {});
      return {
        id: r.id,
        type: (config.type as string ?? "generation") as MetricsRecord["type"],
        providerId: (config.providerId as string) ?? "unknown",
        modelId: (config.modelId as string) ?? "unknown",
        durationMs: (config.durationMs as number) ?? 0,
        inputTokens: (config.inputTokens as number) ?? 0,
        outputTokens: (config.outputTokens as number) ?? 0,
        success: r.status === "done",
        errorType: config.errorType as string | undefined,
        metadata: config,
        createdAt: r.created_at,
      };
    });
  }

  getStats(): {
    totalGenerations: number;
    successRate: number;
    avgDurationMs: number;
    byProvider: Record<string, number>;
  } {
    const total = (dbGet<{ c: number }>("SELECT COUNT(*) as c FROM generation_runs")!).c;
    const success = (dbGet<{ c: number }>("SELECT COUNT(*) as c FROM generation_runs WHERE status = 'done'")!).c;
    const avgDuration = (dbGet<{ avg_dur: number | null }>(
      "SELECT AVG(CAST(json_extract(config, '$.durationMs') AS REAL)) as avg_dur FROM generation_runs WHERE config IS NOT NULL"
    )!)?.avg_dur ?? 0;

    const providerRows = dbAll<{ provider: string; c: number }>(
      "SELECT json_extract(config, '$.providerId') as provider, COUNT(*) as c FROM generation_runs WHERE config IS NOT NULL GROUP BY provider"
    );
    const byProvider: Record<string, number> = {};
    for (const r of providerRows) {
      if (r.provider) byProvider[r.provider] = r.c;
    }

    return {
      totalGenerations: total,
      successRate: total > 0 ? success / total : 0,
      avgDurationMs: avgDuration,
      byProvider,
    };
  }
}

export const metricsCollector = new MetricsCollector();

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
