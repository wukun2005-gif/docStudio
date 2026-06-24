/**
 * Case 数据访问层
 * 照搬 patentExaminator 的 repos 模式，通过通用 KV API 持久化
 */
import type { DocumentCase } from "../../../shared/src/types/case.js";

const API_BASE = "/api/data";

// ── 通用 KV 客户端 ──────────────────────────────────

async function getAll<T>(store: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}/${store}`);
  if (!res.ok) throw new Error(`Failed to get ${store}: ${res.status}`);
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

// ── caseRepo ─────────────────────────────────────────

export async function createCase(item: DocumentCase): Promise<void> {
  await create("cases", item);
}

export async function readAllCases(): Promise<DocumentCase[]> {
  const cases = await getAll<DocumentCase>("cases");
  return cases.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function updateCase(item: DocumentCase): Promise<void> {
  await update("cases", item.id, item);
}

export async function deleteCase(id: string): Promise<void> {
  await remove("cases", id);
}
