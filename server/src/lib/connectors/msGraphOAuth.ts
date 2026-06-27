/**
 * Microsoft Graph OAuth2 授权码流程
 *
 * 实现 OAuth2 Authorization Code Flow，支持 Token 自动刷新。
 * 用户只需在 Settings 配置 Azure 应用信息，点击"连接 OneDrive"即可完成授权。
 */

import { dbRun, dbGet } from "../dbQuery.js";
import { logger } from "../logger.js";

// ── 类型定义 ─────────────────────────────────────────

/** Azure 应用配置（用户在 Settings 页面填写） */
export interface MsGraphAppConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/** OAuth Token 信息 */
export interface MsGraphTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms)
  userDisplayName?: string;
  userEmail?: string;
}

/** 连接状态 */
export interface MsGraphConnectionStatus {
  connected: boolean;
  userDisplayName?: string;
  userEmail?: string;
  tokenExpired?: boolean;
  hasAppConfig: boolean;
}

// ── 常量 ─────────────────────────────────────────────

const AUTHORITY = "https://login.microsoftonline.com";
const GRAPH_SCOPE = "Files.Read Files.Read.All Files.ReadWrite User.Read offline_access";
const CONFIG_KEY = "msgraph_config";
const TOKENS_KEY = "msgraph_tokens";

// ── DB 读写 ──────────────────────────────────────────

/** 读取 Azure 应用配置 */
export function getMsGraphAppConfig(): MsGraphAppConfig | null {
  try {
    const row = dbGet<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [CONFIG_KEY]);
    if (!row) return null;
    const config = JSON.parse(row.value) as MsGraphAppConfig;
    if (!config.clientId || !config.clientSecret || !config.tenantId) return null;
    return config;
  } catch {
    return null;
  }
}

/** 保存 Azure 应用配置 */
export function saveMsGraphAppConfig(config: MsGraphAppConfig): void {
  dbRun(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))",
    [CONFIG_KEY, JSON.stringify(config)],
    { table: "user_settings", recordId: CONFIG_KEY, source: "connector", newData: config },
  );
}

/** 读取 OAuth Token */
export function getMsGraphTokens(): MsGraphTokens | null {
  try {
    const row = dbGet<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [TOKENS_KEY]);
    if (!row) return null;
    return JSON.parse(row.value) as MsGraphTokens;
  } catch {
    return null;
  }
}

/** 保存 OAuth Token */
export function saveMsGraphTokens(tokens: MsGraphTokens): void {
  dbRun(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))",
    [TOKENS_KEY, JSON.stringify(tokens)],
    { table: "user_settings", recordId: TOKENS_KEY, source: "connector", newData: { hasToken: true } },
  );
}

/** 清除 OAuth Token（断开连接） */
export function clearMsGraphTokens(): void {
  dbRun(
    "DELETE FROM user_settings WHERE key = ?",
    [TOKENS_KEY],
    { table: "user_settings", recordId: TOKENS_KEY, source: "connector", operation: "DELETE" },
  );
}

// ── OAuth 流程 ───────────────────────────────────────

/**
 * 生成 OAuth 授权 URL
 * 使用 /common 端点支持个人 Microsoft 帐户访问个人 OneDrive
 */
export function getAuthUrl(config: MsGraphAppConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPE,
    state,
    response_mode: "query",
  });
  return `${AUTHORITY}/common/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * 用授权码换取 Access Token + Refresh Token
 */
export async function exchangeCodeForTokens(
  config: MsGraphAppConfig,
  code: string,
  redirectUri: string,
): Promise<MsGraphTokens> {
  const tokenUrl = `${AUTHORITY}/common/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  // 获取用户信息
  let userDisplayName: string | undefined;
  let userEmail: string | undefined;
  try {
    const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${data.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
      userDisplayName = user.displayName;
      userEmail = user.mail ?? user.userPrincipalName;
    }
  } catch {
    // 获取用户信息失败不影响主流程
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    userDisplayName,
    userEmail,
  };
}

/**
 * 用 Refresh Token 刷新 Access Token
 */
export async function refreshAccessToken(
  config: MsGraphAppConfig,
  refreshToken: string,
): Promise<MsGraphTokens> {
  const tokenUrl = `${AUTHORITY}/common/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: GRAPH_SCOPE,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const tokens = getMsGraphTokens();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // 有些响应不返回新的 refresh_token
    expiresAt: Date.now() + data.expires_in * 1000,
    userDisplayName: tokens?.userDisplayName,
    userEmail: tokens?.userEmail,
  };
}

/**
 * 获取有效的 Access Token（自动刷新）
 * 返回 null 表示未连接或刷新失败
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getMsGraphTokens();
  if (!tokens) return null;

  // Token 未过期（提前 5 分钟刷新）
  if (tokens.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  // 需要刷新
  const config = getMsGraphAppConfig();
  if (!config || !tokens.refreshToken) {
    logger.warn("[MSGraphOAuth] Token 过期且无法刷新：缺少 app config 或 refresh token");
    return null;
  }

  try {
    const newTokens = await refreshAccessToken(config, tokens.refreshToken);
    saveMsGraphTokens(newTokens);
    logger.info("[MSGraphOAuth] Token 刷新成功");
    return newTokens.accessToken;
  } catch (err) {
    logger.error(`[MSGraphOAuth] Token 刷新失败: ${err}`);
    return null;
  }
}

/**
 * 获取连接状态
 */
export function getConnectionStatus(): MsGraphConnectionStatus {
  const config = getMsGraphAppConfig();
  const tokens = getMsGraphTokens();

  if (!tokens) {
    return { connected: false, hasAppConfig: !!config };
  }

  return {
    connected: true,
    userDisplayName: tokens.userDisplayName,
    userEmail: tokens.userEmail,
    tokenExpired: tokens.expiresAt <= Date.now(),
    hasAppConfig: !!config,
  };
}
