import { create } from "zustand";

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
  loading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  saveProviders: (providers: ProviderConfig[], enableProviderFallback?: boolean) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  providers: [],
  enableProviderFallback: true,
  loading: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch<{ ok: boolean; settings: Record<string, unknown> }>("/api/settings");
      const providers: ProviderConfig[] = [];
      let enableProviderFallback = true;

      // 优先读取新格式（provider_all）
      const allSettings = res.settings["provider_all"];
      if (allSettings && typeof allSettings === "object") {
        const appSettings = allSettings as { providers?: ProviderConfig[]; enableProviderFallback?: boolean };
        providers.push(...(appSettings.providers ?? []));
        enableProviderFallback = appSettings.enableProviderFallback ?? true;
      } else {
        // Fallback：旧格式（provider_{id} 独立行）
        for (const [key, value] of Object.entries(res.settings)) {
          if (key.startsWith("provider_") && key !== "provider_all" && typeof value === "object" && value !== null) {
            providers.push(value as ProviderConfig);
          }
        }
      }

      set({ providers, enableProviderFallback, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },

  saveProviders: async (providers: ProviderConfig[], enableProviderFallback?: boolean) => {
    set({ loading: true, error: null });
    try {
      await apiFetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({
          providers,
          enableProviderFallback: enableProviderFallback ?? true,
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
}));
