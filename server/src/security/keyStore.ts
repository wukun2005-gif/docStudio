/**
 * In-memory key store for API keys.
 * Keys are stored in memory only.
 * getApiKey 自动从 DB fallback 读取用户配置的 key。
 */

import { dbGet } from "../lib/dbQuery.js";

const keyStore = new Map<string, string>();

export function setApiKey(providerId: string, apiKey: string): void {
  keyStore.set(providerId, apiKey);
}

export function getApiKey(providerId: string): string | undefined {
  const cached = keyStore.get(providerId);
  if (cached) return cached;
  return readApiKeyFromDb(providerId);
}

/** 从 user_settings 表读取用户配置的 provider API key */
function readApiKeyFromDb(providerId: string): string | undefined {
  try {
    const row = dbGet<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = ?",
      [`provider_${providerId}`],
    );
    if (!row) return undefined;
    const config = JSON.parse(row.value);
    return config.apiKey || undefined;
  } catch {
    return undefined;
  }
}

export function removeApiKey(providerId: string): boolean {
  return keyStore.delete(providerId);
}

export function clearAll(): void {
  keyStore.clear();
}

export function getAllApiKeys(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of keyStore) result[k] = v;
  return result;
}
