/**
 * 文档预览组件 — 渲染生成的 HTML 文档
 * 使用 DOMPurify 净化 HTML，防止 <body>/<style> 标签的 CSS 泄漏到整个页面
 *
 * 融合"章节来源详情"和生成树功能：
 * - 展示知识库来源（可点击跳转）+ Web 来源
 * - 支持删除来源节点
 * - 支持拖拽来源到其他章节
 * - 修改后显式触发重新生成
 */
import { useState, useRef, useMemo, useCallback } from "react";
import DOMPurify from "dompurify";
import type { OutlineSection } from "../../../shared/src/types/generation.js";

export interface SectionData {
  title: string;
  content: string;
  sources: Array<{ chunkId: string; content: string; score: number; sourceId?: string; sourceName?: string; sourceUrl?: string }>;
  webCitations: Array<{ title: string; url: string; snippet: string }>;
  groundingScore: number;
}

interface PendingDrop {
  fromSectionIdx: number;
  sourceIdx: number;
  toSectionIdx: number;
  type: string;
  mouseX: number;
  mouseY: number;
}

interface DocPreviewProps {
  content: string | null;
  trustScore: number | null;
  sections: SectionData[];
  generating: boolean;
  runId?: string | null;
  dirtySections?: Set<number>;
  regeneratingSections?: Set<number>;
  onSectionClick?: (sectionIdx: number) => void;
  onSectionUpdate?: (sectionIdx: number, updated: SectionData) => void;
  onSourceMove?: (fromSectionIdx: number, sourceIdx: number, toSectionIdx: number, type?: string, mode?: "move" | "copy") => void;
  onRegenerateSection?: (sectionIdx: number) => void;
}

