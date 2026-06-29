/**
 * Case 列表侧边栏 — 支持折叠（图标模式）和展开（完整模式）
 */
import { useEffect, useState } from "react";
import { useCaseStore } from "../store/caseStore.js";

const STATE_LABELS: Record<string, string> = {
  draft: "编辑中",
  "outline-ready": "大纲就绪",
  generating: "生成中",
  evaluating: "评估中",
  completed: "已完成",
  error: "失败",
};

const STATE_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  "outline-ready": "bg-blue-100 text-blue-700",
  generating: "bg-yellow-100 text-yellow-700",
  evaluating: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
};

interface CaseListProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function CaseList({ collapsed, onToggle }: CaseListProps) {
  const { cases, currentCase, isLoading, loadCases, createCase, openCase, deleteCase } = useCaseStore();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    loadCases();
  }, []);

  const filtered = search
    ? cases.filter((c) => c.title.includes(search) || c.userRequest.includes(search))
    : cases;

  function handleNew() {
    createCase("");
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (confirm("确定删除此文档？")) {
      deleteCase(id);
    }
  }

  function handleRenameStart(e: React.MouseEvent, c: { id: string; title: string }) {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title);
  }

  function handleRenameConfirm(id: string) {
    if (editTitle.trim()) {
      useCaseStore.getState().updateTitle(editTitle.trim());
    }
    setEditingId(null);
  }

  // 折叠模式：图标栏
  if (collapsed) {
    return (
      <div className="w-12 shrink-0 bg-white border-r flex flex-col items-center py-3 gap-2">
        <button
          onClick={handleNew}
          className="w-8 h-8 rounded flex items-center justify-center text-blue-600 hover:bg-blue-50 text-lg"
          title="新建文档"
        >
          +
        </button>
        <div className="w-6 border-t my-1" />
        {cases.slice(0, 20).map((c) => (
          <button
            key={c.id}
            onClick={() => openCase(c.id)}
            className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium transition-colors ${
              currentCase?.id === c.id
                ? "bg-blue-100 text-blue-700"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            title={c.title || "未命名文档"}
          >
            {(c.title || "文")[0]}
          </button>
        ))}
      </div>
    );
  }

  // 展开模式：完整列表
  return (
    <div className="w-60 shrink-0 flex flex-col bg-white border-r overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">文档列表</h2>
          <button
            onClick={handleNew}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            + 新建
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索..."
          className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-center text-gray-400 text-sm">加载中...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="p-4 text-center text-gray-400 text-sm">
            {search ? "无匹配结果" : "暂无文档"}
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => openCase(c.id)}
            className={`group px-3 py-2 cursor-pointer border-b hover:bg-gray-50 transition-colors ${
              currentCase?.id === c.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleRenameConfirm(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameConfirm(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 border-b border-blue-400 outline-none text-sm bg-transparent"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-sm text-gray-800 truncate flex-1">{c.title || "未命名文档"}</span>
              )}
              <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => handleRenameStart(e, c)}
                  className="text-gray-400 hover:text-blue-600 text-xs"
                  title="重命名"
                >
                  ✏️
                </button>
                <button
                  onClick={(e) => handleDelete(e, c.id)}
                  className="text-gray-400 hover:text-red-500 text-xs"
                  title="删除"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-gray-300 font-mono" title={c.id}>
                {c.id}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_COLORS[c.workflowState] || "bg-gray-100"}`}>
                {STATE_LABELS[c.workflowState] || c.workflowState}
              </span>
              <span className="text-[10px] text-gray-400">
                {new Date(c.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}