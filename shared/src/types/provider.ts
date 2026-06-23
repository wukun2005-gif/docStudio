/**
 * Provider 类型定义 — 从 patentExaminator 迁移
 *
 * 包含 ProviderId、模型能力、Provider 配置等共享类型。
 */

// ── Provider ID ──────────────────────────────────────────

export type ProviderId =
  | "kimi" | "glm" | "minimax" | "mimo" | "deepseek" | "gemini"
  | "qwen" | "bedrock" | "openrouter" | "opencode" | "volcengine" | "bailian";

// ── 模型能力 ──────────────────────────────────────────

export interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens: number;
  isReasoning: boolean;
  temperature: { supported: boolean; range: [number, number] };
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  systemPromptMode: "message" | "parameter" | "none";
  recommendation?: string;
  rpm?: number;
  rpd?: number;
  tpm?: string;
}

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

// ── Provider 配置 ──────────────────────────────────────────

export interface ProviderConnection {
  providerId: ProviderId;
  baseUrl?: string;
  apiKeyRef: string;
  modelIds: string[];
  defaultModelId: string;
  modelFallbacks?: string[];
  enabled: boolean;
  enableModelFallback?: boolean;
}

// ── App Settings ──────────────────────────────────────────

export interface AppSettings {
  providers: ProviderConnection[];
  enableProviderFallback?: boolean;
}

// ── Preset Provider ──────────────────────────────────────────

export interface PresetModelProvider {
  id: ProviderId;
  displayName: string;
  desc: string;
  baseUrl: string;
  keyPlaceholder: string;
}

export const PRESET_MODEL_PROVIDERS: PresetModelProvider[] = [
  { id: "gemini", displayName: "Gemini", desc: "Google AI Studio (免费)", baseUrl: "https://generativelanguage.googleapis.com/v1beta", keyPlaceholder: "AIza..." },
  { id: "mimo", displayName: "MiMo", desc: "小米 Token Plan", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1", keyPlaceholder: "sk-..." },
  { id: "kimi", displayName: "Kimi", desc: "Moonshot / 月之暗面", baseUrl: "https://api.moonshot.cn/v1", keyPlaceholder: "sk-..." },
  { id: "glm", displayName: "GLM", desc: "智谱 AI", baseUrl: "https://open.bigmodel.cn/api/paas/v4", keyPlaceholder: "your-glm-key" },
  { id: "minimax", displayName: "MiniMax", desc: "MiniMax", baseUrl: "https://api.minimax.chat/v1", keyPlaceholder: "your-minimax-key" },
  { id: "deepseek", displayName: "DeepSeek", desc: "深度求索", baseUrl: "https://api.deepseek.com", keyPlaceholder: "sk-..." },
  { id: "qwen", displayName: "Qwen", desc: "阿里通义千问 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-..." },
  { id: "bedrock", displayName: "AWS Bedrock", desc: "AWS Bedrock OpenAI-Compatible API", baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1", keyPlaceholder: "bedrock-api-key" },
  { id: "openrouter", displayName: "OpenRouter", desc: "统一 API 聚合数百模型", baseUrl: "https://openrouter.ai/api/v1", keyPlaceholder: "sk-or-v1-..." },
  { id: "opencode", displayName: "OpenCode Zen", desc: "OpenCode 官方精选模型网关", baseUrl: "https://opencode.ai/zen/v1", keyPlaceholder: "opencode-zen-key" },
  { id: "volcengine", displayName: "火山引擎", desc: "字节跳动 · 火山引擎", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", keyPlaceholder: "sk-..." },
  { id: "bailian", displayName: "百炼", desc: "阿里云百炼 (千问+三方模型)", baseUrl: "https://ws-3vv2b1h4akmem3xz.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", keyPlaceholder: "sk-..." },
];
