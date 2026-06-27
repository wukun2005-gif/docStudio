import { useEffect, useState } from "react";

interface TrustMetrics {
  faithfulness: number;
  groundedness: number;
  coherence: number;
  fluency: number;
  completeness: number;
}

interface TrustReportProps {
  runId: string;
  onOptimize?: (lowScoreSections: string[]) => void;
}

const METRIC_LABELS: Record<keyof TrustMetrics, { label: string; description: string }> = {
  faithfulness: { label: "内容忠实度", description: "内容与来源一致的比例（允许改写和综合）" },
  groundedness: { label: "内容可信度", description: "整体可信度评估（含连贯性、流畅性等维度）" },
  coherence: { label: "连贯性", description: "结构是否清晰，逻辑是否连贯" },
  fluency: { label: "流畅性", description: "语言是否流畅准确" },
  completeness: { label: "完整性", description: "是否覆盖了必要信息" },
};

export default function TrustReport({ runId, onOptimize }: TrustReportProps) {
  const [metrics, setMetrics] = useState<TrustMetrics | null>(null);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  useEffect(() => {
    loadEvaluation();
  }, [runId]);

  async function loadEvaluation() {
    setLoading(true);
    try {
      const res = await fetch(`/api/evaluation/${runId}`);
      const data = await res.json();
      if (data.ok && data.evaluations.length > 0) {
        const latest = data.evaluations[0];
        const m = JSON.parse(latest.metrics);
        setMetrics(m);
        // 使用服务端计算的 trustScore，不在客户端重复计算
        setTrustScore(latest.trustScore ?? null);
      }
    } catch (err) {
      console.error("Failed to load evaluation:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      const res = await fetch("/api/evaluation/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (data.ok) {
        setMetrics(data.metrics);
        setTrustScore(data.trustScore);
      }
    } catch (err) {
      console.error("Evaluation failed:", err);
    } finally {
      setEvaluating(false);
    }
  }

  function getScoreColor(score: number): string {
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.5) return "text-yellow-600";
    return "text-red-600";
  }

  function getScoreBg(score: number): string {
    if (score >= 0.8) return "bg-green-100";
    if (score >= 0.5) return "bg-yellow-100";
    return "bg-red-100";
  }

  if (loading) {
    return <div className="text-center py-4 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 综合分数 */}
      <div className="text-center p-4 bg-white rounded-lg border">
        <div className="text-4xl font-bold mb-1">
          {trustScore !== null ? (
            <span className={getScoreColor(trustScore)}>{(trustScore * 100).toFixed(0)}%</span>
          ) : (
            <span className="text-gray-400">--</span>
          )}
        </div>
        <div className="text-sm text-gray-500">综合质量分</div>
        {!metrics && (
          <button
            onClick={handleEvaluate}
            disabled={evaluating}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {evaluating ? "评估中..." : "开始评估"}
          </button>
        )}
      </div>

      {/* 分项指标 */}
      {metrics && (
        <div className="space-y-2">
          {Object.entries(METRIC_LABELS).map(([key, { label, description }]) => {
            const score = metrics[key as keyof TrustMetrics];
            return (
              <div key={key} className="bg-white rounded-lg border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className={`text-sm font-bold ${getScoreColor(score)}`}>
                    {(score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getScoreBg(score)}`}
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">{description}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* 优化建议（Feature #21） */}
      {metrics && trustScore !== null && trustScore < 0.8 && onOptimize && (
        <button
          onClick={() => onOptimize([])}
          className="w-full px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200"
        >
          💡 查看优化建议
        </button>
      )}
    </div>
  );
}
