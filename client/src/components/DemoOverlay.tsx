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
    if (!isPlaying) return;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const TOTAL_DURATION = 90_000; // 90 秒
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
    ): Promise<boolean> => {
      checkCancelled();
      for (let attempt = 0; attempt < 5; attempt++) {
        const el = document.getElementById(elementId);
        if (el) {
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
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, text);
      } else if (input instanceof HTMLTextAreaElement) {
        const textareaSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (textareaSetter) textareaSetter.call(input, text);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(waitAfter);
    };

    const dispatchNav = (page: "home" | "generate" | "knowledge" | "settings") => {
      window.dispatchEvent(
        new CustomEvent("demo-nav", { detail: { page } }),
      );
    };

    // ═══════════════════════════════════════════════
    //  90 秒竞赛演示脚本
    // ═══════════════════════════════════════════════

    const runSequence = async () => {
      try {
        checkCancelled();

        // ── 0-10s: 知识库全景 ─────────────────────
        await wait(1000);
        await moveToCenter("i-Write — AI 驱动的可信文档生成工作台", 2500);

        dispatchNav("knowledge");
        await wait(500);
        await moveToCenter("42 份知识源已索引就绪", 2000);
        await moveToCenter("覆盖会议纪要、邮件、技术文档、代码仓库、聊天记录", 2500);

        // ── 10-15s: 切换到生成页面 ─────────────────
        dispatchNav("generate");
        await wait(500);
        await moveToCenter("现在来生成一份文档", 2000);

        // ── 15-30s: 输入需求 → 大纲 ───────────────
        const chatInput = document.getElementById("demo-chat-input");
        if (chatInput) {
          const rect = chatInput.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            "一句话描述你的文档需求",
          );
          await wait(1200);
        }
        await typeInInput("demo-chat-input", "写一份 Q3 技术决策报告", 500);

        await moveAndClick("demo-chat-send", "发送 → AI 分析意图", 800);

        // 等待"思考中..."消失（模拟意图分析）
        await wait(2000);
        await moveToCenter("AI 正在分析你的需求…", 1000);
        await wait(2000);

        // 大纲应已显示（DemoProvider 返回预录数据）
        await moveToCenter('AI 已理解需求，生成了包含 5 个章节的大纲：\n概述、关键决策、评估分析、实施进展、经验教训', 3000);

        // ── 30-40s: 一键生成文档 ──────────────────
        const generateBtn = document.getElementById("demo-generate-btn");
        if (generateBtn) {
          const rect = generateBtn.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            "点击「一键生成」，AI 基于知识库为每个章节检索证据并撰写",
          );
          await wait(1200);
        }
        await moveAndClick("demo-generate-btn", "启动文档生成…", 1000);

        // 模拟生成等待
        await wait(3000);
        await moveToCenter("RAG 检索引擎正在工作：\n混合检索 → Reranker 重排 → LLM 生成 → Groundedness 验证", 3000);
        await wait(2000);
        await moveToCenter("每个段落都有来源支撑，确保内容可追溯", 2000);

        // ── 40-50s: 生成树溯源 ────────────────────
        await moveToCenter("文档生成完成！来看看每个段落的来源", 2500);

        // 尝试点击第一个段落
        const p1 = document.getElementById("para-0");
        if (p1) {
          const rect = p1.getBoundingClientRect();
          await moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2,
            "点击任意段落 → 查看生成树",
          );
          await wait(1000);
          p1.click();
          await wait(1500);
        }
        await moveToCenter("生成树展示了每句话来自哪个知识源，置信度一目了然", 3000);

        // ── 50-60s: Metrics 评估卡 ────────────────
        await moveToCenter("i-Write 提供可量化信任指标", 2000);
        await moveToCenter("有据可查度 0.89 · 内容相关度 0.92\n内容完整度 0.87 · 无冲突检测", 3500);

        // ── 60-70s: 置信度热力图（nf2） ────────────
        await moveToCenter("置信度热力图 — 绿/黄/红分层显示每个段落的信任程度", 2000);
        await moveAndClick("demo-heatmap-toggle", "点击热力图开关 → 段落边缘着色", 2000);
        await moveToCenter("绿色 = 多源交叉验证，黄色 = 单源支撑，红色 = AI 推断", 3000);

        // ── 70-80s: AI 自审（nf3 占位） ──────────
        await moveToCenter("AI 自审 / 压力测试 — AI 主动挑战自己的生成内容", 3000);
        await moveToCenter("检查逻辑漏洞、未支撑断言、遗漏视角、过时引用", 2500);

        // ── 80-88s: 导出 ──────────────────────────
        await moveToCenter("支持导出为 Word / PowerPoint / Excel 格式", 2500);
        await moveToCenter("一键导出，格式精美，可直接使用", 2500);

        // ── 88-90s: 结尾 ──────────────────────────
        setTooltipText("i-Write — 连接知识碎片，生成可信文档");
        setPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setProgress(100);
        await wait(4000);

        setTooltipText("Knowledge + Metrics = Trust");
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
