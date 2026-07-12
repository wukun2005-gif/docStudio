/**
 * useExcelContext.ts — Excel 上下文 Hook
 *
 * 检测 Office.js / Excel API 是否可用。
 */
import { useState, useEffect } from 'react';

export interface ExcelContextValue {
  isReady: boolean;
  hostType: string;
}

export function useExcelContext(): ExcelContextValue {
  const [context, setContext] = useState<ExcelContextValue>({
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
