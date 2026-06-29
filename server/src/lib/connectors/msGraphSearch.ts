/**
 * Microsoft Graph Search API 连接器
 *
 * 提供 OneDrive/SharePoint 的语义搜索能力，用于远程知识源的两阶段检索。
 * Phase 1: 使用 Graph /search/query API 获取候选文件列表
 * Phase 2: 下载文件内容用于实时切片和向量化
 */

import { logger } from "../logger.js";

// ── 分词（兼容中英文）────────────────────────────────────

/** 简单中文 + 英文分词：中文按 2-gram，英文按单词拆分 */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^一-鿿a-z0-9]/g, " ");
  const tokens: string[] = [];

  // 英文单词
  const englishWords = normalized.match(/[a-z]+/g) ?? [];
  tokens.push(...englishWords);

  // 连续数字（日期、编号等）
  const numberGroups = normalized.match(/[0-9]+/g) ?? [];
  tokens.push(...numberGroups);

  // 中文按 2-gram
  const chinese = normalized.match(/[一-鿿]+/g) ?? [];
  for (const segment of chinese) {
    for (let i = 0; i < segment.length - 1; i++) {
      tokens.push(segment.slice(i, i + 2));
    }
    // 单字也算上
    if (segment.length === 1) tokens.push(segment);
  }

  return tokens.filter((t) => t.length > 0);
}

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
/**
 * Sanitize query for Microsoft Graph Search API.
 *
 * Graph Search 的查询解析器对特殊字符非常敏感：
 *   - `:` 会被解析为 field 运算符（如 `author:john`）
 *   - `(` `)` / `（` `）` 会被解析为分组语法
 *   - `/` 会被解析为路径分隔符
 *   - `AND` / `OR` / `NOT` 会被解析为布尔运算符
 *
 * 这些字符在中文文档标题和 section 描述中非常常见，
 * 如果不剥离会导致 400 Bad Request。
 *
 * 策略：保留中文字符、字母、数字、空格、以及安全的标点（`-` `_` `.`），
 *       其他所有特殊字符替换为空格，然后折叠连续空白。
 */
export function sanitizeGraphSearchQuery(raw: string): string {
  if (!raw) return "";
  // 1. 替换所有非安全字符为空格
  //    安全字符：CJK 统一表意文字、CJK 扩展 A/B、字母、数字、- _ . 空格
  let sanitized = raw.replace(/[^\u3400-\u9FFF\uF900-\uFAFFa-zA-Z0-9\-_.\s]/g, " ");
  // 2. 折叠连续空白为单个空格
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  // 3. 极限保护：如果 sanitized 为空（极端情况），用原始 query 的前几个词
  if (!sanitized) {
    const fallback = raw.slice(0, 20).replace(/\s+/g, " ").trim();
    return fallback || "document";
  }
  return sanitized;
}

