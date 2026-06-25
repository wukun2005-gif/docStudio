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

export interface GenerationConfig {
  format: DocumentFormat;
  templateId?: string;
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
  style: "email" | "ppt" | "table" | "code" | "report" | "general";
  guide: string;
  // 邮件特有
  recipient?: { name: string; email?: string; title?: string; department?: string };
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
