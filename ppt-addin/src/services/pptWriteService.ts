/**
 * pptWriteService.ts — PowerPoint 幻灯片写入服务
 *
 * 成熟方案（业界标准）：
 * 1. 服务端使用 PptxGenJS（业界最成熟的免费开源 PPTX 生成库，GitHub 3.6k+ stars）
 *    生成包含原生 Office 图表、表格、专业排版的完整 PPTX 文件
 * 2. 客户端使用微软官方 PowerPoint JS API 的 insertSlidesFromBase64()
 *    （PowerPointApi 1.2+，PowerPoint Online 和桌面版均支持）将幻灯片插入当前演示文稿
 *
 * 优势：
 * - 图表是原生 Office 图表（bar/pie/line/column/doughnut/scatter），可在 PPT 中直接编辑
 * - 表格、排版、字体、颜色由 PptxGenJS 专业渲染，质量与手工制作一致
 * - 超链接、参考来源、页码等元素完整支持
 * - 避免了 PowerPoint JS API 中大量未支持/不稳定的底层 shape API
 */

// ── Office 就绪等待 ──────────────────────────────────

let officeReadyPromise: Promise<void> | null = null;

function waitForOfficeReady(): Promise<void> {
  if (officeReadyPromise) return officeReadyPromise;

  officeReadyPromise = new Promise((resolve) => {
    const win = window as unknown as {
      Office?: { onReady?: (cb: () => void) => Promise<void> };
    };
    if (win.Office && win.Office.onReady) {
      win.Office.onReady(() => resolve()).catch(() => resolve());
    } else {
      let attempts = 0;
      const check = () => {
        attempts++;
        const w = window as unknown as {
          Office?: { onReady?: (cb: () => void) => Promise<void> };
        };
        if (w.Office && w.Office.onReady) {
          w.Office.onReady(() => resolve()).catch(() => resolve());
        } else if (attempts < 50) {
          setTimeout(check, 100);
        } else {
          resolve();
        }
      };
      check();
    }
  });

  return officeReadyPromise;
}

// ── 从 server 获取 PPTX base64 ──────────────────────

async function fetchPptxBase64(runId: string): Promise<string> {
  // 确定 API base URL（与 vite.config.ts 中的 proxy 配置一致）
  const apiBase = (window as any).PPT_API_BASE || "";
  const url = `${apiBase}/api/generation/${runId}/pptx-base64`;

  console.log(`[pptWriteService] 获取 PPTX base64: ${url}`);
  const resp = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${errText || resp.statusText}`);
  }

  const data = await resp.json();
  if (!data.ok || !data.base64) {
    throw new Error(data.error || "返回数据无效");
  }

  console.log(`[pptWriteService] PPTX base64 获取成功, 大小≈${Math.round(data.base64.length * 0.75 / 1024)}KB, 预计 ${data.slideCount} 张幻灯片`);
  return data.base64 as string;
}

// ── 使用 insertSlidesFromBase64 插入幻灯片 ────────────

async function insertSlidesFromBase64(base64: string): Promise<void> {
  await PowerPoint.run(async (context: PowerPoint.RequestContext) => {
    const presentation = context.presentation;

    // 先删除默认的空白幻灯片（新建演示文稿通常有1张空白幻灯片）
    // 不删除用户已有内容，只在末尾追加
    presentation.slides.load("items");
    await context.sync();

    // 如果只有1张默认空白幻灯片且没有内容，删除它以避免空白页
    // 检查是否有超过1张幻灯片，或者唯一的幻灯片是否有shapes
    const slideCount = presentation.slides.items.length;
    let shouldDeleteFirst = false;

    if (slideCount === 1) {
      const firstSlide = presentation.slides.items[0]!;
      firstSlide.shapes.load("items");
      await context.sync();
      // 如果只有默认占位符（2个shapes：标题+副标题），视为空白页
      if (firstSlide.shapes.items.length <= 2) {
        shouldDeleteFirst = true;
      }
    }

    // 配置插入选项：使用目标主题（保持当前演示文稿的主题风格）
    const insertOptions: PowerPoint.InsertSlideOptions = {
      formatting: PowerPoint.InsertSlideFormatting.useDestinationTheme,
      // 不指定 targetSlideId → 追加到末尾
    };

    // 插入幻灯片
    presentation.insertSlidesFromBase64(base64, insertOptions);
    await context.sync();

    // 如果之前检测到空白首页，删除它
    if (shouldDeleteFirst) {
      presentation.slides.load("items");
      await context.sync();
      // 插入后第一张仍然是原来的空白页
      if (presentation.slides.items.length > 0) {
        presentation.slides.items[0]!.delete();
        await context.sync();
      }
    }

    console.log(`[pptWriteService] 幻灯片插入成功`);
  });
}

// ── 主入口 ──────────────────────────────────────

/**
 * 将服务端生成的 PPTX 写入当前演示文稿。
 * @param runId generation run ID（服务端已完成生成）
 */
export async function writeGeneratedPptToPresentation(runId: string): Promise<void> {
  await waitForOfficeReady();

  if (typeof PowerPoint === 'undefined') {
    throw new Error("PowerPoint API 不可用，请在 PowerPoint 中运行此 Add-in");
  }

  console.log(`[pptWriteService] 开始写入 PPT (runId=${runId})`);

  // 1. 从服务端获取 PPTX base64（PptxGenJS 生成，包含原生图表）
  const base64 = await fetchPptxBase64(runId);

  // 2. 使用微软官方 API 插入幻灯片
  await insertSlidesFromBase64(base64);

  console.log(`[pptWriteService] PPT 写入完成`);
}

// ── 兼容旧接口（供现有调用方使用）──────────────────

export interface PptSlideData {
  title: string;
  subtitle?: string;
  isTitleSlide?: boolean;
  bulletPoints?: string[];
  paragraphs?: string[];
  table?: {
    title?: string;
    headers: string[];
    rows: string[][];
  };
  charts?: Array<{
    type: string;
    title: string;
    categories: string[];
    series: Array<{ name: string; values: number[] }>;
  }>;
  citationUrls?: Array<{ index: number; url: string; title: string }>;
  notes?: string;
}

export interface PptWritePayload {
  slides: PptSlideData[];
  citations?: Array<{ index: number; title: string; url: string }>;
  /** 新字段：服务端 generation run ID，优先使用 insertSlidesFromBase64 方案 */
  runId?: string;
}

/**
 * 旧接口兼容：如果 payload 包含 runId，使用新的 base64 插入方案；
 * 否则抛出错误提示使用新接口。
 */
export async function writeToPresentation(payload: PptWritePayload): Promise<void> {
  if (payload.runId) {
    return writeGeneratedPptToPresentation(payload.runId);
  }
  throw new Error("请使用 writeGeneratedPptToPresentation(runId) 接口，服务端生成带原生图表的 PPTX 后插入");
}
