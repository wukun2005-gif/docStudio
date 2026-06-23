/**
 * 评估相关类型
 */

/** 5 核心信任度指标 */
export interface TrustMetrics {
  faithfulness: number;      // 事实忠实度 (0-1)
  groundedness: number;      // 有据可查度 (0-1)
  coherence: number;         // 连贯性 (0-1)
  fluency: number;           // 流畅性 (0-1)
  completeness: number;      // 完整性 (0-1)
}

export interface TrustEvaluation {
  id: string;
  runId: string;
  metrics: TrustMetrics;
  createdAt: string;
}

export interface GoldenQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
  expectedSources?: string[];
  category?: string;
  difficulty: "easy" | "medium" | "hard";
  createdAt: string;
}

export interface EvalReport {
  id: string;
  config?: Record<string, unknown>;
  results?: Record<string, unknown>;
  summary?: string;
  createdAt: string;
}

/** 评估指标详情 */
export interface MetricDetail {
  name: string;
  score: number;
  maxScore: number;
  explanation?: string;
}
