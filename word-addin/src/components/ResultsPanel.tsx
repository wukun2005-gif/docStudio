/**
 * ResultsPanel — 结果展示面板（Word 版）
 *
 * 参考 web app 版本的 UnifiedEvaluationCard 组件设计：
 * - 双 Tab 结构：📊 评分概览（雷达图 + 进度条）/ 🔍 问题发现（按类型分组 + 建议）
 * - SVG 雷达图（4 维度：有据可查、内容相关、内容完整、无冲突）
 * - 问题发现：4 类问题（未支撑断言、与需求无关、要点未覆盖、已拦截冲突）
 * - 已覆盖要点列表
 * - 来源追溯（按章节分组）
 *
 * 数据来源：GET /api/evaluation/:runId（flat metrics JSON）
 * DB metrics 结构：{ faithfulness, groundedness, relevance, completeness, conflictRate, hasConflicts, irrelevantSentences, coveredPoints, missingPoints, conflictItems }
 */
import { useEffect, useState, useMemo } from 'react';
import { Card, Button, Text, makeStyles, tokens, ProgressBar } from '@fluentui/react-components';
import { ArrowClockwise16Regular, ChevronUp16Regular, ChevronDown16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import type { GenerationSection } from './WriteTab';

interface ResultsPanelProps {
  runId: string;
  sections: GenerationSection[];
  onRegenerate: () => void;
}

/** DB 中的完整评估指标（flat 结构） */
interface FullMetrics {
  faithfulness: number;
  groundedness: number;
  relevance?: number;
  completeness: number;
  coherence?: number;
  fluency?: number;
  conflictRate?: number;
  hasConflicts?: boolean;
  irrelevantSentences?: string[];
  coveredPoints?: string[];
  missingPoints?: string[];
  conflictItems?: Array<{ topic: string; conflictType?: string; claims: Array<{ text: string; source?: string }>; severity?: string }>;
}

interface ProvenanceNode {
  id: string;
  paragraphIdx: number;
  paragraphTitle?: string;
  chunkId?: string;
  webUrl?: string;
  webTitle?: string;
  sourceName?: string;
  sourceUrl?: string;
  score: number;
  isManual: boolean;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  sectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    flexShrink: 0,
  },
  sectionItem: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
  sectionMeta: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  // ── 评估卡片 ──
  evalCard: {
    padding: 0,
    overflow: 'hidden',
    flexShrink: 0,
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  tabButton: {
    flex: 1,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightMedium,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'center',
  },
  tabButtonActive: {
    background: tokens.colorNeutralBackground1,
    borderBottom: `2px solid ${tokens.colorBrandForeground2}`,
    color: tokens.colorBrandForeground2,
  },
  tabButtonInactive: {
    color: tokens.colorNeutralForeground3,
  },
  collapseBtn: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground4,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
  },
  tabContent: {
    padding: tokens.spacingVerticalS,
  },
  // ── 评分概览 ──
  overviewLayout: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalS,
  },
  radarWrap: {
    display: 'flex',
    justifyContent: 'center',
  },
  metricList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    width: '100%',
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
  metricLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    width: '60px',
    flexShrink: 0,
  },
  metricBar: {
    flex: 1,
  },
  metricValue: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    width: '32px',
    textAlign: 'right',
    flexShrink: 0,
  },
  trustScoreRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: tokens.spacingHorizontalXS,
    justifyContent: 'center',
  },
  trustScoreNum: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
  },
  trustScoreLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  // ── 问题发现 ──
  issuesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    maxHeight: '320px',
    overflowY: 'auto',
  },
  issueGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  issueGroupLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXXS,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  issueItem: {
    marginLeft: '12px',
    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: '8px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  issueDesc: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
  },
  issueSuggestion: {
    fontSize: '10px',
    color: tokens.colorBrandForeground2,
    marginTop: '2px',
  },
  // ── 已覆盖要点 ──
  coveredSection: {
    marginTop: tokens.spacingVerticalS,
  },
  coveredList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingVerticalXS,
    maxHeight: '200px',
    overflowY: 'auto',
  },
  coveredItem: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: '1.4',
    color: tokens.colorNeutralForeground2,
  },
  // ── 来源追溯 ──
  sourceSection: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalXS} 0`,
  },
  sourceCard: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    marginBottom: tokens.spacingVerticalXXS,
  },
  sourceHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXXS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sourceItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    padding: `${tokens.spacingVerticalXS} 0`,
    lineHeight: '1.4',
  },
  sourceDot: {
    width: '6px',
    height: '6px',
    borderRadius: tokens.borderRadiusCircular,
    flexShrink: 0,
  },
  sourceName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
  },
  sourceScore: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    minWidth: '32px',
    textAlign: 'right',
  },
  badge: {
    fontSize: tokens.fontSizeBase100,
    padding: '1px 4px',
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  sourceDeleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: tokens.borderRadiusSmall,
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.15s ease',
    ':hover': {
      background: tokens.colorPaletteRedBackground1,
      color: tokens.colorPaletteRedForeground1,
    },
  },
  emptyText: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
    padding: tokens.spacingVerticalS,
  },
  // ── 折叠态 ──
  collapsedBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
});

function getScoreColor(score: number): string {
  if (score >= 0.8) return tokens.colorPaletteGreenForeground1;
  if (score >= 0.5) return tokens.colorPaletteYellowForeground1;
  return tokens.colorPaletteRedForeground1;
}

// ── SVG 雷达图（参考 web app UnifiedEvaluationCard 的 Radar 组件） ──

function RadarChart({ scores, size = 120 }: { scores: Array<{ lab: string; val: number }>; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;
  const n = scores.length;
  const aStep = (2 * Math.PI) / n;

  const pt = (i: number, v: number) => {
    const a = aStep * i - Math.PI / 2;
    return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`;
  };

  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* 网格圆 */}
      {gridLevels.map((v) => (
        <polygon
          key={v}
          points={scores.map((_, i) => pt(i, v)).join(' ')}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="1"
        />
      ))}
      {/* 轴线 */}
      {scores.map((_, i) => {
        const a = aStep * i - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + r * Math.cos(a)}
            y2={cy + r * Math.sin(a)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        );
      })}
      {/* 数据多边形 */}
      <polygon
        points={scores.map((s, i) => pt(i, s.val)).join(' ')}
        fill="rgba(99,102,241,0.15)"
        stroke="#6366f1"
        strokeWidth="2"
      />
      {/* 数据点 */}
      {scores.map((s, i) => {
        const [px, py] = pt(i, s.val).split(',').map(Number);
        return <circle key={i} cx={px} cy={py} r="2.5" fill="#6366f1" />;
      })}
      {/* 标签 */}
      {scores.map((s, i) => {
        const a = aStep * i - Math.PI / 2;
        const labelR = r + 14;
        return (
          <text
            key={i}
            x={cx + labelR * Math.cos(a)}
            y={cy + labelR * Math.sin(a)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="7"
            fill="#6b7280"
          >
            {s.lab}
          </text>
        );
      })}
    </svg>
  );
}

