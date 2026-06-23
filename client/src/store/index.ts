import { create } from "zustand";
import type { SearchProviderConnection, KnowledgeProviderConnection } from "../../../shared/src/types/provider.js";

/** API 请求工具 */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error: ${res.status} ${body}`);
  }
  return res.json();
}

/** Provider 配置（增强版，支持 model fallback） */
export interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  apiKeyRef?: string;
  baseUrl?: string;
  defaultModelId?: string;
  modelIds?: string[];
  modelFallbacks?: string[];
  enabled: boolean;
  enableModelFallback?: boolean;
}

/** App Store */
interface AppState {
  providers: ProviderConfig[];
  enableProviderFallback: boolean;
  searchProviders: SearchProviderConnection[];
  knowledgeProviders: KnowledgeProviderConnection[];
  knowledgeEnabled: boolean;
  loading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  saveProviders: (providers: ProviderConfig[], enableProviderFallback?: boolean) => Promise<void>;
  saveSearchProviders: (searchProviders: SearchProviderConnection[]) => Promise<void>;
  saveKnowledgeConfig: (knowledgeProviders: KnowledgeProviderConnection[], knowledgeEnabled: boolean) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  providers: [],
  enableProviderFallback: true,
  searchProviders: [],
  knowledgeProviders: [],
  knowledgeEnabled: false,
  loading: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch<{ ok: boolean; settings: Record<string, unknown> }>("/api/settings");
      const providers: ProviderConfig[] = [];
      let enableProviderFallback = true;
      let searchProviders: SearchProviderConnection[] = [];
      let knowledgeProviders: KnowledgeProviderConnection[] = [];
      let knowledgeEnabled = false;

      // 优先读取新格式（provider_all）
      const allSettings = res.settings["provider_all"];
      if (allSettings && typeof allSettings === "object") {
        const appSettings = allSettings as {
          providers?: ProviderConfig[];
          enableProviderFallback?: boolean;
          searchProviders?: SearchProviderConnection[];
          knowledgeProviders?: KnowledgeProviderConnection[];
          knowledge?: { enabled: boolean };
        };
        providers.push(...(appSettings.providers ?? []));
        enableProviderFallback = appSettings.enableProviderFallback ?? true;
        searchProviders = appSettings.searchProviders ?? [];
        knowledgeProviders = appSettings.knowledgeProviders ?? [];
        knowledgeEnabled = appSettings.knowledge?.enabled ?? false;
      } else {
        // Fallback：旧格式（provider_{id} 独立行）
        for (const [key, value] of Object.entries(res.settings)) {
          if (key.startsWith("provider_") && key !== "provider_all" && typeof value === "object" && value !== null) {
            providers.push(value as ProviderConfig);
          }
        }
      }

      set({ providers, enableProviderFallback, searchProviders, knowledgeProviders, knowledgeEnabled, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },

  saveProviders: async (providers: ProviderConfig[], enableProviderFallback?: boolean) => {
    set({ loading: true, error: null });
    try {
      const state = get();
      await apiFetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({
          providers,
          enableProviderFallback: enableProviderFallback ?? true,
          searchProviders: state.searchProviders,
          knowledgeProviders: state.knowledgeProviders,
          knowledge: { enabled: state.knowledgeEnabled },
        }),
      });
      set({
        providers,
        enableProviderFallback: enableProviderFallback ?? true,
        loading: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },

  saveSearchProviders: async (searchProviders: SearchProviderConnection[]) => {
    set({ loading: true, error: null });
    try {
      const state = get();
      await apiFetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({
          providers: state.providers,
          enableProviderFallback: state.enableProviderFallback,
          searchProviders,
          knowledgeProviders: state.knowledgeProviders,
          knowledge: { enabled: state.knowledgeEnabled },
        }),
      });
      set({ searchProviders, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },

  saveKnowledgeConfig: async (knowledgeProviders: KnowledgeProviderConnection[], knowledgeEnabled: boolean) => {
    set({ loading: true, error: null });
    try {
      const state = get();
      await apiFetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({
          providers: state.providers,
          enableProviderFallback: state.enableProviderFallback,
          searchProviders: state.searchProviders,
          knowledgeProviders,
          knowledge: { enabled: knowledgeEnabled },
        }),
      });
      set({ knowledgeProviders, knowledgeEnabled, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },
}));
