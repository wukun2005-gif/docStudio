/**
 * Chat 持久化类型定义
 * 照搬 patentExaminator 的 ChatSession / ChatMessage 结构
 */

export interface ChatSession {
  id: string;
  title: string;
  caseId?: string;       // 关联的文档 case（按 case 隔离历史）
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  type?: string;
  followUpQuestions?: string[];
  createdAt: string;
}
