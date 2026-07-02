/**
 * 文档 Case 类型
 * 照搬 patentExaminator 的 PatentCase 模式
 */
import type { OutlineSection, DocumentFormat } from "./generation.js";

export type CaseWorkflowState =
  | "draft"           // 刚创建，用户正在输入需求
  | "outline-ready"   // 大纲已生成，用户可编辑
  | "generating"      // 文档生成中
  | "evaluating"      // 评估进行中（生成已完成，内容评估中）
  | "completed"       // 文档生成与评估完成
  | "error";          // 生成失败

export interface DocumentCase {
  id: string;
  title: string;                      // case 标题（用户需求的简短摘要）
  userRequest: string;                // 用户原始需求文本
  outline: OutlineSection[];          // 大纲
  generatedContent?: string;          // 生成的文档 HTML
  format: DocumentFormat;             // 文档格式
  trustScore?: number;                // 信任度评分
  lastRunId?: string;                 // 最近一次生成的 runId（用于生成树查询）
  workflowState: CaseWorkflowState;
  errorMessage?: string;              // 错误信息
  deletedAt?: string;                 // 软删除时间，非空表示在回收站中
  createdAt: string;
  updatedAt: string;
}