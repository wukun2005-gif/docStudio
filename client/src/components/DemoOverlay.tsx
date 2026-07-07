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

        // ── 评估指标卡（详细展示） ──────────────────
        await moveToCenter("文档生成完成！i-Write 提供 4 维度可量化信任指标", 2500);

        // 等待评估 SSE 完成（demo replay 约 2s，留足缓冲）
        await wait(2000);

        // 评估卡应该在生成后已展开，如果被折叠了则展开
        const evalExpand0 = document.getElementById("demo-eval-expand");
        if (evalExpand0) { evalExpand0.click(); await wait(400); }

        const evalCard0 = document.getElementById("demo-eval-card");
        if (evalCard0) {
          const rect = evalCard0.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 60,
            "有据可查度 0.65 — 文档内容是否有知识库来源支撑",
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            "内容相关度 1.00 — 所有段落都与用户需求紧密相关",
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            "内容完整度 0.93 — 14 项需求要点已覆盖 14 项",
          );
          await wait(3000);
          scrollList("demo-eval-card", 100);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 120,
            "冲突率 0.25 — AI 检测到 5 处来源间矛盾，已自动处理",
          );
          await wait(3000);
        }
        await moveToCenter("4 维度评估：有据可查度 · 内容相关度 · 内容完整度 · 冲突率", 2500);

        // 切换到"问题发现" tab，详细解释每种问题
        await moveAndClick("demo-eval-tab-issues", "切换到「问题发现」→ 查看具体问题", 2000, true);
        await wait(1000);

        const evalCard2 = document.getElementById("demo-eval-card");
        if (evalCard2) {
          const rect = evalCard2.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            "🔴 未支撑断言：综合有据可查度 65%，部分段落缺少来源支撑",
          );
          await wait(3500);
          scrollList("demo-eval-card", 150);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            "🟢 已拦截冲突：5 处来源矛盾被 AI 识别并拦截，未进入文档\n如「Q3团队规模」两份文档数据不一致",
          );
          await wait(4000);
          scrollList("demo-eval-card", 200);
          await wait(1000);
          await moveTo(rect.left + rect.width / 2, rect.top + 80,
            "每条冲突都标注了冲突主题和来源文档\n用户可据此追溯原始文档",
          );
          await wait(3500);
          scrollList("demo-eval-card", 200);
          await wait(1000);
        }
        await moveToCenter("问题发现 = 让用户知道文档哪里不完美、为什么", 2500);

        // ── 置信度热力图（详细展示） ────────────────
        // 先折叠评估卡和大纲，让文档内容占满屏幕
        const evalCollapseHeat = document.getElementById("demo-eval-collapse");
        if (evalCollapseHeat) { evalCollapseHeat.click(); await wait(400); }
        const outlineCollapseHeat = document.getElementById("demo-outline-toggle");
        if (outlineCollapseHeat && outlineCollapseHeat.textContent?.includes("收起")) {
          outlineCollapseHeat.click();
          await wait(400);
        }

        await moveAndClick("demo-heatmap-toggle", "开启热力图 → 每个段落按来源多寡着色", 2000);
        await moveToCenter("绿色 = 多源交叉验证（高可信）\n黄色 = 单源支撑（中可信）\n红色 = AI 推断（低可信）", 3000);

        // 滚动文档内容区，展示不同颜色的段落
        const docContainer = document.querySelector(".doc-content");
        if (docContainer) {
          setTooltipText("滚动查看每个段落的着色情况…");
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
        await moveToCenter("热力图让信任度一目了然：一眼看出哪些段落需要补充来源", 2500);

        // ── 参考来源章节（文档底部引用列表） ────────
        // 直接从当前位置滚动到文档底部，不要移动光标到顶部
        await moveToCenter("文档底部：所有参考来源汇总", 2000);
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
            "9 个知识源支撑本文档：PRD · 产品路线图 · 技术报告 · 周报 · 月报…\n点击可跳转原始文档",
          );
          await wait(3500);
          // 光标保持在原位，只换文字
          setTooltipText("每个引用都有据可查，用户可追溯任意结论的来源");
          await wait(2500);
        } else {
          await moveToCenter("每个引用都有据可查，用户可追溯任意结论的来源", 2500);
        }

        // ── 来源生成树（来源溯源树 + 拖拽） ───
        // 直接从文档底部滚动到来源树区域，不要先滚回顶部
        const sourceTreeArea = document.getElementById("demo-source-toggle-0");
        if (sourceTreeArea) {
          sourceTreeArea.scrollIntoView({ behavior: "smooth", block: "start" });
          await wait(1000);
        }
        await moveToCenter("来源溯源树：逐章节展示引用了哪些知识源文档", 2500);

        await moveAndClick("demo-source-toggle-0", "点击章节 → 展开来源树", 1500, true);
        await wait(2000);
        await moveToCenter("来源树展示每个章节引用了哪些知识源文档\n评分越高，来源越可信", 3000);

        // 展开第二个章节用于拖拽演示
        await moveAndClick("demo-source-toggle-0", "收起第一个章节", 500, true);
        await moveAndClick("demo-source-toggle-1", "展开第二个章节的来源", 1500, true);
        await wait(1500);

        // 拖拽来源移动
        await moveToCenter("拖拽知识源可以在章节之间移动\n修改引用关系后重新生成章节内容", 2500);

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
            const dropX = s0Rect.left + s0Rect.width / 2;
            const dropY = s0Rect.top + s0Rect.height / 2;
            await moveTo(dropX, dropY,
              "…释放到概述章节，选择移动或复制",
            );
            await wait(800);

            // 4. dispatch dragover + drop（带坐标，修复弹窗定位 bug）
            s0Panel.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt, clientX: dropX, clientY: dropY }));
            s0Panel.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt, clientX: dropX, clientY: dropY }));
            await wait(800);

            // 5. 点击"移动"按钮（pendingDrop 弹窗，现在应在 drop 位置附近）
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
                "章节引用已变更 → 点击「重新生成此章节」更新内容",
              );
              await wait(2000);
            }
          }
        }
        await moveToCenter("拖拽来源 = 灵活控制每个段落的证据支撑\n修改后点「重新生成」更新内容", 2500);

        // ── 导出 PPTX ────────────────────────────────
        await moveToCenter("文档生成完毕，支持导出为 Word / PowerPoint / Excel", 2000);
        // 确保导出按钮可见（大纲折叠状态）
        const exportBtn = document.getElementById("demo-export-pptx");
        if (exportBtn) {
          exportBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          await wait(600);
          const bRect = exportBtn.getBoundingClientRect();
          await moveTo(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2,
            "点击导出 PowerPoint → 直接下载 PPTX 文件",
          );
          await wait(1500);
          setIsClicking(true);
          await wait(200);
          (exportBtn as HTMLElement).click();
          setIsClicking(false);
          await wait(2000);
        }
        await moveToCenter("一键导出，格式精美，可直接使用", 2000);

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
            if (tab.textContent?.includes("评分概览")) {
              (tab as HTMLElement).click();
              await wait(300);
              break;
            }
          }
        }

        // 展开文档大纲卡
        const outlineExpandRecap = document.getElementById("demo-outline-toggle");
        if (outlineExpandRecap && outlineExpandRecap.textContent?.includes("展开")) {
          outlineExpandRecap.click();
          await wait(400);
        }

        await moveToCenter("从 9 个知识源 → RAG 检索 → 生成文档\n→ 4 维度评估 → 5 处冲突拦截", 3500);
        await moveToCenter("事实知识源 + 内容生成 + 评估指标\n= 可信任的文档生成, i-Write", 3500);
        setProgress(100);
        await wait(2000);

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
