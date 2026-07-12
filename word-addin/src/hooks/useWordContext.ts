/**
 * useWordContext.ts — Word 上下文 Hook
 *
 * 检测 Office.js / Word API 是否可用。
 */
import { useState, useEffect } from 'react';

export interface WordContextValue {
  isReady: boolean;
  hostType: string;
}

export function useWordContext(): WordContextValue {
  const [context, setContext] = useState<WordContextValue>({
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