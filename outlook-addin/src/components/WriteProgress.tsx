/**
 * WriteProgress — 生成中状态展示
 */
import { Spinner, tokens, ProgressBar, MessageBar, MessageBarBody } from "@fluentui/react-components";
import type { StatusResponse } from "../services/apiClient";

export interface WriteProgressProps {
  runId: string | null;
  status: StatusResponse | null;
}

export function WriteProgress({ runId, status }: WriteProgressProps) {
  const progress = status?.progress;
  const total = progress?.total ?? 0;
  const current = progress?.index ?? 0;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Spinner size="small" />
        <div style={{ fontSize: 13, fontWeight: 500 }}>正在生成邮件草稿…</div>
      </div>

      {total > 0 && (
        <>
          <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>
            {current} / {total} 章节
          </div>
          <ProgressBar value={percent} max={100} />
          {progress?.currentChapter && (
            <div style={{ fontSize: 12, color: tokens.colorNeutralForeground2 }}>
              当前：{progress.currentChapter}
            </div>
          )}
        </>
      )}

      {runId && (
        <div style={{ fontSize: 10, color: tokens.colorNeutralForeground3, fontFamily: "monospace" }}>
          runId: {runId}
        </div>
      )}

      <MessageBar intent="info">
        <MessageBarBody>
          stub 模式：从 DB 读取 case-1782296242386 的真实生成数据
        </MessageBarBody>
      </MessageBar>
    </div>
  );
}
