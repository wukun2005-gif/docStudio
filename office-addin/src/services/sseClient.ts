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
  await fetchEventSource(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    onmessage(ev) {
      try {
        const data = JSON.parse(ev.data) as SSEEvent;
        onEvent(data);
      } catch {
        // 忽略解析错误
      }
    },
    onerror(err) {
      onEvent({ type: 'error', message: String(err) });
      throw err;
    },
  });
}
