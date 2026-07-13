import { useEffect, useRef, useState } from "react";
import { Spinner, Text, makeStyles, tokens, ProgressBar } from "@fluentui/react-components";
import { writeEmailToMail, setMailSubject } from "../services/mailWriteService";

export interface GenerationSection {
  title: string;
  content: string;
  groundingScore: number;
  sources: Array<{ chunkId: string; score: number; sourceName?: string }>;
}

interface WriteProgressProps {
  outline: Array<{ title: string; description?: string }>;
  userRequest: string;
  onComplete: (runId: string, sections: GenerationSection[]) => void;
}

interface ChapterProgress {
  title: string;
  status: 'pending' | 'generating' | 'done';
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
  },
  currentChapter: {
    fontSize: '14px',
    color: tokens.colorBrandForeground1,
    marginBottom: '8px',
  },
  chapterList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  chapterItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: '13px',
  },
});

const POLL_INTERVAL_MS = 1500;

export default function WriteProgress({ outline, userRequest, onComplete }: WriteProgressProps) {
  const styles = useStyles();
  const [progress, setProgress] = useState<ChapterProgress[]>(
    outline.map(item => ({ title: item.title, status: 'pending' }))
  );
  const [currentChapter, setCurrentChapter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      cancelledRef.current = false;
      return;
    }
    startedRef.current = true;

    cancelledRef.current = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      try {
        const shortTitle = outlineRef.current[0]?.title ?? userRequest.slice(0, 50);
        const resp = await fetch('/api/generation/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: shortTitle,
            userRequest,
            outline: outlineRef.current.map(item => ({ title: item.title, description: item.description ?? '', children: [] })),
            format: 'email',
            providerPreference: ['stub'],
          }),
        });

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }

        const { runId } = await resp.json();
        if (cancelledRef.current) return;

        const poll = async () => {
          if (cancelledRef.current) return;

          try {
            const statusResp = await fetch(`/api/generation/status/${runId}`);
            if (!statusResp.ok) throw new Error(`HTTP ${statusResp.status}`);

            const data = await statusResp.json();
            if (cancelledRef.current) return;

            if (data.status === 'done') {
              setProgress(prev => prev.map(p => ({ ...p, status: 'done' as const })));
              setCurrentChapter('');

              // 自动写入邮件（正文 + 主题）
              if (data.emailPayload) {
                try {
                  if (data.emailPayload.subject) {
                    await setMailSubject(data.emailPayload.subject);
                  }
                  await writeEmailToMail(data.emailPayload);
                } catch (e) {
                  console.error('[WriteProgress] writeEmailToMail 失败:', e);
                }
              }

              if (cancelledRef.current) return;

              // 构建 sections 数据供 ResultsPanel 使用
              const sections: GenerationSection[] = (data.emailPayload?.sourceTree ?? [])
                .map((s: { title: string; score: number; citations?: unknown[] }) => ({
                  title: s.title,
                  content: '',
                  groundingScore: s.score ?? data.trustScore ?? 0,
                  sources: [],
                }));
              onCompleteRef.current(runId, sections);
              return;
            }

            if (data.status === 'error') {
              setError(data.error ?? '生成失败');
              return;
            }

            if (data.progress?.currentChapter) {
              setCurrentChapter(data.progress.currentChapter);
              const idx = data.progress.index ?? 0;
              setProgress(prev => prev.map((p, i) => {
                if (i < idx) return { ...p, status: 'done' as const };
                if (i === idx) return { ...p, status: 'generating' as const };
                return p;
              }));
            }

            pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          } catch (err) {
            if (cancelledRef.current) return;
            pollTimer = setTimeout(poll, POLL_INTERVAL_MS * 2);
          }
        };

        poll();
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    start();

    return () => {
      cancelledRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [outline, userRequest]);

  const completedCount = progress.filter(p => p.status === 'done').length;
  const total = progress.length;
  const percent = total > 0 ? completedCount / total : 0;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text className={styles.title}>正在生成邮件</Text>
      </div>

      {currentChapter && (
        <Text className={styles.currentChapter}>正在生成：{currentChapter}</Text>
      )}

      <Text>{completedCount} / {total} 段落</Text>

      <ProgressBar value={percent} max={1} />

      {error && (
        <Text className={styles.error}>{error}</Text>
      )}

      <div className={styles.chapterList}>
        {progress.map((chapter, i) => (
          <div key={i} className={styles.chapterItem}>
            {chapter.status === 'done' && '✅'}
            {chapter.status === 'generating' && <Spinner size="tiny" />}
            {chapter.status === 'pending' && '⏳'}
            <Text>{chapter.title}</Text>
          </div>
        ))}
      </div>
    </div>
  );
}
