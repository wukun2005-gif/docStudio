/**
 * API Client for Outlook Add-in
 *
 * 与 word/ppt/excel 同样的 axios baseURL='/api' 模式：
 * - Vite dev server proxy /api → http://localhost:3000
 * - Excel Online / Outlook on the web CSP 友好（无 hardcoded http://localhost:3000）
 */
import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// ── 类型定义（与 server 端 emailPayloadBuilder.ts 保持一致） ──

export interface CitationItem {
  index: number;
  title: string;
  url: string;
}

export interface EmailWritePayload {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  bodyCharCount: number;
  citations: Array<{ index: number; title: string; url: string }>;
  trustScore: number;
  documentStyle: string;
}

export interface OutlineSection {
  id: string;
  title: string;
  level: number;
  children: unknown[];
  description: string;
}

export interface GenerateRequest {
  title: string;
  outline: Array<{ title: string; description?: string; children?: never[] }>;
  format: "email";
  providerPreference: string[];
  userRequest: string;
  modelId?: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
}

export interface GenerateResponse {
  ok: boolean;
  runId: string;
  existingRunId?: string;
  error?: string;
}

export interface StatusResponse {
  ok: boolean;
  status: "generating" | "done" | "error";
  runId: string;
  title?: string;
  error?: string;
  progress?: { currentChapter: string; index: number; total: number };
  emailPayload?: EmailWritePayload;
  trustScore?: number;
  documentStyle?: string;
}

// ── API 调用封装 ──

/** POST /api/generation/email — 触发邮件草稿生成 */
export async function generateEmail(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await apiClient.post<GenerateResponse>("/generation/email", req);
  return res.data;
}

/** GET /api/generation/status/:runId — 轮询生成状态 */
export async function getGenerationStatus(runId: string): Promise<StatusResponse> {
  const res = await apiClient.get<StatusResponse>(`/generation/status/${runId}`);
  return res.data;
}
