import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../store";
import type { ProviderConfig } from "../store";
import { PRESET_SEARCH_PROVIDERS, PRESET_KNOWLEDGE_PROVIDERS } from "../../../shared/src/types/provider.js";
import type { SearchProviderConnection, KnowledgeProviderConnection, SearchProviderId } from "../../../shared/src/types/provider.js";

const PRESET_PROVIDERS = [
  { id: "gemini", name: "Gemini (Google)", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", keyPlaceholder: "AIza...", desc: "Google Gemini 系列" },
  { id: "openrouter", name: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", keyPlaceholder: "sk-or-...", desc: "多模型聚合平台" },
  { id: "deepseek", name: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", keyPlaceholder: "sk-...", desc: "DeepSeek AI" },
  { id: "qwen", name: "Qwen (通义千问)", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-...", desc: "阿里通义千问" },
  { id: "kimi", name: "Kimi (月之暗面)", defaultBaseUrl: "https://api.moonshot.cn/v1", keyPlaceholder: "sk-...", desc: "月之暗面 Kimi" },
  { id: "glm", name: "GLM (智谱)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", keyPlaceholder: "...", desc: "智谱 GLM" },
  { id: "minimax", name: "MiniMax", defaultBaseUrl: "https://api.minimax.chat/v1", keyPlaceholder: "eyJhb...", desc: "MiniMax AI" },
  { id: "opencode", name: "OpenCode", defaultBaseUrl: "https://opencode.ai/v1", keyPlaceholder: "sk-...", desc: "OpenCode AI" },
  { id: "mimo", name: "MiMo (Xiaomi)", defaultBaseUrl: "https://api.xiaomi.com/v1", keyPlaceholder: "tp-...", desc: "小米 MiMo" },
  { id: "volcengine", name: "Volcengine (火山引擎)", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", keyPlaceholder: "ark-...", desc: "火山引擎豆包" },
  { id: "bailian", name: "Bailian (百炼/阿里)", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-...", desc: "阿里百炼" },
  { id: "bedrock", name: "AWS Bedrock", defaultBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", keyPlaceholder: "AWS access key ID", desc: "Amazon Bedrock", needsRegion: true, regionPlaceholder: "us-east-1" },
  { id: "custom", name: "Custom (OpenAI Compatible)", defaultBaseUrl: "", keyPlaceholder: "sk-...", desc: "自定义 OpenAI 兼容端点" },
];

type TabId = "llm" | "search" | "knowledge";

interface FormProvider {
  providerId: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  modelIds: string[];
  defaultModelId: string;
  modelFallbacks: string[];
  enableModelFallback: boolean;
}

export default function Settings() {
  const { providers, enableProviderFallback, searchProviders: savedSearch, knowledgeProviders: savedKnowledge, knowledgeEnabled: savedKnowledgeEnabled, loadSettings, saveProviders, saveSearchProviders, saveKnowledgeConfig } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabId>("llm");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [formState, setFormState] = useState<Record<string, FormProvider>>({});
  const [searchFormState, setSearchFormState] = useState<Record<string, SearchProviderConnection>>({});
  const [knowledgeFormState, setKnowledgeFormState] = useState<Record<string, KnowledgeProviderConnection>>({});
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    const map: Record<string, FormProvider> = {};
    PRESET_PROVIDERS.forEach(p => {
      const saved = providers.find(c => c.providerId === p.id);
      map[p.id] = {
        providerId: p.id, name: p.name, enabled: saved?.enabled ?? false,
        apiKey: saved?.apiKey || saved?.apiKeyRef || "", baseUrl: saved?.baseUrl || p.defaultBaseUrl,
        modelIds: saved?.modelIds || [], defaultModelId: saved?.defaultModelId || "",
        modelFallbacks: saved?.modelFallbacks || [], enableModelFallback: saved?.enableModelFallback ?? false,
      };
    });
    providers.filter(c => !PRESET_PROVIDERS.find(p => p.id === c.providerId)).forEach(c => {
      map[c.providerId] = {
        providerId: c.providerId, name: c.providerId, enabled: c.enabled,
        apiKey: c.apiKey || c.apiKeyRef || "", baseUrl: c.baseUrl || "",
        modelIds: c.modelIds || [], defaultModelId: c.defaultModelId || "",
        modelFallbacks: c.modelFallbacks || [], enableModelFallback: c.enableModelFallback ?? false,
      };
    });
    setFormState(map);
  }, [providers]);

  useEffect(() => {
    const map: Record<string, SearchProviderConnection> = {};
    PRESET_SEARCH_PROVIDERS.forEach(p => {
      const saved = savedSearch?.find(s => s.providerId === p.id);
      map[p.id] = saved || { providerId: p.id as SearchProviderId, name: p.displayName, apiKeyRef: "", baseUrl: p.baseUrl, enabled: false };
    });
    setSearchFormState(map);
  }, [savedSearch]);

  useEffect(() => {
    setKnowledgeEnabled(savedKnowledgeEnabled || false);
    const map: Record<string, KnowledgeProviderConnection> = {};
    PRESET_KNOWLEDGE_PROVIDERS.forEach(p => {
      const key = `${p.providerType}-${p.providerId}`;
      const saved = savedKnowledge?.find(k => k.providerType === p.providerType && k.providerId === p.providerId);
      map[key] = saved || {
        providerType: p.providerType, providerId: p.providerId, displayName: p.displayName,
        baseUrl: p.baseUrl, apiKeyRef: "", modelId: p.defaultModelId, availableModels: p.queryModels, enabled: false,
      };
    });
    setKnowledgeFormState(map);
  }, [savedKnowledge, savedKnowledgeEnabled]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2000);
  };

  const handleQueryModels = useCallback(async (providerId: string) => {
    const provider = formState[providerId];
    if (!provider?.apiKey) return;
    try {
      const res = await fetch(`/api/settings/providers/${providerId}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: provider.apiKey, baseUrl: provider.baseUrl }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "查询失败");
      const models: string[] = data.models || [];
      setFormState(prev => {
        const current = prev[providerId];
        if (!current) return prev;
        return { ...prev, [providerId]: { ...current, modelIds: models, defaultModelId: models[0] || current.defaultModelId } };
      });
      showToast("success", `已查询到 ${models.length} 个模型`);
    } catch (e: any) {
      showToast("error", `查询失败: ${e.message}`);
    }
  }, [formState]);

  const handleVerifySearchKey = useCallback(async (providerId: string) => {
    const config = searchFormState[providerId];
    if (!config) return;
    try {
      const body: any = { providerId, apiKey: config.apiKeyRef, baseUrl: config.baseUrl };
      if (providerId === "epo" && (config as any).apiKey2Ref) {
        body.apiKey = `${config.apiKeyRef}:${(config as any).apiKey2Ref}`;
      }
      const res = await fetch("/api/settings/verify-search-key", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      showToast(data.ok ? "success" : "error", data.ok ? "验证成功" : `验证失败: ${data.error || "未知错误"}`);
    } catch (e: any) {
      showToast("error", `验证失败: ${e.message}`);
    }
  }, [searchFormState]);

  const handleTestKnowledge = useCallback(async (key: string) => {
    const config = knowledgeFormState[key];
    if (!config) return;
    try {
      const res = await fetch("/api/settings/knowledge/providers/test", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ providerType: config.providerType, providerId: config.providerId, baseUrl: config.baseUrl, apiKey: config.apiKeyRef, modelId: config.modelId }),
      });
      const data = await res.json();
      showToast(data.ok ? "success" : "error", data.ok ? "连接成功" : `连接失败: ${data.error || "未知错误"}`);
    } catch (e: any) {
      showToast("error", `连接失败: ${e.message}`);
    }
  }, [knowledgeFormState]);

  const handleSave = async () => {
    const list: ProviderConfig[] = Object.values(formState).map(c => ({
      providerId: c.providerId, enabled: c.enabled,
      apiKey: c.apiKey.trim(), apiKeyRef: c.apiKey.trim(),
      baseUrl: c.baseUrl.replace(/\/+$/, ""),
      modelIds: c.modelIds, defaultModelId: c.defaultModelId,
      modelFallbacks: c.modelFallbacks, enableModelFallback: c.enableModelFallback,
    }));
    await saveProviders(list, enableProviderFallback);
    showToast("success", "已保存");
    await loadSettings();
  };

  const handleSaveSearch = async () => {
    await saveSearchProviders(Object.values(searchFormState));
    showToast("success", "已保存");
  };

  const handleSaveKnowledge = async () => {
    await saveKnowledgeConfig(Object.values(knowledgeFormState), knowledgeEnabled);
    showToast("success", "已保存");
  };

  const updateField = (id: string, field: keyof FormProvider, value: any) => {
    setFormState(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "llm", label: "模型 Providers" },
    { id: "search", label: "搜索 Providers" },
    { id: "knowledge", label: "知识库" },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-2.5 rounded-md text-white text-sm shadow-lg ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.message}
        </div>
      )}

      <h2 className="text-2xl font-bold mb-4">设置</h2>

      {/* Tab 导航 */}
      <div className="flex border-b mb-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.id ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== 模型 Providers Tab ===== */}
      {activeTab === "llm" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-lg font-semibold">LLM Provider 配置</h3>
            <button onClick={handleSave} className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">保存</button>
          </div>
          <div className="space-y-3">
            {Object.values(formState).map(c => {
              const preset = PRESET_PROVIDERS.find(p => p.id === c.providerId);
              const isExpanded = expandedProvider === c.providerId;
              return (
                <div key={c.providerId} className="border rounded-lg bg-white overflow-hidden">
                  <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedProvider(isExpanded ? null : c.providerId)}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${c.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.apiKey && <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">已配置</span>}
                      {!c.apiKey && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">需配置Key</span>}
                      {c.modelIds.length > 0 && <span className="text-xs text-gray-500">{c.modelIds.length} 模型</span>}
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t p-4 space-y-4 bg-gray-50/50">
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={c.enabled} onChange={e => updateField(c.providerId, "enabled", e.target.checked)} className="rounded" />
                          启用
                        </label>
                        <button onClick={handleSave} className="ml-auto px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">API Key</label>
                        <input type="password" value={c.apiKey} onChange={e => updateField(c.providerId, "apiKey", e.target.value)} placeholder={preset?.keyPlaceholder || "sk-..."} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                        <input type="text" value={c.baseUrl} onChange={e => updateField(c.providerId, "baseUrl", e.target.value)} placeholder={preset?.defaultBaseUrl || "https://api.example.com/v1"} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-gray-600">可用模型</span>
                          <button onClick={() => handleQueryModels(c.providerId)} disabled={!c.apiKey}
                            className={`text-xs px-2.5 py-1 rounded ${c.apiKey ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                            查询可用模型
                          </button>
                        </div>
                        {c.modelIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {c.modelIds.map(m => (
                              <button key={m} onClick={() => updateField(c.providerId, "defaultModelId", m)}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${c.defaultModelId === m ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}>
                                {m}{c.defaultModelId === m ? " ✓" : ""}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">点击"查询可用模型"获取</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 搜索 Providers Tab ===== */}
      {activeTab === "search" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-lg font-semibold">搜索 Providers</h3>
            <button onClick={handleSaveSearch} className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">保存</button>
          </div>
          <div className="space-y-3">
            {Object.values(searchFormState).map(c => {
              const preset = PRESET_SEARCH_PROVIDERS.find(p => p.id === c.providerId);
              return (
                <div key={c.providerId} className="border rounded-lg bg-white p-4">
                  <div className="flex items-center mb-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.enabled ? "bg-green-500" : "bg-gray-300"} mr-3`} />
                    <span className="font-medium flex-1">{c.name}</span>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={c.enabled} onChange={e => setSearchFormState(prev => ({ ...prev, [c.providerId]: { ...prev[c.providerId], enabled: e.target.checked } }))} className="rounded" />
                      启用
                    </label>
                  </div>
                  {preset && <p className="text-xs text-gray-500 mb-3 ml-6">{preset.desc}</p>}
                  {c.providerId === "epo" ? (
                    <div className="ml-6 space-y-3">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Consumer Key</label>
                        <input type="password" value={c.apiKeyRef || ""} onChange={e => setSearchFormState(prev => ({ ...prev, [c.providerId]: { ...prev[c.providerId], apiKeyRef: e.target.value } }))} placeholder="your-consumer-key" className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Consumer Secret</label>
                        <input type="password" value={(c as any).apiKey2Ref || ""} onChange={e => setSearchFormState(prev => ({ ...prev, [c.providerId]: { ...prev[c.providerId], apiKey2Ref: e.target.value } } as any))} placeholder="your-consumer-secret" className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <p className="text-xs text-gray-400">格式: Consumer Key + Consumer Secret</p>
                    </div>
                  ) : (
                    <div className="ml-6 space-y-3">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">API Key</label>
                        <input type="password" value={c.apiKeyRef || ""} onChange={e => setSearchFormState(prev => ({ ...prev, [c.providerId]: { ...prev[c.providerId], apiKeyRef: e.target.value } }))} placeholder={preset?.keyPlaceholder || "API Key"} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      {c.providerId === "serper" && (
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                          <input type="text" value={c.baseUrl || ""} onChange={e => setSearchFormState(prev => ({ ...prev, [c.providerId]: { ...prev[c.providerId], baseUrl: e.target.value } }))} placeholder={preset?.baseUrl} className="w-full border rounded px-3 py-2 text-sm" />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="ml-6 mt-3 flex gap-2">
                    <button onClick={handleSaveSearch} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
                    <button onClick={() => handleVerifySearchKey(c.providerId)} disabled={!c.apiKeyRef} className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">验证 Key</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 知识库 Tab ===== */}
      {activeTab === "knowledge" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-lg font-semibold">知识库</h3>
            <label className="flex items-center gap-2 ml-auto text-sm text-gray-600">
              <input type="checkbox" checked={knowledgeEnabled} onChange={e => setKnowledgeEnabled(e.target.checked)} className="rounded" />
              启用知识库
            </label>
            <button onClick={handleSaveKnowledge} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">保存</button>
          </div>
          <div className="space-y-3">
            {Object.entries(knowledgeFormState).map(([key, c]) => {
              const preset = PRESET_KNOWLEDGE_PROVIDERS.find(p => p.providerType === c.providerType && p.providerId === c.providerId);
              return (
                <div key={key} className="border rounded-lg bg-white p-4">
                  <div className="flex items-center mb-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.enabled ? "bg-green-500" : "bg-gray-300"} mr-3`} />
                    <span className="font-medium flex-1">{c.displayName}</span>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={c.enabled} onChange={e => setKnowledgeFormState(prev => ({ ...prev, [key]: { ...prev[key], enabled: e.target.checked } }))} className="rounded" />
                      启用
                    </label>
                  </div>
                  {preset && <p className="text-xs text-gray-500 mb-3 ml-6">{preset.desc}</p>}
                  <div className="ml-6 space-y-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">API Key</label>
                      <input type="password" value={c.apiKeyRef || ""} onChange={e => setKnowledgeFormState(prev => ({ ...prev, [key]: { ...prev[key], apiKeyRef: e.target.value } }))} placeholder="sk-..." className="w-full border rounded px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                      <input type="text" value={c.baseUrl || ""} onChange={e => setKnowledgeFormState(prev => ({ ...prev, [key]: { ...prev[key], baseUrl: e.target.value } }))} placeholder={preset?.baseUrl} className="w-full border rounded px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">模型</label>
                      <select value={c.modelId || ""} onChange={e => setKnowledgeFormState(prev => ({ ...prev, [key]: { ...prev[key], modelId: e.target.value } }))} className="w-full border rounded px-3 py-2 text-sm">
                        {(c.availableModels || []).map(m => <option key={m} value={m}>{m}</option>)}
                        {!(c.availableModels || []).includes(c.modelId) && c.modelId && <option value={c.modelId}>{c.modelId}</option>}
                      </select>
                    </div>
                  </div>
                  <div className="ml-6 mt-3 flex gap-2">
                    <button onClick={handleSaveKnowledge} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
                    <button onClick={() => handleTestKnowledge(key)} disabled={!c.apiKeyRef} className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">测试连接</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
