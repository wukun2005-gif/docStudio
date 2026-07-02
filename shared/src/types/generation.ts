/**
 * 文档生成相关类型
 */

export type DocumentFormat = "docx" | "pptx" | "xlsx" | "html" | "eml";
export type GenerationStatus = "pending" | "generating" | "done" | "error";

export interface OutlineSection {
  id: string;
  title: string;
  level: number;          // 1=章, 2=节, 3=小节
  children: OutlineSection[];
  description?: string;
}

/** Style 模板 — 文档体裁特征 */
export interface StyleTemplate {
  id: string;           // "report" | "email" | "technical" | "presentation" | "memo" | "general" | "custom-xxx"
  name: string;         // 显示名："报告"
  description: string;  // "正式的分析报告，适合管理层阅读"
  promptFragment: string; // 注入 system prompt 的风格指引
  isBuiltin: boolean;
}

/** Format 模板 — 输出格式约束 */
export interface FormatTemplate {
  id: string;           // "word" | "ppt" | "excel" | "markdown" | "html"
  name: string;         // "Word 文档"
  constraints: string;  // 注入 system prompt 的格式约束
}

/** Audience Profile — 读者画像 */
export interface AudienceProfile {
  id: string;           // "executive" | "engineer" | "legal" | "customer" | "general"
  name: string;         // "企业高管"
  guidance: string;     // 注入 system prompt 的读者适配指引
  isBuiltin?: boolean;
}

export interface GenerationConfig {
  format: DocumentFormat;
  templateId?: string;
  styleId?: string;         // Style Layer: 文档风格 ID
  outputFormatId?: string;  // Format Layer: 输出格式 ID
  audienceId?: string;      // Audience Layer: 读者画像 ID
  narrativeStyle?: string;
  targetLength?: number;
  sourcePreferences?: string[];
}

export interface GenerationRun {
  id: string;
  title: string;
  outline?: OutlineSection;
  content?: string;
  format: DocumentFormat;
  config?: GenerationConfig;
  status: GenerationStatus;
  trustScore?: number;
  createdAt: string;
  updatedAt: string;
}

/** 文档元数据 — 从用户请求中提取的结构化信息 */
export interface DocumentMetadata {
  style: string;        // Style ID: "email" | "report" | "technical" | ...
  guide: string;        // 兼容旧代码，等同于 styleTemplate.promptFragment
  styleId?: string;     // 显式指定的 Style ID
  outputFormatId?: string; // 显式指定的 Format ID
  audienceId?: string;  // 显式指定的 Audience ID
  // 邮件/文档读者（支持多读者）
  recipient?: { name: string; email?: string; title?: string; department?: string; personId?: string; role?: string };
  /** 所有读者（LLM 提取 + People Graph 匹配），recipient 为第一个主读者 */
  recipients?: Array<{ name: string; email?: string; title?: string; department?: string; personId?: string; role?: string }>;
  subject?: string;
  cc?: string[];
  // 通用
  metadata: Record<string, unknown>;
}

export interface ProvenanceNode {
  id: string;
  runId: string;
  paragraphIdx: number;
  chunkId?: string;
  score: number;
  isManual: boolean;
  parentId?: string;
  createdAt: string;
}
