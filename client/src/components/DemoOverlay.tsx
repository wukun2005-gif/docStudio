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

    const TOTAL_DURATION = 120_000; // 120 秒
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
        await moveToCenter("i-Write — AI 驱动的可信文档生成工作台", 2500);

        dispatchNav("knowledge");
        await wait(800);

        // Tab 1: 本地文档
        await moveAndClick("demo-kb-tab-sources", "知识库 — 本地文档：会议纪要、邮件、技术文档…", 1000);
        scrollList("demo-kb-sources-list", 200);
        await wait(1500);
        scrollList("demo-kb-sources-list", 200);
        await wait(1200);

        // Tab 2: 远程 GitHub Repo
        await moveAndClick("demo-kb-tab-code", "知识库 — 远程 GitHub 代码仓库", 1500);

        // Tab 3: 远程文档
        await moveAndClick("demo-kb-tab-remote", "知识库 — 远程文档：OneDrive / SharePoint 集成", 1500);

        // Tab 4: People Graph
        await moveAndClick("demo-kb-tab-people", "知识库 — People Graph：组织架构图也是知识库的一部分", 2000);
        scrollList("demo-people-org-tree", 200);
        await wait(1500);
        scrollList("demo-people-org-tree", 200);
        await wait(1200);
        await moveToCenter("People Graph 记录团队成员关系与领域专长，为文档生成提供人力知识上下文", 2500);

        await moveToCenter("4 大知识来源覆盖：本地文档 · 代码仓库 · 远程文档 · 人员关系", 2000);

        // ── 15-17s: 切换到生成页面 ─────────────────
        dispatchNav("generate");
        await wait(500);
        await moveToCenter("现在用这些知识来生成一份文档", 2000);

        // ── 17-22s: 输入需求 ────────────────────────
        const chatInput = document.getElementById("demo-chat-input");
        if (chatInput) {
          const rect = chatInput.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            "一句话描述你的文档需求",
          );
          await wait(1000);
        }
        await typeInInput("demo-chat-input", "请生成一份「Q3技术团队工作总结与业务汇报」PPT演示文稿", 500);
        await moveAndClick("demo-chat-send", "发送 → AI 分析意图", 800);

        // ── 22-28s: 等待大纲生成 ───────────────────
        hideCursor();
        setTooltipText("AI 正在分析需求，生成大纲中…");
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        await wait(1000);
        hideCursor();

        const hasOutline = await waitForElement("demo-generate-btn", 15000);
        if (!hasOutline) {
          setTooltipText("大纲生成超时，请检查 DemoProvider 是否启用");
          setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          await wait(3000);
        }

        // ── 28-32s: 大纲确认 → 点击生成 ──────────
        const generateBtn = document.getElementById("demo-generate-btn");
        if (generateBtn) {
          const rect = generateBtn.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            "大纲已生成（5 页 PPT）。点击一键生成，AI 会为每页检索知识库并撰写内容（含图表）",
          );
          await wait(2000);
          await moveAndClick("demo-generate-btn", "RAG 引擎启动…", 500);
        }

        // ── 32-45s: 流式生成（隐藏光标，让文档渲染）──
        hideCursor();
        // 等待第一个段落出现
        const firstPara = await waitForSelector("[id^='para-']", 25000);
        if (firstPara) {
          const rect = firstPara.getBoundingClientRect();
          setTooltipText("流式生成中：AI 逐个章节撰写，内容即时呈现");
          setPosition({ x: rect.left + 20, y: rect.top + 20 });
          await wait(2000);
        }
        hideCursor();
        await wait(4000);
        await waitForElement("demo-eval-card", 20000);
        hideCursor();
        await wait(1000);

        // ── 45-55s: 生成树溯源（章节来源详情） ──────
        await moveToCenter("文档生成完成！每个段落都有知识库来源支撑", 2000);

        // 先收起大纲和评估卡，腾出垂直空间给来源树
        const outlineToggle = document.getElementById("demo-outline-toggle");
        if (outlineToggle && outlineToggle.textContent?.includes("收起")) {
          outlineToggle.click();
          await wait(400);
        }
        const evalCollapse = document.getElementById("demo-eval-collapse");
        if (evalCollapse) {
          evalCollapse.click();
          await wait(400);
        }

        // 滚动到来源树区域
        hideCursor();
        const sourceToggle0 = document.getElementById("demo-source-toggle-0");
        if (sourceToggle0) sourceToggle0.scrollIntoView({ behavior: "smooth", block: "start" });
        await wait(1000);

        // 点击第一个章节的 toggle，展开来源树
        await moveAndClick("demo-source-toggle-0", "点击章节 → 展开来源树（Provenance Tree）", 1500, true);
        await wait(2000);
        await moveToCenter("来源树展示每个章节引用了哪些知识源文档\n评分越高，来源越可信", 3000);

        // 展开第二个章节用于拖拽演示
        await moveAndClick("demo-source-toggle-0", "收起第一个章节", 500, true);
        await moveAndClick("demo-source-toggle-1", "展开第二个章节的来源", 1500, true);
        await wait(1500);

        // ── 55-65s: 拖拽来源移动 ────────────────────
        await moveToCenter("拖拽知识源可以在章节之间移动\n修改引用关系后重新生成章节内容", 2500);

        // 实际模拟拖拽：从 section 1 拖一个 source 到 section 0
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
              "拖拽「Q3技术规划.docx」到概述章节…",
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
            await moveTo(s0Rect.left + s0Rect.width / 2, s0Rect.top + s0Rect.height / 2,
              "…释放到概述章节，重新生成内容",
            );
            await wait(800);

            // 4. dispatch dragover + drop
            s0Panel.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
            s0Panel.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
            await wait(800);

            // 5. 点击"移动"按钮（pendingDrop 弹窗）
            const moveBtns = document.querySelectorAll("button");
            for (const btn of moveBtns) {
              if (btn.textContent?.includes("移动")) {
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                await wait(300);
                const bRect = btn.getBoundingClientRect();
                await moveTo(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2,
                  "确认移动 → 来源重新分配到目标章节",
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

            // 6. 点击 section 0 toggle 展开（移入来源的章节），展示"重新生成"按钮
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
                "章节引用已变更 → 点击「重新生成此章节」更新内容",
              );
              await wait(2000);
            }
          }
        }
        await moveToCenter("拖拽来源 = 灵活控制每个段落的证据支撑\n修改后点「重新生成」更新内容", 2500);

        // ── 65-75s: 评估指标卡 ──────────────────────
        // 评估卡在来源树阶段被折叠了，重新展开
        const evalExpand = document.getElementById("demo-eval-expand");
        if (evalExpand) { evalExpand.click(); await wait(400); }

        const evalCard = document.getElementById("demo-eval-card");
        if (evalCard) {
          const rect = evalCard.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 60,
            "i-Write 提供可量化信任指标",
          );
          await wait(2000);
          scrollList("demo-eval-card", 200);
          await wait(1500);
        }
        await moveToCenter("有据可查度 0.97 · 内容相关度 0.87\n内容完整度 0.97 · 冲突率 0.18", 2000);

        // 切换到"问题发现" tab
        await moveAndClick("demo-eval-tab-issues", "切换到「问题发现」→ AI 发现 4 个潜在问题", 2500, true);

        // ── 75-82s: 置信度热力图（nf2） ────────────
        // 先折叠评估卡，让文档内容占满屏幕
        const evalCollapse2 = document.getElementById("demo-eval-collapse");
        if (evalCollapse2) { evalCollapse2.click(); await wait(400); }

        await moveAndClick("demo-heatmap-toggle", "热力图开关 → 段落按来源多寡着色", 2000);
        await moveToCenter("绿色 = 多源交叉验证，黄色 = 单源支撑，红色 = AI 推断", 2000);

        // 滚动文档内容区，展示不同颜色的段落
        const docContainer = document.querySelector(".doc-content");
        if (docContainer) {
          setTooltipText("滚动查看所有段落着色情况…");
          setPosition({ x: 200, y: window.innerHeight / 2 });
          docContainer.scrollIntoView({ behavior: "smooth", block: "start" });
          await wait(1000);
          // 滚动文档内容
          const scrollEl = docContainer.closest(".overflow-y-auto");
          if (scrollEl) {
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
            await wait(1500);
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
            await wait(1500);
            scrollEl.scrollBy({ top: 200, behavior: "smooth" });
          }
          await wait(1000);
          // 滚动到顶部
          hideCursor();
          await wait(500);
        }

        // ── 82-92s: AI 自审（nf3） ─────────────────
        const auditPanel = document.getElementById("demo-audit-panel");
        if (auditPanel) {
          const rect = auditPanel.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 60,
            "AI 自审 / 压力测试：AI 主动挑战自己的输出",
          );
          await wait(2000);
        }
        await moveAndClick("demo-audit-fix", "一键修正 → AI 自动修复发现的问题", 2000);
        await moveToCenter("5 维度雷达图：有据可查度 · 内容相关度\n内容完整度 · 一致性 · 无冲突", 2500);

        // ── 92-98s: 导出能力 ──────────────────────
        await moveToCenter("支持导出为 Word / PowerPoint / Excel 格式", 1500);
        await moveAndClick("demo-export-pptx", "导出为 PowerPoint → 下载 PPTX 文件", 2000);
        // 同时打开 OneDrive 上的真实 PPTX 示例
        window.open("https://1drv.ms/p/c/2678b95b0c3e07ef/IQA3oknIehNYQLe4l3DWMzWXASyVrevG8U9bx2CxdEneA5o", "_blank");
        await moveToCenter("一键导出，格式精美，可直接使用\n（OneDrive PPTX 示例已打开）", 2500);

        // ── 98-120s: People Graph 回顾 + 结尾 ──────
        dispatchNav("knowledge");
        await wait(500);
        await moveAndClick("demo-kb-tab-people", "知识库回顾：People Graph 为文档提供人物上下文", 2000);
        scrollList("demo-people-org-tree", 200);
        await wait(2000);

        dispatchNav("generate");
        await wait(500);
        await moveToCenter("i-Write — 连接知识碎片，生成可信文档", 2500);

        setTooltipText("Knowledge + Metrics = Trust");
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setProgress(100);
        await wait(4000);

        setTooltipText("");
        await wait(2000);
        if (!cancelled) stopDemo();
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "__CANCELLED__") return;
        setTooltipText(`Demo 中断: ${err instanceof Error ? err.message : "unknown"}`);
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
