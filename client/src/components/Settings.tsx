import { useEffect, useState } from "react";
import { useAppStore, type ProviderConfig } from "../store";

const KNOWN_PROVIDERS = [
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "gemini", name: "Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "openrouter", name: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "siliconflow", name: "SiliconFlow (Embedding)", defaultBaseUrl: "https://api.siliconflow.cn/v1" },
];

export default function Settings() {
  const { providers, loading, error, loadSettings, saveProviders } = useAppStore();
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    // 合并已配置和已知 providers
    const merged: ProviderConfig[] = KNOWN_PROVIDERS.map((kp) => {
      const existing = providers.find((p) => p.providerId === kp.id);
      return existing ?? { providerId: kp.id, apiKey: "", baseUrl: kp.defaultBaseUrl, defaultModelId: "", enabled: false };
    });
    setLocalProviders(merged);
  }, [providers]);

  const handleSave = async () => {
    await saveProviders(localProviders);
    setSaveStatus("保存成功");
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const updateProvider = (idx: number, field: keyof ProviderConfig, value: string | boolean) => {
    setLocalProviders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  if (loading && providers.length === 0) {
    return <div className="text-center py-8 text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">设置</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>
      )}

      {/* Provider 配置 */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-4">LLM Provider 配置</h3>
        <div className="space-y-4">
          {localProviders.map((p, idx) => (
            <div key={p.providerId} className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => updateProvider(idx, "enabled", e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-medium">{KNOWN_PROVIDERS.find((kp) => kp.id === p.providerId)?.name ?? p.providerId}</span>
                </label>
              </div>
              {p.enabled && (
                <div className="space-y-3 ml-6">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">API Key</label>
                    <input
                      type="password"
                      value={p.apiKey ?? ""}
                      onChange={(e) => updateProvider(idx, "apiKey", e.target.value)}
                      placeholder="sk-..."
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                    <input
                      type="text"
                      value={p.baseUrl ?? ""}
                      onChange={(e) => updateProvider(idx, "baseUrl", e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">默认模型</label>
                    <input
                      type="text"
                      value={p.defaultModelId ?? ""}
                      onChange={(e) => updateProvider(idx, "defaultModelId", e.target.value)}
                      placeholder="gpt-4o"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 保存按钮 */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "保存中..." : "保存设置"}
        </button>
        {saveStatus && <span className="text-green-600 text-sm">{saveStatus}</span>}
      </div>
    </div>
  );
}
