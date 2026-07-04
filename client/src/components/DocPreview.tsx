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
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import DOMPurify from "dompurify";
import DocumentAudit from "./DocumentAudit";
import type { OutlineSection } from "../../../shared/src/types/generation.js";

/** 热力图颜色计算（nf2）— 基于 section sources 和 groundingScore */
export function computeHeatmapColors(
  sections: SectionData[],
): Record<number, { color: string; label: string }> {
  const colors: Record<number, { color: string; label: string }> = {};
  let globalIdx = 0;
  for (const s of sections) {
    const uniqueSources = new Set(s.sources.map((src) => src.sourceId).filter(Boolean));
    const sourceCount = uniqueSources.size;
    const gs = s.groundingScore;
    let color: string;
    let label: string;
    if (gs < 0.5) {
      color = "rgba(239,68,68,0.25)";
      label = "AI 推断";
    } else if (sourceCount >= 2) {
      color = "rgba(34,197,94,0.25)";
      label = "多源验证";
    } else {
      color = "rgba(234,179,8,0.25)";
      label = "单源支撑";
    }
    const paraCount = Math.max((s.content.match(/<(p|h[1-6]|li)\b/gi) || []).length, 1);
    for (let i = 0; i < paraCount; i++) {
      colors[globalIdx + 1] = { color, label };
      globalIdx++;
    }
  }
  return colors;
}

