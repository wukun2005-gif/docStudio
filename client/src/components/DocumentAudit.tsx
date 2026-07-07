/**
 * DocumentAudit — AI 文档自审 / 压力测试仪表盘（nf3）
 *
 * 文档生成后，展示"红队 AI"对生成内容的审查结果：
 * - 风险雷达图（5 维度：有据可查度/相关度/完整度/一致性/冲突）
 * - 问题卡片列表（严重程度 + 描述 + 建议修正方向）
 * - 一键修正按钮
 *
 * 数据来源：evaluationMetrics（与 UnifiedEvaluationCard 同源）
 * 当 evaluationMetrics 不可用时 fallback 到 DEMO_AUDIT
 */
import { useState, useMemo } from "react";

interface AuditIssue {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  description: string;
  suggestion: string;
}

interface AuditData {
  overallScore: number;
  radarScores: Array<{ dimension: string; score: number; maxScore: number }>;
  issues: AuditIssue[];
}

/** 评估指标 props（与 UnifiedEvaluationCard 同源） */
interface EvalMetricsProps {
  groundedness?: { score: number };
  relevance?: { score: number; irrelevantSentences?: string[] };
  completeness?: { score: number; missingPoints?: string[]; lackSourcePoints?: string[] };
  conflicts?: {
    hasConflicts: boolean;
    conflictRate: number;
    items?: Array<{
      topic: string;
      claims?: Array<{ text: string; source?: string }>;
      severity?: string;
      winnerSource?: string;
      winnerReason?: string;
      status?: string;
    }>;
  };
}

interface Props {
  evaluationMetrics?: EvalMetricsProps | null;
  trustScore?: number | null;
}

/** 从 evaluationMetrics 推导 5 维度雷达图 + 问题列表 */
function deriveAuditData(metrics: EvalMetricsProps | null | undefined, trustScore: number | null): AuditData {
  if (!metrics) {
    return DEMO_AUDIT;
  }

  const groundedness = metrics.groundedness?.score ?? 0;
  const relevance = metrics.relevance?.score ?? 0;
  const completeness = metrics.completeness?.score ?? 0;
  const conflictRate = metrics.conflicts?.conflictRate ?? 0;
  const consistency = 1 - conflictRate; // 一致性 = 1 - 冲突率
  const conflictScore = 1 - conflictRate; // 无冲突维度

  const radarScores = [
    { dimension: "有据可查", score: groundedness, maxScore: 1 },
    { dimension: "内容相关", score: relevance, maxScore: 1 },
    { dimension: "内容完整", score: completeness, maxScore: 1 },
    { dimension: "一致性", score: consistency, maxScore: 1 },
    { dimension: "无冲突", score: conflictScore, maxScore: 1 },
  ];

  const overall = (groundedness + relevance + completeness + consistency + conflictScore) / 5;

  // 构建问题列表
  const issues: AuditIssue[] = [];

  // 1. 未支撑断言
  if (trustScore != null && trustScore < 0.8) {
    issues.push({
      id: "i-unsupported",
      severity: trustScore < 0.5 ? "high" : "medium",
      category: "未支撑断言",
      description: `综合有据可查度仅 ${Math.round(trustScore * 100)}%，部分段落缺少来源支撑。建议拖拽知识源到相关章节并重新生成。`,
      suggestion: "在 Provenance Tree 中拖拽知识源到低分段落，或补充知识源后重新生成。",
    });
  }

  // 2. 无关内容
  if (metrics.relevance?.irrelevantSentences?.length) {
    for (let i = 0; i < metrics.relevance.irrelevantSentences.length; i++) {
      const sentence = metrics.relevance.irrelevantSentences[i];
      issues.push({
        id: `i-irrelevant-${i}`,
        severity: "medium",
        category: "与需求无关",
        description: `与需求无关的内容：${sentence.length > 100 ? sentence.substring(0, 100) + "…" : sentence}`,
        suggestion: "在文档中搜索此句并手动编辑删除或修改。",
      });
    }
  }

  // 3. 未覆盖要点
  if (metrics.completeness?.missingPoints?.length) {
    for (let i = 0; i < metrics.completeness.missingPoints.length; i++) {
      const point = metrics.completeness.missingPoints[i];
      issues.push({
        id: `i-missing-${i}`,
        severity: "high",
        category: "需求要点未覆盖",
        description: `需求要点未覆盖：${point}`,
        suggestion: "补充相关知识源后重新生成。",
      });
    }
  }

  // 4. 缺少来源支撑的要点
  if (metrics.completeness?.lackSourcePoints?.length) {
    for (let i = 0; i < metrics.completeness.lackSourcePoints.length; i++) {
      const point = metrics.completeness.lackSourcePoints[i];
      issues.push({
        id: `i-lacksource-${i}`,
        severity: "medium",
        category: "缺少来源支撑",
        description: `缺少来源支撑：${point}`,
        suggestion: "在知识库中搜索相关文档，拖拽到对应章节后重新生成。",
      });
    }
  }

  // 5. 已拦截冲突
  if (metrics.conflicts?.items?.length) {
    for (let i = 0; i < metrics.conflicts.items.length; i++) {
      const c = metrics.conflicts.items[i];
      const claimsDesc = c.claims?.map(cl => {
        const src = cl.source ? `（${cl.source}）` : "";
        return `"${cl.text?.substring(0, 60) ?? ""}${cl.text && cl.text.length > 60 ? "…" : ""}"${src}`;
      }).join("  vs  ") || "";
      const sev = c.severity === "high" ? "high" : c.severity === "medium" ? "medium" : "low";
      issues.push({
        id: `i-conflict-${i}`,
        severity: sev as "high" | "medium" | "low",
        category: "已拦截冲突",
        description: `拦截冲突：${c.topic}\n${claimsDesc}`,
        suggestion: c.winnerReason
          ? `AI 已判定可信方：${c.winnerSource ?? "未知"}\n理由：${c.winnerReason}`
          : "已自动处理，无需操作。",
      });
    }
  }

  // 6. 如果没有问题
  if (issues.length === 0) {
    issues.push({
      id: "i-ok",
      severity: "low",
      category: "质量良好",
      description: "文档整体质量良好，未发现明显问题。",
      suggestion: "可直接使用或导出。",
    });
  }

  return { overallScore: overall, radarScores, issues };
}

