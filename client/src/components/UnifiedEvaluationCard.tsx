import { useState, useMemo } from "react";

interface EvalMetrics {
  groundedness: { score: number };
  relevance: { score: number; irrelevantSentences?: string[] };
  completeness: { score: number; missingPoints?: string[] };
  conflicts?: { hasConflicts: boolean; conflictRate: number; items: Array<{ topic: string; claims: Array<{ text: string; source?: string }>; severity?: string }> };
}

interface Props { evaluationMetrics?: EvalMetrics | null; trustScore?: number | null }

const DEMO: EvalMetrics = {
  groundedness: { score: 0.6497142857142858 },
  relevance: { score: 1, irrelevantSentences: [] },
  completeness: { score: 0.9333333333333333, missingPoints: [] },
  conflicts: { hasConflicts: true, conflictRate: 0.25, items: [
    { topic: "Q3 团队规模目标与实际人数", claims: [{ text: "当前团队:18人；Q3末目标:25人", source: "产品路线图-Q3-2026.pptx" }, { text: "人数:18-19人", source: "docs/PRD.md" }], severity: "low" },
    { topic: "Beta版本发布时间", claims: [{ text: "7月:Beta版本发布", source: "产品路线图-Q3-2026.pptx" }, { text: "Sprint 3未完成Beta前置条件", source: "10-陈强-团队-本周总结.eml" }], severity: "medium" },
    { topic: "Q3技术债务清理数量", claims: [{ text: "Q3共完成技术债务清理14项", source: "Q3-技术架构演进报告.docx" }, { text: "Q3共清理14项（分类统计）", source: "Q3-技术架构演进报告.docx" }], severity: "low" },
    { topic: "支付接口重构上线时间", claims: [{ text: "上线时间2026年9月10日", source: "Q3-技术架构演进报告.docx" }, { text: "Sprint 3仅完成方案初稿", source: "10-陈强-团队-本周总结.eml" }], severity: "medium" },
    { topic: "Q3团队总Commit数", claims: [{ text: "Q3总Commit数:2,553次", source: "14-陈强-团队-Q3代码生产力周报.eml" }, { text: "Q3合计提交1,096次", source: "Q3-GitHub开发活跃度报告.docx" }], severity: "high" },
  ] },
};

