/**
 * ResultsPanel — 结果展示面板（邮件版）
 *
 * 评估卡片严格对齐 web app 的 UnifiedEvaluationCard.tsx：
 * - 双 Tab：📊 评分概览（雷达图+进度条并排）/ 🔍 问题发现
 * - 雷达图 160px，indigo 色 #6366f1，4 维度：有据可查/内容相关/内容完整/无冲突
 * - 进度条统一 indigo-500（不按分数变色），8px 高，rounded-full
 * - 无顶部大百分比数字（web app 没有）
 * - 折叠按钮用 ▲/▼ 文字
 * - 无评估数据时使用 DEMO 数据（与 web app 一致）
 * - 来源追溯：按段落分组折叠卡片
 */
import { useEffect, useState, useMemo } from 'react';
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwise16Regular } from '@fluentui/react-icons';
import type { GenerationSection } from './WriteProgress';

interface ResultsPanelProps {
  runId: string;
  sections: GenerationSection[];
  onRegenerate: () => void;
}

// ── 评估数据类型（对齐 web app UnifiedEvaluationCard） ──

interface EvalMetrics {
  groundedness: { score: number };
  relevance: { score: number; irrelevantSentences?: string[] };
  completeness: { score: number; missingPoints?: string[] };
  conflicts?: {
    hasConflicts: boolean;
    conflictRate: number;
    items: Array<{
      topic: string;
      claims: Array<{ text: string; source?: string }>;
      severity?: string;
    }>;
  };
}

// DEMO 数据（无评估时使用，与 web app 一致）
const DEMO: EvalMetrics = {
  groundedness: { score: 0.6 },
  relevance: { score: 1, irrelevantSentences: [] },
  completeness: { score: 0.7, missingPoints: [] },
  conflicts: { hasConflicts: false, conflictRate: 0, items: [] },
};

