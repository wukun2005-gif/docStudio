/**
 * AppShell — Outlook Add-in Task Pane 顶层容器
 *
 * 行为：
 * - 顶部栏：Logo + 标题 + mail 模式徽章（Read/Compose）+ 刷新按钮
 * - 中部：WriteTab 主面板（chat → outline → generating → results）
 * - 全局错误提示
 */
import { Spinner, tokens, Badge } from "@fluentui/react-components";
import { ArrowSync24Regular, Mail24Regular } from "@fluentui/react-icons";
import { useMailContext } from "../hooks/useMailContext";
import WriteTab from "./WriteTab";

export function App() {
  const { context, loading, error, refresh } = useMailContext();

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: tokens.colorNeutralBackground1,
      }}
    >
      {/* ── 顶部栏 ── */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: tokens.colorNeutralBackground2,
        }}
      >
        <Mail24Regular style={{ color: tokens.colorBrandForeground1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Generate Mail with Knowledge</div>
        </div>
        {context && (
          <Badge
            appearance="tint"
            color={context.mode === "compose" ? "success" : "informative"}
            size="small"
          >
            {context.mode === "compose" ? "撰写" : context.mode === "read" ? "阅读" : "未知"}
          </Badge>
        )}
        <button
          type="button"
          onClick={refresh}
          title="刷新邮件上下文"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <ArrowSync24Regular />
        </button>
      </div>

      {/* ── 错误提示 ── */}
      {error && (
        <div
          style={{
            padding: 8,
            background: "#fef0ee",
            color: "#a1260d",
            fontSize: 12,
            borderBottom: `1px solid #f5d6d2`,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* ── 主面板 ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {loading || !context ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spinner size="small" label="加载邮件上下文…" />
          </div>
        ) : (
          <WriteTab />
        )}
      </div>
    </div>
  );
}
