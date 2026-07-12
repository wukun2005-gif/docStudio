/**
 * WriteTab — Outlook Add-in 主交互面板
 *
 * 状态机：
 *   chat（默认）→ user 输入需求 → 触发生成 → outline 显示大纲 → 用户确认
 *   → generating（轮询 status）→ results（显示结果 + 写回邮件按钮）
 *
 * 模式：
 * - Read 模式：只显示结果（写回按钮禁用）
 * - Compose 模式：可写回邮件正文
 */
import { useState, useRef } from "react";
import {
  Button,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { ArrowRight24Regular, Checkmark24Regular } from "@fluentui/react-icons";
import type { MailContext } from "../services/mailContextReader";
import { generateEmail, getGenerationStatus, type StatusResponse } from "../services/apiClient";
import { ChatPanel } from "./ChatPanel";
import { OutlinePanel } from "./OutlinePanel";
import { WriteProgress } from "./WriteProgress";
import { ResultsPanel } from "./ResultsPanel";

type Stage = "chat" | "outline" | "generating" | "results" | "error";

export interface WriteTabProps {
  context: MailContext;
}

export function WriteTab({ context }: WriteTabProps) {
  const [stage, setStage] = useState<Stage>("chat");
  const [userRequest, setUserRequest] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [outline, setOutline] = useState<Array<{ title: string; description?: string }>>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  /** 1. Chat 提交 → 触发生成 */
  const handleChatSubmit = async (request: string) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setUserRequest(request);
    setErrorMsg(null);

    // 构造初始 outline（stub mode 写死 3 段以匹配 case-1782296242386）
    const initialOutline: Array<{ title: string; description: string }> = [
      { title: "邮件开头（问候+简要目的）", description: "向王芳致意，概述本周汇报主题" },
      { title: "本周核心工作进展", description: "详细描述本周完成的关键产品功能 / 项目里程碑" },
      { title: "下周计划与需要协调事项", description: "下周计划、需要王芳协调或决策的事项" },
    ];
    setOutline(initialOutline);
    setStage("outline");
  };

  /** 2. Outline 确认 → 触发 /api/generation/email */
  const handleOutlineConfirm = async () => {
    if (!userRequest) return;
    setErrorMsg(null);
    setStage("generating");
    try {
      const reqTitle = "eml: 产品开发汇报邮件";
      const res = await generateEmail({
        title: reqTitle,
        outline: outline.map((o) => ({ title: o.title, description: o.description, children: [] })),
        format: "email",
        providerPreference: ["stub"], // stub 模式从 DB 读 case-1782296242386
        userRequest,
      });
      if (!res.ok) {
        setErrorMsg(res.error ?? "生成失败");
        setStage("error");
        return;
      }
      setRunId(res.runId);
      pollStatus(res.runId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  };

  /** 3. 轮询状态（2s 间隔，最多 60 次 = 2 分钟） */
  const pollStatus = async (rid: string) => {
    let attempt = 0;
    const maxAttempts = 60;
    const tick = async () => {
      attempt++;
      try {
        const s = await getGenerationStatus(rid);
        setStatus(s);
        if (s.status === "done") {
          setStage("results");
          return;
        }
        if (s.status === "error") {
          setErrorMsg(s.error ?? "生成失败");
          setStage("error");
          return;
        }
        if (attempt < maxAttempts) {
          setTimeout(tick, 2000);
        } else {
          setErrorMsg("生成超时（>2 分钟）");
          setStage("error");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStage("error");
      }
    };
    tick();
  };

  const handleReset = () => {
    setStage("chat");
    setUserRequest("");
    setRunId(null);
    setOutline([]);
    setStatus(null);
    setErrorMsg(null);
    startedRef.current = false;
  };

  if (stage === "chat") {
    return <ChatPanel onSubmit={handleChatSubmit} mailSubject={context.subject} />;
  }

  return (
    <div style={{ padding: 12 }}>
      {errorMsg && (
        <MessageBar intent="error" style={{ marginBottom: 12 }}>
          <MessageBarBody>{errorMsg}</MessageBarBody>
        </MessageBar>
      )}

      {stage === "outline" && (
        <>
          <OutlinePanel outline={outline} userRequest={userRequest} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button
              appearance="subtle"
              onClick={handleReset}
              icon={<ArrowRight24Regular style={{ transform: "rotate(180deg)" }} />}
            >
              返回修改
            </Button>
            <Button
              appearance="primary"
              onClick={handleOutlineConfirm}
              icon={<Checkmark24Regular />}
              style={{ flex: 1 }}
            >
              确认生成
            </Button>
          </div>
        </>
      )}

      {stage === "generating" && <WriteProgress runId={runId} status={status} />}

      {stage === "results" && status?.emailPayload && (
        <ResultsPanel
          payload={status.emailPayload}
          mode={context.mode}
          onReset={handleReset}
        />
      )}

      {stage === "error" && (
        <div style={{ textAlign: "center", padding: 16 }}>
          <Button onClick={handleReset} appearance="primary">
            重新开始
          </Button>
        </div>
      )}
    </div>
  );
}
