/**
 * 模型目录 Hook — 从 server 获取静态模型目录（含能力元数据）
 */
import { useState, useEffect, useCallback } from "react";

export interface ModelInfo {
  id: string;
  recommendation?: string;
  rpm?: number;
  rpd?: number;
  tpm?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  isReasoning?: boolean;
  supportsVision?: boolean;
  supportsStructuredOutput?: boolean;
  supportsFunctionCalling?: boolean;
}

export type ModelCatalog = Record<string, ModelInfo[]>;

let catalogCache: ModelCatalog | null = null;

/** 获取模型目录（带缓存） */
export function useModelCatalog(): {
  catalog: ModelCatalog;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [catalog, setCatalog] = useState<ModelCatalog>(catalogCache ?? {});
  const [loading, setLoading] = useState(!catalogCache);
  const [error, setError] = useState<string | null>(null);

  const fetchCatalog = useCallback(async () => {
    if (catalogCache) {
      setCatalog(catalogCache);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/providers/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; catalog: ModelCatalog };
      catalogCache = data.catalog;
      setCatalog(data.catalog);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const refresh = useCallback(() => {
    catalogCache = null;
    fetchCatalog();
  }, [fetchCatalog]);

  return { catalog, loading, error, refresh };
}
