/**
 * ResultsPanel — 结果展示面板
 *
 * 显示工作簿预览 + 信任度指标占位 + 来源追溯占位 + 重新生成按钮。
 * Phase 3 将实现完整的 TrustReport 和 ProvenanceTree。
 */
import { Card, Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwise24Regular } from '@fluentui/react-icons';
import type { GenerationSection } from './WriteTab';

interface ResultsPanelProps {
  runId: string;
  sections: GenerationSection[];
  onRegenerate: () => void;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    overflowY: 'auto',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalXS,
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
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingVerticalXS,
  },
  metricCard: {
    textAlign: 'center',
    padding: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  metricLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  metricValue: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    marginTop: tokens.spacingVerticalXS,
  },
});

export default function ResultsPanel({ runId: _runId, sections, onRegenerate }: ResultsPanelProps) {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      {/* 工作簿预览 */}
      <div className={styles.sectionHeader}>
        <Text weight="semibold" size={300}>生成完成</Text>
        <Text size={100}>{sections.length} 个章节</Text>
      </div>

      <div className={styles.sectionList}>
        {sections.map((sec, idx) => (
          <div key={idx} className={styles.sectionItem}>
            <Text block className={styles.sectionTitle}>{sec.title}</Text>
            <Text block size={100} className={styles.sectionMeta}>
              {sec.content ? `${sec.content.length} 字` : ''} · 有据可查度 {Math.round(sec.groundingScore * 100)}%
              {sec.sources?.length ? ` · ${sec.sources.length} 个来源` : ''}
            </Text>
          </div>
        ))}
      </div>

      {/* 评估指标（Phase 3 完整实现） */}
      <Text weight="semibold" size={200} style={{ marginTop: tokens.spacingVerticalS }}>评估指标</Text>
      <div className={styles.metricsGrid}>
        <Card className={styles.metricCard}>
          <div className={styles.metricLabel}>有据可查度</div>
          <div className={styles.metricValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
            {sections.length ? Math.round(sections.reduce((s, sec) => s + sec.groundingScore, 0) / sections.length * 100) / 100 : 0}
          </div>
        </Card>
        <Card className={styles.metricCard}>
          <div className={styles.metricLabel}>内容相关度</div>
          <div className={styles.metricValue}>--</div>
        </Card>
        <Card className={styles.metricCard}>
          <div className={styles.metricLabel}>内容完整度</div>
          <div className={styles.metricValue}>--</div>
        </Card>
        <Card className={styles.metricCard}>
          <div className={styles.metricLabel}>无冲突率</div>
          <div className={styles.metricValue}>--</div>
        </Card>
      </div>

      {/* 来源追溯（Phase 3 完整实现） */}
      {sections.some(s => s.sources?.length) && (
        <>
          <Text weight="semibold" size={200} style={{ marginTop: tokens.spacingVerticalS }}>来源追溯</Text>
          {sections.filter(s => s.sources?.length).map((sec, idx) => (
            <div key={idx}>
              <Text size={100} weight="semibold">{sec.title}</Text>
              {sec.sources.map((src, sIdx) => (
                <Text key={sIdx} size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  → {src.sourceName ?? src.chunkId}
                </Text>
              ))}
            </div>
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
