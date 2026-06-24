/**
 * 文档生成页面 — 中间主区域：大纲编辑 + 文档预览
 */
import { useState, useEffect } from "react";
import OutlineEditor from "./OutlineEditor";
import DocPreview, { type SectionData } from "./DocPreview";
import { useCaseStore } from "../store/caseStore.js";
import type { OutlineSection } from "../../../shared/src/types/generation.js";

export default function GenerationPage() {
  const currentCase = useCaseStore((s) => s.currentCase);
  const updateOutline = useCaseStore((s) => s.updateOutline);
  const updateGeneratedContent = useCaseStore((s) => s.updateGeneratedContent);
  const updateWorkflowState = useCaseStore((s) => s.updateWorkflowState);
  const createCase = useCaseStore((s) => s.createCase);

  const [localOutline, setLocalOutline] = useState<OutlineSection[]>([]);
  const [document, setDocument] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);

  // 从 case 加载数据
  useEffect(() => {
    if (currentCase) {
      setLocalOutline(currentCase.outline);
      setDocument(currentCase.generatedContent ?? null);
      setTrustScore(currentCase.trustScore ?? null);
    } else {
      setLocalOutline([]);
      setDocument(null);
      setTrustScore(null);
      setSections([]);
    }
  }, [currentCase?.id]);

  function handleOutlineRequest(suggested: Array<{ title: string; description?: string }>) {
    if (!currentCase) {
      const userReq = suggested.map((s) => s.title).join("、");
      createCase(userReq);
    }

    const outlineData: OutlineSection[] = suggested.map((s, idx) => ({
      id: `s${idx + 1}`,
      title: s.title,
      level: 1,
      children: [],
      description: s.description,
    }));
    setLocalOutline(outlineData);
    updateOutline(outlineData);
    updateWorkflowState("outline-ready");
  }

  function handleOutlineChange(outline: OutlineSection[]) {
    setLocalOutline(outline);
    updateOutline(outline);
  }

  // 将 handleOutlineRequest 暴露给 ChatBox（通过 window 事件）
  useEffect(() => {
    function handleOutlineEvent(e: CustomEvent) {
      handleOutlineRequest(e.detail);
    }
    window.addEventListener("outline-request" as any, handleOutlineEvent);
    return () => window.removeEventListener("outline-request" as any, handleOutlineEvent);
  }, [currentCase]);

  async function handleGenerate() {
    if (localOutline.length === 0) return;
    setGenerating(true);
    setDocument(null);
    setSections([]);
    updateWorkflowState("generating");

    try {
      const res = await fetch("/api/generation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: localOutline[0]?.title ?? "文档",
          outline: localOutline,
          format: "html",
          userRequest: currentCase?.userRequest ?? localOutline[0]?.title ?? "",
        }),
      });
      const data = await res.json();

      if (data.ok) {
        console.log("[GenerationPage] generate success, content length:", data.content?.length, "first 500:", data.content?.substring(0, 500));
        // Debug: 检查是否有宽度相关的HTML属性
        if (data.content) {
          const widthMatches = data.content.match(/width[:\s]*[:=]["']?\d+|style="[^"]*width[^"]*"/gi);
          if (widthMatches) console.log("[GenerationPage] FOUND WIDTH in HTML:", widthMatches);
          const tableMatches = data.content.match(/<table[^>]*>/gi);
          if (tableMatches) console.log("[GenerationPage] FOUND TABLE tags:", tableMatches);
        }
        setDocument(data.content);
        setTrustScore(data.trustScore);
        setSections(data.sections ?? []);
        updateGeneratedContent(data.content, data.trustScore);
        updateWorkflowState("completed");
      } else {
        const errHtml = `<p style="color:red">生成失败: ${data.error}</p>`;
        setDocument(errHtml);
        updateWorkflowState("error", data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocument(`<p style="color:red">生成失败: ${msg}</p>`);
      updateWorkflowState("error", msg);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 大纲编辑区（可折叠） */}
      <div className="shrink-0 border-b bg-white">
        <div
          className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 select-none"
          onClick={() => setOutlineCollapsed(!outlineCollapsed)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">📋 文档大纲</span>
            {localOutline.length > 0 && (
              <span className="text-xs text-gray-400">{localOutline.length} 个章节</span>
            )}
          </div>
          <span className="text-gray-400 text-xs">{outlineCollapsed ? "▼ 展开" : "▲ 收起"}</span>
        </div>
        {!outlineCollapsed && (
          <OutlineEditor
            outline={localOutline}
            onChange={handleOutlineChange}
            onGenerate={handleGenerate}
          />
        )}
      </div>

      {/* 文档预览区 */}
      <DocPreview
        content={document}
        trustScore={trustScore}
        sections={sections}
        generating={generating}
      />
    </div>
  );
}
