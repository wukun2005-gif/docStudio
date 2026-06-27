/**
 * Microsoft Graph 组织架构同步
 *
 * 使用 client_credentials 流程（Application 权限）从 Entra ID 拉取用户和上下级关系，
 * 写入本地 people 表。
 */
import { dbGet } from "../dbQuery.js";
import { logger } from "../logger.js";
import { addPerson, addRelationship, getAllPeople, deletePerson } from "../peopleGraph.js";

// ── 类型 ──────────────────────────────────────────────

interface GraphUser {
  id: string;
  displayName: string;
  jobTitle?: string;
  department?: string;
  mail?: string;
  userPrincipalName?: string;
}

interface ClientTokenCache {
  token: string;
  expiresAt: number;
}

// ── Token 缓存 ────────────────────────────────────────

let clientTokenCache: ClientTokenCache | null = null;

/** 读取 Azure 应用配置（复用 msGraphOAuth 的配置） */
function getAppConfig(): { clientId: string; clientSecret: string; tenantId: string } | null {
  try {
    const row = dbGet<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", ["msgraph_config"]);
    if (!row) return null;
    const config = JSON.parse(row.value);
    if (!config.clientId || !config.clientSecret || !config.tenantId) return null;
    return config;
  } catch {
    return null;
  }
}

/** 获取 Application Token（client_credentials 流程，带缓存） */
async function getClientToken(): Promise<string> {
  if (clientTokenCache && clientTokenCache.expiresAt > Date.now() + 60_000) {
    return clientTokenCache.token;
  }

  const config = getAppConfig();
  if (!config) {
    throw new Error("未配置 Azure 应用信息。请在 Settings 中配置 Microsoft Graph 连接。");
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`获取 Application Token 失败: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  clientTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ── Graph API 调用 ─────────────────────────────────────

/** 获取所有用户 */
async function fetchUsers(token: string): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let url = "https://graph.microsoft.com/v1.0/users?$select=id,displayName,jobTitle,department,mail,userPrincipalName&$top=999";

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`获取用户列表失败: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { value: GraphUser[]; "@odata.nextLink"?: string };
    users.push(...data.value);
    url = data["@odata.nextLink"] || "";
  }

  return users;
}

/** 获取某用户的上级 */
async function fetchManager(token: string, userId: string): Promise<GraphUser | null> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}/manager?$select=id,displayName`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) return null; // 没有上级
  if (!res.ok) return null;

  return (await res.json()) as GraphUser;
}

// ── 同步主函数 ─────────────────────────────────────────

export interface SyncResult {
  total: number;
  imported: number;
  relationships: number;
  errors: string[];
}

/**
 * 从 Entra ID 同步组织架构到本地 people 表
 * 替换所有现有数据
 */
export async function syncPeopleFromGraph(): Promise<SyncResult> {
  const result: SyncResult = { total: 0, imported: 0, relationships: 0, errors: [] };

  // 1. 获取 token
  const token = await getClientToken();

  // 2. 拉取所有用户
  const users = await fetchUsers(token);
  result.total = users.length;
  logger.info(`[GraphPeople] 从 Entra ID 获取到 ${users.length} 个用户`);

  // 3. 清空现有数据
  const existing = getAllPeople();
  for (const p of existing) {
    deletePerson(p.id);
  }

  // 4. 创建 ID 映射（用于后续设置 manager 关系）
  const userMap = new Map<string, GraphUser>();
  for (const u of users) {
    userMap.set(u.id, u);
  }

  // 5. 导入所有用户
  for (const u of users) {
    try {
      addPerson({
        id: u.id,
        name: u.displayName,
        title: u.jobTitle || "",
        department: u.department || "",
        email: u.mail || u.userPrincipalName || "",
      });
      result.imported++;
    } catch (err) {
      const msg = `导入用户 ${u.displayName} 失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      logger.warn(`[GraphPeople] ${msg}`);
    }
  }

  // 6. 逐个拉取 manager 并建立关系
  for (const u of users) {
    try {
      const manager = await fetchManager(token, u.id);
      if (manager && userMap.has(manager.id)) {
        addRelationship({
          sourceId: u.id,
          targetId: manager.id,
          type: "manager",
          context: "直接汇报",
        });
        result.relationships++;
      }
    } catch (err) {
      const msg = `获取 ${u.displayName} 的上级失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      logger.warn(`[GraphPeople] ${msg}`);
    }
  }

  logger.info(
    `[GraphPeople] 同步完成: ${result.imported}/${result.total} 人, ${result.relationships} 条关系, ${result.errors.length} 个错误`,
  );

  return result;
}