interface SourceTreeItem {
  title: string;
  score: number;
  citations: Array<{ index: number; title: string; url: string }>;
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

interface EmailPayload {
  subject: string;
  bodyHtml: string;
  citations: Array<{ index: number; title: string; url: string }>;
  trustScore: number;
  sourceTree?: SourceTreeItem[];
}

// ── 样式（精确匹配 web app Tailwind 类名对应的视觉） ──

const INDIGO = '#6366f1';
const INDIGO_BG = 'rgba(99,102,241,0.15)';
const GRAY_200 = '#e5e7eb';
const GRAY_400 = '#9ca3af';
const GRAY_500 = '#6b7280';
const GRAY_600 = '#4b5563';
const GRAY_700 = '#374151';
const INDIGO_600 = '#4f46e5';
const INDIGO_700 = '#4338ca';
const INDIGO_500_BG = '#6366f1';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: '8px',
    padding: '8px',
    overflowY: 'auto',
  },
  // ── 评估卡片（border rounded-lg bg-white overflow-hidden） ──
  evalCard: {
    border: `1px solid ${GRAY_200}`,
    borderRadius: '8px',
    background: '#fff',
    overflow: 'hidden',
    flexShrink: 0,
  },
  // Tab 栏（flex border-b bg-gray-50 items-center）
  tabBar: {
    display: 'flex',
    borderBottom: `1px solid ${GRAY_200}`,
    background: '#f9fafb',
    alignItems: 'center',
  },
  tabBtn: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 500,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabBtnActive: {
    background: '#fff',
    color: INDIGO_700,
    borderBottom: `2px solid ${INDIGO_500_BG}`,
  },
  tabBtnInactive: {
    color: GRAY_500,
  },
  collapseBtn: {
    padding: '8px 8px',
    fontSize: '12px',
    color: GRAY_400,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  // ── 评分概览（flex flex-wrap items-center p-4 gap-4） ──
  overviewArea: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: '16px',
    gap: '16px',
  },
  // 进度条列表（space-y-1.5 text-xs flex-1 min-w-[140px]）
  metricList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '12px',
    flex: 1,
    minWidth: '140px',
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  metricLabel: {
    color: GRAY_500,
    width: '64px',
    fontSize: '12px',
    flexShrink: 0,
  },
  metricBarWrap: {
    flex: 1,
    height: '8px',
    background: GRAY_200,
    borderRadius: '9999px',
    overflow: 'hidden',
  },
  metricBarFill: {
    height: '100%',
    background: INDIGO_500_BG,
    borderRadius: '9999px',
    transition: 'width 0.3s',
  },
  metricValue: {
    color: GRAY_600,
    fontWeight: 500,
    width: '32px',
    textAlign: 'right',
    fontSize: '12px',
    flexShrink: 0,
  },
  // ── 问题发现（p-3 max-h-[360px] overflow-y-auto space-y-3） ──
  issuesArea: {
    padding: '12px',
    maxHeight: '360px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  issueGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  issueGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px',
  },
  issueGroupIcon: {
    fontSize: '12px',
  },
  issueGroupLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: GRAY_700,
  },
  issueItem: {
    marginLeft: '20px',
    marginBottom: '6px',
    borderLeft: `2px solid ${GRAY_200}`,
    paddingLeft: '10px',
  },
  issueDesc: {
    fontSize: '11px',
    color: GRAY_600,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
    margin: 0,
  },
  issueSuggestion: {
    fontSize: '10px',
    color: INDIGO_600,
    marginTop: '2px',
    margin: 0,
  },
  // ── 折叠态 ──
  collapsedBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: '12px',
    color: GRAY_500,
    border: 'none',
    background: 'transparent',
    width: '100%',
    fontFamily: 'inherit',
  },
  // ── 来源追溯 ──
  sourceSection: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '4px',
  },
  sourceCard: {
    border: `1px solid ${GRAY_200}`,
    borderRadius: '8px',
    padding: '8px 12px',
    marginBottom: '2px',
    background: '#fff',
  },
  sourceHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
    paddingBottom: '4px',
    borderBottom: `1px solid ${GRAY_200}`,
    cursor: 'pointer',
  },
  sourceItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    padding: '4px 0',
    lineHeight: 1.4,
  },
  sourceDot: {
    width: '6px',
    height: '6px',
    borderRadius: '9999px',
    flexShrink: 0,
  },
  sourceName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: '12px',
    color: GRAY_600,
    textDecoration: 'none',
  },
  sourceScore: {
    fontSize: '11px',
    color: GRAY_500,
    flexShrink: 0,
    minWidth: '32px',
    textAlign: 'right' as const,
  },
  badge: {
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  emptyText: {
    fontSize: '11px',
    color: GRAY_500,
    textAlign: 'center' as const,
    padding: '8px',
  },
});

// ── 雷达图 SVG（与 web app 完全一致，size=160） ──

function Radar({ scores, size = 160 }: { scores: Array<{ lab: string; val: number }>; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;
  const n = scores.length;
  const aStep = (2 * Math.PI) / n;
  const pt = (i: number, v: number) => {
    const a = aStep * i - Math.PI / 2;
    return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <polygon key={v} points={scores.map((_, i) => pt(i, v)).join(' ')} fill="none" stroke={GRAY_200} strokeWidth="1" />
      ))}
      {scores.map((_, i) => {
        const a = aStep * i - Math.PI / 2;
        return (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke={GRAY_200} strokeWidth="1" />
        );
      })}
      <polygon
        points={scores.map((s, i) => pt(i, s.val)).join(' ')}
        fill={INDIGO_BG}
        stroke={INDIGO}
        strokeWidth="2"
      />
      {scores.map((s, i) => {
        const [px, py] = pt(i, s.val).split(',').map(Number);
        return <circle key={i} cx={px} cy={py} r="3" fill={INDIGO} />;
      })}
      {scores.map((s, i) => {
        const a = aStep * i - Math.PI / 2;
        return (
          <text
            key={i}
            x={cx + (r + 16) * Math.cos(a)}
            y={cy + (r + 16) * Math.sin(a)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="8"
            fill={GRAY_500}
          >
            {s.lab}
          </text>
        );
      })}
    </svg>
  );
}

