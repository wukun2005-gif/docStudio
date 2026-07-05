import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import type { ProviderConfig } from "../store";
import { PRESET_SEARCH_PROVIDERS, PRESET_KNOWLEDGE_PROVIDERS } from "../../../shared/src/types/provider.js";
import type { SearchProviderConnection, KnowledgeProviderConnection, SearchProviderId } from "../../../shared/src/types/provider.js";
import { useModelCatalog } from "../lib/modelCatalog";
import type { ModelInfo } from "../lib/modelCatalog";

/** 从目录中获取单个模型的元数据 */
function getModelMeta(providerId: string, modelId: string, catalog?: Record<string, ModelInfo[]>): ModelInfo | undefined {
  const src = catalog;
  if (!src) return undefined;
  return src[providerId]?.find((m) => m.id === modelId);
}

interface MsGraphConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

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

type TabId = "profile" | "llm" | "search" | "knowledge";

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

const PROVIDER_EXPANDED_KEY = "docstudio-provider-expanded";
const PROVIDER_ORDER_KEY = "docstudio-provider-order";

function loadExpandedState(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(PROVIDER_EXPANDED_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

function saveExpandedState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(PROVIDER_EXPANDED_KEY, JSON.stringify(state));
  } catch {}
}

function loadProviderOrder(): string[] {
  try {
    const saved = localStorage.getItem(PROVIDER_ORDER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveProviderOrder(order: string[]) {
  try {
    localStorage.setItem(PROVIDER_ORDER_KEY, JSON.stringify(order));
  } catch {}
}

export default function Settings() {
  const { providers, enableProviderFallback, searchProviders: savedSearch, knowledgeProviders: savedKnowledge, knowledgeEnabled: savedKnowledgeEnabled, loadSettings, saveProviders, saveSearchProviders, saveKnowledgeConfig } = useAppStore();
  const { catalog: modelCatalog } = useModelCatalog();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [formState, setFormState] = useState<Record<string, FormProvider>>({});
  const [searchFormState, setSearchFormState] = useState<Record<string, SearchProviderConnection>>({});
  const [knowledgeFormState, setKnowledgeFormState] = useState<Record<string, KnowledgeProviderConnection>>({});
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  const [verifiedModels, setVerifiedModels] = useState<Record<string, Set<string>>>({});
  const [fcSupportMap, setFcSupportMap] = useState<Record<string, Record<string, boolean>>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>(loadExpandedState);
  const [providerOrder, setProviderOrder] = useState<string[]>(loadProviderOrder);
  const dragItem = useRef<{ providerId: string; index: number } | null>(null);
  const dragOverItem = useRef<{ providerId: string; index: number } | null>(null);
  const dragProviderItem = useRef<{ index: number } | null>(null);
  const dragProviderOver = useRef<{ index: number } | null>(null);

  // GitHub Token 配置
  const [githubToken, setGithubToken] = useState("");
  const [githubSaved, setGithubSaved] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  // Azure 应用配置
  const [msGraphConfig, setMsGraphConfig] = useState<MsGraphConfig>({ clientId: "", clientSecret: "", tenantId: "" });
  const [msGraphConfigured, setMsGraphConfigured] = useState(false);
  const [msGraphSaving, setMsGraphSaving] = useState(false);

  // 个人资料（发件人身份）
  const [profileForm, setProfileForm] = useState({ name: "", title: "", department: "", email: "" });
  const [profileSaving, setProfileSaving] = useState(false);

  // 排序后的 provider 列表
  const sortedProviders = [...PRESET_PROVIDERS].sort((a, b) => {
    const aIdx = providerOrder.indexOf(a.id);
    const bIdx = providerOrder.indexOf(b.id);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  const toggleExpanded = (providerId: string) => {
    setExpandedProviders((prev) => {
      const next = { ...prev, [providerId]: !prev[providerId] };
      saveExpandedState(next);
      return next;
    });
  };

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 加载 GitHub Token 配置
  useEffect(() => {
    fetch("/api/settings/connector_github")
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.value?.token) {
          setGithubToken(data.value.token);
          setGithubSaved(true);
        }
      })
      .catch(() => {});
  }, []);

  // 加载 Azure 应用配置
  useEffect(() => {
    fetch("/api/connectors/msgraph/config")
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          setMsGraphConfigured(true);
          setMsGraphConfig(prev => ({ ...prev, clientId: data.clientId || "", tenantId: data.tenantId || "", clientSecret: data.clientSecret || "" }));
        }
      })
      .catch(() => {});
  }, []);

  // 加载个人资料
  useEffect(() => {
    fetch("/api/settings/sender_profile")
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          setProfileForm({
            name: data.value.name || "",
            title: data.value.title || "",
            department: data.value.department || "",
            email: data.value.email || "",
          });
        }
      })
      .catch(() => {});
  }, []);

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
        baseUrl: p.baseUrl, apiKeyRef: "", modelId: p.defaultModelId, availableModels: [], enabled: false,
      };
    });
    setKnowledgeFormState(map);
  }, [savedKnowledge, savedKnowledgeEnabled]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2000);
  };

  // 设为默认模型
  const handleSelectDefault = (providerId: string, modelId: string) => {
    setFormState(prev => {
      const current = prev[providerId];
      if (!current) return prev;
      const fallbacks = (current.modelFallbacks ?? current.modelIds).filter(m => m !== modelId);
      return {
        ...prev,
        [providerId]: {
          ...current,
          defaultModelId: modelId,
          modelFallbacks: [modelId, ...fallbacks],
        },
      };
    });
  };

  // 模型 fallback 拖拽排序
  const handleDragStart = (providerId: string, index: number) => {
    dragItem.current = { providerId, index };
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleDragOver = (e: React.DragEvent, providerId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 Provider 卡片
    dragOverItem.current = { providerId, index };
  };

  const handleDrop = (providerId: string) => {
    if (!dragItem.current || !dragOverItem.current) return;
    if (dragItem.current.providerId !== providerId) return;
    if (dragItem.current.index === dragOverItem.current.index) return;

    // 先保存到局部变量，避免在 setFormState 回调中引用已被清空的 ref
    const fromIndex = dragItem.current.index;
    const toIndex = dragOverItem.current.index;

    setFormState(prev => {
      const current = prev[providerId];
      if (!current) return prev;
      const list = [...(current.modelFallbacks ?? current.modelIds)];
      const [moved] = list.splice(fromIndex, 1);
      if (moved !== undefined) {
        list.splice(toIndex, 0, moved);
      }
      return { ...prev, [providerId]: { ...current, modelFallbacks: list } };
    });

    dragItem.current = null;
    dragOverItem.current = null;
  };

  // Provider 卡片拖拽排序
  const handleProviderDragStart = (index: number) => {
    dragProviderItem.current = { index };
  };

  const handleProviderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragProviderOver.current = { index };
  };

  const handleProviderDrop = () => {
    if (!dragProviderItem.current || !dragProviderOver.current) return;
    if (dragProviderItem.current.index === dragProviderOver.current.index) return;

    const fromIndex = dragProviderItem.current.index;
    const toIndex = dragProviderOver.current.index;
    const newOrder = sortedProviders.map(p => p.id);
    const [moved] = newOrder.splice(fromIndex, 1);
    if (moved !== undefined) {
      newOrder.splice(toIndex, 0, moved);
    }

    setProviderOrder(newOrder);
    saveProviderOrder(newOrder);

    // 同步更新 formState 的顺序
    const orderedFormState: Record<string, FormProvider> = {};
    for (const id of newOrder) {
      if (formState[id]) {
        orderedFormState[id] = formState[id];
      }
    }
    // 添加不在排序中的 provider
    for (const [id, p] of Object.entries(formState)) {
      if (!orderedFormState[id]) {
        orderedFormState[id] = p;
      }
    }
    setFormState(orderedFormState);

    dragProviderItem.current = null;
    dragProviderOver.current = null;
  };

  const handleProviderDragEnd = () => {
    dragProviderItem.current = null;
    dragProviderOver.current = null;
  };

  // 保存个人资料
  const handleSaveProfile = async () => {
    if (!profileForm.name.trim()) {
      showToast("error", "姓名不能为空");
      return;
    }
    setProfileSaving(true);
    try {
      // 保存 sender_profile
      await fetch("/api/settings/sender_profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: profileForm }),
      });
      // 同步到 People Graph（upsert current-user）
      await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "current-user",
          name: profileForm.name,
          title: profileForm.title || undefined,
          department: profileForm.department || undefined,
          email: profileForm.email || undefined,
          attributes: { isCurrentUser: true },
        }),
      });
      showToast("success", "个人资料已保存");
    } catch {
      showToast("error", "保存失败");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleQueryModels = useCallback(async (providerId: string) => {
    const provider = formState[providerId];
    if (!provider?.apiKey) return;
    setLoadingModels(providerId);
    setVerifiedModels(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

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

      // 保留用户已选 defaultModelId 和 fallback 顺序
      const userDefaultId = provider.defaultModelId ?? "";
      const existingFallbacks = provider.modelFallbacks ?? [];
      const modelSet = new Set(models);
      const mergedModels = userDefaultId && !modelSet.has(userDefaultId)
        ? [userDefaultId, ...models]
        : [...models];
      const preserved = existingFallbacks.filter(m => mergedModels.includes(m));
      const preservedSet = new Set(preserved);
      const newModels = mergedModels.filter(m => !preservedSet.has(m));
      const fallbacks = [...preserved, ...newModels];

      setFormState(prev => {
        const current = prev[providerId];
        if (!current) return prev;
        return {
          ...prev,
          [providerId]: {
            ...current,
            modelIds: mergedModels,
            defaultModelId: userDefaultId || models[0] || current.defaultModelId,
            modelFallbacks: fallbacks,
          },
        };
      });

      // 逐个验证模型是否真实可用
      const verified = new Set<string>();
      const CONCURRENCY = 3;
      const queue = [...models];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
        (async () => {
          while (queue.length > 0) {
            const modelId = queue.shift();
            if (!modelId) break;
            try {
              const verifyRes = await fetch(`/api/settings/providers/${providerId}/verify-model`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, modelId }),
              });
              const verifyData = await verifyRes.json();
              if (verifyData.ok) verified.add(modelId);
            } catch {}
          }
        })()
      );
      await Promise.all(workers);
      setVerifiedModels(prev => ({ ...prev, [providerId]: verified }));

      showToast("success", `已查询到 ${models.length} 个模型`);
    } catch (e: any) {
      showToast("error", `查询失败: ${e.message}`);
    } finally {
      setLoadingModels(null);
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
    const list: ProviderConfig[] = sortedProviders.map(p => {
      const c = formState[p.id];
      if (!c) return null;
      return {
        providerId: c.providerId, enabled: c.enabled,
        apiKey: c.apiKey.trim(), apiKeyRef: c.apiKey.trim(),
        baseUrl: c.baseUrl.replace(/\/+$/, ""),
        modelIds: c.modelIds, defaultModelId: c.defaultModelId,
        modelFallbacks: c.modelFallbacks, enableModelFallback: c.enableModelFallback,
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);
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

  const handleSaveMsGraphConfig = async () => {
    setMsGraphSaving(true);
    try {
      // 如果 secret 是脱敏占位符，不发送（服务端会保留原值）
      const { clientSecret, ...rest } = msGraphConfig;
      const body = clientSecret === "••••••••" ? rest : msGraphConfig;
      const res = await fetch("/api/connectors/msgraph/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setMsGraphConfigured(true);
        showToast("success", "Azure 应用配置已保存");
      } else {
        showToast("error", data.error || "保存失败");
      }
    } catch (e: any) {
      showToast("error", `保存失败: ${e.message}`);
    } finally {
      setMsGraphSaving(false);
    }
  };

  const handleSaveGithubToken = async () => {
    if (!githubToken.trim()) return;
    try {
      // 读取已有的 repos 列表，避免覆盖
      const existing = await fetch("/api/settings/connector_github").then(r => r.json());
      const repos = existing.ok && Array.isArray(existing.value?.repos) ? existing.value.repos : [];
      await fetch("/api/settings/connector_github", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: { token: githubToken.trim(), repos } }),
      });
      setGithubSaved(true);
      setGithubError(null);
      showToast("success", "GitHub Token 已保存");
    } catch (e: any) {
      showToast("error", `保存失败: ${e.message}`);
    }
  };

  const handleVerifyGithub = async () => {
    setGithubLoading(true);
    setGithubError(null);
    try {
      const res = await fetch("/api/connectors/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubToken.trim(), perPage: 50 }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("success", `验证成功，找到 ${data.repos.length} 个 Repo`);
      } else {
        setGithubError(data.error || "连接失败");
        showToast("error", data.error || "连接失败");
      }
    } catch (e: any) {
      setGithubError(`验证失败: ${e.message}`);
      showToast("error", `验证失败: ${e.message}`);
    } finally {
      setGithubLoading(false);
    }
  };

  const updateField = (id: string, field: keyof FormProvider, value: any) => {
    setFormState(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "profile", label: "👤 个人资料" },
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

      {/* ===== 个人资料 Tab ===== */}
      {activeTab === "profile" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-lg font-semibold">个人资料</h3>
            <button onClick={handleSaveProfile} disabled={profileSaving}
              className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
              {profileSaving ? "保存中..." : "保存"}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            配置您的个人信息，用于文档生成时的署名和邮件落款。保存后会自动同步到「人员图谱」。
          </p>
          <div className="bg-white border rounded-lg p-6 space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={profileForm.name}
                onChange={e => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="黄薇"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">职位</label>
              <input
                type="text"
                value={profileForm.title}
                onChange={e => setProfileForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="高级产品经理"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">部门</label>
              <input
                type="text"
                value={profileForm.department}
                onChange={e => setProfileForm(prev => ({ ...prev, department: e.target.value }))}
                placeholder="产品部"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={e => setProfileForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="huangwei@company.com"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* ===== 模型 Providers Tab ===== */}
      {activeTab === "llm" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-lg font-semibold">LLM Provider 配置</h3>
            <button onClick={handleSave} className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">保存</button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            配置 AI 服务商的 API Key 以启用模型连接。拖拽卡片可调整 Provider 优先级。
          </p>

          {/* Provider 回退总开关 */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enableProviderFallback}
                onChange={() => {
                  const store = useAppStore.getState();
                  store.saveProviders(store.providers, !enableProviderFallback);
                }}
                className="rounded"
              />
              <span className="font-medium">启用 Provider 回退</span>
              <span className="text-gray-500">（失败时自动切换至下一个可用服务商）</span>
            </label>
          </div>

          <div className="space-y-3">
            {sortedProviders.map((preset, index) => {
              const c = formState[preset.id];
              if (!c) return null;
              const isExpanded = expandedProviders[preset.id] ?? false;
              const fallbackList = c.modelFallbacks ?? c.modelIds ?? [];
              const isLoading = loadingModels === preset.id;
              const modelMetaMap = new Map(
                fallbackList.map(id => [id, getModelMeta(preset.id, id, modelCatalog)])
              );

              return (
                <div
                  key={preset.id}
                  className={`border rounded-lg bg-white overflow-hidden ${!c.enabled ? "opacity-60" : ""}`}
                  onDragOver={(e) => handleProviderDragOver(e, index)}
                  onDrop={handleProviderDrop}
                >
                  {/* Provider 卡片头部 */}
                  <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span
                        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 select-none"
                        draggable
                        onDragStart={() => handleProviderDragStart(index)}
                        onDragEnd={handleProviderDragEnd}
                        title="拖拽排序"
                      >
                        ⋮⋮
                      </span>
                      <button
                        type="button"
                        className="flex items-center gap-2"
                        onClick={() => toggleExpanded(preset.id)}
                      >
                        <span className="text-xs">{isExpanded ? "▼" : "▶"}</span>
                        <div className={`w-2.5 h-2.5 rounded-full ${c.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-gray-400">{preset.desc}</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={c.enableModelFallback ?? false}
                          onChange={e => updateField(c.providerId, "enableModelFallback", e.target.checked)}
                          className="rounded"
                        />
                        Model 回退
                      </label>
                      <label className="flex items-center gap-1.5 text-xs" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={e => updateField(c.providerId, "enabled", e.target.checked)}
                          className="rounded"
                        />
                        启用
                      </label>
                      {c.apiKey && <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">已配置</span>}
                      {!c.apiKey && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">需配置Key</span>}
                      {c.modelIds.length > 0 && <span className="text-xs text-gray-500">{c.modelIds.length} 模型</span>}
                    </div>
                  </div>

                  {/* Provider 卡片内容 */}
                  {isExpanded && (
                    <div className="border-t p-4 space-y-4 bg-gray-50/50">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">API Key</label>
                        <input
                          type="password"
                          value={c.apiKey}
                          onChange={e => updateField(c.providerId, "apiKey", e.target.value)}
                          placeholder={preset?.keyPlaceholder || "sk-..."}
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Base URL</label>
                        <input
                          type="text"
                          value={c.baseUrl}
                          onChange={e => updateField(c.providerId, "baseUrl", e.target.value)}
                          placeholder={preset?.defaultBaseUrl || "https://api.example.com/v1"}
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>

                      {/* 查询可用模型按钮 */}
                      {c.apiKey && (
                        <div>
                          <button
                            onClick={() => handleQueryModels(c.providerId)}
                            disabled={isLoading}
                            className={`text-sm px-3 py-1.5 rounded ${isLoading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                          >
                            {isLoading ? "查询中…" : "查询可用模型"}
                          </button>
                        </div>
                      )}

                      {/* Fallback 模型表格 */}
                      {fallbackList.length > 0 && (
                        <div>
                          <label className="block text-sm text-gray-600 mb-2">默认模型（拖拽调整 fallback 顺序）</label>
                          <div className="border rounded-lg overflow-hidden bg-white">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="w-8 px-2 py-2 text-center text-gray-500">#</th>
                                  <th className="px-3 py-2 text-left text-gray-500">Model ID</th>
                                  <th className="px-3 py-2 text-left text-gray-500">推荐场景</th>
                                  <th className="px-3 py-2 text-left text-gray-500">配额</th>
                                  <th className="w-20 px-2 py-2 text-center text-gray-500">操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fallbackList.map((model, i) => {
                                  const isDefault = model === c.defaultModelId;
                                  const meta = modelMetaMap.get(model);
                                  const verified = verifiedModels[preset.id];
                                  const isVerified = verified ? verified.has(model) : null;
                                  return (
                                    <tr
                                      key={model}
                                      className={`border-t hover:bg-gray-50 ${isDefault ? "bg-blue-50/50" : ""}`}
                                      onDragOver={(e) => handleDragOver(e, preset.id, i)}
                                      onDrop={(e) => {
                                        e.stopPropagation(); // 阻止冒泡到 Provider 卡片
                                        handleDrop(preset.id);
                                      }}
                                    >
                                      <td className="px-2 py-2 text-center">
                                        <span
                                          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 select-none"
                                          draggable
                                          onDragStart={() => handleDragStart(preset.id, i)}
                                          onDragEnd={handleDragEnd}
                                          aria-label="拖拽排序"
                                        >
                                          ⠿
                                        </span>
                                      </td>
                                      <td className="px-3 py-2">
                                        <span className="font-mono text-xs">
                                          {model}
                                          {isDefault && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">当前默认</span>}
                                          {isVerified === true && <span className="ml-1 text-green-600" title="已验证可用">✓</span>}
                                          {isVerified === false && <span className="ml-1 text-amber-500" title="验证失败">⚠</span>}
                                          {isVerified === null && isLoading && <span className="ml-1 text-gray-400" title="验证中…">⏳</span>}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-gray-500 text-xs">
                                        {meta?.recommendation ?? "—"}
                                      </td>
                                      <td className="px-3 py-2 text-gray-500 text-xs">
                                        {meta ? `RPM ${meta.rpm ?? "?"} / RPD ${meta.rpd ?? "?"} / TPM ${meta.tpm ?? "?"}` : "—"}
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        {!isDefault && (
                                          <button
                                            type="button"
                                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                            onClick={() => handleSelectDefault(c.providerId, model)}
                                          >
                                            设为默认
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end">
                        <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
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

          {/* 远程知识源配置 */}
          <div className="mt-6 border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">远程知识源</h3>
            <div className="space-y-4">
              {/* Microsoft Entra ID (Azure AD) 配置 */}
              <div className="border rounded-lg bg-white p-4">
                <div className="flex items-center mb-3">
                  <span className="text-lg mr-2">🏢</span>
                  <span className="font-medium flex-1">Microsoft Entra ID (Azure AD)</span>
                  {msGraphConfigured && (
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">已配置</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Azure AD 应用凭据，用于 <strong>People Graph</strong>（同步组织架构）和 <strong>OneDrive / SharePoint</strong>（远程文档搜索）。
                </p>
                <div className="space-y-3 ml-1">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Tenant ID</label>
                    <input
                      type="text"
                      value={msGraphConfig.tenantId}
                      onChange={e => setMsGraphConfig(prev => ({ ...prev, tenantId: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={msGraphConfig.clientId}
                      onChange={e => setMsGraphConfig(prev => ({ ...prev, clientId: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={msGraphConfig.clientSecret}
                      onChange={e => setMsGraphConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                      placeholder={msGraphConfigured ? "••••••••（已配置，留空则不更新）" : "Client Secret Value"}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveMsGraphConfig}
                      disabled={msGraphSaving || !msGraphConfig.clientId || !msGraphConfig.tenantId}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {msGraphSaving ? "保存中..." : "保存配置"}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    在 <a href="https://portal.azure.com/" target="_blank" rel="noopener" className="text-blue-500 hover:underline">Azure Portal</a> 注册应用获取。
                    需配置重定向 URI：<code className="bg-gray-100 px-1 rounded">http://localhost:3000/api/connectors/msgraph/callback</code>。
                    配置后可在「知识库 → People Graph」同步组织架构，在「知识库 → 远程文档」连接 OneDrive。
                  </p>
                </div>
              </div>

              {/* GitHub 配置 */}
              <div className="border rounded-lg bg-white p-4">
                <div className="flex items-center mb-3">
                  <span className="text-lg mr-2">🐙</span>
                  <span className="font-medium flex-1">GitHub</span>
                  {githubSaved && githubToken && (
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">已保存</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Clone 团队 repo 到本地，自动索引代码和文档。支持增量同步。
                </p>
                <div className="space-y-3 ml-1">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Personal Access Token</label>
                    <input
                      type="password"
                      value={githubToken}
                      onChange={e => { setGithubToken(e.target.value); setGithubSaved(false); }}
                      placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveGithubToken}
                      disabled={!githubToken.trim()}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button
                      onClick={handleVerifyGithub}
                      disabled={!githubToken.trim() || githubLoading}
                      className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {githubLoading ? "验证中..." : "验证 Token"}
                    </button>
                  </div>
                  {githubError && (
                    <p className="text-xs text-red-500">{githubError}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    在 <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" className="text-blue-500 hover:underline">GitHub Settings → Tokens</a> 创建，
                    需要 repo 权限。配置后在「知识库 → 代码」tab 选择 Repo 并索引。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}