/**
 * Office Add-in Taskpane React Entry
 *
 * Feature #34-36: Word/Excel/PowerPoint Add-in
 *
 * 复用 client 核心组件，在 Office 侧边栏中运行。
 */
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";

// ── Types ──────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TrustMetrics {
  faithfulness?: number;
  groundedness?: number;
  coherence?: number;
  fluency?: number;
  completeness?: number;
}

// ── App ────────────────────────────────────────────────

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [trustScores, setTrustScores] = useState<TrustMetrics | null>(null);
  const [documentContext, setDocumentContext] = useState("");

  useEffect(() => {
    // Load Office context
    loadOfficeContext();
  }, []);

  async function loadOfficeContext() {
    try {
      // @ts-expect-error Office.js is loaded globally
      if (typeof Office !== "undefined") {
        // @ts-expect-error Office.js
        await Office.onReady();
        // Try to get document content
        try {
          // @ts-expect-error Word API
          await Word.run(async (ctx: any) => {
            const body = ctx.document.body;
            body.load("text");
            await ctx.sync();
            setDocumentContext(body.text.slice(0, 2000));
          });
        } catch {
          try {
            // @ts-expect-error Excel API
            await Excel.run(async (ctx: any) => {
              const sheet = ctx.workbook.worksheets.getActiveWorksheet();
              const range = sheet.getUsedRange();
              range.load("values");
              await ctx.sync();
              setDocumentContext(JSON.stringify(range.values).slice(0, 2000));
            });
          } catch {
            // Not in Word or Excel
          }
        }
      }
    } catch (err) {
      console.warn("Office context not available:", err);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          context: { documentContent: documentContext },
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setMessages(prev => [...prev, { role: "assistant", content: data.content ?? "" }]);
        if (data.trustScores) {
          setTrustScores(data.trustScores);
        }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleInsert() {
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    if (!lastAssistant) return;

    try {
      // @ts-expect-error Word API
      await Word.run(async (ctx: any) => {
        ctx.document.body.insertParagraph(lastAssistant.content, "End");
        await ctx.sync();
      });
    } catch {
      try {
        // @ts-expect-error Excel API
        await Excel.run(async (ctx: any) => {
          const sheet = ctx.workbook.worksheets.getActiveWorksheet();
          const range = sheet.getUsedRange();
          range.load("rowCount");
          await ctx.sync();
          sheet.getRangeByIndex(range.rowCount + 1, 0).values = [[lastAssistant.content]];
          await ctx.sync();
        });
      } catch (err) {
        alert(`无法插入: ${err}`);
      }
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "-apple-system, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e0e0e0" }}>
        <span style={{ fontSize: 24 }}>✍️</span>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>i-Write</h1>
      </div>

      {/* Chat Messages */}
      <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              marginBottom: 8,
              borderRadius: 8,
              background: msg.role === "user" ? "#4A90D9" : "#f0f0f0",
              color: msg.role === "user" ? "white" : "#333",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{ padding: "8px 12px", color: "#999", fontSize: 13 }}>
            生成中...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ background: "white", borderRadius: 8, padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入你的文档需求..."
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, resize: "none" }}
          rows={3}
        />
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button
            onClick={handleSend}
            disabled={loading}
            style={{ padding: "8px 16px", background: "#4A90D9", color: "white", border: "none", borderRadius: 6, fontSize: 14, cursor: "pointer" }}
          >
            生成文档
          </button>
          <button
            onClick={handleInsert}
            style={{ padding: "8px 16px", background: "#e0e0e0", color: "#333", border: "none", borderRadius: 6, fontSize: 14, cursor: "pointer" }}
          >
            插入到文档
          </button>
        </div>
      </div>

      {/* Trust Report */}
      {trustScores && (
        <div style={{ background: "white", borderRadius: 8, padding: 12, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>📊 信任度报告</h3>
          {trustScores.faithfulness !== undefined && (
            <MetricRow label="Faithfulness" value={trustScores.faithfulness} />
          )}
          {trustScores.groundedness !== undefined && (
            <MetricRow label="Groundedness" value={trustScores.groundedness} />
          )}
          {trustScores.coherence !== undefined && (
            <MetricRow label="Coherence" value={trustScores.coherence} />
          )}
          {trustScores.completeness !== undefined && (
            <MetricRow label="Completeness" value={trustScores.completeness} />
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "#4CAF50" : value >= 0.5 ? "#FF9800" : "#f44336";

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
      <span style={{ fontSize: 13, color: "#666" }}>{label}</span>
      <div style={{ width: 60, height: 6, background: "#e0e0e0", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{value.toFixed(2)}</span>
    </div>
  );
}

// ── Mount ──────────────────────────────────────────────

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<App />);
