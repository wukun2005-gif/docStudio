/**
 * sseClient.ts — SSE 流式客户端
 *
 * 使用 @microsoft/fetch-event-source 消费 SSE 流。
 * 用于实时接收生成进度。
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';

export interface SSEEvent {
  type: 'chapter_start' | 'chapter_complete' | 'section-start' | 'section' | 'progress' | 'error' | 'done';
  chapter?: string;
  progress?: number;
  message?: string;
}

/**
 * 消费 SSE 流
 *
 * @param url SSE 端点 URL
 * @param body POST 请求体
 * @param onEvent 事件回调
 * @param signal AbortSignal
 */
export async function consumeSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let retryCount = 0;
  const MAX_RETRIES = 3;
  const WATCHDOG_MS = 300_000; // 5 分钟无事件则判定连接断开

  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  const resetWatchdog = () => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      console.error('[SSE] watchdog 超时，5 分钟未收到事件，主动中断连接');
      onEvent({ type: 'error', message: '连接超时：5 分钟未收到服务器响应，可能网络中断。请刷新后重试。' });
      controller.abort();
    }, WATCHDOG_MS);
  };

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    resetWatchdog();

    await fetchEventSource(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        console.log('[SSE] 连接已建立, status=' + response.status);
        const ct = response.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream')) {
          const text = await response.text();
          let msg = `服务器返回非 SSE 响应 (Content-Type: ${ct})`;
          try {
            const json = JSON.parse(text);
            msg = json.error ?? json.message ?? msg;
          } catch {}
          throw new Error(msg);
        }
        retryCount = 0;
        resetWatchdog();
      },
      onmessage(ev) {
        resetWatchdog();
        try {
          const data = JSON.parse(ev.data);
          if (!data.type && ev.event) {
            data.type = ev.event;
          }
          console.log('[SSE] 收到事件: type=' + (data.type ?? ev.event) + ', event=' + ev.event);
          onEvent(data as SSEEvent);
        } catch (e) {
          console.warn('[SSE] JSON 解析失败:', ev.data?.slice(0, 100));
        }
      },
      onerror(err) {
        console.warn('[SSE] 连接错误:', String(err));
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          onEvent({ type: 'error', message: String(err) });
          throw err;
        }
        resetWatchdog();
        return Math.min(1000 * Math.pow(2, retryCount - 1), 8000);
      },
    });
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}