export async function searchFiles(
  config: GraphSearchConfig,
  query: string,
  options: GraphSearchOptions = {},
): Promise<GraphSearchResult[]> {
  const { top = 20, fileTypes, scope = "me" } = options;

  // Graph Search 不支持 section 描述中的复杂标点和布尔语法。
  // 在调用 API 前必须 sanitize，否则会返回 400 Bad Request。
  const sanitizedQuery = sanitizeGraphSearchQuery(query);

  // ── 端点选择与查询构建 ──────────────────────────────────
  //
  // /me/drive/root/search（GET）: 简单关键字搜索，URL 参数中放 query。
  //   ❌ 不支持 KQL： AND / OR / fileType: / (...)
  //   ❌ 不支持特殊字符（冒号会触发 "Paths can only contain at most two colons"）
  //
  // /search/query（POST）: 高级搜索，JSON body 中放 query。
  //   ✅ 支持 KQL 语法和字段运算符
  //
  // 策略：scope="me" 时纯关键字搜索，文件类型在客户端过滤。
  //       scope="org" 时用高级搜索，可以注入 KQL 字段运算符。

  const simpleEndpoint = "https://graph.microsoft.com/v1.0/me/drive/root/search(q='{query}')";
  const advancedEndpoint = "https://graph.microsoft.com/v1.0/search/query";

  let url: string;
  let body: string | undefined;

  if (scope === "me") {
    // ── 简单搜索：只放关键字，KQL 和文件类型在客户端处理 ──
    url = simpleEndpoint.replace("{query}", encodeURIComponent(sanitizedQuery));
    body = undefined;
  } else {
    // ── 高级搜索：支持 KQL 字段运算符 ──
    let queryString = sanitizedQuery;
    if (fileTypes && fileTypes.length > 0) {
      const typeFilter = fileTypes.map(t => `fileType:${t}`).join(" OR ");
      queryString = `${sanitizedQuery} AND (${typeFilter})`;
    }
    url = advancedEndpoint;
    body = JSON.stringify({
      requests: [{
        entityTypes: ["driveItem"],
        query: { queryString },
        from: 0,
        size: top,
      }],
    });
  }

  logger.info(`[GraphSearch] 搜索: query="${sanitizedQuery}", scope=${scope}, top=${top}`);

  // 单次请求 + 解析
  const doOneRequest = async (q: string, runScope: "me" | "org"): Promise<{
    results: GraphSearchResult[];
    rawCount: number;
    usedClientFilter: boolean;
  }> => {
    let runUrl: string;
    let runBody: string | undefined;
    if (runScope === "me") {
      runUrl = simpleEndpoint.replace("{query}", encodeURIComponent(q));
      runBody = undefined;
    } else {
      let queryString = q;
      if (fileTypes && fileTypes.length > 0) {
        const typeFilter = fileTypes.map(t => `fileType:${t}`).join(" OR ");
        queryString = `${q} AND (${typeFilter})`;
      }
      runUrl = advancedEndpoint;
      runBody = JSON.stringify({
        requests: [{
          entityTypes: ["driveItem"],
          query: { queryString },
          from: 0,
          size: top,
        }],
      });
    }

    const res = await fetch(runUrl, {
      method: runBody ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: runBody,
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

    const needFilter = runScope === "me" && !!fileTypes && fileTypes.length > 0;
    const allowedExts = needFilter
      ? new Set(fileTypes.map(ext => ext.toLowerCase().replace(/^\./, "")))
      : null;

    const matchByExt = (name: string): boolean => {
      if (!allowedExts) return true;
      const dot = name.lastIndexOf(".");
      if (dot < 0) return false;
      return allowedExts.has(name.slice(dot + 1).toLowerCase());
    };

    const results: GraphSearchResult[] = [];
    let rawCount = 0;

    if (data.value) {
      for (const item of data.value) {
        rawCount++;
        if (!item.file) continue;
        if (!matchByExt(item.name)) continue;
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
      for (const container of data.value2) {
        for (const hit of container.hitsContainers ?? []) {
          for (const h of hit.hits ?? []) {
            rawCount++;
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

    return { results, rawCount, usedClientFilter: needFilter };
  };

  const takeFirstNTokens = (q: string, n: number): string => {
    const tokens = q.split(/\s+/).filter(t => t.length > 0);
    return tokens.slice(0, n).join(" ").trim();
  };

  try {
    // 1) 原始 query
    const first = await doOneRequest(sanitizedQuery, scope);
    if (first.results.length > 0) {
      const filterMsg = first.usedClientFilter && fileTypes ? `，客户端过滤: ${fileTypes.join(",")}` : "";
      logger.info(`[GraphSearch] 搜索完成（首次成功）: ${first.results.length} 个结果（原始返回=${first.rawCount}${filterMsg}）`);
      return first.results;
    }

    // 2) 回退 1：只保留前 3 个 token
    const f1 = takeFirstNTokens(sanitizedQuery, 3);
    if (f1 && f1 !== sanitizedQuery) {
      logger.info(`[GraphSearch] 首次 0 结果，回退简化 query: "${f1}"`);
      const second = await doOneRequest(f1, scope);
      if (second.results.length > 0) {
        logger.info(`[GraphSearch] 简化查询成功: ${second.results.length} 个结果`);
        return second.results;
      }
    }

    // 3) 回退 2：只保留前 2 个 token
    const f2 = takeFirstNTokens(sanitizedQuery, 2);
    if (f2 && f2 !== f1 && f2 !== sanitizedQuery) {
      logger.info(`[GraphSearch] 再简化 query: "${f2}"`);
      const third = await doOneRequest(f2, scope);
      if (third.results.length > 0) {
        logger.info(`[GraphSearch] 进一步简化成功: ${third.results.length} 个结果`);
        return third.results;
      }
    }

    // 4) 回退 3：Graph Search API 对 MSA 中文 docx 基本搜不到（搜内容不搜文件名）。
    //    降级为 listRootFiles + 本地文件名关键词匹配。
    logger.info(`[GraphSearch] Graph Search API 零结果，降级为 list + 本地文件名匹配`);
    try {
      const allFiles = await listRootFiles(config, { top: 200 });
      const keywords = tokenize(sanitizedQuery);
      const allowedExts = fileTypes && fileTypes.length > 0
        ? new Set(fileTypes.map(ext => ext.toLowerCase().replace(/^\./, "")))
        : null;

      const matchByExt = (name: string): boolean => {
        if (!allowedExts) return true;
        const dot = name.lastIndexOf(".");
        if (dot < 0) return false;
        return allowedExts.has(name.slice(dot + 1).toLowerCase());
      };

      const scored = allFiles
        .filter(f => matchByExt(f.name))
        .map(f => {
          const nameLower = f.name.toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            if (nameLower.includes(kw)) score++;
          }
          return { ...f, relevanceScore: score };
        })
        .filter(f => f.relevanceScore! > 0)
        .sort((a, b) => b.relevanceScore! - a.relevanceScore!)
        .slice(0, top);

      if (scored.length > 0) {
        logger.info(`[GraphSearch] 本地文件名匹配: ${scored.length} 个结果（来自 ${allFiles.length} 个文件）`);
        return scored;
      }

      // 文件名匹配也失败时，返回所有文件（上限 top 个）供 Phase 2 语义检索
      // 这是最后的兜底：Graph Search API 无法搜索中文 docx 内容，文件名也没匹配上，
      // 但 Phase 2 可以通过下载+索引文件内容来做真正的语义匹配。
      const fallbackCandidates = allFiles
        .filter(f => matchByExt(f.name))
        .slice(0, top);
      logger.info(`[GraphSearch] 文件名匹配无结果，返回 ${fallbackCandidates.length} 个文件供 Phase 2 语义检索（来自 ${allFiles.length} 个文件）`);
      return fallbackCandidates;
    } catch (listErr) {
      logger.warn(`[GraphSearch] listRootFiles 降级也失败: ${listErr instanceof Error ? listErr.message : String(listErr)}`);
    }

    logger.info(`[GraphSearch] 搜索完成（最终零结果）: 0 个结果`);
    return [];
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