/**
 * Outlook Add-in 入口
 *
 * 关键决策：
 * - React 立即挂载（不等待 Office.onReady），避免 white screen
 * - 监听 Office.onReady 后才启用 mail 写入能力（避免在 host 未就绪时调用 Office.context.mailbox）
 * - 使用 ErrorBoundary 包裹，避免任意一处异常导致整个 add-in 白屏
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./components/AppShell";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#a1260d" }}>
          <h3>Add-in 出现异常</h3>
          <pre style={{ fontSize: 12 }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <FluentProvider theme={webLightTheme}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </FluentProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
