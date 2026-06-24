/**
 * 文档预览组件 — 渲染生成的 HTML 文档
 * 使用 DOMPurify 净化 HTML，防止 <body>/<style> 标签的 CSS 泄漏到整个页面
 */
import { useState, useRef, useMemo } from "react";
import DOMPurify from "dompurify";
import type { OutlineSection } from "../../../shared/src/types/generation.js";

export interface SectionData {
  title: string;
  content: string;
  sources: Array<{ chunkId: string; content: string; score: number; sourceId?: string; sourceName?: string; sourceUrl?: string }>;
  webCitations: Array<{ title: string; url: string; snippet: string }>;
  groundingScore: number;
}

interface DocPreviewProps {
  content: string | null;
  trustScore: number | null;
  sections: SectionData[];
  generating: boolean;
  onSectionClick?: (sectionIdx: number) => void;
}

export default function DocPreview({ content, trustScore, sections, generating, onSectionClick }: DocPreviewProps) {
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // DOMPurify 净化：剥离 <body>/<style>/<html>/<head> 等标签，防止 CSS 泄漏
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

            {/* 章节来源详情（可展开） */}
            {sections.length > 0 && (
              <div className="mt-8 pt-6 border-t">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">📊 章节来源详情</h3>
                <div className="space-y-2">
                  {sections.map((s, idx) => (
                    <div key={idx} className="border rounded-lg overflow-hidden">
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
                        </div>
                        <span className="text-gray-400 text-xs">
                          {activeSection === idx ? "▲" : "▼"}
                        </span>
                      </button>
                      {activeSection === idx && (
                        <div className="px-4 pb-3 border-t bg-gray-50">
                          {s.sources.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-500 mb-1">知识库来源：</p>
                              {s.sources.map((src, i) => (
                                <div key={i} className="text-xs text-gray-600 mb-1 pl-2 border-l-2 border-blue-300">
                                  {src.sourceId ? (
                                    <a href={`/api/knowledge/sources/${src.sourceId}/file`} target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium">
                                      📄 {src.sourceName || src.chunkId}
                                    </a>
                                  ) : (
                                    <span className="font-mono text-blue-600">{src.sourceName || `[${src.chunkId}]`}</span>
                                  )}{" "}
                                  <span className="text-gray-400">(score: {src.score.toFixed(2)})</span>
                                  <p className="text-gray-500 mt-0.5 line-clamp-2">{src.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {s.webCitations.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-500 mb-1">Web 来源：</p>
                              {s.webCitations.map((c, i) => (
                                <div key={i} className="text-xs mb-1 pl-2 border-l-2 border-green-300">
                                  <a href={c.url} target="_blank" rel="noopener" className="text-green-600 hover:underline">
                                    {c.title}
                                  </a>
                                  <p className="text-gray-500 mt-0.5 line-clamp-2">{c.snippet}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {s.sources.length === 0 && s.webCitations.length === 0 && (
                            <p className="text-xs text-gray-400 mt-2">无来源信息</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
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
    </div>
  );
}
