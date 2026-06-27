/**
 * 文档生成页面 — 中间主区域：大纲编辑 + 文档预览
 */
import { useState, useEffect, useCallback } from "react";
import OutlineEditor from "./OutlineEditor";
import DocPreview, { type SectionData } from "./DocPreview";
import { useCaseStore } from "../store/caseStore.js";
import { updateCase as repoUpdateCase } from "../lib/caseRepo.js";
import { localIso } from "../../../shared/src/datetime.js";
import type { OutlineSection } from "../../../shared/src/types/generation.js";

// ── Composable Prompt Layers: 模板选项类型 ──
interface StyleOption { id: string; name: string; description: string; isBuiltin?: boolean }
interface FormatOption { id: string; name: string }
interface AudienceOption { id: string; name: string; guidance: string; isBuiltin?: boolean }

/** 转义 HTML 特殊字符，防止 XSS */
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export default function GenerationPage() {
  const currentCase = useCaseStore((s) => s.currentCase);
  const updateOutline = useCaseStore((s) => s.updateOutline);
  const updateGeneratedContent = useCaseStore((s) => s.updateGeneratedContent);
  const updateWorkflowState = useCaseStore((s) => s.updateWorkflowState);
  const updateLastRunId = useCaseStore((s) => s.updateLastRunId);
  const createCase = useCaseStore((s) => s.createCase);
  const updateUserRequest = useCaseStore((s) => s.updateUserRequest);
  const updateTitle = useCaseStore((s) => s.updateTitle);

  const [localOutline, setLocalOutline] = useState<OutlineSection[]>([]);
  const [document, setDocument] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirtySections, setDirtySections] = useState<Set<number>>(new Set());
  const [regeneratingSections, setRegeneratingSections] = useState<Set<number>>(new Set());
  const [documentStyle, setDocumentStyle] = useState<string | undefined>(undefined);
  const [evaluationMetrics, setEvaluationMetrics] = useState<any>(null);
  const [evaluating, setEvaluating] = useState(false);

  // ── Composable Prompt Layers: 维度选择状态 ──
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([]);
  const [formatOptions, setFormatOptions] = useState<FormatOption[]>([]);
  const [audienceOptions, setAudienceOptions] = useState<AudienceOption[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [selectedAudience, setSelectedAudience] = useState<string>("");

  // ── Composable Prompt Layers: 加载模板选项 ──
  useEffect(() => {
    Promise.all([
      fetch("/api/prompt-templates/styles").then((r) => r.json()),
      fetch("/api/prompt-templates/formats").then((r) => r.json()),
      fetch("/api/prompt-templates/audiences").then((r) => r.json()),
    ]).then(([styles, formats, audiences]) => {
      if (styles.ok) setStyleOptions(styles.data);
      if (formats.ok) setFormatOptions(formats.data);
      if (audiences.ok) setAudienceOptions(audiences.data);
    }).catch(() => { /* 静默失败 */ });
  }, []);

  // ── Composable Prompt Layers: 从用户请求自动推断维度 ──
  const autoDetectDimensions = useCallback(async (userRequest: string) => {
    if (!userRequest.trim()) return;
    try {
      const res = await fetch("/api/prompt-templates/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRequest }),
      });
      const data = await res.json();
      if (data.ok) {
        if (!selectedStyle) setSelectedStyle(data.data.style.id);
        if (!selectedFormat) setSelectedFormat(data.data.format.id);
        if (!selectedAudience) setSelectedAudience(data.data.audience.id);
      }
    } catch { /* 静默失败 */ }
  }, [selectedStyle, selectedFormat, selectedAudience]);

  // 从 case 加载数据
  useEffect(() => {
    if (currentCase) {
      setLocalOutline(currentCase.outline);
      setDocument(currentCase.generatedContent ?? null);
      setTrustScore(currentCase.trustScore ?? null);
      setRunId(currentCase.lastRunId ?? null);
      // 恢复 sections 来源详情（重启后从 provenance 重建）
      if (currentCase.lastRunId) {
        fetch(`/api/generation/${currentCase.lastRunId}/sections`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.sections) {
              setSections(data.sections);
            }
          })
          .catch(() => { /* 静默失败，不影响主流程 */ });
        // 恢复 documentStyle
        fetch(`/api/generation/${currentCase.lastRunId}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.run?.document_style) {
              setDocumentStyle(data.run.document_style);
            }
          })
          .catch(() => { /* 静默失败 */ });
        // 恢复已缓存的评估结果
        fetch(`/api/generation/${currentCase.lastRunId}/evaluation`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.evaluation?.metrics) {
              setEvaluationMetrics(data.evaluation.metrics);
            }
          })
          .catch(() => { /* 静默失败 */ });
      } else {
        setSections([]);
      }
    } else {
      setLocalOutline([]);
      setDocument(null);
      setTrustScore(null);
      setSections([]);
      setRunId(null);
      setDirtySections(new Set());
      setDocumentStyle(undefined);
      setEvaluationMetrics(null);
    }
  }, [currentCase?.id]);

  function handleOutlineRequest(suggested: Array<{ title: string; description?: string }>, skipEdit?: boolean, userRequest?: string) {
    console.log("[GenerationPage] handleOutlineRequest called", { suggestedLength: suggested.length, skipEdit, userRequest, currentCaseId: currentCase?.id });

    let targetCase = currentCase;

    if (!targetCase) {
      // 优先使用用户原始消息（如"写邮件"），而非大纲标题
      const userReq = userRequest || suggested.map((s) => s.title).join("、");
      console.log("[GenerationPage] Creating new case", { userReq });
      targetCase = createCase(userReq);
      console.log("[GenerationPage] New case created", { caseId: targetCase.id });
    } else if (userRequest) {
      // 已有 case 时也更新 userRequest
      console.log("[GenerationPage] Updating existing case userRequest", { caseId: targetCase.id, userRequest });
      updateUserRequest(userRequest);
    }

    const outlineData: OutlineSection[] = suggested.map((s, idx) => ({
      id: `s${idx + 1}`,
      title: s.title,
      level: 1,
      children: [],
      description: s.description,
    }));
    console.log("[GenerationPage] Setting local outline", { outlineLength: outlineData.length });
    setLocalOutline(outlineData);

    // 自动推断文档风格、输出格式、目标读者
    const detectReq = userRequest || currentCase?.userRequest || suggested.map((s) => s.title).join("、");
    if (detectReq) autoDetectDimensions(detectReq);

    // 直接更新 case 的 outline，不依赖异步的 currentCase 状态
    if (targetCase) {
      console.log("[GenerationPage] Updating case with outline", { caseId: targetCase.id });
      const updated = { ...targetCase, outline: outlineData, workflowState: "outline-ready" as const, updatedAt: localIso() };
      useCaseStore.getState().setCurrentCase(updated);
      useCaseStore.setState((prev) => ({
        cases: prev.cases.map((c) => c.id === updated.id ? updated : c),
      }));
      repoUpdateCase(updated).catch(console.error);
      console.log("[GenerationPage] Case updated successfully");

      // 情况1：跳过编辑，直接开始生成
      if (skipEdit) {
        console.log("[GenerationPage] skipEdit=true, starting generation immediately");
        // 使用 setTimeout 确保状态更新完成后再触发生成
        setTimeout(() => {
          handleGenerate();
        }, 100);
      }
    } else {
      console.error("[GenerationPage] No target case available to update outline");
    }
  }

  function handleOutlineChange(outline: OutlineSection[]) {
    setLocalOutline(outline);
    updateOutline(outline);
  }

  // 将 handleOutlineRequest 暴露给 ChatBox（通过 window 事件）
  useEffect(() => {
    function handleOutlineEvent(e: CustomEvent) {
      const { outline, userRequest, skipEdit } = e.detail;
      console.log("[GenerationPage] Received outline-request event", { outlineLength: outline.length, userRequest, skipEdit });
      handleOutlineRequest(outline, skipEdit, userRequest);
    }
    console.log("[GenerationPage] Registering outline-request event listener");
    window.addEventListener("outline-request" as any, handleOutlineEvent);
    return () => {
      console.log("[GenerationPage] Unregistering outline-request event listener");
      window.removeEventListener("outline-request" as any, handleOutlineEvent);
    };
  }, [currentCase]);

  async function handleGenerate() {
    if (localOutline.length === 0) return;
    setGenerating(true);
    setDocument(null);
    setSections([]);
    updateWorkflowState("generating");

    // 用 userRequest 作为标题（如"写邮件给苏楠"），而非大纲第一章节名
    const docTitle = currentCase?.userRequest?.trim() || localOutline[0]?.title || "文档";

    try {
      const res = await fetch("/api/generation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle,
          outline: localOutline,
          format: "html",
          userRequest: currentCase?.userRequest ?? localOutline[0]?.title ?? "",
          // Composable Prompt Layers: 传递用户选择的维度
          ...(selectedStyle ? { styleId: selectedStyle } : {}),
          ...(selectedFormat ? { outputFormatId: selectedFormat } : {}),
          ...(selectedAudience ? { audienceId: selectedAudience } : {}),
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
        setDirtySections(new Set());
        setDocumentStyle(data.documentStyle);
        if (data.runId) {
          setRunId(data.runId);
          updateLastRunId(data.runId);
        }
        // 用服务端生成的文件名更新 case 标题
        if (data.title) {
          updateTitle(data.title);
        }
        updateGeneratedContent(data.content, data.trustScore);
        updateWorkflowState("completed");
      } else {
        const safeError = escapeHtml(data.error ?? "未知错误");
        setDocument(`<p style="color:red">生成失败: ${safeError}</p>`);
        updateWorkflowState("error", data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocument(`<p style="color:red">生成失败: ${escapeHtml(msg)}</p>`);
      updateWorkflowState("error", msg);
    } finally {
      setGenerating(false);
    }
  }

  // ── 评估内容相关度和完整度 ──
  const handleEvaluate = async () => {
    if (!runId) return;
    setEvaluating(true);

    try {
      const res = await fetch(`/api/generation/${runId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userRequest: currentCase?.userRequest ?? localOutline[0]?.title ?? "",
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setEvaluationMetrics(data.metrics);
      } else {
        console.error("[GenerationPage] Evaluation failed:", data.error);
      }
    } catch (err) {
      console.error("[GenerationPage] Evaluation error:", err);
    } finally {
      setEvaluating(false);
    }
  };

  // ── 章节来源修改回调 ──

  const handleSectionUpdate = (sectionIdx: number, updated: SectionData) => {
    setSections((prev) => prev.map((s, i) => i === sectionIdx ? updated : s));
    setDirtySections((prev) => new Set(prev).add(sectionIdx));
  };

  const handleSourceMove = (fromSectionIdx: number, sourceIdx: number, toSectionIdx: number, type?: string, mode?: "move" | "copy") => {
    const isCopy = mode === "copy";
    setSections((prev) => {
      const next = [...prev];
      if (type === "web") {
        const citation = next[fromSectionIdx]?.webCitations[sourceIdx];
        if (!citation) return prev;
        if (!isCopy) {
          next[fromSectionIdx] = {
            ...next[fromSectionIdx],
            webCitations: next[fromSectionIdx].webCitations.filter((_, i) => i !== sourceIdx),
          };
        }
        next[toSectionIdx] = {
          ...next[toSectionIdx],
          webCitations: [...next[toSectionIdx].webCitations, citation],
        };
      } else {
        const source = next[fromSectionIdx]?.sources[sourceIdx];
        if (!source) return prev;
        if (!isCopy) {
          next[fromSectionIdx] = {
            ...next[fromSectionIdx],
            sources: next[fromSectionIdx].sources.filter((_, i) => i !== sourceIdx),
          };
        }
        next[toSectionIdx] = {
          ...next[toSectionIdx],
          sources: [...next[toSectionIdx].sources, source],
        };
      }
      return next;
    });
    if (!isCopy) {
      setDirtySections((prev) => {
        const next = new Set(prev);
        next.add(fromSectionIdx);
        next.add(toSectionIdx);
        return next;
      });
    } else {
      // 复制模式：只标记目标章节为 dirty
      setDirtySections((prev) => new Set(prev).add(toSectionIdx));
    }
  };

  const handleRegenerateSection = async (sectionIdx: number) => {
    if (!runId || !localOutline[sectionIdx]) return;
    setRegeneratingSections((prev) => new Set(prev).add(sectionIdx));

    try {
      const res = await fetch(`/api/generation/${runId}/regenerate-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionIdx,
          section: localOutline[sectionIdx],
          outline: localOutline,
        }),
      });
      const data = await res.json();
      if (data.ok && data.section) {
        // 替换该章节
        setSections((prev) => prev.map((s, i) => i === sectionIdx ? data.section : s));
        // 从 dirty 集合中移除
        setDirtySections((prev) => {
          const next = new Set(prev);
          next.delete(sectionIdx);
          return next;
        });
      }
    } catch (err) {
      console.error("Regenerate section failed:", err);
    } finally {
      setRegeneratingSections((prev) => {
        const next = new Set(prev);
        next.delete(sectionIdx);
        return next;
      });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 大纲编辑区（可折叠） */}
      <div className="shrink-0 border-b bg-white">
        {/* Composable Prompt Layers: 维度选择器 */}
        {(styleOptions.length > 0 || formatOptions.length > 0 || audienceOptions.length > 0) && (
          <div className="px-4 py-2 flex items-center gap-3 border-b bg-gray-50 text-xs">
            <span className="text-gray-500 font-medium">📐 文档维度</span>
            {styleOptions.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-gray-500">风格:</span>
                <select
                  className="border rounded px-1.5 py-0.5 text-xs bg-white"
                  value={selectedStyle}
                  onChange={(e) => setSelectedStyle(e.target.value)}
                >
                  <option value="">自动推断</option>
                  {styleOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            {formatOptions.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-gray-500">格式:</span>
                <select
                  className="border rounded px-1.5 py-0.5 text-xs bg-white"
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                >
                  <option value="">自动推断</option>
                  {formatOptions.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
            )}
            {audienceOptions.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-gray-500">读者:</span>
                <select
                  className="border rounded px-1.5 py-0.5 text-xs bg-white"
                  value={selectedAudience}
                  onChange={(e) => setSelectedAudience(e.target.value)}
                >
                  <option value="">自动推断</option>
                  {audienceOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div
          className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50"
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
        runId={runId}
        dirtySections={dirtySections}
        regeneratingSections={regeneratingSections}
        documentStyle={documentStyle}
        evaluationMetrics={evaluationMetrics}
        evaluating={evaluating}
        onSectionUpdate={handleSectionUpdate}
        onSourceMove={handleSourceMove}
        onRegenerateSection={handleRegenerateSection}
        onSave={(newContent) => setDocument(newContent)}
        onEvaluate={handleEvaluate}
      />
    </div>
  );
}
