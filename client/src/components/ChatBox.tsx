import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  type?: string;
  followUpQuestions?: string[];
}

interface ChatBoxProps {
  onOutlineRequest?: (outline: Array<{ title: string; description?: string }>) => void;
}

export default function ChatBox({ onOutlineRequest }: ChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          conversationHistory: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();

      if (data.ok) {
        const assistantMessage: Message = {
          role: "assistant",
          content: data.content,
          type: data.type,
          followUpQuestions: data.followUpQuestions,
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (data.type === "outline_request" && data.suggestedOutline && onOutlineRequest) {
          onOutlineRequest(data.suggestedOutline);
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: "请求失败，请重试。" }]);
    } finally {
      setLoading(false);
    }
  }

  function handleFollowUp(question: string) {
    setInput(question);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-8">
            <p className="text-lg mb-2">👋 你好！我是 i-Write 文档助手</p>
            <p className="text-sm">告诉我你想生成什么文档，我来帮你。</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
              msg.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-white border shadow-sm"
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.followUpQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleFollowUp(q)}
                      className="block w-full text-left text-sm text-blue-600 hover:bg-blue-50 rounded px-2 py-1"
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
            <div className="bg-white border rounded-lg px-4 py-2 shadow-sm">
              <span className="animate-pulse">思考中...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="输入你的需求..."
            className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