export default function DocPreview({
  content, trustScore, sections, generating, runId,
  dirtySections, regeneratingSections,
  onSectionClick, onSectionUpdate, onSourceMove, onRegenerateSection,
}: DocPreviewProps) {
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // DOMPurify 净化
  const sanitizedContent = useMemo(() => {
    if (!content) return null;
    return DOMPurify.sanitize(content, {
      ADD_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6"],
      ADD_ATTR: ["target", "rel", "class", "title"],
    });
  }, [content]);

  function handleSectionClick(idx: number) {
    setActiveSection(activeSection === idx ? null : idx);
    onSectionClick?.(idx);
  }

  // ── 删除来源 ──
  const handleDeleteSource = useCallback(async (sectionIdx: number, sourceIdx: number) => {
    const section = sections[sectionIdx];
    if (!section) return;
    const source = section.sources[sourceIdx];
    if (!source) return;

    // 1. 立即更新 UI：从 section.sources 中移除
    const updatedSources = section.sources.filter((_, i) => i !== sourceIdx);
    const updated: SectionData = { ...section, sources: updatedSources };
    onSectionUpdate?.(sectionIdx, updated);

    // 2. 后端删除 provenance 节点
    if (runId) {
      try {
        const res = await fetch(`/api/provenance/${runId}`);
        const data = await res.json();
        if (data.ok) {
          const node = data.nodes.find((n: any) => n.chunkId === source.chunkId);
          if (node) {
            await fetch(`/api/provenance/${node.id}`, { method: "DELETE" });
          }
        }
      } catch (err) {
        console.error("Delete provenance node failed:", err);
      }
    }
  }, [sections, runId, onSectionUpdate]);

  // ── 删除 Web 来源 ──
  const handleDeleteWebCitation = useCallback((sectionIdx: number, citationIdx: number) => {
    const section = sections[sectionIdx];
    if (!section) return;
    const updated: SectionData = {
      ...section,
      webCitations: section.webCitations.filter((_, i) => i !== citationIdx),
    };
    onSectionUpdate?.(sectionIdx, updated);
  }, [sections, onSectionUpdate]);

  // ── 拖拽 ──
  const handleDragStart = useCallback((e: React.DragEvent, sectionIdx: number, sourceIdx: number, type: "kb" | "web") => {
    e.dataTransfer.setData("application/json", JSON.stringify({ sectionIdx, sourceIdx, type }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, sectionIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSection(sectionIdx);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverSection(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toSectionIdx: number) => {
    e.preventDefault();
    setDragOverSection(null);
    try {
      const { sectionIdx: fromSectionIdx, sourceIdx, type } = JSON.parse(e.dataTransfer.getData("application/json"));
      if (fromSectionIdx === toSectionIdx) return;
      setPendingDrop({ fromSectionIdx, sourceIdx, toSectionIdx, type, mouseX: e.clientX, mouseY: e.clientY });
    } catch {}
  }, []);

  const handlePendingAction = useCallback((mode: "move" | "copy") => {
    if (!pendingDrop) return;
    onSourceMove?.(pendingDrop.fromSectionIdx, pendingDrop.sourceIdx, pendingDrop.toSectionIdx, pendingDrop.type, mode);
    setPendingDrop(null);
  }, [pendingDrop, onSourceMove]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-700">📄 文档预览</span>
          {sections.length > 0 && (
            <span className="text-xs text-gray-400">{sections.length} 个章节</span>
          )}
        </div>
        {trustScore !== null && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            trustScore >= 0.8 ? "bg-green-100 text-green-700" :
            trustScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
            "bg-red-100 text-red-700"
          }`}>
            信任度 {(trustScore * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {generating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-500 text-sm">正在生成文档...</p>
              <p className="text-gray-400 text-xs mt-1">检索知识库 + Web 搜索 + 生成 + 验证</p>
            </div>
          </div>
        ) : sanitizedContent ? (
          <div className="p-6" ref={containerRef}>
            {/* 渲染净化后的 HTML 内容 */}
            <div
              className="doc-content max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />

            {/* 🌳 章节来源详情（可展开、支持拖拽和删除） */}
            {sections.length > 0 && (
              <div className="mt-8 pt-6 border-t">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">🌳 章节来源详情</h3>
                <p className="text-xs text-gray-400 mb-3">拖拽知识节点可将其移动到其他章节；修改后点击"重新生成"更新章节内容</p>
                <div className="space-y-2">
                  {sections.map((s, idx) => {
                    const isDirty = dirtySections?.has(idx) ?? false;
                    const isRegenerating = regeneratingSections?.has(idx) ?? false;
                    const isDragOver = dragOverSection === idx;
                    return (
                      <div
                        key={idx}
                        className={`border rounded-lg overflow-hidden transition-colors ${isDragOver ? "border-blue-400 bg-blue-50" : ""}`}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, idx)}
                      >
                        <button
                          onClick={() => handleSectionClick(idx)}
                          className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-700">{s.title}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              s.groundingScore >= 0.8 ? "bg-green-100 text-green-700" :
                              s.groundingScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
                              "bg-red-100 text-red-700"
                            }`}>
                              {(s.groundingScore * 100).toFixed(0)}%
                            </span>
                            {isDirty && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">已修改</span>
                            )}
                          </div>
                          <span className="text-gray-400 text-xs">
                            {activeSection === idx ? "▲" : "▼"}
                          </span>
                        </button>
                        {activeSection === idx && (
                          <div className="px-4 pb-3 border-t bg-gray-50">
                            {s.sources.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs text-gray-500 mb-1">知识库来源（可拖拽）：</p>
                                {s.sources.map((src, i) => (
                                  <div
                                    key={`${src.chunkId}-${i}`}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, idx, i, "kb")}
                                    className="text-xs text-gray-600 mb-1.5 pl-2 border-l-2 border-blue-300 cursor-grab active:cursor-grabbing hover:bg-blue-50 rounded-r transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-2 pr-1">
                                      <div className="flex-1 min-w-0">
                                        {src.sourceId ? (
                                          <a href={`/api/knowledge/sources/${src.sourceId}/file`} target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium">
                                            📄 {src.sourceName || src.chunkId}
                                          </a>
                                        ) : (
                                          <span className="font-mono text-blue-600">{src.sourceName || `[${src.chunkId}]`}</span>
                                        )}{" "}
                                        <span className="text-gray-400">(score: {src.score.toFixed(2)})</span>
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSource(idx, i); }}
                                        className="shrink-0 px-2 py-0.5 border border-red-200 text-red-500 hover:bg-red-50 rounded text-[11px] transition-colors"
                                        title="移除此来源"
                                      >
                                        移除
                                      </button>
                                    </div>
                                    <p className="text-gray-500 mt-0.5 line-clamp-2 pr-1 pb-0.5">{src.content}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.webCitations.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs text-gray-500 mb-1">Web 来源（可拖拽）：</p>
                                {s.webCitations.map((c, i) => (
                                  <div
                                    key={i}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, idx, i, "web")}
                                    className="text-xs mb-1.5 pl-2 border-l-2 border-green-300 cursor-grab active:cursor-grabbing hover:bg-green-50 rounded-r transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-2 pr-1">
                                      <div className="flex-1 min-w-0">
                                        <a href={c.url} target="_blank" rel="noopener" className="text-green-600 hover:underline">
                                          {c.title}
                                        </a>
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteWebCitation(idx, i); }}
                                        className="shrink-0 px-2 py-0.5 border border-red-200 text-red-500 hover:bg-red-50 rounded text-[11px] transition-colors"
                                        title="移除此来源"
                                      >
                                        移除
                                      </button>
                                    </div>
                                    <p className="text-gray-500 mt-0.5 line-clamp-2 pr-1 pb-0.5">{c.snippet}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.sources.length === 0 && s.webCitations.length === 0 && (
                              <p className="text-xs text-gray-400 mt-2">无来源信息</p>
                            )}
                            {/* 重新生成按钮 */}
                            {isDirty && (
                              <div className="mt-3 pt-2 border-t border-gray-200">
                                <button
                                  onClick={() => onRegenerateSection?.(idx)}
                                  disabled={isRegenerating}
                                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                    isRegenerating
                                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                      : "bg-blue-600 text-white hover:bg-blue-700"
                                  }`}
                                >
                                  {isRegenerating ? "⏳ 重新生成中..." : "🔄 重新生成此章节"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-4xl mb-3">📝</p>
              <p className="text-sm">通过右侧对话描述需求，调整大纲后一键生成</p>
            </div>
          </div>
        )}
      </div>

      {/* 拖拽操作选择弹窗 */}
      {pendingDrop && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPendingDrop(null)} />
          <div
            className="fixed z-50 bg-white rounded-lg shadow-lg border px-3 py-2 flex items-center gap-2"
            style={{ left: pendingDrop.mouseX + 8, top: pendingDrop.mouseY - 20 }}
          >
            <span className="text-xs text-gray-500">拖拽到「{sections[pendingDrop.toSectionIdx]?.title}」</span>
            <button
              onClick={() => handlePendingAction("move")}
              className="px-2.5 py-1 text-xs rounded bg-orange-500 text-white hover:bg-orange-600"
            >
              ✂️ 移动
            </button>
            <button
              onClick={() => handlePendingAction("copy")}
              className="px-2.5 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
            >
              📋 复制
            </button>
          </div>
        </>
      )}
    </div>
  );
}
