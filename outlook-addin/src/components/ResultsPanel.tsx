/**
 * ResultsPanel — 显示生成结果 + 写回邮件正文按钮
 *
 * 关键功能：
 * - 显示邮件主题、正文预览
 * - 显示综合质量分（trust_score）
 * - 显示参考来源（citations）
 * - "写回邮件正文"按钮（仅 compose 模式可点）
 */
import { useState } from "react";
import { Button, Card, tokens, Badge, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { MailEdit24Regular, Checkmark24Regular } from "@fluentui/react-icons";
import type { EmailWritePayload } from "../services/apiClient";
import { writeEmailToMail, setMailSubject, canWriteToMail } from "../services/mailWriteService";

export interface ResultsPanelProps {
  payload: EmailWritePayload;
  mode: "read" | "compose" | "unknown";
  onReset: () => void;
}

export function ResultsPanel({ payload, mode, onReset }: ResultsPanelProps) {
  const [writing, setWriting] = useState(false);
  const [writeResult, setWriteResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canWrite = canWriteToMail() && mode === "compose";

  const handleWriteToMail = async () => {
    setWriting(true);
    setWriteResult(null);
    try {
      // 1. 写主题
      const subRes = await setMailSubject(payload.subject);
      if (!subRes.ok) {
        setWriteResult({ ok: false, message: `设置主题失败：${subRes.error}` });
        setWriting(false);
        return;
      }
      // 2. 写正文
      const bodyRes = await writeEmailToMail(payload);
      if (bodyRes.ok) {
        setWriteResult({
          ok: true,
          message: `✓ 已写入邮件正文（${bodyRes.bytesWritten} 字符）`,
        });
      } else {
        setWriteResult({ ok: false, message: `写入正文失败：${bodyRes.error}` });
      }
    } catch (err) {
      setWriteResult({ ok: false, message: `异常：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setWriting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── 综合质量 ── */}
      <Card style={{ padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>综合质量分</div>
          <Badge
            appearance="filled"
            color={payload.trustScore >= 0.85 ? "success" : payload.trustScore >= 0.6 ? "warning" : "danger"}
          >
            {payload.trustScore.toFixed(2)}
          </Badge>
        </div>
      </Card>

      {/* ── 邮件主题 ── */}
      <Card style={{ padding: 10 }}>
        <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, marginBottom: 4 }}>
          邮件主题
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{payload.subject}</div>
      </Card>

      {/* ── 邮件正文预览（HTML） ── */}
      <Card style={{ padding: 10 }}>
        <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, marginBottom: 6 }}>
          正文预览（{payload.bodyCharCount} 字符）
        </div>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            maxHeight: 240,
            overflow: "auto",
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            borderRadius: 4,
            padding: 8,
            background: tokens.colorNeutralBackground2,
          }}
          dangerouslySetInnerHTML={{ __html: payload.bodyHtml }}
        />
      </Card>

      {/* ── 参考来源 ── */}
      {payload.citations.length > 0 && (
        <Card style={{ padding: 10 }}>
          <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, marginBottom: 6 }}>
            参考来源（{payload.citations.length}）
          </div>
          {payload.citations.map((c) => (
            <div key={c.index} style={{ fontSize: 11, padding: "2px 0" }}>
              [{c.index}]{" "}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" style={{ color: tokens.colorBrandForeground1 }}>
                  {c.title}
                </a>
              ) : (
                <span>{c.title}</span>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* ── 写回按钮（核心功能） ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {canWrite ? (
          <Button
            appearance="primary"
            size="large"
            icon={writeResult?.ok ? <Checkmark24Regular /> : <MailEdit24Regular />}
            onClick={handleWriteToMail}
            disabled={writing}
            style={{ width: "100%" }}
          >
            {writing ? "正在写入邮件…" : writeResult?.ok ? "已写入，再次覆盖" : "写回邮件正文"}
          </Button>
        ) : (
          <MessageBar intent="warning">
            <MessageBarBody>
              {mode === "read"
                ? "当前为阅读模式，无法写回原邮件正文。请点击「新建邮件」后再激活 add-in。"
                : "当前环境不支持写回（Office.js 未就绪）"}
            </MessageBarBody>
          </MessageBar>
        )}

        {writeResult && (
          <MessageBar intent={writeResult.ok ? "success" : "error"}>
            <MessageBarBody>{writeResult.message}</MessageBarBody>
          </MessageBar>
        )}

        <Button appearance="subtle" onClick={onReset}>
          重新生成
        </Button>
      </div>
    </div>
  );
}
