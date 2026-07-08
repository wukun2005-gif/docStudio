/**
 * WriteProgress — 生成进度面板
 *
 * SSE 消费生成进度，实时展示每个章节的完成状态。
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Text, ProgressBar, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { Checkmark24Regular } from '@fluentui/react-icons';
import { consumeSSE, type SSEEvent } from '../services/sseClient';
import { writeToWorkbook, type ExcelWritePayload } from '../services/excelWriteService';
import type { OutlineItem, GenerationSection } from './WriteTab';

interface WriteProgressProps {
  outline: OutlineItem[];
  userRequest: string;
  onComplete: (runId: string, sections: GenerationSection[]) => void;
  onSettingsClick: () => void;
}

interface ChapterProgress {
  title: string;
  status: 'pending' | 'generating' | 'done';
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
  },
  card: {
    padding: tokens.spacingVerticalM,
  },
  currentLabel: {
    marginBottom: tokens.spacingVerticalXS,
  },
  progressList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  progressItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
  },
  doneIcon: {
    color: tokens.colorPaletteGreenForeground1,
  },
  errorText: {
    color: tokens.colorPaletteRedForeground1,
    marginTop: tokens.spacingVerticalM,
  },
});

export default function WriteProgress({ outline, userRequest, onComplete, onSettingsClick: _onSettingsClick }: WriteProgressProps) {
  const styles = useStyles();
  const [progress, setProgress] = useState<ChapterProgress[]>(
    outline.map(item => ({ title: item.title, status: 'pending' }))
  );
  const [currentChapter, setCurrentChapter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sectionsRef = useRef<GenerationSection[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;

    const startGeneration = async () => {
      try {
        await consumeSSE(
          'http://localhost:3000/api/generation/generate/excel-stream',
          {
            title: userRequest,
            outline: outline.map(item => ({ title: item.title })),
            format: 'excel',
          },
          async (event: SSEEvent) => {
            switch (event.type) {
              case 'section-start': {
                if (event.chapter !== undefined) {
                  setCurrentChapter(event.chapter);
                  setProgress(prev => prev.map(p =>
                    p.title === event.chapter
                      ? { ...p, status: 'generating' }
                      : p
                  ));
                }
                break;
              }
              case 'chapter_complete':
              case 'section': {
                // Extract chapter name from event data
                const chapterName = (event as unknown as Record<string, unknown>).chapter as string
                  ?? (event as unknown as Record<string, unknown>).title as string
                  ?? '';
                if (chapterName) {
                  setProgress(prev => prev.map(p =>
                    p.title === chapterName ? { ...p, status: 'done' } : p
                  ));
                }
                // 收集完整章节数据（含来源）
                const sectionData = (event as unknown as Record<string, unknown>).section as Record<string, unknown> | undefined;
                if (sectionData) {
                  const sec: GenerationSection = {
                    title: String(sectionData.title ?? ''),
                    content: String(sectionData.content ?? ''),
                    groundingScore: Number(sectionData.groundingScore ?? 0),
                    sources: Array.isArray(sectionData.sources)
                      ? sectionData.sources.map((s: unknown) => ({
                          chunkId: String((s as Record<string, unknown>).chunkId ?? ''),
                          score: Number((s as Record<string, unknown>).score ?? 0),
                          sourceName: (s as Record<string, unknown>).sourceName as string | undefined,
                        }))
                      : [],
                  };
                  sectionsRef.current.push(sec);
                }
                break;
              }
              case 'done': {
                const payload = (event as unknown as Record<string, unknown>).excelPayload as ExcelWritePayload | undefined;
                const runId = (event as unknown as Record<string, unknown>).runId as string | undefined;

                // 如果有 Excel payload，写入工作簿
                if (payload) {
                  await writeToWorkbook(payload);
                }

                // 使用 SSE section 事件中收集的完整数据（含来源）
                const finalSections = sectionsRef.current.length > 0
                  ? sectionsRef.current
                  : ((event as unknown as Record<string, unknown>).sections as GenerationSection[] | undefined) ?? [];
                onComplete(runId ?? '', finalSections);
                break;
              }
              case 'error': {
                setError(event.message ?? '生成失败');
                break;
              }
            }
          },
          abort.signal
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      }
    };

    startGeneration();

    return () => {
      abort.abort();
    };
  }, [outline, userRequest, onComplete]);

  const completedCount = progress.filter(p => p.status === 'done').length;
  const total = progress.length;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <Text block weight="semibold" className={styles.currentLabel}>
          {currentChapter ? `正在生成：${currentChapter}` : '准备中...'}
        </Text>
        <ProgressBar value={percent} />
        <Text block size={100} style={{ marginTop: tokens.spacingVerticalXS }}>
          {completedCount} / {total} 章节
        </Text>
      </Card>

      <div className={styles.progressList}>
        {progress.map((p, idx) => (
          <div key={idx} className={styles.progressItem}>
            {p.status === 'done' ? (
              <Checkmark24Regular className={styles.doneIcon} />
            ) : p.status === 'generating' ? (
              <Spinner size="tiny" />
            ) : (
              <span style={{ width: 12 }} />
            )}
            <Text size={200} style={{ color: p.status === 'pending' ? tokens.colorNeutralForeground3 : undefined }}>
              {p.title}
            </Text>
          </div>
        ))}
      </div>

      {error && (
        <Text block className={styles.errorText}>
          {error}
        </Text>
      )}
    </div>
  );
}