export interface SectionData {
  title: string;
  content: string;
  sources: Array<{ chunkId: string; content: string; score: number; sourceId?: string; sourceName?: string; sourceUrl?: string }>;
  webCitations: Array<{ title: string; url: string; snippet: string; score?: number }>;
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

interface ConflictItem {
  topic: string;
  conflictType: "temporal" | "authority" | "perspective" | "data" | "other";
  claims: Array<{ text: string; source: string; sourceAuthority?: number; timestamp?: string }>;
  severity: "high" | "medium" | "low";
  recommendation?: string;
}

interface EvaluationMetrics {
  groundedness: { score: number; label: string; description: string };
  relevance: { score: number; label: string; description: string; irrelevantSentences?: string[] };
  completeness: { score: number; label: string; description: string; coveredPoints?: string[]; missingPoints?: string[] };
  conflicts?: { hasConflicts: boolean; conflictRate: number; items: ConflictItem[]; label: string; description: string };
}

interface DocPreviewProps {
  content: string | null;
  trustScore: number | null;
  sections: SectionData[];
  generating: boolean;
  runId?: string | null;
  dirtySections?: Set<number>;
  regeneratingSections?: Set<number>;
  documentStyle?: string;
  evaluationMetrics?: EvaluationMetrics | null;
  evaluating?: boolean;
  evaluationProgress?: {
    totalTasks: number;
    tasks: Record<string, { taskLabel: string; status: "running" | "done"; score?: number }>;
  } | null;
  onSectionClick?: (sectionIdx: number) => void;
  onSectionUpdate?: (sectionIdx: number, updated: SectionData) => void;
  onSourceMove?: (fromSectionIdx: number, sourceIdx: number, toSectionIdx: number, type?: string, mode?: "move" | "copy") => void;
  onRegenerateSection?: (sectionIdx: number) => void;
  onSave?: (content: string) => void;
  onEvaluate?: () => void;
}

export default function DocPreview({
  content, trustScore, sections, generating, runId,
  dirtySections, regeneratingSections, documentStyle,
  evaluationMetrics, evaluating, evaluationProgress, onSectionClick, onSectionUpdate, onSourceMove, onRegenerateSection, onSave, onEvaluate,
}: DocPreviewProps) {
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当没有文档内容时，自动关闭评估面板（避免"新建文档后显示评估"的问题）
  useEffect(() => {
    if (content === null) {
      setShowMetrics(false);
    }
  }, [content]);

  // 评估开始时自动展开 metrics 面板
  useEffect(() => {
    if (evaluating) {
      setShowMetrics(true);
    }
  }, [evaluating]);

  // 评估指标到达时自动展开 metrics 面板
  useEffect(() => {
    if (evaluationMetrics) {
      setShowMetrics(true);
    }
  }, [evaluationMetrics]);

  // ── 置信度热力图（nf2）──

  const heatmapColors = useMemo(() => {
    return computeHeatmapColors(showHeatmap ? sections : []);
  }, [showHeatmap, sections]);

  // 热力图 DOM 注入
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const allParas = container.querySelectorAll<HTMLElement>("[id^='para-']");
    allParas.forEach((el) => {
      const match = el.id.match(/^para-(\d+)$/);
      if (!match) return;
      const idx = parseInt(match[1], 10);
      const hc = heatmapColors[idx];
      if (hc) {
        el.style.boxShadow = `inset 4px 0 0 ${hc.color}`;
        el.style.paddingLeft = "8px";
        el.style.borderRadius = "0 4px 4px 0";
      } else {
        el.style.boxShadow = "";
        el.style.paddingLeft = "";
        el.style.borderRadius = "";
      }
    });
  }, [heatmapColors, sanitizedContent]);

  // DOMPurify 净化 + 段落标记
  const sanitizedContent = useMemo(() => {
    if (!content) return null;
    const clean = DOMPurify.sanitize(content, {
      ADD_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6"],
      ADD_ATTR: ["target", "rel", "class", "title", "id"],
    });
    // 给段落元素添加 id，供 insight 中的 [¶N] 引用跳转
    // 先移除已有 id 属性，再注入 para-N id，避免重复 id
    let paraIdx = 0;
    return clean
      .replace(/(<(?:p|h[1-6]|li|div|section)\s[^>]*?)\s*id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1")
      .replace(/<(p|h[1-6]|li|div|section)(\s|>)/gi, (match, tag, after) => {
        paraIdx++;
        return `<${tag} id="para-${paraIdx}"${after}`;
      });
  }, [content]);

  function handleSectionClick(idx: number) {
    setActiveSection(activeSection === idx ? null : idx);
    onSectionClick?.(idx);
  }

  // 滚动到指定段落并高亮
  function scrollToParagraph(text: string) {
    if (!containerRef.current) return;

    // 准备多种匹配模式
    const searchTexts: string[] = [text.substring(0, 30)];
    // 去掉引文标记 [N] 再匹配
    const stripped = text.replace(/\s*\[\d+\]\s*/g, '').trim();
    if (stripped !== text.substring(0, 30)) {
      searchTexts.push(stripped.substring(0, 30));
    }
    // 空格标准化再匹配
    const normalized = text.replace(/[\s\u00A0]+/g, ' ').trim();
    if (!searchTexts.includes(normalized.substring(0, 30))) {
      searchTexts.push(normalized.substring(0, 30));
    }

    const paragraphs = containerRef.current.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
    for (const searchText of searchTexts) {
      for (const para of paragraphs) {
        let content = (para.textContent || '').replace(/[\s\u00A0]+/g, ' ').trim();
        let contentStripped = content.replace(/\s*\[\d+\]\s*/g, '').trim();
        if (
          content.includes(searchText) ||
          contentStripped.includes(searchText)
        ) {
          const htmlPara = para as HTMLElement;
          htmlPara.scrollIntoView({ behavior: "smooth", block: "center" });

          const originalBg = htmlPara.style.backgroundColor;
          const originalTransition = htmlPara.style.transition;
          htmlPara.style.transition = "background-color 0.3s ease";
          htmlPara.style.backgroundColor = "#fef08a";

          setTimeout(() => {
            htmlPara.style.backgroundColor = originalBg;
            setTimeout(() => {
              htmlPara.style.transition = originalTransition;
            }, 300);
          }, 3000);

          return;
        }
      }
    }

    // 未找到匹配时输出调试信息
    console.warn("[scrollToParagraph] 未在文档中找到匹配的段落:", text.substring(0, 80));
  }

  // ── 删除来源 ──
  const handleDeleteSource = useCallback(async (sectionIdx: number, sourceIdx: number) => {
    const section = sections[sectionIdx];
    if (!section) return;
    const source = section.sources[sourceIdx];
    if (!source) return;

    // 保存原始数据用于回滚
    const originalSources = section.sources;

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
        // 回滚 UI
        onSectionUpdate?.(sectionIdx, { ...section, sources: originalSources });
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

  const handleDragLeave = useCallback((e: React.DragEvent, sectionIdx: number) => {
    // 只在鼠标真正离开 section 区域时才清除高亮，避免子元素触发的 dragleave 导致闪烁
    const related = e.relatedTarget as HTMLElement | null;
    if (related && e.currentTarget.contains(related)) return;
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

  // ── HTML ↔ 纯文本转换 ──
  function htmlToPlainText(html: string): string {
    // 用临时 div 解析 HTML，提取纯文本
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    // 将 <br> / </p> / </div> / </h1-h6> / </li> 转为换行
    tmp.innerHTML = tmp.innerHTML
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|section|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ");
    // 去掉所有标签
    const text = tmp.textContent || tmp.innerText || "";
    // 合并多余空行
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  function plainTextToHtml(text: string): string {
    // 按空行分段，每段包 <p>
    const paragraphs = text.split(/\n\s*\n/);
    return paragraphs
      .map((p) => {
        const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
        return `<p>${lines.join("<br/>")}</p>`;
      })
      .join("\n");
  }

  // ── 编辑 ──
  async function handleSave() {
    if (!runId) return;
    setSaving(true);
    try {
      // 纯文本 → HTML 再保存
      const htmlContent = plainTextToHtml(editedContent);
      const res = await fetch(`/api/generation/${runId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: htmlContent }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `保存失败 (${res.status})`);
      }
      onSave?.(htmlContent);
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
      alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // ── 导出 ──
  function handleExport(format: string) {
    if (!runId) return;
    window.open(`/api/generation/${runId}/export/${format}`, "_blank");
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 border-b bg-white">
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-medium text-gray-700">📄 文档预览</span>
            {sections.length > 0 && (
              <span className="text-xs text-gray-400">{sections.length} 个章节</span>
            )}
            {evaluating && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                <span className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                🧪 评估中...
                {evaluationProgress && (
                  <span className="text-purple-500">
                    ({Object.values(evaluationProgress.tasks).filter((t) => t.status === "done").length}/{evaluationProgress.totalTasks})
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 编辑按钮 */}
            {content && runId && !editing && (
              <button
                onClick={() => { setEditing(true); setEditedContent(htmlToPlainText(content)); }}
                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
              >
                ✏️ 编辑
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "保存中..." : "💾 保存"}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditedContent(""); }}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
              </>
            )}
            {/* 导出按钮 */}
            {runId && !editing && (
              <div className="flex gap-1">
                <button
                  onClick={() => handleExport("docx")}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                  title="导出 Word"
                >
                  📄 Word
                </button>
                <button
                  onClick={() => handleExport("pptx")}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                  title="导出 PPT"
                >
                  📊 PPT
                </button>
                <button
                  onClick={() => handleExport("xlsx")}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                  title="导出 Excel"
                >
                  📈 Excel
                </button>
                <button
                  onClick={() => handleExport("eml")}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                  title="导出 Outlook 邮件 (.eml)"
                >
                  📧 Outlook
                </button>
              </div>
            )}
          {content !== null && trustScore !== null && (
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80 ${
                trustScore >= 0.8 ? "bg-green-100 text-green-700" :
                trustScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}
            >
              有据可查度 {(trustScore * 100).toFixed(0)}%
              <span className="text-[10px]">{showMetrics ? "▲" : "▼"}</span>
            </button>
          )}
          {sections.length > 0 && (
            <button
              id="demo-heatmap-toggle"
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                showHeatmap
                  ? "bg-purple-100 text-purple-700 border border-purple-300"
                  : "bg-white text-gray-500 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              🔥 热力图
            </button>
          )}
          </div>
        </div>
        {content !== null && showMetrics && (
          <div className="px-5 pb-4 border-t bg-gray-50 max-h-[50vh] overflow-y-auto">
            <div className="pt-3">
              {/* 三维度指标说明 */}
              <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <p className="text-[11px] text-blue-700 font-medium mb-1">📊 文档质量评估（3 个核心指标）</p>
                <p className="text-[10px] text-blue-600">
                  按照 RAGAS/FActScore 业界标准，从三个维度评估文档质量：
                  <br />
                  • 有据可查度：内容是否有来源支撑（我能信任吗？）
                  <br />
                  • 内容相关度：内容是否与需求相关（这回答了我的问题吗？）
                  <br />
                  • 内容完整度：是否覆盖需求的所有要点（有遗漏吗？）
                </p>
              </div>

              {/* 三维度指标卡片 */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                {/* 有据可查度 */}
                <div className="px-3 py-2 rounded-lg bg-white border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-gray-500">有据可查度</span>
                    <span className={`text-sm font-bold ${
                      trustScore !== null && trustScore >= 0.8 ? "text-green-600" :
                      trustScore !== null && trustScore >= 0.5 ? "text-yellow-600" :
                      "text-red-600"
                    }`}>
                      {trustScore !== null ? `${(trustScore * 100).toFixed(0)}%` : "—"}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        trustScore !== null && trustScore >= 0.8 ? "bg-green-500" :
                        trustScore !== null && trustScore >= 0.5 ? "bg-yellow-500" :
                        "bg-red-500"
                      }`}
                      style={{ width: `${(trustScore ?? 0) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">内容是否有来源支撑</p>
                </div>

                {/* 内容相关度 */}
                <div className="px-3 py-2 rounded-lg bg-white border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-gray-500">内容相关度</span>
                    <span className={`text-sm font-bold ${
                      evaluationMetrics?.relevance?.score != null && evaluationMetrics?.relevance?.score >= 0.8 ? "text-green-600" :
                      evaluationMetrics?.relevance?.score != null && evaluationMetrics?.relevance?.score >= 0.5 ? "text-yellow-600" :
                      "text-gray-400"
                    }`}>
                      {evaluationMetrics?.relevance?.score != null ? `${(evaluationMetrics?.relevance?.score * 100).toFixed(0)}%` : "待评估"}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        evaluationMetrics?.relevance?.score != null && evaluationMetrics?.relevance?.score >= 0.8 ? "bg-green-500" :
                        evaluationMetrics?.relevance?.score != null && evaluationMetrics?.relevance?.score >= 0.5 ? "bg-yellow-500" :
                        "bg-gray-300"
                      }`}
                      style={{ width: `${(evaluationMetrics?.relevance?.score ?? 0) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">内容是否与需求相关</p>
                </div>

                {/* 内容完整度 */}
                <div className="px-3 py-2 rounded-lg bg-white border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-gray-500">内容完整度</span>
                    <span className={`text-sm font-bold ${
                      evaluationMetrics?.completeness?.score != null && evaluationMetrics?.completeness?.score >= 0.8 ? "text-green-600" :
                      evaluationMetrics?.completeness?.score != null && evaluationMetrics?.completeness?.score >= 0.5 ? "text-yellow-600" :
                      "text-gray-400"
                    }`}>
                      {evaluationMetrics?.completeness?.score != null ? `${(evaluationMetrics?.completeness?.score * 100).toFixed(0)}%` : "待评估"}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        evaluationMetrics?.completeness?.score != null && evaluationMetrics?.completeness?.score >= 0.8 ? "bg-green-500" :
                        evaluationMetrics?.completeness?.score != null && evaluationMetrics?.completeness?.score >= 0.5 ? "bg-yellow-500" :
                        "bg-gray-300"
                      }`}
                      style={{ width: `${(evaluationMetrics?.completeness?.score ?? 0) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">是否覆盖需求的所有要点</p>
                </div>
              </div>

              {/* 评估按钮 */}
              {onEvaluate && (
                <button
                  onClick={onEvaluate}
                  disabled={evaluating}
                  className="w-full px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {evaluating ? "⏳ 评估中..." : evaluationMetrics ? "🔄 重新评估" : "🔍 评估内容相关度和完整度"}
                </button>
              )}

              {/* 详细信息 */}
              {evaluationMetrics && (
                <div className="space-y-2">

                  {/* 遗漏要点 */}
                  {evaluationMetrics.completeness?.missingPoints && evaluationMetrics.completeness.missingPoints.length > 0 && (
                    <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200">
                      <p className="text-[11px] text-orange-700 font-medium mb-1">⚠️ 以下需求要点可能未覆盖：</p>
                      <ul className="text-[10px] text-orange-600 space-y-0.5">
                        {evaluationMetrics.completeness.missingPoints.slice(0, 3).map((s, i) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 内容冲突（过滤已 resolved 的，只展示 unresolved/new） */}
                  {(() => {
                    const visibleItems = (evaluationMetrics.conflicts?.items ?? []).filter(
                      (i) => (i as any).status !== "resolved",
                    );
                    if (visibleItems.length === 0) return null;
                    return (
                      <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-[11px] text-red-700 font-medium mb-1">🔴 发现 {visibleItems.length} 处内容冲突：</p>
                        <div className="space-y-2">
                          {visibleItems.slice(0, 2).map((conflict, i) => (
                            <div key={i} className="ml-2">
                              <p className="text-[10px] text-red-600 font-medium">
                                {(conflict as any).severity === "high" ? "🔴" : (conflict as any).severity === "medium" ? "🟡" : "🟢"} {(conflict as any).topic}
                              </p>
                              <ul className="text-[10px] text-red-500 ml-3 space-y-0.5">
                                {((conflict as any).claims ?? []).slice(0, 2).map((claim: any, j: number) => (
                                  <li key={j} className="cursor-pointer hover:underline" onClick={() => scrollToParagraph(claim.text)}>• {claim.source}: {String(claim.text).substring(0, 50)}...</li>
                                ))}
                              </ul>
                              {(conflict as any).recommendation && (
                                <p className="text-[10px] text-red-400 ml-3 mt-0.5">💡 {(conflict as any).recommendation}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 推荐操作 */}
              {trustScore !== null && trustScore < 0.8 && (
                <div className={`mt-3 px-3 py-2 rounded-lg text-xs ${
                  trustScore >= 0.5 ? "bg-yellow-50 text-yellow-800 border border-yellow-200" :
                  "bg-red-50 text-red-800 border border-red-200"
                }`}>
                  {trustScore >= 0.5
                    ? "⚠️ 文档整体可用，但建议补充知识源提高有据可查度"
                    : "❌ 有据可查度较低，建议补充知识源或重新生成后再使用"
                  }
                </div>
              )}

              {/* 章节级详情 */}
              {sections.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-2">各章节有据可查度：</p>
                  <div className="space-y-1.5">
                    {sections.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-24 truncate">{s.title}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              s.groundingScore >= 0.8 ? "bg-green-500" :
                              s.groundingScore >= 0.5 ? "bg-yellow-500" :
                              "bg-red-500"
                            }`}
                            style={{ width: `${s.groundingScore * 100}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium w-8 text-right ${
                          s.groundingScore >= 0.8 ? "text-green-600" :
                          s.groundingScore >= 0.5 ? "text-yellow-600" :
                          "text-red-600"
                        }`}>
                          {(s.groundingScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {generating ? (
          sanitizedContent ? (
            <div className="p-6">
              <div className="doc-content max-w-none" dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
              {sections.length > 0 && (
                <div className="mt-8 pt-6 border-t">{/* 章节来源占位 */}</div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-500 text-sm">正在生成文档...</p>
              <p className="text-gray-400 text-xs mt-1">检索知识库 + Web 搜索 + 生成 + 验证</p>
              </div>
            </div>
          )
            ) : sanitizedContent ? (
          <>
            <div className="p-6" ref={containerRef}>
            {showHeatmap && (
              <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-20 text-xs">
                <div className="font-medium mb-1.5 text-gray-700">置信度热力图</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-3 h-3 rounded" style={{ background: "rgba(34,197,94,0.6)" }} />
                  <span className="text-gray-600">多源交叉验证（≥2 源）</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-3 h-3 rounded" style={{ background: "rgba(234,179,8,0.6)" }} />
                  <span className="text-gray-600">单源支撑（1 源）</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.6)" }} />
                  <span className="text-gray-600">AI 推断（无直接来源）</span>
                </div>
              </div>
            )}
            {/* 编辑模式：textarea */}
            {editing ? (
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="w-full h-full min-h-[400px] border rounded-lg p-4 font-sans text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
                /* 渲染净化后的 HTML 内容 */
                <div
                  className="doc-content max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                />
            )}

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
                        onDragLeave={(e) => handleDragLeave(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                      >
                        <button
                          onClick={() => handleSectionClick(idx)}
                          className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-700">{s.title}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                s.groundingScore >= 0.8 ? "bg-green-100 text-green-700" :
                                s.groundingScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
                                "bg-red-100 text-red-700"
                              }`}
                              title="引用覆盖率：本章节可追溯到具体来源段落的声明比例（逐句验证，最严格指标）"
                            >
                              引用覆盖 {(s.groundingScore * 100).toFixed(0)}%
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
                                      <div className="flex-1 min-w-0" style={{ userSelect: "text" }}>
                                        {src.sourceUrl ? (
                                          <a href={src.sourceUrl} target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium">
                                            📄 {src.sourceName || src.chunkId}
                                          </a>
                                        ) : src.sourceId ? (
                                          <a href={`/api/knowledge/sources/${src.sourceId}/file`} target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium">
                                            📄 {src.sourceName || src.chunkId}
                                          </a>
                                        ) : (
                                          <span className="font-mono text-blue-600">{src.sourceName || `[${src.chunkId}]`}</span>
                                        )}{" "}
                                        <span className="text-gray-400" title={`相关度 ${(src.score * 100).toFixed(0)}%（满分 100%）`}>
                                          {src.score >= 0.7 ? "🟢 高相关" :
                                           src.score >= 0.4 ? "🟡 中相关" :
                                           src.score >= 0.15 ? "🟠 低相关" :
                                           "⚪ 弱相关"}{" "}
                                          {(src.score * 100).toFixed(0)}%
                                        </span>
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSource(idx, i); }}
                                        className="shrink-0 px-2 py-0.5 border border-red-200 text-red-500 hover:bg-red-50 rounded text-[11px] transition-colors"
                                        title="移除此来源"
                                      >
                                        移除
                                      </button>
                                    </div>
                                    <p className="text-gray-500 mt-0.5 line-clamp-2 pr-1 pb-0.5" style={{ userSelect: "text" }}>{src.content}</p>
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
                                      <div className="flex-1 min-w-0" style={{ userSelect: "text" }}>
                                        <a href={c.url} target="_blank" rel="noopener" className="text-green-600 hover:underline">
                                          {c.title}
                                        </a>
                                        {c.score !== undefined && (
                                          <span className="text-gray-400 ml-1" title={`相关度 ${(c.score * 100).toFixed(0)}%（满分 100%）`}>
                                            {c.score >= 0.7 ? "🟢 高相关" :
                                             c.score >= 0.4 ? "🟡 中相关" :
                                             c.score >= 0.15 ? "🟠 低相关" :
                                             "⚪ 弱相关"}{" "}
                                            {(c.score * 100).toFixed(0)}%
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteWebCitation(idx, i); }}
                                        className="shrink-0 px-2 py-0.5 border border-red-200 text-red-500 hover:bg-red-50 rounded text-[11px] transition-colors"
                                        title="移除此来源"
                                      >
                                        移除
                                      </button>
                                    </div>
                                    <p className="text-gray-500 mt-0.5 line-clamp-2 pr-1 pb-0.5" style={{ userSelect: "text" }}>{c.snippet}</p>
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

          {/* 🔍 AI 文档自审 / 压力测试（nf3） */}
          <div className="mt-6">
            <DocumentAudit />
          </div>
          </>

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