import { useState, useRef, useEffect } from "react";

interface DocumentViewerProps {
  content: string;
  runId?: string;
  trustScore?: number;
  onSave?: (content: string) => void;
}

export default function DocumentViewer({ content, runId, trustScore, onSave }: DocumentViewerProps) {
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditedContent(content);
  }, [content]);

  async function handleSave() {
    if (!runId || !onSave) return;
    setSaving(true);
    try {
      await fetch(`/api/generation/${runId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      onSave(editedContent);
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleExport(format: "docx" | "pptx" | "xlsx") {
    if (!runId) return;
    window.open(`/api/generation/${runId}/export/${format}`, "_blank");
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="px-4 py-2 border-b flex items-center justify-between bg-gray-50">
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "💾 保存"}
              </button>
              <button
                onClick={() => { setEditing(false); setEditedContent(content); }}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-100"
            >
              ✏️ 编辑
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {trustScore !== undefined && trustScore !== null && (
            <span className={`px-2 py-1 rounded text-sm ${
              trustScore >= 0.8 ? "bg-green-100 text-green-700" :
              trustScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
              "bg-red-100 text-red-700"
            }`}>
              置信度: {(trustScore * 100).toFixed(0)}%
            </span>
          )}

          {runId && (
            <div className="flex gap-1">
              <button
                onClick={() => handleExport("docx")}
                className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
                title="导出 Word"
              >
                📄 Word
              </button>
              <button
                onClick={() => handleExport("pptx")}
                className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
                title="导出 PPT"
              >
                📊 PPT
              </button>
              <button
                onClick={() => handleExport("xlsx")}
                className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
                title="导出 Excel"
              >
                📈 Excel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {editing ? (
          <textarea
            ref={editorRef}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="w-full h-full min-h-[400px] border rounded-lg p-4 font-sans text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <div
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: editedContent }}
          />
        )}
      </div>
    </div>
  );
}