const DEMO_AUDIT: AuditData = {
  overallScore: 0.77,
  radarScores: [
    { dimension: "有据可查", score: 0.65, maxScore: 1 },
    { dimension: "内容相关", score: 1.0, maxScore: 1 },
    { dimension: "内容完整", score: 0.93, maxScore: 1 },
    { dimension: "一致性", score: 0.75, maxScore: 1 },
    { dimension: "无冲突", score: 0.75, maxScore: 1 },
  ],
  issues: [
    {
      id: "i1",
      severity: "high",
      category: "未支撑断言",
      description: "综合有据可查度 65%，部分段落缺少来源支撑。建议拖拽知识源到相关章节并重新生成。",
      suggestion: "在 Provenance Tree 中拖拽知识源到低分段落，或补充知识源后重新生成。",
    },
    {
      id: "i2",
      severity: "medium",
      category: "缺少来源支撑",
      description: "Teams Chat 与 Outlook Email 协作频次分析缺少来源支撑",
      suggestion: "在知识库中搜索相关文档，拖拽到对应章节后重新生成。",
    },
    {
      id: "i3",
      severity: "high",
      category: "已拦截冲突",
      description: `拦截冲突：Q3 团队总 Commit 数\n「Q3 总 Commit 数:2,553 次」（14-陈强-团队-Q3代码生产力周报.eml）  vs  「Q3 合计提交 1,096 次」（Q3-GitHub 开发活跃度报告.docx）`,
      suggestion: `AI 已判定可信方：14-陈强-团队-Q3代码生产力周报.eml\n理由：两数据差异显著，团队周报明确限定「技术部核心 8 人」，数据更聚焦、可解释性强`,
    },
    {
      id: "i4",
      severity: "medium",
      category: "已拦截冲突",
      description: `拦截冲突：Beta 版本发布时间\n「7 月: Beta 版本发布」（产品路线图-Q3-2026.pptx）  vs  「Sprint 3 未完成 Beta 前置条件」（10-陈强-团队-本周总结.eml）`,
      suggestion: `AI 已判定可信方：10-陈强-团队-本周总结.eml\n理由：该周报为一线技术负责人实绩反馈，明确指出 Sprint 3 仍未完成性能/安全测试等 Beta 关键前置条件`,
    },
    {
      id: "i5",
      severity: "medium",
      category: "已拦截冲突",
      description: `拦截冲突：支付接口重构上线时间\n「上线时间 2026 年 9 月 10 日」（Q3-技术架构演进报告.docx）  vs  「Sprint 3 仅完成方案初稿」（10-陈强-团队-本周总结.eml）`,
      suggestion: `AI 已判定可信方：Q3-技术架构演进报告.docx\n理由：技术报告明确记录上线时间、负责人及性能指标提升，属已完成事实`,
    },
  ],
};

