import { useEffect, useState, useMemo } from "react";
import { useAppStore, type ProviderConfig } from "../store";
import { useModelCatalog, type ModelInfo } from "../lib/modelCatalog";

// 预置 provider 列表（与 server 端 PRESET_MODEL_PROVIDERS 同步）
const PRESET_PROVIDERS = [
  { id: "gemini", displayName: "Gemini", desc: "Google AI Studio (免费)", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", keyPlaceholder: "AIza..." },
  { id: "mimo", displayName: "MiMo", desc: "小米 Token Plan", defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1", keyPlaceholder: "sk-..." },
  { id: "kimi", displayName: "Kimi", desc: "Moonshot / 月之暗面", defaultBaseUrl: "https://api.moonshot.cn/v1", keyPlaceholder: "sk-..." },
  { id: "glm", displayName: "GLM", desc: "智谱 AI", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", keyPlaceholder: "your-glm-key" },
  { id: "minimax", displayName: "MiniMax", desc: "MiniMax", defaultBaseUrl: "https://api.minimax.chat/v1", keyPlaceholder: "your-minimax-key" },
  { id: "deepseek", displayName: "DeepSeek", desc: "深度求索", defaultBaseUrl: "https://api.deepseek.com", keyPlaceholder: "sk-..." },
  { id: "qwen", displayName: "Qwen", desc: "阿里通义千问 (DashScope)", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-..." },
  { id: "bedrock", displayName: "AWS Bedrock", desc: "AWS Bedrock OpenAI-Compatible API", defaultBaseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1", keyPlaceholder: "bedrock-api-key" },
  { id: "openrouter", displayName: "OpenRouter", desc: "统一 API 聚合数百模型", defaultBaseUrl: "https://openrouter.ai/api/v1", keyPlaceholder: "sk-or-v1-..." },
  { id: "opencode", displayName: "OpenCode Zen", desc: "OpenCode 官方精选模型网关", defaultBaseUrl: "https://opencode.ai/zen/v1", keyPlaceholder: "opencode-zen-key" },
  { id: "volcengine", displayName: "火山引擎", desc: "字节跳动 · 火山引擎", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", keyPlaceholder: "sk-..." },
  { id: "bailian", displayName: "百炼", desc: "阿里云百炼 (千问+三方模型)", defaultBaseUrl: "https://ws-3vv2b1h4akmem3xz.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-..." },
  { id: "siliconflow", displayName: "SiliconFlow (Embedding)", desc: "硅基流动 Embedding API", defaultBaseUrl: "https://api.siliconflow.cn/v1", keyPlaceholder: "sk-..." },
];

export default function Settings() {
  const { providers, enableProviderFallback, loading, error, loadSettings, saveProviders } = useAppStore();
  const { catalog, loading: catalogLoading } = useModelCatalog();
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>([]);
  const [localFallback, setLocalFallback] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    // 合并预置 providers 和已配置 providers
    const merged: ProviderConfig[] = PRESET_PROVIDERS.map((preset) => {
      const existing = providers.find((p) => p.providerId === preset.id);
      return existing ?? {
        providerId: preset.id,
        apiKey: "",
        baseUrl: preset.defaultBaseUrl,
        defaultModelId: "",
        modelIds: [],
        modelFallbacks: [],
        enabled: false,
        enableModelFallback: false,
      };
    });
    setLocalProviders(merged);
    setLocalFallback(enableProviderFallback);
  }, [providers, enableProviderFallback]);

  const handleSave = async () => {
    await saveProviders(localProviders, localFallback);
    setSaveStatus("保存成功");
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const updateProvider = (idx: number, field: keyof ProviderConfig, value: string | boolean | string[]) => {
    setLocalProviders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const setDefaultModel = (idx: number, modelId: string) => {
    setLocalProviders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], defaultModelId: modelId };
      return next;
    });
  };

  const toggleModelFallback = (idx: number, modelId: string) => {
    setLocalProviders((prev) => {
      const next = [...prev];
      const p = { ...next[idx] };
      const fallbacks = [...(p.modelFallbacks ?? [])];
      const i = fallbacks.indexOf(modelId);
      if (i >= 0) fallbacks.splice(i, 1);
      else fallbacks.push(modelId);
      p.modelFallbacks = fallbacks;
      next[idx] = p;
      return next;
    });
  };

  if (loading && providers.length === 0) {
    return <div className="text-center py-8 text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">设置</h2>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* 全局 Provider 回退开关 */}
      <section className="mb-6">
        <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={localFallback}
            onChange={(e) => setLocalFallback(e.target.checked)}
            className="rounded w-5 h-5"
          />
          <div>
            <span className="font-medium">启用 Provider 回退</span>
            <p className="text-sm text-gray-500">当首选 Provider 失败时，自动尝试下一个已启用的 Provider</p>
          </div>
        </label>
      </section>

      {/* Provider 配置 */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-4">LLM Provider 配置</h3>
        {catalogLoading && <p className="text-sm text-gray-500 mb-2">加载模型目录...</p>}
        <div className="space-y-3">
          {localProviders.map((p, idx) => {
            const preset = PRESET_PROVIDERS.find((pr) => pr.id === p.providerId);
            const models = catalog[p.providerId] ?? [];
            const isExpanded = expandedProvider === p.providerId;
            const configuredKey = p.apiKeyRef ?? p.apiKey;

            return (
              <div key={p.providerId} className="border rounded-lg bg-white overflow-hidden">
                {/* Provider 头部 */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedProvider(isExpanded ? null : p.providerId)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateProvider(idx, "enabled", e.target.checked);
                      }}
                      className="rounded w-4 h-4"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div>
                      <span className="font-medium">{preset?.displayName ?? p.providerId}</span>
                      <span className="text-sm text-gray-500 ml-2">{preset?.desc}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {configuredKey && <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">已配置</span>}
                    {p.defaultModelId && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">{p.defaultModelId}</span>}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>

                {/* Provider 详情 */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4 bg-gray-50/50">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">API Key</label>
                        <input
                          type="password"
                          value={configuredKey ?? ""}
                          onChange={(e) => updateProvider(idx, "apiKey", e.target.value)}
                          placeholder={preset?.keyPlaceholder ?? "sk-..."}
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                        <input
                          type="text"
                          value={p.baseUrl ?? ""}
                          onChange={(e) => updateProvider(idx, "baseUrl", e.target.value)}
                          placeholder={preset?.defaultBaseUrl}
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    {/* 模型选择 */}
                    {models.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm text-gray-600">默认模型</label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={p.enableModelFallback ?? false}
                              onChange={(e) => updateProvider(idx, "enableModelFallback", e.target.checked)}
                              className="rounded w-3.5 h-3.5"
                            />
                            <span className="text-gray-500">启用模型回退</span>
                          </label>
                        </div>
                        <ModelSelector
                          models={models}
                          defaultModelId={p.defaultModelId ?? ""}
                          modelFallbacks={p.modelFallbacks ?? []}
                          onSetDefault={(id) => setDefaultModel(idx, id)}
                          onToggleFallback={(id) => toggleModelFallback(idx, id)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 保存按钮 */}
      <div className="flex items-center gap-4 sticky bottom-0 bg-white py-4 border-t">
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

// ── 模型选择器组件 ──────────────────────────────────────────

function ModelSelector({
  models,
  defaultModelId,
  modelFallbacks,
  onSetDefault,
  onToggleFallback,
}: {
  models: ModelInfo[];
  defaultModelId: string;
  modelFallbacks: string[];
  onSetDefault: (id: string) => void;
  onToggleFallback: (id: string) => void;
}) {
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="text-left px-3 py-2 w-8"></th>
            <th className="text-left px-3 py-2">模型</th>
            <th className="text-left px-3 py-2">推荐</th>
            <th className="text-left px-3 py-2">上下文</th>
            <th className="text-left px-3 py-2">输出</th>
            <th className="text-left px-3 py-2 w-16">回退</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const isDefault = m.id === defaultModelId;
            const isFallback = modelFallbacks.includes(m.id);
            return (
              <tr key={m.id} className={`border-t hover:bg-blue-50/50 ${isDefault ? "bg-blue-50" : ""}`}>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onSetDefault(m.id)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isDefault ? "border-blue-500 bg-blue-500" : "border-gray-300"}`}
                    title="设为默认"
                  >
                    {isDefault && <div className="w-2 h-2 rounded-full bg-white" />}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {m.id}
                  {m.isReasoning && <span className="ml-1 text-purple-600 text-[10px]">思考</span>}
                  {m.supportsVision && <span className="ml-1 text-green-600 text-[10px]">视觉</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 max-w-[200px] truncate">{m.recommendation ?? ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{m.contextWindow ? `${Math.round(m.contextWindow / 1024)}K` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{m.maxOutputTokens ? `${Math.round(m.maxOutputTokens / 1024)}K` : ""}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={isFallback}
                    onChange={() => onToggleFallback(m.id)}
                    className="rounded w-3.5 h-3.5"
                    title={isFallback ? "从回退列表移除" : "加入回退列表"}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