// ── 问题发现：构建 issues 列表（参考 web app UnifiedEvaluationCard） ──

interface IssueItem {
  type: 'unsupported' | 'irrelevant' | 'uncovered' | 'blocked';
  desc: string;
  suggestion: string;
}

const ISSUE_META: Record<string, { icon: string; label: string }> = {
  unsupported: { icon: '🔴', label: '未支撑断言' },
  irrelevant: { icon: '🟠', label: '与需求无关的内容' },
  uncovered: { icon: '🟡', label: '需求要点未覆盖' },
  blocked: { icon: '🟢', label: '已拦截冲突（未进入文档）' },
};

function buildIssues(metrics: FullMetrics, trustScore: number | null): IssueItem[] {
  const list: IssueItem[] = [];

  // 1. 未支撑断言
  if (trustScore != null && trustScore < 0.8) {
    list.push({
      type: 'unsupported',
      desc: `综合有据可查度仅 ${Math.round(trustScore * 100)}%，部分内容缺少来源支撑。`,
      suggestion: '拖拽来源重生成低分段落，或补充知识源后重新生成',
    });
  }

  // 2. 与需求无关的内容
  if (metrics.irrelevantSentences?.length) {
    for (const sentence of metrics.irrelevantSentences) {
      list.push({
        type: 'irrelevant',
        desc: `与需求无关：${sentence.length > 120 ? sentence.substring(0, 120) + '…' : sentence}`,
        suggestion: '在文档中搜索此句并手动编辑删除或修改',
      });
    }
  }

  // 3. 需求要点未覆盖
  if (metrics.missingPoints?.length) {
    for (const p of metrics.missingPoints) {
      list.push({
        type: 'uncovered',
        desc: `需求要点未覆盖：${p}`,
        suggestion: '补充相关知识源后重新生成',
      });
    }
  }

  // 4. 已拦截冲突
  if (metrics.conflictItems?.length) {
    for (const c of metrics.conflictItems) {
      const claimsDesc = c.claims
        .map((cl) => {
          const src = cl.source ? `（${cl.source}）` : '';
          return `"${cl.text}"${src}`;
        })
        .join('  vs  ');
      list.push({
        type: 'blocked',
        desc: `拦截冲突：${c.topic}，未进入文档。\n${claimsDesc}`,
        suggestion: '已自动处理，无需操作',
      });
    }
  }

  // 无问题时
  if (list.length === 0 && trustScore != null) {
    list.push({
      type: 'unsupported',
      desc: '文档整体质量良好，未发现明显问题。',
      suggestion: '可直接使用或导出',
    });
  }

  return list;
}

