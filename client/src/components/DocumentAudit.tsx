/**
 * DocumentAudit — AI 文档自审 / 压力测试仪表盘（nf3）
 *
 * 文档生成后，展示"红队 AI"对生成内容的审查结果：
 * - 风险雷达图（5 维度：有据可查度/相关度/完整度/一致性/冲突）
 * - 问题卡片列表（严重程度 + 描述 + 建议修正方向）
 * - 一键修正按钮
 *
 * Demo 阶段：hardcoded fixture 数据
 */
import { useState } from "react";

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

const DEMO_AUDIT: AuditData = {
  overallScore: 0.82,
  radarScores: [
    { dimension: "Groundedness", score: 0.89, maxScore: 1 },
    { dimension: "Relevance", score: 0.92, maxScore: 1 },
    { dimension: "Completeness", score: 0.78, maxScore: 1 },
    { dimension: "Consistency", score: 0.85, maxScore: 1 },
    { dimension: "Conflict", score: 0.93, maxScore: 1 },
  ],
  issues: [
    {
      id: "i1",
      severity: "high",
      category: "遗漏视角",
      description:
        "技术债务治理体系章节缺少具体的 debt 指标和量化数据，仅描述了目标未展示当前债务基线。建议补充 Q3 初期的技术债务评估报告数据。",
      suggestion: "从知识库中检索 '技术债务评估报告' 并引用具体 debt score 和趋势数据。",
    },
    {
      id: "i2",
      severity: "medium",
      category: "未支撑断言",
      description:
        ""数据驱动的决策优于直觉判断" 这一结论没有引用具体的 Benchmark 对比数据作为支撑。建议在 Q3 决策评估章节中补充至少一组数据对比。",
      suggestion: "将决策评估的定量数据（如 8.7/10 评分）显式关联到来源文档的具体数据点。",
    },
    {
      id: "i3",
      severity: "medium",
      category: "逻辑漏洞",
      description:
        "AI 编码平台推广至全公司的建议没有考虑安全审计和合规审查的依赖条件，遗漏了关键的 risk 缓冲建议。",
      suggestion: "添加安全审计作为 Q4 推广的前置条件，并标注对应的风险等级。",
    },
    {
      id: "i4",
      severity: "low",
      category: "遗漏视角",
      description:
        "数据库迁移部分未提及 TiDB 的运维成本和团队培训需求。从成本效益角度看，这是一项重要的遗漏。",
      suggestion: "补充 TiDB 运维成本估算和团队培训计划的简要说明。",
    },
    {
      id: "i5",
      severity: "low",
      category: "一致性",
      description:
        "实施进展章节中提到"单服务部署时间从 45 分钟降至 8 分钟"，但评估分析章节未引用该指标来支撑"效率提升"的结论。",
      suggestion: "在评估分析中交叉引用实施进展的具体数据，增强结论可信度。",
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

export default function DocumentAudit() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState(false);
  const [auditData] = useState<AuditData>(DEMO_AUDIT);
  const [done, setDone] = useState(false);

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
                    <p className="text-[11px] text-gray-600 mt-2">{issue.description}</p>
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
