/**
 * Chat 对话组件 — 嵌入右侧面板，支持会话管理 + 按 case 隔离历史
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { localIso } from "../../../shared/src/datetime.js";
import { useChatStore } from "../store/chatStore.js";
import { useCaseStore } from "../store/caseStore.js";
import {
  getSessionsByCaseId,
  getMessagesBySessionId,
  updateSession as repoUpdateSession,
} from "../lib/chatRepo.js";
import type { ChatSession, ChatMessage } from "../../../shared/src/types/chat.js";

interface ChatBoxProps {
  collapsed?: boolean;
  onOutlineRequest?: (outline: Array<{ title: string; description?: string }>, skipEdit?: boolean, userRequest?: string) => void;
}

export default function ChatBox({ collapsed, onOutlineRequest }: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整 textarea 高度
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 200; // 最大高度 200px
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  // input 变化时调整高度
  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  const {
    sessions,
    messages,
    activeSessionId,
    loadSessions,
    addSession,
    removeSession,
    renameSession,
    loadMessages,
    addMessage,
    setActiveSessionId,
  } = useChatStore();

  const currentCase = useCaseStore((s) => s.currentCase);

  // ── 按 caseId 加载 sessions + messages（照搬 patentExaminator）──
  useEffect(() => {
    const caseId = currentCase?.id;
    console.log("[ChatBox] Loading chat history effect", { caseId });
    if (!caseId) {
      console.log("[ChatBox] No caseId, skipping load");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // case 创建后，将内存中孤立的 session（caseId: undefined）关联到新 case
        // 必须在 loadSessions 之前完成 IndexedDB 写入，否则 loadSessions 会用旧数据覆盖
        const orphanedSessions = useChatStore.getState().sessions.filter((s) => !s.caseId);
        if (orphanedSessions.length > 0) {
          console.log("[ChatBox] Linking orphaned sessions to case", { caseId, count: orphanedSessions.length });
          for (const s of orphanedSessions) {
            const updated = { ...s, caseId, updatedAt: localIso() };
            await repoUpdateSession(updated);  // 确保 IndexedDB 写入完成
            // 同步更新 store（loadSessions 之前）
            useChatStore.setState((prev) => ({
              sessions: prev.sessions.map((x) => (x.id === s.id ? updated : x)),
            }));
          }
        }

        console.log("[ChatBox] Fetching sessions for case", { caseId });
        const storedSessions = await getSessionsByCaseId(caseId);
        if (cancelled) return;
        console.log("[ChatBox] Loaded sessions", { count: storedSessions.length });
        loadSessions(storedSessions);
        const allMessages: ChatMessage[] = [];
        for (const s of storedSessions) {
          const msgs = await getMessagesBySessionId(s.id);
          allMessages.push(...msgs);
        }
        if (!cancelled) {
          console.log("[ChatBox] Loaded messages", { count: allMessages.length });
          loadMessages(allMessages);
        }
      } catch (e) {
        console.error("[ChatBox] Failed to load chat history", e);
      }
    })();
    return () => { cancelled = true; };
  }, [currentCase?.id]);

  // ── Case 内 session 过滤 ─────────────────────────
  const caseSessions = useMemo(
    () => sessions.filter((s) => s.caseId === currentCase?.id),
    [sessions, currentCase?.id],
  );

  // ── effectiveSessionId：优先 activeSessionId，fallback 到第一个 ──
  const effectiveSessionId = useMemo(() => {
    if (activeSessionId && caseSessions.some((s) => s.id === activeSessionId)) return activeSessionId;
    return caseSessions[0]?.id ?? null;
  }, [activeSessionId, caseSessions]);

  // ── 当前 session 的 messages ──────────────────────
  const sessionMessages = useMemo(
    () => messages.filter((m) => m.sessionId === effectiveSessionId),
    [messages, effectiveSessionId],
  );

  // ── Auto scroll ─────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionMessages.length]);

  // ── Create new session ──────────────────────────────
  function handleNewSession() {
    const id = crypto.randomUUID();
    const now = localIso();
    const session: ChatSession = {
      id,
      title: "新对话",
      caseId: currentCase?.id,
      createdAt: now,
      updatedAt: now,
    };
    addSession(session);
    setActiveSessionId(id);
  }

  // ── Send message ────────────────────────────────────
  async function handleSend() {
    if (!input.trim() || loading) return;

    // 在 setInput("") 之前捕获用户输入（用于后续 outline-request 事件和 fetch）
    const userInput = input;

    let sessionId = effectiveSessionId;
    console.log("[ChatBox] handleSend start", { sessionId, currentCaseId: currentCase?.id, input: userInput.slice(0, 50) });

    if (!sessionId) {
      const id = crypto.randomUUID();
      const now = localIso();
      const session: ChatSession = {
        id,
        title: userInput.slice(0, 30),
        caseId: currentCase?.id,
        createdAt: now,
        updatedAt: now,
      };
      console.log("[ChatBox] Creating new session", { id, caseId: currentCase?.id });
      addSession(session);
      setActiveSessionId(id);
      sessionId = id;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: userInput,
      createdAt: localIso(),
    };
    console.log("[ChatBox] Adding user message", { messageId: userMessage.id, sessionId });
    addMessage(userMessage);

    // 如果有 case，同步更新 userRequest
    if (currentCase && !currentCase.userRequest) {
      useCaseStore.getState().updateUserRequest(userInput);
    }

    setInput("");
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    try {
      console.log("[ChatBox] Sending request to /api/chat");
      const fetchBody: any = {
        message: userInput,
        conversationHistory: sessionMessages.map((m) => ({ role: m.role, content: m.content })),
      };
      if ((window as any).__DEMO_MODE__) {
        fetchBody.providerPreference = ["demo"];
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fetchBody),
      });
      const data = await res.json();
      console.log("[ChatBox] Received response", { ok: data.ok, type: data.type, hasOutline: !!data.suggestedOutline, contentLength: data.content?.length });

      if (data.ok) {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId,
          role: "assistant",
          content: data.content,
          type: data.type,
          followUpQuestions: data.followUpQuestions,
          createdAt: localIso(),
        };
        console.log("[ChatBox] Adding assistant message", { messageId: assistantMessage.id, type: data.type });
        addMessage(assistantMessage);

        if (sessionMessages.length === 0) {
          const title = userInput.length > 30 ? userInput.slice(0, 30) + "..." : userInput;
          renameSession(sessionId, title);
          if (currentCase && !currentCase.title) {
            useCaseStore.getState().updateTitle(title);
          }
        }

        if (data.type === "outline_request" && data.suggestedOutline) {
          console.log("[ChatBox] Outline request detected", { outlineLength: data.suggestedOutline.length, skipEdit: data.skipEdit, hasOnOutlineRequest: !!onOutlineRequest });
          if (onOutlineRequest) {
            console.log("[ChatBox] Calling onOutlineRequest callback");
            onOutlineRequest(data.suggestedOutline, data.skipEdit, userInput);
          } else {
            // 跨组件通信：通过 window event，附带用户原始消息
            console.log("[ChatBox] Dispatching outline-request event", { userRequest: userInput, skipEdit: data.skipEdit });
            window.dispatchEvent(new CustomEvent("outline-request", { detail: { outline: data.suggestedOutline, userRequest: userInput, skipEdit: data.skipEdit } }));
          }
        }
      }
    } catch {
      addMessage({
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: "请求失败，请重试。",
        createdAt: localIso(),
      });
    } finally {
      setLoading(false);
    }
  }

  function handleFollowUp(question: string) {
    setInput(question);
  }

  function handleRenameStart(session: ChatSession) {
    setEditingId(session.id);
    setEditTitle(session.title);
  }

  function handleRenameConfirm(id: string) {
    if (editTitle.trim()) {
      renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  }

  // 折叠模式：图标栏
  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 h-full">
        <div className="w-8 h-8 rounded flex items-center justify-center text-gray-500">
          💬
        </div>
        <div className="w-6 border-t my-1" />
        {caseSessions.slice(0, 10).map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium transition-colors ${
              activeSessionId === s.id
                ? "bg-blue-100 text-blue-700"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            title={s.title}
          >
            {s.title[0] || "💬"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session tabs */}
      <div className="border-b px-2 py-1.5 flex items-center gap-1 overflow-x-auto shrink-0">
        {caseSessions.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer shrink-0 transition-colors ${
              activeSessionId === s.id
                ? "bg-blue-100 text-blue-700 font-medium"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            onClick={() => setActiveSessionId(s.id)}
          >
            {editingId === s.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => handleRenameConfirm(s.id)}
                onKeyDown={(e) => e.key === "Enter" && handleRenameConfirm(s.id)}
                className="bg-transparent border-b border-blue-400 outline-none w-20 text-xs"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleRenameStart(s);
                }}
                className="truncate max-w-[80px]"
              >
                {s.title}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeSession(s.id);
              }}
              className="text-gray-400 hover:text-red-500 ml-0.5"
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={handleNewSession}
          className="px-2 py-1 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
          title="新对话"
        >
          +
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sessionMessages.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            <p className="text-2xl mb-2">👋</p>
            <p className="text-sm font-medium text-gray-600">你好！我是 i-Write 文档助手</p>
            <p className="text-xs mt-1">告诉我你想生成什么文档，我来帮你。</p>
          </div>
        )}
        {sessionMessages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-800"
            }`}>
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.followUpQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleFollowUp(q)}
                      className="block w-full text-left text-xs text-blue-600 hover:bg-blue-50 rounded px-2 py-1"
                    >
                      💬 {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm">
              <span className="animate-pulse text-gray-500">思考中...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入你的需求... (Shift+Enter 换行)"
            id="demo-chat-input"
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none overflow-y-auto"
            style={{ minHeight: "40px", maxHeight: "200px" }}
            rows={1}
            disabled={loading}
          />
          <button
            id="demo-chat-send"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm transition-colors shrink-0"
            style={{ height: "40px" }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