export default function ResultsPanel({ runId, sections, onRegenerate }: ResultsPanelProps) {
  const styles = useStyles();
  const [metrics, setMetrics] = useState<FullMetrics | null>(null);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceNode[]>([]);
  const [loadingEval, setLoadingEval] = useState(false);
  const [loadingTrust, setLoadingTrust] = useState(true);
  const [tab, setTab] = useState<'overview' | 'issues'>('overview');
  const [collapsed, setCollapsed] = useState(false);

  // 加载评估数据
  useEffect(() => {
    if (!runId) return;

    async function loadEvaluation() {
      setLoadingTrust(true);
      try {
        const res = await fetch(`/api/evaluation/${runId}`);
        const data = await res.json();
        if (data.ok && data.evaluations?.length > 0) {
          const latest = data.evaluations[0];
          const m = JSON.parse(latest.metrics) as FullMetrics;
          setMetrics(m);
          setTrustScore(latest.trust_score ?? latest.trustScore ?? null);
        }
      } catch {
        // 静默失败
      } finally {
        setLoadingTrust(false);
      }
    }

    async function loadProvenance() {
      try {
        const res = await fetch(`/api/provenance/${runId}`);
        const data = await res.json();
        if (data.ok) setProvenance(data.nodes ?? []);
      } catch {
        // 静默失败
      }
    }

    loadEvaluation();
    loadProvenance();
  }, [runId]);

  async function handleEvaluate() {
    setLoadingEval(true);
    try {
      const res = await fetch('/api/evaluation/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (data.ok) {
        setMetrics(data.metrics);
        setTrustScore(data.trustScore);
      }
    } catch {
      // 静默失败
    } finally {
      setLoadingEval(false);
    }
  }

  // 雷达图 4 维度（与 web app 一致）
  const radarScores = useMemo(() => {
    if (!metrics) return [];
    return [
      { lab: '有据可查', val: metrics.groundedness ?? 0 },
      { lab: '内容相关', val: metrics.relevance ?? 0 },
      { lab: '内容完整', val: metrics.completeness ?? 0 },
      { lab: '无冲突', val: metrics.conflictRate != null ? 1 - metrics.conflictRate : 1 },
    ];
  }, [metrics]);

  // 问题列表
  const issues = useMemo(() => {
    if (!metrics || trustScore === null) return [];
    return buildIssues(metrics, trustScore);
  }, [metrics, trustScore]);

  // 按类型分组
  const groupedIssues = useMemo(() => {
    const groups = new Map<string, IssueItem[]>();
    for (const issue of issues) {
      const arr = groups.get(issue.type) ?? [];
      arr.push(issue);
      groups.set(issue.type, arr);
    }
    return groups;
  }, [issues]);

  // 按章节分组来源（参考 web app ProvenanceTree：直接从 nodes 按 paragraphIdx 分组）
  const provenanceByParagraph = useMemo(() => {
    const map = new Map<number, ProvenanceNode[]>();
    for (const node of provenance) {
      if (!map.has(node.paragraphIdx)) {
        map.set(node.paragraphIdx, []);
      }
      map.get(node.paragraphIdx)!.push(node);
    }
    return map;
  }, [provenance]);

  const sectionSources = Array.from(provenanceByParagraph.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, paragraphNodes]) => {
      // 章节标题优先用 provenance 的 paragraphTitle，其次用 sections[idx].title
      const title = paragraphNodes[0]?.paragraphTitle || sections[idx]?.title || `段落 ${idx + 1}`;
      const sources = paragraphNodes
        .sort((a, b) => b.score - a.score)
        .map((n) => ({
          nodeId: n.id,
          name: n.sourceName || n.webTitle || n.chunkId?.slice(0, 12) || '手动来源',
          url: n.sourceUrl || n.webUrl,
          score: n.score,
          isWeb: !!n.webUrl,
          isManual: n.isManual,
          chunkId: n.chunkId,
        }));
      // 平均 score = 节点 score 的算术平均（参考 web app）
      const avgScore = paragraphNodes.reduce((sum, n) => sum + n.score, 0) / paragraphNodes.length;
      return { title, sources, avgScore, count: paragraphNodes.length };
    });

  // 来源树：每个章节默认展开；折叠状态由 expandedSections 控制
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    () => new Set(sectionSources.map((_, i) => i))
  );
  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // 拖拽状态：拖动中的来源节点 + 拖动目标章节
  type SourceItem = {
    name: string;
    url?: string;
    score: number;
    isWeb: boolean;
    isManual: boolean;
    chunkId?: string;
  };
  const [draggingNode, setDraggingNode] = useState<{ source: SourceItem; fromIdx: number } | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);

  async function handleDropOnSection(toIdx: number) {
    if (!draggingNode || !runId) return;
    if (draggingNode.fromIdx === toIdx) {
      setDraggingNode(null);
      setDragOverIdx(null);
      return;
    }
    setRegeneratingIdx(toIdx);
    try {
      const res = await fetch(`/api/generation/${runId}/regenerate-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionIdx: toIdx,
          section: sectionSources[toIdx].title,
          outline: [{ title: sectionSources[toIdx].title }],
          replaceSource: {
            fromParagraphIdx: draggingNode.fromIdx,
            fromChunkId: draggingNode.source.chunkId,
          },
        }),
      });
      if (res.ok) {
        // 重新加载来源树
        const refreshed = await fetch(`/api/provenance/${runId}`).then((r) => r.json());
        if (refreshed.ok) setProvenance(refreshed.nodes);
      }
    } catch (err) {
      console.error('[WordResultsPanel] 拖拽重生成失败:', err);
    } finally {
      setRegeneratingIdx(null);
      setDraggingNode(null);
      setDragOverIdx(null);
    }
  }

  // 删除来源（参考 web app ProvenanceTree 的 × 按钮）
  async function handleDeleteSource(nodeId: string) {
    if (!runId) return;
    try {
      const res = await fetch(`/api/provenance/${nodeId}`, { method: 'DELETE' });
      if (res.ok) {
        // 从本地 state 移除该节点
        setProvenance((prev) => prev.filter((n) => n.id !== nodeId));
      }
    } catch (err) {
      console.error('[WordResultsPanel] 删除来源失败:', err);
    }
  }

  const hasEval = trustScore !== null && metrics !== null;

  return (
    <div className={styles.container}>
      {/* 评估卡片（参考 web app UnifiedEvaluationCard 双 Tab 设计） */}
      <Card className={styles.evalCard}>
        {collapsed ? (
          <div className={styles.collapsedBar} onClick={() => setCollapsed(false)}>
            <Text size={100}>📊 文档评估</Text>
            <Text size={100}>▼ 展开</Text>
          </div>
        ) : (
          <>
            {/* Tab 栏 */}
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabButton} ${tab === 'overview' ? styles.tabButtonActive : styles.tabButtonInactive}`}
                onClick={() => setTab('overview')}
              >
                📊 评分概览
              </button>
              <button
                className={`${styles.tabButton} ${tab === 'issues' ? styles.tabButtonActive : styles.tabButtonInactive}`}
                onClick={() => setTab('issues')}
              >
                🔍 问题发现 ({issues.length})
              </button>
              <button className={styles.collapseBtn} onClick={() => setCollapsed(true)} title="折叠">
                <ChevronUp16Regular />
              </button>
            </div>

            {/* Tab 内容 */}
            <div className={styles.tabContent}>
              {loadingTrust ? (
                <Text size={100} className={styles.emptyText}>
                  加载评估数据中...
                </Text>
              ) : !hasEval ? (
                <div style={{ textAlign: 'center', padding: tokens.spacingVerticalS }}>
                  <Text size={100} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: tokens.spacingVerticalS }}>
                    尚未进行评估
                  </Text>
                  <Button size="small" appearance="primary" onClick={handleEvaluate} disabled={loadingEval}>
                    {loadingEval ? '评估中...' : '开始评估'}
                  </Button>
                </div>
              ) : tab === 'overview' ? (
                /* ── 评分概览 Tab ── */
                <div className={styles.overviewLayout}>
                  {/* 综合信任度 */}
                  <div className={styles.trustScoreRow}>
                    <span className={styles.trustScoreNum} style={{ color: getScoreColor(trustScore!) }}>
                      {Math.round(trustScore! * 100)}%
                    </span>
                    <span className={styles.trustScoreLabel}>综合质量分</span>
                  </div>

                  {/* 雷达图 */}
                  {radarScores.length > 0 && (
                    <div className={styles.radarWrap}>
                      <RadarChart scores={radarScores} size={120} />
                    </div>
                  )}

                  {/* 进度条列表 */}
                  <div className={styles.metricList}>
                    {radarScores.map((r) => (
                      <div key={r.lab} className={styles.metricRow}>
                        <span className={styles.metricLabel}>{r.lab}</span>
                        <div className={styles.metricBar}>
                          <ProgressBar value={r.val} max={1} />
                        </div>
                        <span className={styles.metricValue} style={{ color: getScoreColor(r.val) }}>
                          {Math.round(r.val * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── 问题发现 Tab ── */
                <div className={styles.issuesContainer}>
                  {Array.from(groupedIssues.entries()).map(([type, items]) => {
                    const meta = ISSUE_META[type] ?? { icon: '🟡', label: type };
                    return (
                      <div key={type} className={styles.issueGroup}>
                        <div className={styles.issueGroupLabel}>
                          {meta.icon} {meta.label}（{items.length}）
                        </div>
                        {items.map((item, i) => (
                          <div key={i} className={styles.issueItem}>
                            <Text className={styles.issueDesc}>{item.desc}</Text>
                            <Text className={styles.issueSuggestion}>→ {item.suggestion}</Text>
                          </div>
                        ))}
                      </div>
                    );
                  })}


                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* 来源追溯 */}
      {sectionSources.length > 0 && (
        <div className={styles.sourceSection}>
          <Text weight="semibold" size={200}>
            来源追溯
          </Text>
          {sectionSources.map((sec, idx) => {
            const isExpanded = expandedSections.has(idx);
            const isDropTarget = dragOverIdx === idx;
            const isRegenerating = regeneratingIdx === idx;
            return (
              <Card
                key={idx}
                className={styles.sourceCard}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIdx(idx);
                }}
                onDragLeave={() => setDragOverIdx((cur) => (cur === idx ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDropOnSection(idx);
                }}
                style={{
                  outline: isDropTarget ? `2px dashed ${tokens.colorBrandForeground1}` : undefined,
                  background: isDropTarget ? tokens.colorBrandBackground2 : undefined,
                }}
              >
                <div
                  className={styles.sourceHeader}
                  onClick={() => toggleSection(idx)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                  <Text
                    size={200}
                    weight="semibold"
                    style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {sec.title}
                  </Text>
                  <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                    {sec.count} 个来源
                  </Text>
                  {isRegenerating && (
                    <Text size={100} style={{ color: tokens.colorBrandForeground1, marginLeft: 8 }}>
                      重生成中…
                    </Text>
                  )}
                </div>
                {isExpanded && sec.sources.map((src, sIdx) => (
                  <div
                    key={sIdx}
                    className={styles.sourceItem}
                    draggable={!!src.chunkId}
                    onDragStart={(e) => {
                      if (!src.chunkId) return;
                      setDraggingNode({ source: src, fromIdx: idx });
                      e.dataTransfer.setData('text/plain', src.chunkId);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDraggingNode(null);
                      setDragOverIdx(null);
                    }}
                    style={{ cursor: src.chunkId ? 'grab' : 'default' }}
                    title={src.chunkId ? '拖拽到其他章节以触发该章节重生成' : undefined}
                  >
                    <div className={styles.sourceDot} style={{ background: getScoreColor(src.score) }} />
                    {src.url ? (
                      <a
                        className={styles.sourceName}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={src.name}
                        style={{ color: tokens.colorBrandForeground1, textDecoration: 'none' }}
                      >
                        {src.name}
                      </a>
                    ) : (
                      <span className={styles.sourceName} title={src.name}>
                        {src.name}
                      </span>
                    )}
                    <span className={styles.sourceScore}>{Math.round(src.score * 100)}%</span>
                    {src.isWeb && (
                      <span
                        className={styles.badge}
                        style={{
                          background: tokens.colorPalettePurpleBackground2,
                          color: tokens.colorPalettePurpleForeground2,
                        }}
                      >
                        Web
                      </span>
                    )}
                    {src.isManual && (
                      <span
                        className={styles.badge}
                        style={{
                          background: tokens.colorPaletteBlueBackground2,
                          color: tokens.colorPaletteBlueForeground2,
                        }}
                      >
                        手动
                      </span>
                    )}
                    {src.nodeId && (
                      <button
                        className={styles.sourceDeleteBtn}
                        onClick={(e) => {
                          e.stopPropagation(); // 防止触发章节折叠
                          handleDeleteSource(src.nodeId!);
                        }}
                        title="移除此来源"
                        aria-label="移除此来源"
                      >
                        <Dismiss16Regular />
                      </button>
                    )}
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      <Button
        appearance="primary"
        icon={<ArrowClockwise16Regular />}
        onClick={onRegenerate}
        size="medium"
        style={{
          marginTop: tokens.spacingVerticalS,
          alignSelf: 'stretch',
          minWidth: 0,
          minHeight: '40px',
          paddingTop: tokens.spacingVerticalSNudge,
          paddingBottom: tokens.spacingVerticalSNudge,
          fontSize: tokens.fontSizeBase300,
          lineHeight: '20px',
        }}
      >
        重新生成
      </Button>
    </div>
  );
}