// ── 问题发现构建（与 web app 完全一致） ──

interface IssueItem {
  t: string;
  d: string;
  s: string;
}

function buildIssues(m: EvalMetrics, trustScore: number | null): IssueItem[] {
  const list: IssueItem[] = [];
  if (trustScore != null && trustScore < 0.8) {
    list.push({
      t: 'unsupported',
      d: `综合有据可查度仅 ${Math.round(trustScore * 100)}%，部分内容缺少来源支撑。`,
      s: '拖拽来源重生成低分段落，或补充知识源后重新生成',
    });
  }
  if (m.relevance?.irrelevantSentences?.length) {
    for (const sentence of m.relevance.irrelevantSentences) {
      list.push({
        t: 'irrelevant',
        d: `与需求无关：${sentence.length > 120 ? sentence.substring(0, 120) + '…' : sentence}`,
        s: '在文档中搜索此句并手动编辑删除或修改',
      });
    }
  }
  if (m.completeness?.missingPoints?.length) {
    for (const p of m.completeness.missingPoints) {
      list.push({
        t: 'uncovered',
        d: `需求要点未覆盖：${p}`,
        s: '补充相关知识源后重新生成',
      });
    }
  }
  if (m.conflicts?.items?.length) {
    for (const c of m.conflicts.items) {
      const claimsDesc = c.claims
        .map((cl) => {
          const src = cl.source ? `（${cl.source}）` : '';
          return `"${cl.text}"${src}`;
        })
        .join('  vs  ');
      list.push({
        t: 'blocked',
        d: `拦截冲突：${c.topic}，未进入文档。\n${claimsDesc}`,
        s: '已自动处理，无需操作',
      });
    }
  }
  if (list.length === 0 && trustScore != null) {
    list.push({
      t: 'unsupported',
      d: '文档整体质量良好，未发现明显问题。',
      s: '可直接使用或导出',
    });
  }
  return list;
}

const ISSUE_META: Record<string, { i: string; l: string }> = {
  unsupported: { i: '🔴', l: '未支撑断言' },
  irrelevant: { i: '🟠', l: '与需求无关的内容' },
  uncovered: { i: '🟡', l: '需求要点未覆盖' },
  blocked: { i: '🟢', l: '已拦截冲突（未进入文档）' },
};

function hasAllMetrics(m: any): m is EvalMetrics {
  return m && m.groundedness && m.relevance && m.completeness;
}

function scoreDotColor(score: number): string {
  if (score >= 0.8) return '#22c55e';
  if (score >= 0.5) return '#eab308';
  return '#ef4444';
}

