/**
 * Microsoft Graph Search API 连接器
 *
 * 提供 OneDrive/SharePoint 的语义搜索能力，用于远程知识源的两阶段检索。
 * Phase 1: 使用 Graph /search/query API 获取候选文件列表
 * Phase 2: 下载文件内容用于实时切片和向量化
 */

import { logger } from "../logger.js";

// ── 类型定义 ────────────────────────────────────────────

export interface GraphSearchConfig {
  accessToken: string;
}

export interface GraphSearchResult {
  /** 文件 ID */
  id: string;
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** Web URL */
  webUrl: string;
  /** 最后修改时间 */
  lastModifiedDateTime: string;
  /** 搜索相关性分数 */
  relevanceScore?: number;
  /** 文件路径（如果可获取） */
  path?: string;
}

export interface GraphSearchOptions {
  /** 返回结果数量 */
  top?: number;
  /** 文件类型过滤 */
  fileTypes?: string[];
  /** 搜索范围：'me' | 'org' */
  scope?: "me" | "org";
}

// ── 核心函数 ────────────────────────────────────────────

/**
 * 使用 Microsoft Graph Search API 搜索文件
 *
 * @param config Graph 配置（包含 accessToken）
 * @param query 搜索查询
 * @param options 搜索选项
 * @returns 候选文件列表
 */
export async function searchFiles(
  config: GraphSearchConfig,
  query: string,
  options: GraphSearchOptions = {},
): Promise<GraphSearchResult[]> {
  const { top = 20, fileTypes, scope = "me" } = options;

  // 构建查询字符串
  let queryString = query;
  if (fileTypes && fileTypes.length > 0) {
    // 添加文件类型过滤
    const typeFilter = fileTypes.map(t => `fileType:${t}`).join(" OR ");
    queryString = `${query} AND (${typeFilter})`;
  }

  const endpoint = scope === "me"
    ? "https://graph.microsoft.com/v1.0/me/drive/root/search(q='{query}')"
    : "https://graph.microsoft.com/v1.0/search/query";

  const body = scope === "me"
    ? undefined
    : JSON.stringify({
        requests: [{
          entityTypes: ["driveItem"],
          query: { queryString },
          from: 0,
          size: top,
        }],
      });

  const url = scope === "me"
    ? endpoint.replace("{query}", encodeURIComponent(queryString))
    : endpoint;

  logger.info(`[GraphSearch] 搜索: query="${query}", scope=${scope}, top=${top}`);

  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Graph Search API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as {
      value?: Array<{
        id: string;
        name: string;
        file?: { mimeType: string };
        size: number;
        webUrl: string;
        lastModifiedDateTime: string;
        parentReference?: { path?: string };
        resourceVisualization?: { title?: string };
      }>;
      value2?: Array<{
        hitsContainers?: Array<{
          hits?: Array<{
            resource?: {
              id: string;
              name: string;
              file?: { mimeType: string };
              size: number;
              webUrl: string;
              lastModifiedDateTime: string;
              parentReference?: { path?: string };
            };
            rank: number;
          }>;
        }>;
      }>;
    };

    // 解析结果（兼容两种 API 格式）
    const results: GraphSearchResult[] = [];

    if (data.value) {
      // /me/drive/root/search 格式
      for (const item of data.value) {
        if (!item.file) continue; // 跳过文件夹
        results.push({
          id: item.id,
          name: item.name,
          mimeType: item.file.mimeType,
          size: item.size,
          webUrl: item.webUrl,
          lastModifiedDateTime: item.lastModifiedDateTime,
          path: item.parentReference?.path,
        });
      }
    } else if (data.value2) {
      // /search/query 格式
      for (const container of data.value2) {
        for (const hit of container.hitsContainers ?? []) {
          for (const h of hit.hits ?? []) {
            const resource = h.resource;
            if (!resource?.file) continue;
            results.push({
              id: resource.id,
              name: resource.name,
              mimeType: resource.file.mimeType,
              size: resource.size,
              webUrl: resource.webUrl,
              lastModifiedDateTime: resource.lastModifiedDateTime,
              relevanceScore: h.rank,
              path: resource.parentReference?.path,
            });
          }
        }
      }
    }

    logger.info(`[GraphSearch] 搜索完成: ${results.length} 个结果`);
    return results;
  } catch (err) {
    logger.error(`[GraphSearch] 搜索失败: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * 列出 OneDrive 根目录文件
 */
export async function listRootFiles(
  config: GraphSearchConfig,
  options?: { top?: number },
): Promise<GraphSearchResult[]> {
  const top = options?.top ?? 50;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=${top}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Graph List API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as {
    value: Array<{
      id: string;
      name: string;
      file?: { mimeType: string };
      size: number;
      webUrl: string;
      lastModifiedDateTime: string;
    }>;
  };

  return data.value
    .filter(item => item.file)
    .map(item => ({
      id: item.id,
      name: item.name,
      mimeType: item.file!.mimeType,
      size: item.size,
      webUrl: item.webUrl,
      lastModifiedDateTime: item.lastModifiedDateTime,
    }));
}

/**
 * 列出指定文件夹中的文件
 */
export async function listFolderFiles(
  config: GraphSearchConfig,
  folderId: string,
  options?: { top?: number },
): Promise<GraphSearchResult[]> {
  const top = options?.top ?? 50;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=${top}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Graph Folder API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as {
    value: Array<{
      id: string;
      name: string;
      file?: { mimeType: string };
      size: number;
      webUrl: string;
      lastModifiedDateTime: string;
    }>;
  };

  return data.value
    .filter(item => item.file)
    .map(item => ({
      id: item.id,
      name: item.name,
      mimeType: item.file!.mimeType,
      size: item.size,
      webUrl: item.webUrl,
      lastModifiedDateTime: item.lastModifiedDateTime,
    }));
}

/**
 * 下载文件内容
 *
 * @returns 文件内容（Buffer）
 */
export async function downloadFile(
  config: GraphSearchConfig,
  fileId: string,
): Promise<{ content: Buffer; mimeType: string }> {
  // 先获取文件元数据
  const metaRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!metaRes.ok) {
    throw new Error(`Graph Meta API error ${metaRes.status}`);
  }

  const meta = await metaRes.json() as {
    file?: { mimeType: string };
    size: number;
  };

  // 检查文件大小限制（10MB）
  if (meta.size > 10 * 1024 * 1024) {
    throw new Error(`文件太大: ${(meta.size / 1024 / 1024).toFixed(1)}MB，限制 10MB`);
  }

  // 下载文件内容
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Graph Download API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    content: Buffer.from(arrayBuffer),
    mimeType: meta.file?.mimeType ?? "application/octet-stream",
  };
}

/**
 * 获取文件元数据
 */
export async function getFileMetadata(
  config: GraphSearchConfig,
  fileId: string,
): Promise<GraphSearchResult | null> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) return null;

  const data = await res.json() as {
    id: string;
    name: string;
    file?: { mimeType: string };
    size: number;
    webUrl: string;
    lastModifiedDateTime: string;
    parentReference?: { path?: string };
  };

  if (!data.file) return null;

  return {
    id: data.id,
    name: data.name,
    mimeType: data.file.mimeType,
    size: data.size,
    webUrl: data.webUrl,
    lastModifiedDateTime: data.lastModifiedDateTime,
    path: data.parentReference?.path,
  };
}
