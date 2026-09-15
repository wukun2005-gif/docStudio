/**
 * DemoOverlay — 一键 Demo 的 FakeCursor + Tooltip + 自动演示脚本
 *
 * 参考 GraphMe 的 FakeCursor 实现模式：
 * - 右上角 ▶ 按钮触发自动演示
 * - 模拟用户操作：输入文字、点击按钮、等待加载
 * - 文字解说（Tooltip）解释每一步的功能
 * - 进度条显示演示进度
 * - ESC 或点击任意处中断
 *
 * nf1: 一键 Demo（Mock Mode + FakeCursor + 90s 视频）
 */
import { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { translate as tr } from "../i18n";

interface DemoOverlayProps {
  isPlaying: boolean;
  onStop: () => void;
}

/** Tooltip — 半透明解说气泡，跟随光标 */
function Tooltip({
  text,
  position,
}: {
  text: string;
  position: { x: number; y: number } | null;
}) {
  if (!text || !position) return null;

  const tooltipWidth = Math.min(text.length * 14, 420);
  const left = Math.max(
    10,
    Math.min(position.x - tooltipWidth / 2, window.innerWidth - tooltipWidth - 10),
  );
  const top =
    position.y > window.innerHeight - 80 ? position.y - 48 : position.y + 30;

  return (
    <div
      className="fixed px-3 py-2 text-xs font-medium rounded-lg text-center leading-relaxed max-w-[420px]"
      style={{
        left,
        top,
        zIndex: 9999,
        background: "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(99,102,241,0.95))",
        color: "#fff",
        boxShadow: "0 4px 24px rgba(59,130,246,0.35)",
        pointerEvents: "none",
        transition: "left 0.6s cubic-bezier(0.16, 1, 0.3, 1), top 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {text}
    </div>
  );
}

export default function DemoOverlay({ isPlaying, onStop }: DemoOverlayProps) {
  const [position, setPosition] = useState({ x: -100, y: -100 });
  const [isClicking, setIsClicking] = useState(false);
  const [tooltipText, setTooltipText] = useState("");
  const [progress, setProgress] = useState(0);

  const stopRef = useRef<() => void>(() => {});
  stopRef.current = () => {
    setTooltipText("");
    setPosition({ x: -100, y: -100 });
    setProgress(0);
    onStop();
  };

  const stopDemo = useCallback(() => stopRef.current(), []);

  // ESC 中断
  useEffect(() => {
    if (!isPlaying) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopDemo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPlaying, stopDemo]);

  // 主演示脚本
  useEffect(() => {
    if (!isPlaying) {
      delete (window as any).__DEMO_MODE__;
      return;
    }

    // 标记全局 demo mode，让 ChatBox / GenerationPage 发送 providerPreference: ["demo"]
    (window as any).__DEMO_MODE__ = true;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const TOTAL_DURATION = 180_000; // 180 秒
    const startTime = Date.now();

    const progressInterval = setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - startTime) / TOTAL_DURATION) * 100));
    }, 200);

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms);
        timeouts.push(id);
      });

    const checkCancelled = () => {
      if (cancelled) throw new Error("__CANCELLED__");
    };

    const moveTo = async (x: number, y: number, text: string) => {
      checkCancelled();
      setTooltipText(text);
      setPosition({ x, y });
      await wait(400);
    };

    const moveToCenter = async (text: string, waitMs = 2000) => {
      checkCancelled();
      setTooltipText(text);
      setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      await wait(500);
      checkCancelled();
      await wait(waitMs);
    };

    const moveAndClick = async (
      elementId: string,
      text: string,
      waitAfter = 1500,
      scrollIntoView = false,
    ): Promise<boolean> => {
      checkCancelled();
      for (let attempt = 0; attempt < 5; attempt++) {
        const el = document.getElementById(elementId);
        if (el) {
          if (scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            setTooltipText(text);
            setPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
            await wait(500);
            setIsClicking(true);
            await wait(200);
            el.click();
            setIsClicking(false);
            await wait(waitAfter);
            return true;
          }
        }
        await wait(800);
      }
      return false;
    };

    const typeInInput = async (
      elementId: string,
      text: string,
      waitAfter = 1000,
    ) => {
      checkCancelled();
      const input = document.getElementById(elementId) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!input) return;
    if (input instanceof HTMLTextAreaElement) {
      const textareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (textareaSetter) textareaSetter.call(input, text);
    } else {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, text);
      }
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(waitAfter);
    };

    const dispatchNav = (page: "home" | "generate" | "knowledge" | "settings") => {
      window.dispatchEvent(
        new CustomEvent("demo-nav", { detail: { page } }),
      );
    };

    const scrollList = (containerId: string, scrollAmount = 300) => {
      const el = document.getElementById(containerId);
      if (el) el.scrollBy({ top: scrollAmount, behavior: "smooth" });
    };

    const waitForElement = async (elementId: string, timeoutMs = 15000): Promise<boolean> => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        checkCancelled();
        const el = document.getElementById(elementId);
        if (el) return true;
        await wait(500);
      }
      return false;
    };

    const waitForSelector = async (selector: string, timeoutMs = 15000): Promise<Element | null> => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        checkCancelled();
        const el = document.querySelector(selector);
        if (el) return el;
        await wait(500);
      }
      return null;
    };

    const hideCursor = () => {
      setPosition({ x: -100, y: -100 });
      setTooltipText("");
    };

    // ═══════════════════════════════════════════════
    //  90 秒竞赛演示脚本
    // ═══════════════════════════════════════════════

    const runSequence = async () => {
      try {
        checkCancelled();

        // ── 0-15s: 知识库全景 ─────────────────────
        await wait(1000);
        await moveToCenter(tr("demo.intro"), 2500);

        dispatchNav("knowledge");
        await wait(800);

        // Tab 1: 本地文档
        await moveAndClick("demo-kb-tab-sources", tr("demo.kbLocal"), 1000);
        scrollList("demo-kb-sources-list", 200);
        await wait(1500);
        scrollList("demo-kb-sources-list", 200);
        await wait(1200);

        // Tab 2: 远程 GitHub Repo
        await moveAndClick("demo-kb-tab-code", tr("demo.kbCode"), 1500);

        // Tab 3: 远程文档
        await moveAndClick("demo-kb-tab-remote", tr("demo.kbRemote"), 1500);

        // Tab 4: People Graph
        await moveAndClick("demo-kb-tab-people", tr("demo.kbPeople"), 2000);
        scrollList("demo-people-org-tree", 200);
        await wait(1500);
        scrollList("demo-people-org-tree", 200);
        await wait(1200);
        await moveToCenter(tr("demo.peopleExplain"), 2500);

        await moveToCenter(tr("demo.fourSources"), 2000);

        // ── 15-17s: 切换到生成页面 ─────────────────
        dispatchNav("generate");
        await wait(500);
        await moveToCenter(tr("demo.useKnowledge"), 2000);

        // ── 17-22s: 输入需求 ────────────────────────
        const chatInput = document.getElementById("demo-chat-input");
        if (chatInput) {
          const rect = chatInput.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            tr("demo.describeNeed"),
          );
          await wait(1000);
        }
        await typeInInput("demo-chat-input", tr("demo.demoRequest"), 500);
        await moveAndClick("demo-chat-send", tr("demo.sendAnalyze"), 800);

        // ── 22-28s: 等待大纲生成 ───────────────────
        hideCursor();
        setTooltipText(tr("demo.analyzing"));
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        await wait(1000);
        hideCursor();

        const hasOutline = await waitForElement("demo-generate-btn", 15000);
        if (!hasOutline) {
          setTooltipText(tr("demo.outlineTimeout"));
          setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          await wait(3000);
        }

        // ── 28-32s: 大纲确认 → 点击生成 ──────────
        const generateBtn = document.getElementById("demo-generate-btn");
        if (generateBtn) {
          const rect = generateBtn.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            tr("demo.outlineReady"),
          );
          await wait(2000);
          await moveAndClick("demo-generate-btn", tr("demo.ragStart"), 500);
        }

        // ── 32-45s: 流式生成（隐藏光标，让文档渲染）──
        hideCursor();
        // 等待第一个段落出现
        const firstPara = await waitForSelector("[id^='para-']", 25000);
        if (firstPara) {
          const rect = firstPara.getBoundingClientRect();
          setTooltipText(tr("demo.streaming"));
          setPosition({ x: rect.left + 20, y: rect.top + 20 });
          await wait(2000);
        }
        hideCursor();
        await wait(4000);
        await waitForElement("demo-eval-card", 20000);
        hideCursor();
        await wait(1000);

        // ── 评估指标卡（详细展示） ──────────────────
        await moveToCenter(tr("demo.docDone"), 2500);

        // 等待评估 SSE 完成（demo replay 约 2s，留足缓冲）
        await wait(2000);

        // 评估卡应该在生成后已展开，如果被折叠了则展开
        const evalExpand0 = document.getElementById("demo-eval-expand");
        if (evalExpand0) { evalExpand0.click(); await wait(400); }

        const evalCard0 = document.getElementById("demo-eval-card");
        if (evalCard0) {
          const rect = evalCard0.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 60,
            tr("demo.metricGrounded"),
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            tr("demo.metricRelevant"),
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            tr("demo.metricComplete"),
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            tr("demo.metricConflict"),
          );
          await wait(3000);
        }
        await moveToCenter(tr("demo.fourDimensions"), 2500);

        // 切换到"问题发现" tab，详细解释每种问题
        await moveAndClick("demo-eval-tab-issues", tr("demo.switchIssues"), 2000, true);
        await wait(1000);

        const evalCard2 = document.getElementById("demo-eval-card");
        if (evalCard2) {
          const rect = evalCard2.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            tr("demo.issueUnsupported"),
          );
          await wait(3500);
          scrollList("demo-eval-card", 150);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            tr("demo.issueBlocked"),
          );
          await wait(4000);
          scrollList("demo-eval-card", 200);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            tr("demo.issueBlockedDetail"),
          );
          await wait(3500);
          scrollList("demo-eval-card", 200);
          await wait(1000);
        }
        await moveToCenter(tr("demo.issuesMeaning"), 2500);

        // ── 置信度热力图（详细展示） ────────────────
        // 先折叠评估卡和大纲，让文档内容占满屏幕
        const evalCollapseHeat = document.getElementById("demo-eval-collapse");
        if (evalCollapseHeat) { evalCollapseHeat.click(); await wait(400); }
        const outlineCollapseHeat = document.getElementById("demo-outline-toggle");
        if (outlineCollapseHeat && outlineCollapseHeat.textContent?.includes(tr("demo.collapseWord"))) {
          outlineCollapseHeat.click();
          await wait(400);
        }

        await moveAndClick("demo-heatmap-toggle", tr("demo.heatmapOn"), 2000);
        await moveToCenter(tr("demo.heatmapLegend"), 3000);

        // 滚动文档内容区，展示不同颜色的段落
        const docContainer = document.querySelector(".doc-content");
        if (docContainer) {
          setTooltipText(tr("demo.heatmapScroll"));
          setPosition({ x: 200, y: window.innerHeight / 2 });
          docContainer.scrollIntoView({ behavior: "smooth", block: "start" });
          await wait(1000);
          const scrollEl = docContainer.closest(".overflow-y-auto");
          if (scrollEl) {
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
            await wait(1500);
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
            await wait(1500);
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
          }
          await wait(1000);
          hideCursor();
          await wait(500);
        }
        await moveToCenter(tr("demo.heatmapTakeaway"), 2500);

        // ── 参考来源章节（文档底部引用列表） ────────
        // 直接从当前位置滚动到文档底部，不要移动光标到顶部
        await moveToCenter(tr("demo.footerSources"), 2000);
        if (docContainer) {
          const scrollEl = docContainer.closest(".overflow-y-auto");
          if (scrollEl) {
            scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
            await wait(2000);
          }
        }
        // 光标直接指向 citation footer，保持在附近不晃动
        const citeFooter = document.querySelector(".citations");
        if (citeFooter) {
          const rect = citeFooter.getBoundingClientRect();
          // 光标放在 citation footer 附近，不移动到别处
          await moveTo(rect.left + rect.width / 2, rect.top + 60,
            tr("demo.sourcesSummary"),
          );
          await wait(3500);
          // 光标保持在原位，只换文字
          setTooltipText(tr("demo.refTrust"));
          await wait(2500);
        } else {
          await moveToCenter(tr("demo.refTrust"), 2500);
        }

        // ── 来源生成树（来源溯源树 + 拖拽） ───
        // 直接从文档底部滚动到来源树区域，不要先滚回顶部
        const sourceTreeArea = document.getElementById("demo-source-toggle-0");
        if (sourceTreeArea) {
          sourceTreeArea.scrollIntoView({ behavior: "smooth", block: "start" });
          await wait(1000);
        }
        await moveToCenter(tr("demo.provenanceTree"), 2500);

        await moveAndClick("demo-source-toggle-0", tr("demo.clickSection"), 1500, true);
        await wait(2000);
        await moveToCenter(tr("demo.treeExplain"), 3000);

        // 展开第二个章节用于拖拽演示
        await moveAndClick("demo-source-toggle-0", tr("demo.collapseFirst"), 500, true);
        await moveAndClick("demo-source-toggle-1", tr("demo.expandSecond"), 1500, true);
        await wait(1500);

        // 拖拽来源移动
        await moveToCenter(tr("demo.dragSources"), 2500);

        const s1Toggle = document.getElementById("demo-source-toggle-1");
        const s0Toggle = document.getElementById("demo-source-toggle-0");
        if (s1Toggle && s0Toggle) {
          const s1Panel = s1Toggle.closest(".border.rounded-lg");
          const s0Panel = s0Toggle.closest(".border.rounded-lg");
          const draggableSrc = s1Panel?.querySelector("[draggable]") as HTMLElement;

          if (draggableSrc && s0Panel) {
            // 1. 指向 draggable source
            draggableSrc.scrollIntoView({ behavior: "smooth", block: "center" });
            await wait(800);
            const dsRect = draggableSrc.getBoundingClientRect();
            await moveTo(dsRect.left + dsRect.width / 2, dsRect.top + dsRect.height / 2,
              tr("demo.dragFile"),
            );
            await wait(1000);

            // 2. 发起 dragstart
            const dt = new DataTransfer();
            dt.setData("application/json", JSON.stringify({ sectionIdx: 1, sourceIdx: 0, type: "kb" }));
            dt.effectAllowed = "move";
            draggableSrc.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));

            // 3. 移动到目标
            s0Panel.scrollIntoView({ behavior: "smooth", block: "center" });
            await wait(800);
            const s0Rect = s0Panel.getBoundingClientRect();
            const dropX = s0Rect.left + s0Rect.width / 2;
            const dropY = s0Rect.top + s0Rect.height / 2;
            await moveTo(dropX, dropY,
              tr("demo.dropRelease"),
            );
            await wait(800);

            // 4. dispatch dragover + drop（带坐标，修复弹窗定位 bug）
            s0Panel.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt, clientX: dropX, clientY: dropY }));
            s0Panel.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt, clientX: dropX, clientY: dropY }));
            await wait(800);

            // 5. 点击"移动"按钮（pendingDrop 弹窗，现在应在 drop 位置附近）
            const moveBtns = document.querySelectorAll("button");
            for (const btn of moveBtns) {
              if (btn.textContent?.includes(tr("demo.moveWord"))) {
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                await wait(300);
                const bRect = btn.getBoundingClientRect();
                await moveTo(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2,
                  tr("demo.confirmMove"),
                );
                await wait(400);
                setIsClicking(true);
                await wait(200);
                (btn as HTMLElement).click();
                setIsClicking(false);
                break;
              }
            }
            await wait(1500);

            // 6. 展开目标章节，展示"重新生成"按钮
            const s0ToggleBtn = document.getElementById("demo-source-toggle-0");
            if (s0ToggleBtn) {
              s0ToggleBtn.scrollIntoView({ behavior: "smooth", block: "center" });
              await wait(600);
              s0ToggleBtn.click();
              await wait(800);
            }

            // 7. 找到"重新生成"按钮并展示
            const regenBtn = document.getElementById("demo-regenerate-section");
            if (regenBtn) {
              regenBtn.scrollIntoView({ behavior: "smooth", block: "center" });
              await wait(500);
              const rRect = regenBtn.getBoundingClientRect();
              await moveTo(rRect.left + rRect.width / 2, rRect.top + rRect.height / 2,
                tr("demo.sectionChanged"),
              );
              await wait(2000);
            }
          }
        }
        await moveToCenter(tr("demo.dragTakeaway"), 2500);

        // ── 导出 PPTX ────────────────────────────────
        await moveToCenter(tr("demo.genDoneExport"), 2000);
        // 确保导出按钮可见（大纲折叠状态）
        const exportBtn = document.getElementById("demo-export-pptx");
        if (exportBtn) {
          exportBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          await wait(600);
          const bRect = exportBtn.getBoundingClientRect();
          await moveTo(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2,
            tr("demo.clickExportPpt"),
          );
          await wait(1500);
          setIsClicking(true);
          await wait(200);
          (exportBtn as HTMLElement).click();
          setIsClicking(false);
          await wait(2000);
        }
        await moveToCenter(tr("demo.exportTakeaway"), 2000);

        // ── 回顾 + 结尾 ────────────────────────────
        dispatchNav("generate");
        await wait(500);

        // 展开评估卡
        const evalExpandRecap = document.getElementById("demo-eval-expand");
        if (evalExpandRecap) { evalExpandRecap.click(); await wait(400); }

        // 确保在"评分概览" tab（如果不是则点击切换）
        const evalOverviewTab = document.querySelector("#demo-eval-card button");
        if (evalOverviewTab) {
          // 找到第一个 tab 按钮（评分概览）
          const tabs = document.querySelectorAll("#demo-eval-card > .flex button");
          for (const tab of tabs) {
            if (tab.textContent?.includes(tr("demo.scoreOverviewWord"))) {
              (tab as HTMLElement).click();
              await wait(300);
              break;
            }
          }
        }

        // 展开文档大纲卡
        const outlineExpandRecap = document.getElementById("demo-outline-toggle");
        if (outlineExpandRecap && outlineExpandRecap.textContent?.includes(tr("demo.expandWord"))) {
          outlineExpandRecap.click();
          await wait(400);
        }

        await moveToCenter(tr("demo.recapFlow"), 3500);
        await moveToCenter(tr("demo.recapTagline"), 3500);
        setProgress(100);
        await wait(2000);

        setTooltipText("");
        await wait(2000);
        if (!cancelled) stopDemo();
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "__CANCELLED__") return;
        setTooltipText(`${tr("demo.interruptedPrefix")}${err instanceof Error ? err.message : "unknown"}`);
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        await wait(3000);
        if (!cancelled) stopDemo();
      }
    };

    runSequence();

    return () => {
      cancelled = true;
      clearInterval(progressInterval);
      timeouts.forEach(clearTimeout);
      delete (window as any).__DEMO_MODE__;
    };
  }, [isPlaying]);

  if (!isPlaying) return null;

  return ReactDOM.createPortal(
    <>
      {/* 点击任意处中断 */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 9997 }}
        onClick={stopDemo}
      />

      {/* 进度条 */}
      <div
        className="fixed top-0 left-0 w-full h-1 bg-black/10"
        style={{ zIndex: 9998 }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, #3b82f6, #6366f1)",
          }}
        />
      </div>

      {/* Tooltip 解说 */}
      <Tooltip text={tooltipText} position={position} />

      {/* Fake Cursor（鼠标箭头 SVG） */}
      <div
        className="fixed pointer-events-none"
        style={{
          left: 0,
          top: 0,
          marginLeft: -12,
          marginTop: -12,
          transform: `translate(${position.x}px, ${position.y}px) scale(${isClicking ? 0.7 : 1})`,
          transition: "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
          zIndex: 9999,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 2L20 10.6667L12 13L10 21L4 2Z"
            fill="white"
            stroke="black"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        {isClicking && (
          <div
            className="absolute top-1/2 left-1/2 w-8 h-8 rounded-full border-2 border-blue-400"
            style={{
              transform: "translate(-50%, -50%)",
              opacity: 0,
              animation: "demo-click-ripple 0.4s ease-out",
            }}
          />
        )}
      </div>
    </>,
    document.body,
  );
}
