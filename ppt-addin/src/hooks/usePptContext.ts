/**
 * usePptContext.ts — PowerPoint 上下文 Hook
 *
 * 检测 Office.js / PowerPoint API 是否可用。
 */
import { useState, useEffect } from 'react';

export interface PptContextValue {
  isReady: boolean;
  hostType: string;
}

export function usePptContext(): PptContextValue {
  const [context, setContext] = useState<PptContextValue>({
    isReady: false,
    hostType: '',
  });

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      if (win.Office?.context) {
        setContext({
          isReady: true,
          hostType: win.Office.context.host?.hostType ?? '',
        });
      }
    } catch {
      // Office context not available
    }
  }, []);

  return context;
}