/** 简易 SVG 雷达图 */
function RadarChart({
  scores,
  size = 200,
}: {
  scores: Array<{ dimension: string; score: number; maxScore: number }>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.35;
  const angleStep = (2 * Math.PI) / scores.length;

  const getPoint = (index: number, value: number, max: number) => {
    const ratio = value / max;
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: cx + radius * ratio * Math.cos(angle),
      y: cy + radius * ratio * Math.sin(angle),
    };
  };

  const gridLines = [0.2, 0.4, 0.6, 0.8, 1.0].map((r) => {
    const pts = scores
      .map((_, i) => {
        const a = angleStep * i - Math.PI / 2;
        return `${cx + radius * r * Math.cos(a)},${cy + radius * r * Math.sin(a)}`;
      })
      .join(" ");
    return <polygon key={r} points={pts} fill="none" stroke="#e5e7eb" strokeWidth="1" />;
  });

  const dataPoints = scores.map((s, i) => {
    const p = getPoint(i, s.score, s.maxScore);
    return `${p.x},${p.y}`;
  });

  const labelPoints = scores.map((_, i) => {
    const a = angleStep * i - Math.PI / 2;
    return {
      x: cx + (radius + 20) * Math.cos(a),
      y: cy + (radius + 20) * Math.sin(a),
      label: scores[i].dimension,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {gridLines}
      {/* 轴线 */}
      {scores.map((_, i) => {
        const a = angleStep * i - Math.PI / 2;
        return (
          <line
            key={`axis-${i}`}
            x1={cx}
            y1={cy}
            x2={cx + radius * Math.cos(a)}
            y2={cy + radius * Math.sin(a)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        );
      })}
      {/* 数据区域 */}
      <polygon
        points={dataPoints.join(" ")}
        fill="rgba(99,102,241,0.2)"
        stroke="#6366f1"
        strokeWidth="2"
      />
      {/* 数据点 */}
      {scores.map((s, i) => {
        const p = getPoint(i, s.score, s.maxScore);
        return (
          <circle key={`dot-${i}`} cx={p.x} cy={p.y} r="4" fill="#6366f1" />
        );
      })}
      {/* 标签 */}
      {labelPoints.map((lp, i) => (
        <text
          key={`lbl-${i}`}
          x={lp.x}
          y={lp.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="#6b7280"
        >
          {lp.label.length > 10 ? lp.label.slice(0, 10) : lp.label}
        </text>
      ))}
    </svg>
  );
}

function severityBadge(severity: "high" | "medium" | "low") {
  const map = {
    high: { bg: "bg-red-100", text: "text-red-700", label: "高" },
    medium: { bg: "bg-yellow-100", text: "text-yellow-700", label: "中" },
    low: { bg: "bg-blue-100", text: "text-blue-700", label: "低" },
  };
  const m = map[severity];
  return (
    <span className={`${m.bg} ${m.text} px-1.5 py-0.5 rounded text-[10px] font-medium`}>
      {m.label}
    </span>
  );
}

export default function DocumentAudit({ evaluationMetrics, trustScore }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState(false);

  const auditData = useMemo(
    () => deriveAuditData(evaluationMetrics, trustScore ?? null),
    [evaluationMetrics, trustScore],
  );

  const toggleIssue = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFix = () => {
    setFixing(true);
    setTimeout(() => {
      setFixing(false);
      setDone(true);
    }, 3000);
  };

  return (
    <div className="border rounded-lg bg-white overflow-hidden" id="demo-audit-panel">
      {/* 头部 */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">🔍 AI 文档自审 / 压力测试</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            综合评分 {auditData.overallScore.toFixed(2)} &middot; {auditData.issues.length} 个审查问题
          </p>
        </div>
        {done && (
          <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            修正完成
          </span>
        )}
      </div>

      {/* 仪表盘主体 */}
      <div className="flex flex-wrap">
        {/* 雷达图 */}
        <div className="p-4 flex items-center justify-center border-r" style={{ minWidth: 220 }}>
          <RadarChart scores={auditData.radarScores} size={200} />
        </div>

        {/* 问题卡片列表 */}
        <div className="flex-1 p-3 max-h-[360px] overflow-y-auto min-w-[280px]">
          <div className="text-[11px] font-medium text-gray-600 mb-2">审查问题列表</div>
          <div className="space-y-2">
            {auditData.issues.map((issue) => (
              <div
                key={issue.id}
                className="border rounded-lg overflow-hidden transition-colors hover:border-gray-400"
              >
                <button
                  onClick={() => toggleIssue(issue.id)}
                  className="w-full px-3 py-2 flex items-start gap-2 text-left text-xs"
                >
                  {severityBadge(issue.severity)}
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {issue.category}
                  </span>
                  <span className="flex-1 text-gray-700 line-clamp-2">
                    {issue.description.slice(0, 80)}...
                  </span>
                  <span className="text-gray-400 text-[10px] shrink-0">
                    {expanded.has(issue.id) ? "▲" : "▼"}
                  </span>
                </button>
                {expanded.has(issue.id) && (
                  <div className="px-3 pb-2 border-t bg-gray-50">
                    <p className="text-[11px] text-gray-600 mt-2 whitespace-pre-line">{issue.description}</p>
                    <p className="text-[11px] text-indigo-600 mt-1 border-l-2 border-indigo-300 pl-2">
                      💡 {issue.suggestion}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 一键修正 */}
      <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
        <span className="text-[11px] text-gray-500">
          {done ? "✅ 所有问题已提示修正方向" : "AI 发现问题，建议逐一修正或一键批量修正"}
        </span>
        <button
          id="demo-audit-fix"
          onClick={handleFix}
          disabled={fixing || done}
          className={`px-4 py-1.5 rounded text-xs font-medium transition-all ${
            done
              ? "bg-green-100 text-green-700 cursor-default"
              : fixing
                ? "bg-indigo-100 text-indigo-400 cursor-wait"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          {fixing ? "正在修正..." : done ? "已完成" : "🔧 一键修正"}
        </button>
      </div>
    </div>
  );
}
