/**
 * Browser Manager — Playwright Chromium 单例，自动复用和清理。
 */

import { chromium, Browser, BrowserContext } from "playwright";
import { logger } from "./logger.js";

let browser: Browser | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟闲置后关闭
const VIEWPORT = { width: 960, height: 540 };

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browser) {
      logger.info("[BrowserManager] 闲置超时，关闭浏览器");
      await browser.close();
      browser = null;
    }
  }, IDLE_TIMEOUT_MS);
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    resetIdleTimer();
    return browser;
  }

  const start = Date.now();
  browser = await chromium.launch({ headless: true });
  logger.info(`[BrowserManager] Chromium 启动: ${Date.now() - start}ms`);
  resetIdleTimer();
  return browser;
}

export async function newPage(): Promise<{ page: import("playwright").Page; context: BrowserContext }> {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  return { page, context };
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  if (browser) {
    await browser.close();
    browser = null;
  }
}
