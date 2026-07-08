/**
 * ResultsPanel — 结果展示面板
 *
 * 显示生成结果摘要 + 信任度评估 + 来源追溯 + 重新生成。
 */
import { useEffect, useState } from 'react';
import { Card, Button, Text, makeStyles, tokens, ProgressBar } from '@fluentui/react-components';
import { ArrowClockwise24Regular, DocumentCheckmark24Regular } from '@fluentui/react-icons';
import type { GenerationSection } from './WriteTab';

interface ResultsPanelProps {
  runId: string;
  sections: GenerationSection[];
  onRegenerate: () => void;
}

interface TrustMetrics {
  faithfulness: number;
  groundedness: number;
  coherence: number;
  fluency: number;
  completeness: number;
}

interface ProvenanceNode {
  id: string;
  paragraphIdx: number;
  chunkId?: string;
  webUrl?: string;
  webTitle?: string;
  score: number;
  isManual: boolean;
}

const METRIC_META: Array<{ key: keyof TrustMetrics; label: string }> = [
  { key: 'groundedness', label: '有据可查度' },
  { key: 'faithfulness', label: '内容忠实度' },
  { key: 'coherence', label: '连贯性' },
  { key: 'fluency', label: '流畅性' },
  { key: 'completeness', label: '完整性' },
];

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  sectionItem: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
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
  trustCard: {
    padding: tokens.spacingVerticalM,
  },
  trustScore: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    textAlign: 'center',
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalXS,
  },
  metricLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    width: '70px',
    flexShrink: 0,
  },
  metricBar: {
    flex: 1,
  },
  metricValue: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    width: '36px',
    textAlign: 'right',
    flexShrink: 0,
  },
  sourceCard: {
    padding: tokens.spacingVerticalS,
  },
  sourceHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalXS,
  },
  sourceItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase100,
    padding: `${tokens.spacingVerticalXXS} 0`,
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
  },
  sourceScore: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  badge: {
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  emptyText: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
    padding: tokens.spacingVerticalS,
  },
});

function getScoreColor(score: number): string {
  if (score >= 0.8) return tokens.colorPaletteGreenForeground1;
  if (score >= 0.5) return tokens.colorPaletteYellowForeground1;
  return tokens.colorPaletteRedForeground1;
}

function getScoreBg(score: number): string {
  if (score >= 0.8) return tokens.colorPaletteGreenBackground1;
  if (score >= 0.5) return tokens.colorPaletteYellowBackground1;
  return tokens.colorPaletteRedBackground1;
}

