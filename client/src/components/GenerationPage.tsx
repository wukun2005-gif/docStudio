import { useState } from "react";
import ChatBox from "./ChatBox";
import OutlineEditor from "./OutlineEditor";

interface OutlineSection {
  id: string;
  title: string;
  level: number;
  children: OutlineSection[];
  description?: string;
}

export default function GenerationPage() {
  const [outline, setOutline] = useState<OutlineSection[]>([]);
  const [document, setDocument] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [trustScore, setTrustScore] = useState<number | null>(null);

  function handleOutlineRequest(suggested: Array<{ title: string; description?: string }>) {
    const outlineData: OutlineSection[] = suggested.map((s, idx) => ({
      id: `s${idx + 1}`,
      title: s.title,
      level: 1,
      children: [],
      description: s.description,
    }));
    setOutline(outlineData);
  }

  async function handleGenerate() {
    if (outline.length === 0) return;
    setGenerating(true);
    setDocument(null);

    try {
      const res = await fetch("/api/generation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: outline[0]?.title ?? "文档",
          outline,
          format: "html",
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setDocument(data.content);
        setTrustScore(data.trustScore);
      } else {
        setDocument(`<p>生成失败: ${data.error}</p>`);
      }
    } catch (err) {
      setDocument(`<p>生成失败: ${err instanceof Error ? err.message : String(err)}</p>`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-120px)]">
      {/* 左侧：Chat + 大纲 */}
      <div className="w-1/3 flex flex-col gap-4">
        <div className="flex-1 bg-white rounded-lg border shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b font-medium">💬 Chat</div>
          <div className="flex-1 overflow-hidden">
            <ChatBox onOutlineRequest={handleOutlineRequest} />
          </div>
        </div>

        {outline.length > 0 && (
          <OutlineEditor
            outline={outline}
            onChange={setOutline}
            onGenerate={handleGenerate}
          />
        )}
      </div>

      {/* 右侧：文档预览 */}
      <div className="flex-1 bg-white rounded-lg border shadow-sm overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-medium">📄 文档预览</span>
          {trustScore !== null && (
            <span className={`px-2 py-1 rounded text-sm ${
              trustScore >= 0.8 ? "bg-green-100 text-green-700" :
              trustScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
              "bg-red-100 text-red-700"
            }`}>
              信任度: {(trustScore * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {generating ? (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-500">正在生成文档...</p>
            </div>
          ) : document ? (
            <div
              className="prose max-w-none"
              dangerouslySetInnerHTML={{ __html: document }}
            />
          ) : (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg mb-2">📝</p>
              <p>通过 Chat 描述你的需求，调整大纲后一键生成</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
