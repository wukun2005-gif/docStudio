/**
 * ChatPanel — 用户输入需求面板
 */
import { useState, useRef, useEffect } from "react";
import { Textarea, tokens, Card } from "@fluentui/react-components";
import { Send24Filled } from "@fluentui/react-icons";

export interface ChatPanelProps {
  onSubmit: (request: string) => void;
  mailSubject?: string;
}

const PRESET_PROMPTS = [
  "帮我向王芳写一封邮件，汇报本周核心产品工作进展",
  "给团队发一封周报邮件，列出本周完成的关键任务",
  "回复客户的咨询邮件，礼貌说明我们的产品方案",
];

export function ChatPanel({ onSubmit, mailSubject }: ChatPanelProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整高度（与 word/ppt 一致）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      {mailSubject && (
        <Card style={{ padding: 8, fontSize: 12, color: tokens.colorNeutralForeground3 }}>
          主题参考：<strong style={{ color: tokens.colorNeutralForeground1 }}>{mailSubject}</strong>
        </Card>
      )}

      <div>
        <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3, marginBottom: 4 }}>
          告诉我你想写什么邮件
        </div>
        <div style={{ position: "relative" }}>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(_, d) => setText(d.value)}
            placeholder="例：帮我向王芳写一封邮件，汇报本周产品工作进展"
            rows={1}
            resize="none"
            style={{
              width: "100%",
              minHeight: 40,
              resize: "none",
              paddingRight: 40, // 留 40px 给浮动发送按钮
              fontSize: 14,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim()}
            title="发送"
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "none",
              background: text.trim() ? tokens.colorBrandBackground : tokens.colorNeutralBackground3,
              color: "#fff",
              cursor: text.trim() ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Send24Filled fontSize={16} />
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3, marginBottom: 6 }}>
          快速开始
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PRESET_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSubmit(p)}
              style={{
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 12,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                borderRadius: 6,
                background: tokens.colorNeutralBackground1,
                cursor: "pointer",
                color: tokens.colorNeutralForeground1,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
