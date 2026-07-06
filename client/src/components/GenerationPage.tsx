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
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirtySections, setDirtySections] = useState<Set<number>>(new Set());
  const [regeneratingSections, setRegeneratingSections] = useState<Set<number>>(new Set());
  const [documentStyle, setDocumentStyle] = useState<string | undefined>(undefined);
  const [evaluationMetrics, setEvaluationMetrics] = useState<any>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState<{
    totalTasks: number;
    tasks: Record<string, { taskLabel: string; status: "running" | "done"; score?: number }>;
  } | null>(null);

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
            } else {
              // 无评估结果时清空，避免其他 case 的旧数据泄漏
              setEvaluationMetrics(null);
            }
          })
          .catch(() => {
            setEvaluationMetrics(null);
          });
      } else {
        setSections([]);
        setEvaluationMetrics(null);
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
      setEvaluating(false);
      setEvaluationProgress(null);
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

    const requestBody: any = {
      title: docTitle,
      outline: localOutline,
      format: "html",
      userRequest: currentCase?.userRequest ?? localOutline[0]?.title ?? "",
      ...(selectedStyle ? { styleId: selectedStyle } : {}),
      ...(selectedFormat ? { outputFormatId: selectedFormat } : {}),
      ...(selectedAudience ? { audienceId: selectedAudience } : {}),
    };
    if ((window as any).__DEMO_MODE__) {
      requestBody.providerPreference = ["demo"];
    }

    const reqJson = JSON.stringify(requestBody);

    // 累积流式章节内容
    let receivedSections: Array<{ title: string; content: string; groundingScore: number; sources: any[]; webCitations: any[] }> = [];

    // 辅助函数：从 DB 获取完整文档内容（toHtml 输出，含引用处理和 footer）
    const fetchFullContentFromDB = async (targetRunId: string | null, base: string): Promise<string | null> => {
      if (!targetRunId) return null;
      try {
        const res = await fetch(`${base}/api/generation/${targetRunId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.ok && data?.run?.content ? data.run.content : null;
      } catch (e) {
        console.warn("[GenerationPage] fetchFullContentFromDB failed:", e);
        return null;
      }
    };

    // 辅助函数：降级到流式收到的 sections 重建内容（丢失引用处理、footer 等）
    const fallbackToReceivedSections = () => {
      if (receivedSections.length > 0) {
        console.log("[GenerationPage] falling back to receivedSections, count:", receivedSections.length);
        const sectionsHtml = receivedSections.map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.content}</section>`).join("\n");
        setDocument(sectionsHtml);
        const groundingScores = receivedSections.map((s) => s.groundingScore).filter((s) => s > 0);
        const avgTrust = groundingScores.length > 0
          ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
          : null;
        setTrustScore(avgTrust);
        setSections(receivedSections as any);
        setDirtySections(new Set());
        updateGeneratedContent(sectionsHtml, avgTrust ?? undefined);
        updateWorkflowState("evaluating");
        setGenerating(false);
        if (runId) {
          evaluateWithSSE(runId);
        }
      } else {
        setDocument(`<p style="color:red">生成失败: 未收到内容</p>`);
        updateWorkflowState("error", "未收到内容");
        setGenerating(false);
      }
    };

    try {
      // 使用 SSE 流式接口（POST 请求，手动解析 SSE 流）
      // 开发环境绕过 Vite 代理直连后端，避免代理层 buffering SSE 响应
      const apiBase = import.meta.env.DEV ? "http://localhost:3000" : "";
      console.log("[SSE] POST ->", `${apiBase}/api/generation/generate/stream`);
      const res = await fetch(`${apiBase}/api/generation/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reqJson,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const safeError = escapeHtml(errorData.error ?? `HTTP ${res.status}`);
        setDocument(`<p style="color:red">生成失败: ${safeError}</p>`);
        updateWorkflowState("error", errorData.error);
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setDocument(`<p style="color:red">生成失败: 无法读取响应流</p>`);
        updateWorkflowState("error", "无法读取响应流");
        setGenerating(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      let eventData = "";  // eventName/eventData 必须在 while 外，跨 chunk 持久化
      let runId: string | null = null;
      let finalData: any = null;
      console.log("[SSE] reader created, entering stream loop");

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[SSE] stream ended (done=true)");
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        console.log(`[SSE] chunk received (${chunk.length} chars):`, chunk.substring(0, 120).replace(/\n/g, "\\n"));
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        console.log(`[SSE] chunk state: eventName="${eventName}" eventData=${eventData.length} bufferRest=${buffer.length}`);

        for (const line of lines) {
          if (line === "") {
            // 事件结束，处理
            console.log(`[SSE] event dispatched: name="${eventName}", data_len=${eventData.length}`);
            if (eventName === "start" && eventData) {
              const startData = JSON.parse(eventData);
              console.log("[SSE] start event parsed:", startData);
              if (startData.runId) {
                runId = startData.runId;
                setRunId(startData.runId);
                updateLastRunId(startData.runId);
              }
            } else if (eventName === "section-start" && eventData) {
              const startInfo = JSON.parse(eventData);
              console.log("[SSE] section-start:", startInfo);
              // 在顶部 header 显示生成进度，不污染 document 内容
              setGenerationProgress({
                current: startInfo.index + 1,
                total: startInfo.total,
                title: startInfo.title,
              });
            } else if (eventName === "section" && eventData) {
              const sectionData = JSON.parse(eventData);
              console.log("[SSE] section:", { title: sectionData.section.title, contentLen: sectionData.section.content?.length });
              receivedSections.push({
                title: sectionData.section.title,
                content: sectionData.section.content,
                groundingScore: sectionData.section.groundingScore,
                sources: sectionData.section.sources,
                webCitations: sectionData.section.webCitations,
              });
              // 实时渲染已收到的章节
              const sectionsHtml = receivedSections.map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.content}</section>`).join("\n");
              setDocument(sectionsHtml);
              setSections(receivedSections as any);
              // 更新 trust score 为当前平均分数
              const groundingScores = receivedSections.map((s) => s.groundingScore).filter((s) => s > 0);
              if (groundingScores.length > 0) {
                const avg = groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length;
                setTrustScore(avg);
              }
            } else if (eventName === "done" && eventData) {
              finalData = JSON.parse(eventData);
              console.log("[SSE] done event:", { ok: finalData.ok });
            } else if (eventName === "error" && eventData) {
              const errData = JSON.parse(eventData);
              console.log("[SSE] error event:", errData);
              const safeError = escapeHtml(errData.error ?? "未知错误");
              setDocument(`<p style="color:red">生成失败: ${safeError}</p>`);
              updateWorkflowState("error", errData.error);
              setGenerating(false);
              setGenerationProgress(null);
              return;
            }
            eventName = "";
            eventData = "";
          } else if (line.startsWith("event: ")) {
            eventName = line.substring(7).trim();
            console.log(`[SSE gen] eventName set to "${eventName}"`);
          } else if (line.startsWith("data: ")) {
            eventData += line.substring(6);
          } else if (line.length > 0) {
            const hexPrefix = Array.from(line.substring(0, 40)).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
            console.warn(`[SSE gen] unmatched line (${line.length} chars): hex[0..40]=${hexPrefix} text="${line.substring(0, 40).replace(/\n/g, '\\n')}"`);
          }
        }
      }
      // ── 流结束后：检查 buffer 中是否还有残留数据 ──
      console.log(`[SSE gen] after stream: bufferRest=${buffer.length} eventName="${eventName}" eventData=${eventData.length}`);

      // ── 流结束后：从 DB 获取完整文档作为最终结果 ──
      // 流式内容只用于实时预览；DB 中的 toHtml() 输出才是权威数据（含引用去重、编号修正、footer）
      if (finalData && finalData.ok) {
        // done event 成功 → 使用 runId 从 DB 拉取完整内容
        const targetRunId = finalData.runId || runId;
        if (finalData.runId) {
          runId = finalData.runId;
          setRunId(finalData.runId);
          updateLastRunId(finalData.runId);
        }
        if (finalData.title) {
          const autoTitle = currentCase?.userRequest?.slice(0, 50);
          const isAutoTitle = !currentCase?.title
            || currentCase.title === "新文档"
            || currentCase.title === autoTitle;
          if (isAutoTitle) {
            updateTitle(finalData.title);
          }
        }
        setDocumentStyle(finalData.documentStyle);

        // 合并 done event 数据和流式收到的 source 数据（done event 的 sections 不含 sources/webCitations）
        const doneSections = finalData.sections ?? [];
        const finalSections = doneSections.map((s: any, i: number) => ({
          ...s,
          sources: receivedSections[i]?.sources ?? [],
          webCitations: receivedSections[i]?.webCitations ?? [],
        }));
        setSections(finalSections.length > 0 ? finalSections : receivedSections as any);
        setDirtySections(new Set());

        // 从 DB 拉取完整 HTML（toHtml 输出，含引用处理和 footer）
        const dbContent = await fetchFullContentFromDB(targetRunId, apiBase);
        if (dbContent) {
          const sectionCount = (dbContent.match(/<section>/g) || []).length;
          const supCount = (dbContent.match(/<sup><a/g) || []).length;
          console.log(`[GenerationPage] loaded full content from DB, length: ${dbContent.length}, sections: ${sectionCount}, sup<a: ${supCount}`);
          setDocument(dbContent);
          updateGeneratedContent(dbContent, finalData.trustScore);
        } else {
          // DB 拉取失败 → 降级到 done event 的 content（可能为空或不完整）
          console.warn("[GenerationPage] DB fetch failed, falling back to done event content");
          setDocument(finalData.content || "<p>文档生成完成，但内容加载失败</p>");
          updateGeneratedContent(finalData.content || "", finalData.trustScore);
        }
        setTrustScore(finalData.trustScore);
        updateWorkflowState("evaluating");
        setGenerating(false);
        setGenerationProgress(null);

        // 生成完成后自动触发评估（SSE 流式）
        if (targetRunId) {
          evaluateWithSSE(targetRunId);
        }
      } else if (finalData) {
        const safeError = escapeHtml(finalData.error ?? "未知错误");
        setDocument(`<p style="color:red">生成失败: ${safeError}</p>`);
        updateWorkflowState("error", finalData.error);
      } else {
        // 流结束但没有 done 事件 → 尝试从 DB 拉取完整内容
        if (runId) {
          console.log("[GenerationPage] no done event, fetching full content from DB, runId:", runId);
          const dbContent = await fetchFullContentFromDB(runId, apiBase);
          if (dbContent) {
            const sectionCount = (dbContent.match(/<section>/g) || []).length;
            const supCount = (dbContent.match(/<sup><a/g) || []).length;
            console.log(`[GenerationPage] loaded full content from DB (no done event), length: ${dbContent.length}, sections: ${sectionCount}, sup<a: ${supCount}`);
            setDocument(dbContent);
            // 计算 trustScore
            const groundingScores = receivedSections.map((s) => s.groundingScore).filter((s) => s > 0);
            const avgTrust = groundingScores.length > 0
              ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
              : null;
            setTrustScore(avgTrust);
            setSections(receivedSections as any);
            setDirtySections(new Set());
            updateGeneratedContent(dbContent, avgTrust ?? undefined);
            updateWorkflowState("evaluating");
            setGenerating(false);
            evaluateWithSSE(runId);
          } else {
            // DB 也拉不到 → 用流式收到的 sections 重建
            fallbackToReceivedSections();
          }
        } else if (receivedSections.length > 0) {
          fallbackToReceivedSections();
        } else {
          setDocument(`<p style="color:red">生成失败: 未收到内容</p>`);
          updateWorkflowState("error", "未收到内容");
          setGenerating(false);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocument(`<p style="color:red">生成失败: ${escapeHtml(msg)}</p>`);
      updateWorkflowState("error", msg);
    } finally {
      // generating state already set above
    }
  }

  // ── 评估内容相关度和完整度（SSE 流式） ──
  const evaluateWithSSE = async (targetRunId: string) => {
    setEvaluating(true);
    setEvaluationProgress(null);
    setEvaluationMetrics(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);

    try {
      const apiBase = import.meta.env.DEV ? "http://localhost:3000" : "";
      const evalBody: any = {
        userRequest: currentCase?.userRequest ?? localOutline[0]?.title ?? "",
      };
      if ((window as any).__DEMO_MODE__) {
        evalBody.providerPreference = ["demo"];
        evalBody.providerId = "demo";
      }
      const res = await fetch(`${apiBase}/api/generation/${targetRunId}/evaluate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evalBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.warn("[GenerationPage] SSE evaluation failed:", err.error);
        updateWorkflowState("completed", err.error);
        setEvaluating(false);
        clearTimeout(timeoutId);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        updateWorkflowState("completed", "无法读取评估流");
        setEvaluating(false);
        clearTimeout(timeoutId);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      let eventData = "";
      let partialMetrics: any = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line === "") {
            if (eventName === "evaluate-start") {
              const data = JSON.parse(eventData);
              setEvaluationProgress({ totalTasks: data.totalTasks, tasks: {} });
            } else if (eventName === "evaluate-progress") {
              const data = JSON.parse(eventData);
              setEvaluationProgress((prev) => prev ? {
                ...prev,
                tasks: { ...prev.tasks, [data.task]: data },
              } : null);
              if (data.status === "done" && data.score !== undefined) {
                partialMetrics[data.task] = { score: data.score };
                setEvaluationMetrics({ ...partialMetrics });
              }
            } else if (eventName === "evaluate-done") {
              const data = JSON.parse(eventData);
              if (data.ok) {
                setEvaluationMetrics(data.metrics);
              }
            } else if (eventName === "error") {
              const data = JSON.parse(eventData);
              console.warn("[GenerationPage] SSE evaluation error:", data.error);
            }
            eventName = "";
            eventData = "";
          } else if (line.startsWith("event: ")) {
            eventName = line.substring(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData += line.substring(6);
          }
        }
      }
      updateWorkflowState("completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "AbortError" || msg.includes("aborted")) {
        updateWorkflowState("completed", "评估超时");
      } else {
        console.warn("[GenerationPage] SSE evaluation stream error:", err);
        updateWorkflowState("completed", msg);
      }
    } finally {
      clearTimeout(timeoutId);
      setEvaluating(false);
      setEvaluationProgress(null);
    }
  };

  const handleEvaluate = async () => {
    if (!runId) return;
    updateWorkflowState("evaluating");
    evaluateWithSSE(runId);
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
          id="demo-outline-toggle"
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
        evaluationProgress={evaluationProgress}
        generationProgress={generationProgress}
        onSectionUpdate={handleSectionUpdate}
        onSourceMove={handleSourceMove}
        onRegenerateSection={handleRegenerateSection}
        onSave={(newContent) => setDocument(newContent)}
        onEvaluate={handleEvaluate}
      />
    </div>
  );
}