function Radar({ scores, size = 160 }: { scores: Array<{ lab: string; val: number }>; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.32, n = scores.length;
  const aStep = (2 * Math.PI) / n;
  const pt = (i: number, v: number) => { const a = aStep * i - Math.PI / 2; return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`; };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {[0.2, 0.4, 0.6, 0.8, 1].map((v) => <polygon key={v} points={scores.map((_, i) => pt(i, v)).join(" ")} fill="none" stroke="#e5e7eb" strokeWidth="1" />)}
      {scores.map((_, i) => { const a = aStep * i - Math.PI / 2; return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="#e5e7eb" strokeWidth="1" />; })}
      <polygon points={scores.map((s, i) => pt(i, s.val)).join(" ")} fill="rgba(99,102,241,0.15)" stroke="#6366f1" strokeWidth="2" />
      {scores.map((s, i) => { const [px, py] = pt(i, s.val).split(",").map(Number); return <circle key={i} cx={px} cy={py} r="3" fill="#6366f1" />; })}
      {scores.map((s, i) => { const a = aStep * i - Math.PI / 2; return <text key={i} x={cx + (r + 16) * Math.cos(a)} y={cy + (r + 16) * Math.sin(a)} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#6b7280">{s.lab}</text>; })}
    </svg>
  );
}

function hasAllMetrics(m: any): m is EvalMetrics {
  return m && m.groundedness && m.relevance && m.completeness;
}

export default function UnifiedEvaluationCard({ evaluationMetrics, trustScore }: Props) {
  const [tab, setTab] = useState<"overview" | "issues">("overview");
  const [collapsed, setCollapsed] = useState(false);
  const m: EvalMetrics = hasAllMetrics(evaluationMetrics) ? evaluationMetrics : DEMO;

  const radar = [
    { lab: "有据可查", val: m.groundedness?.score ?? 0 },
    { lab: "内容相关", val: m.relevance?.score ?? 0 },
    { lab: "内容完整", val: m.completeness?.score ?? 0 },
    { lab: "无冲突", val: m.conflicts ? 1 - m.conflicts.conflictRate : 1 },
  ];

  const issues = useMemo(() => {
    const list: Array<{ t: string; d: string; s: string }> = [];
    if (trustScore != null && trustScore < 0.8) list.push({ t: "unsupported", d: `综合有据可查度仅 ${Math.round(trustScore * 100)}%，部分内容缺少来源支撑。`, s: "拖拽来源重生成低分段落，或补充知识源后重新生成" });
    // 展开每一条无关句子，让用户看到具体内容并可在文档中定位
    if (m.relevance?.irrelevantSentences?.length) for (const sentence of m.relevance.irrelevantSentences) list.push({ t: "irrelevant", d: `与需求无关：${sentence.length > 120 ? sentence.substring(0, 120) + "…" : sentence}`, s: "在文档中搜索此句并手动编辑删除或修改" });
    if (m.completeness?.missingPoints?.length) for (const p of m.completeness.missingPoints) list.push({ t: "uncovered", d: `需求要点未覆盖：${p}`, s: "补充相关知识源后重新生成" });
    if (m.conflicts?.items?.length) for (const c of m.conflicts.items) {
      const claimsDesc = c.claims.map(cl => {
        const src = cl.source ? `（${cl.source}）` : "";
        return `"${cl.text}"${src}`;
      }).join("  vs  ");
      list.push({ t: "blocked", d: `拦截冲突：${c.topic}，未进入文档。\n${claimsDesc}`, s: "已自动处理，无需操作" });
    }
    if (list.length === 0 && trustScore != null) list.push({ t: "unsupported", d: "文档整体质量良好，未发现明显问题。", s: "可直接使用或导出" });
    return list;
  }, [m, trustScore]);

  const META: Record<string, { i: string; l: string }> = {
    unsupported: { i: "🔴", l: "未支撑断言" },
    irrelevant: { i: "🟠", l: "与需求无关的内容" },
    uncovered: { i: "🟡", l: "需求要点未覆盖" },
    blocked: { i: "🟢", l: "已拦截冲突（未进入文档）" },
  };
  const grouped = new Map<string, typeof issues>();
  for (const i of issues) { const a = grouped.get(i.t) ?? []; a.push(i); grouped.set(i.t, a); }

  if (collapsed) return (
    <div className="border rounded-lg bg-white overflow-hidden" id="demo-eval-card">
      <button id="demo-eval-expand" onClick={() => setCollapsed(false)} className="w-full px-4 py-2 flex items-center justify-between text-xs text-gray-500 hover:bg-gray-50">
        <span>📊 文档评估</span><span>▼ 展开</span>
      </button>
    </div>
  );

  return (
    <div className="border rounded-lg bg-white overflow-hidden" id="demo-eval-card">
      <div className="flex border-b bg-gray-50 items-center">
        <button className={`flex-1 px-3 py-2 text-xs font-medium ${tab === "overview" ? "bg-white text-indigo-700 border-b-2 border-indigo-500" : "text-gray-500"}`} onClick={() => setTab("overview")}>📊 评分概览</button>
        <button id="demo-eval-tab-issues" className={`flex-1 px-3 py-2 text-xs font-medium ${tab === "issues" ? "bg-white text-indigo-700 border-b-2 border-indigo-500" : "text-gray-500"}`} onClick={() => setTab("issues")}>🔍 问题发现 ({issues.length})</button>
        <button id="demo-eval-collapse" onClick={() => setCollapsed(true)} className="px-2 py-2 text-xs text-gray-400 hover:text-gray-600" title="折叠">▲</button>
      </div>
      {tab === "overview" && (
        <div className="flex flex-wrap items-center p-4 gap-4">
          <Radar scores={radar} size={160} />
          <div className="space-y-1.5 text-xs flex-1 min-w-[140px]">
            {radar.map((r) => (
              <div key={r.lab} className="flex items-center gap-2">
                <span className="text-gray-500 w-16">{r.lab}</span>
                <div className="flex-1 h-2 bg-gray-200 rounded-full"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(r.val * 100)}%` }} /></div>
                <span className="text-gray-600 font-medium w-8 text-right">{Math.round(r.val * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "issues" && (
        <div className="p-3 max-h-[360px] overflow-y-auto space-y-3">
          {Array.from(grouped.entries()).map(([t, items]) => {
            const meta = META[t] ?? { i: "🟡", l: t };
            return (
              <div key={t}>
                <div className="flex items-center gap-1.5 mb-1.5"><span className="text-xs">{meta.i}</span><span className="text-xs font-medium text-gray-700">{meta.l}（{items.length}）</span></div>
                {items.map((item, i) => (
                  <div key={i} className="ml-5 mb-1.5 border-l-2 border-gray-200 pl-2.5">
                    <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">{item.d}</p>
                    <p className="text-[10px] text-indigo-600 mt-0.5">→ {item.s}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}