export default function ResultsPanel({ runId, sections, onRegenerate }: ResultsPanelProps) {
  const styles = useStyles();
  const [metrics, setMetrics] = useState<TrustMetrics | null>(null);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceNode[]>([]);
  const [loadingEval, setLoadingEval] = useState(false);
  const [loadingTrust, setLoadingTrust] = useState(true);
  const [_loadingProv, setLoadingProv] = useState(true);

  // 加载评估数据
  useEffect(() => {
    if (!runId) return;

    async function loadEvaluation() {
      setLoadingTrust(true);
      try {
        const res = await fetch(`http://localhost:3000/api/evaluation/${runId}`);
        const data = await res.json();
        if (data.ok && data.evaluations?.length > 0) {
          const latest = data.evaluations[0];
          const m = JSON.parse(latest.metrics) as TrustMetrics;
          setMetrics(m);
          setTrustScore(latest.trustScore ?? null);
        }
      } catch {
        // 静默失败：评估数据非必需
      } finally {
        setLoadingTrust(false);
      }
    }

    async function loadProvenance() {
      setLoadingProv(true);
      try {
        const res = await fetch(`http://localhost:3000/api/provenance/${runId}`);
        const data = await res.json();
        if (data.ok) setProvenance(data.nodes ?? []);
      } catch {
        // 静默失败
      } finally {
        setLoadingProv(false);
      }
    }

    loadEvaluation();
    loadProvenance();
  }, [runId]);

  async function handleEvaluate() {
    setLoadingEval(true);
    try {
      const res = await fetch('http://localhost:3000/api/evaluation/evaluate', {
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

  // 按章节分组来源
  const sectionSources = sections.map((sec, idx) => {
    const provNodes = provenance.filter(n => n.paragraphIdx === idx);
    const sources = provNodes.length > 0
      ? provNodes.map(n => ({
          name: n.webTitle || n.chunkId?.slice(0, 12) || '手动来源',
          score: n.score,
          isWeb: !!n.webUrl,
          isManual: n.isManual,
        }))
      : (sec.sources || []).map(s => ({
          name: s.sourceName || s.chunkId.slice(0, 12),
          score: s.score,
          isWeb: false,
          isManual: false,
        }));
    return { title: sec.title, sources, avgScore: sec.groundingScore };
  }).filter(s => s.sources.length > 0);

  return (
    <div className={styles.container}>
      {/* 头部 */}
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
          <DocumentCheckmark24Regular style={{ color: tokens.colorPaletteGreenForeground1 }} />
          <Text weight="semibold" size={300}>生成完成</Text>
        </div>
        <Text size={100}>{sections.length} 个章节</Text>
      </div>

      {/* 章节列表 */}
      <div className={styles.sectionList}>
        {sections.map((sec, idx) => (
          <div key={idx} className={styles.sectionItem}>
            <Text block className={styles.sectionTitle}>{sec.title}</Text>
            <Text block size={100} className={styles.sectionMeta}>
              {sec.content ? `${sec.content.length} 字` : ''}
              {' · 有据可查度 '}
              <span style={{ color: getScoreColor(sec.groundingScore) }}>
                {Math.round(sec.groundingScore * 100)}%
              </span>
              {sec.sources?.length ? ` · ${sec.sources.length} 个来源` : ''}
            </Text>
          </div>
        ))}
      </div>

      {/* 信任度评估 */}
      <Card className={styles.trustCard}>
        <Text weight="semibold" size={200}>信任度评估</Text>
        {trustScore !== null ? (
          <>
            <div className={styles.trustScore} style={{ color: getScoreColor(trustScore) }}>
              {Math.round(trustScore * 100)}%
            </div>
            <Text size={100} style={{ textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
              综合质量分
            </Text>
            {metrics && (
              <div style={{ marginTop: tokens.spacingVerticalS }}>
                {METRIC_META.map(({ key, label }) => {
                  const score = metrics[key];
                  return (
                    <div key={key} className={styles.metricRow}>
                      <span className={styles.metricLabel}>{label}</span>
                      <div className={styles.metricBar}>
                        <ProgressBar value={Math.round(score * 100)} />
                      </div>
                      <span className={styles.metricValue} style={{ color: getScoreColor(score) }}>
                        {Math.round(score * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : loadingTrust ? (
          <Text size={100} className={styles.emptyText}>加载评估数据中...</Text>
        ) : (
          <div style={{ textAlign: 'center', marginTop: tokens.spacingVerticalS }}>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: tokens.spacingVerticalS }}>
              尚未进行评估
            </Text>
            <Button
              size="small"
              appearance="primary"
              onClick={handleEvaluate}
              disabled={loadingEval}
            >
              {loadingEval ? '评估中...' : '开始评估'}
            </Button>
          </div>
        )}
      </Card>

      {/* 来源追溯 */}
      {sectionSources.length > 0 && (
        <>
          <Text weight="semibold" size={200}>来源追溯</Text>
          {sectionSources.map((sec, idx) => (
            <Card key={idx} className={styles.sourceCard}>
              <div className={styles.sourceHeader}>
                <Text size={100} weight="semibold" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sec.title}
                </Text>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: tokens.borderRadiusSmall,
                    background: getScoreBg(sec.avgScore),
                    color: getScoreColor(sec.avgScore),
                  }}
                >
                  {Math.round(sec.avgScore * 100)}%
                </span>
              </div>
              {sec.sources.map((src, sIdx) => (
                <div key={sIdx} className={styles.sourceItem}>
                  <div
                    className={styles.sourceDot}
                    style={{ background: getScoreColor(src.score) }}
                  />
                  <span className={styles.sourceName} title={src.name}>{src.name}</span>
                  <span className={styles.sourceScore}>{Math.round(src.score * 100)}%</span>
                  {src.isWeb && (
                    <span className={styles.badge} style={{ background: tokens.colorPalettePurpleBackground2, color: tokens.colorPalettePurpleForeground2 }}>
                      Web
                    </span>
                  )}
                  {src.isManual && (
                    <span className={styles.badge} style={{ background: tokens.colorPaletteBlueBackground2, color: tokens.colorPaletteBlueForeground2 }}>
                      手动
                    </span>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </>
      )}

      <Button
        appearance="secondary"
        icon={<ArrowClockwise24Regular />}
        onClick={onRegenerate}
        style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
      >
        重新生成
      </Button>
    </div>
  );
}
