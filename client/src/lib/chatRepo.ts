/**
 * Chat 数据访问层
 * 照搬 patentExaminator 的 chatRepo，通过通用 KV API 持久化
 */
import type { ChatSession, ChatMessage } from "../../../shared/src/types/chat.js";

const API_BASE = "/api/data";

// ── 通用 KV 客户端 ──────────────────────────────────

async function getAll<T>(store: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}/${store}`);
  if (!res.ok) throw new Error(`Failed to get ${store}: ${res.status}`);
  const data = await res.json() as { ok: boolean; records: T[] };
  return data.records;
}

async function query<T>(store: string, field: string, value: unknown): Promise<T[]> {
  const res = await fetch(`${API_BASE}/${store}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value }),
  });
  if (!res.ok) throw new Error(`Failed to query ${store}: ${res.status}`);
  const data = await res.json() as { ok: boolean; records: T[] };
  return data.records;
}

async function create<T extends { id: string }>(store: string, record: T): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Failed to create ${store}: ${res.status}`);
}

async function update<T>(store: string, id: string, data: T): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update ${store}/${id}: ${res.status}`);
}

async function remove(store: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete ${store}/${id}: ${res.status}`);
}

// ── chatRepo ─────────────────────────────────────────

export async function createSession(session: ChatSession): Promise<void> {
  await create("chatSessions", session);
}

export async function getAllSessions(): Promise<ChatSession[]> {
  const sessions = await getAll<ChatSession>("chatSessions");
  return sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getSessionsByCaseId(caseId: string): Promise<ChatSession[]> {
  return query<ChatSession>("chatSessions", "caseId", caseId);
}

export async function deleteSession(id: string): Promise<void> {
  await remove("chatSessions", id);
}

export async function updateSession(session: ChatSession): Promise<void> {
  await update("chatSessions", session.id, session);
}

export async function createMessage(message: ChatMessage): Promise<void> {
  await create("chatMessages", message);
}

export async function getMessagesBySessionId(sessionId: string): Promise<ChatMessage[]> {
  const messages = await query<ChatMessage>("chatMessages", "sessionId", sessionId);
  // 按创建时间升序排列（最早的消息在前）
  return messages.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export async function deleteMessagesBySessionId(sessionId: string): Promise<void> {
  const messages = await query<ChatMessage>("chatMessages", "sessionId", sessionId);
  for (const msg of messages) {
    await remove("chatMessages", msg.id);
  }
}
