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

/** Provider 配置 */
export interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModelId?: string;
  enabled: boolean;
}

/** App Store */
interface AppState {
  providers: ProviderConfig[];
  loading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  saveProviders: (providers: ProviderConfig[]) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  providers: [],
  loading: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch<{ ok: boolean; settings: Record<string, unknown> }>("/api/settings");
      const providers: ProviderConfig[] = [];
      for (const [key, value] of Object.entries(res.settings)) {
        if (key.startsWith("provider_") && typeof value === "object" && value !== null) {
          providers.push(value as ProviderConfig);
        }
      }
      set({ providers, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },

  saveProviders: async (providers: ProviderConfig[]) => {
    set({ loading: true, error: null });
    try {
      await apiFetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({ providers }),
      });
      set({ providers, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, loading: false });
    }
  },
}));
