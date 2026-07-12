/**
 * useMailContext — 读取当前邮件元数据的 React Hook
 *
 * 用法：
 *   const { context, loading, error, refresh } = useMailContext();
 *
 * 行为：
 * - 组件挂载时立即调用 readMailContext()
 * - 提供 refresh() 供用户在写回前手动刷新
 */
import { useEffect, useState, useCallback } from "react";
import { readMailContext, type MailContext } from "../services/mailContextReader";

export interface UseMailContextResult {
  context: MailContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMailContext(): UseMailContextResult {
  const [context, setContext] = useState<MailContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await readMailContext();
      setContext(ctx);
      if (ctx.error) {
        setError(ctx.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { context, loading, error, refresh };
}