export default function ResultsPanel({ runId, sections, onRegenerate }: ResultsPanelProps) {
  const styles = useStyles();
  const [metrics, setMetrics] = useState<EvalMetrics | null>(null);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceNode[]>([]);
  const [emailPayload, setEmailPayload] = useState<EmailPayload | null>(null);
  const [tab, setTab] = useState<'overview' | 'issues'>('overview');
  const [collapsed, setCollapsed] = useState(false);

  // 从 /api/generation/:runId/evaluation 获取评估数据（对齐 web app 使用的端点）
  // 同时从 /api/generation/status/:runId 获取 emailPayload（含 sourceTree 正确标题）
  useEffect(() => {
    if (!runId) return;

    async function load() {
      try {
        const res = await fetch(`/api/generation/${runId}/evaluation`);
        const data = await res.json();
        if (data.ok && data.evaluation?.metrics) {
          setMetrics(data.evaluation.metrics);
        }
      } catch {
        // 静默失败，使用 DEMO 数据
      }
      try {
        const statusRes = await fetch(`/api/generation/status/${runId}`);
        const statusData = await statusRes.json();
        if (statusData.trustScore != null) setTrustScore(statusData.trustScore);
        if (statusData.emailPayload) setEmailPayload(statusData.emailPayload);
      } catch {}
    }
    load();

    // 获取来源追溯（用于分数和 Web/手动 badge）
    fetch(`/api/provenance/${runId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setProvenance(data.nodes ?? []);
      })
      .catch(() => {});
  }, [runId]);

  const m: EvalMetrics = hasAllMetrics(metrics) ? metrics : DEMO;

  const radar = [
    { lab: '有据可查', val: m.groundedness?.score ?? 0 },
    { lab: '内容相关', val: m.relevance?.score ?? 0 },
    { lab: '内容完整', val: m.completeness?.score ?? 0 },
    { lab: '无冲突', val: m.conflicts ? 1 - m.conflicts.conflictRate : 1 },
  ];

  const issues = useMemo(() => buildIssues(m, trustScore), [m, trustScore]);

  const grouped = useMemo(() => {
    const g = new Map<string, IssueItem[]>();
    for (const i of issues) {
      const arr = g.get(i.t) ?? [];
      arr.push(i);
      g.set(i.t, arr);
    }
    return g;
  }, [issues]);

  // 使用 emailPayload.sourceTree 作为来源追溯的主要数据源（有正确的章节标题）
  // provenance 数据用于补充 Web/手动 badge 和更精确的分数
  const sectionSources = useMemo(() => {
    // 优先使用 emailPayload.sourceTree
    if (emailPayload?.sourceTree && emailPayload.sourceTree.length > 0) {
      // 构建 url -> provenance node 的映射，用于补充 isWeb/isManual 信息
      const provByUrl = new Map<string, ProvenanceNode>();
      for (const n of provenance) {
        const key = n.sourceUrl || n.webUrl || '';
        if (key && !provByUrl.has(key)) provByUrl.set(key, n);
      }
      return emailPayload.sourceTree.map((node) => ({
        title: node.title,
        avgScore: node.score,
        count: node.citations.length,
        sources: node.citations.map((c) => {
          const pNode = c.url ? provByUrl.get(c.url) : undefined;
          return {
            name: c.title,
            url: c.url,
            score: pNode?.score ?? node.score,
            isWeb: pNode?.isManual === false ? !!pNode.webUrl : (c.url ? c.url.startsWith('http') : false),
            isManual: pNode?.isManual ?? false,
          };
        }),
      }));
    }

    // Fallback: 从 provenance_nodes 分组
    const map = new Map<number, ProvenanceNode[]>();
    for (const node of provenance) {
      if (!map.has(node.paragraphIdx)) map.set(node.paragraphIdx, []);
      map.get(node.paragraphIdx)!.push(node);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, paragraphNodes]) => {
        const title = paragraphNodes[0]?.paragraphTitle || sections[idx]?.title || `段落 ${idx + 1}`;
        const srcs = paragraphNodes
          .sort((a, b) => b.score - a.score)
          .map((n) => ({
            name: n.sourceName || n.webTitle || n.chunkId?.slice(0, 12) || '手动来源',
            url: n.sourceUrl || n.webUrl,
            score: n.score,
            isWeb: !!n.webUrl,
            isManual: n.isManual,
          }));
        const avgScore = paragraphNodes.reduce((s, n) => s + n.score, 0) / paragraphNodes.length;
        return { title, sources: srcs, avgScore, count: paragraphNodes.length };
      });
  }, [emailPayload, provenance, sections]);

  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // 当 sectionSources 加载后，默认展开所有段落
  useEffect(() => {
    setExpandedSections(new Set(sectionSources.map((_, i) => i)));
  }, [sectionSources.length]);
  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className={styles.container}>
      {/* 评估卡片（与 web app UnifiedEvaluationCard 像素级对齐） */}
      <div className={styles.evalCard} id="demo-eval-card">
        {collapsed ? (
          <button className={styles.collapsedBar} onClick={() => setCollapsed(false)} id="demo-eval-expand">
            <span>📊 文档评估</span>
            <span>▼ 展开</span>
          </button>
        ) : (
          <>
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabBtn} ${tab === 'overview' ? styles.tabBtnActive : styles.tabBtnInactive}`}
                onClick={() => setTab('overview')}
              >
                📊 评分概览
              </button>
              <button
                id="demo-eval-tab-issues"
                className={`${styles.tabBtn} ${tab === 'issues' ? styles.tabBtnActive : styles.tabBtnInactive}`}
                onClick={() => setTab('issues')}
              >
                🔍 问题发现 ({issues.length})
              </button>
              <button
                className={styles.collapseBtn}
                onClick={() => setCollapsed(true)}
                title="折叠"
                id="demo-eval-collapse"
              >
                ▲
              </button>
            </div>

            {tab === 'overview' && (
              <div className={styles.overviewArea}>
                <Radar scores={radar} size={160} />
                <div className={styles.metricList}>
                  {radar.map((r) => (
                    <div key={r.lab} className={styles.metricRow}>
                      <span className={styles.metricLabel}>{r.lab}</span>
                      <div className={styles.metricBarWrap}>
                        <div className={styles.metricBarFill} style={{ width: `${Math.round(r.val * 100)}%` }} />
                      </div>
                      <span className={styles.metricValue}>{Math.round(r.val * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'issues' && (
              <div className={styles.issuesArea}>
                {Array.from(grouped.entries()).map(([t, items]) => {
                  const meta = ISSUE_META[t] ?? { i: '🟡', l: t };
                  return (
                    <div key={t} className={styles.issueGroup}>
                      <div className={styles.issueGroupHeader}>
                        <span className={styles.issueGroupIcon}>{meta.i}</span>
                        <span className={styles.issueGroupLabel}>
                          {meta.l}（{items.length}）
                        </span>
                      </div>
                      {items.map((item, i) => (
                        <div key={i} className={styles.issueItem}>
                          <p className={styles.issueDesc}>{item.d}</p>
                          <p className={styles.issueSuggestion}>→ {item.s}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 来源追溯 */}
      {sectionSources.length > 0 && (
        <div className={styles.sourceSection}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: GRAY_700 }}>来源追溯</span>
          {sectionSources.map((sec, idx) => {
            const isExpanded = expandedSections.has(idx);
            return (
              <div key={idx} className={styles.sourceCard}>
                <div className={styles.sourceHeader} onClick={() => toggleSection(idx)}>
                  <span style={{ fontSize: '12px', color: GRAY_500, lineHeight: 1 }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      maxWidth: '180px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginLeft: '4px',
                    }}
                  >
                    {sec.title}
                  </span>
                  <span style={{ fontSize: '11px', color: GRAY_500 }}>{sec.count} 个来源</span>
                </div>
                {isExpanded &&
                  sec.sources.map((src, sIdx) => (
                    <div key={sIdx} className={styles.sourceItem}>
                      <div className={styles.sourceDot} style={{ background: scoreDotColor(src.score) }} />
                      {src.url ? (
                        <a
                          className={styles.sourceName}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={src.name}
                          style={{ color: INDIGO }}
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
                            background: '#f3e8ff',
                            color: '#7c3aed',
                          }}
                        >
                          Web
                        </span>
                      )}
                      {src.isManual && (
                        <span
                          className={styles.badge}
                          style={{
                            background: '#dbeafe',
                            color: '#2563eb',
                          }}
                        >
                          手动
                        </span>
                      )}
                    </div>
                  ))}
              </div>
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
          marginTop: '8px',
          width: '100%',
          minHeight: '40px',
          fontSize: '14px',
        }}
      >
        重新生成
      </Button>
    </div>
  );
}
