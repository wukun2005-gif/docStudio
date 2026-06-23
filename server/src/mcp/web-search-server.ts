/**
 * Web Search MCP Server
 *
 * 暴露 web_search tool，支持 Serper.dev / Tavily / SerpAPI。
 * 通过 stdio transport 与 MCP client 通信。
 * 从 patentExaminator 照搬，适配 i-Write 数据库结构。
 *
 * 注意：日志必须走 stderr（stdout 被 JSON-RPC 占用）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";

const FETCH_TIMEOUT_MS = 30_000;

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

// 从数据库读取搜索 provider 配置
function readSearchConfig(): { providerId: string; apiKey: string; baseUrl: string } | undefined {
  try {
    const dbPath = process.env.DB_PATH;
    if (!dbPath) {
      stderrLog("DB_PATH environment variable not set");
      return undefined;
    }
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT value FROM user_settings WHERE key = 'provider_all'").get() as { value: string } | undefined;
    db.close();
    if (row) {
      const settings = JSON.parse(row.value) as {
        searchProviders?: Array<{ providerId: string; enabled: boolean; apiKeyRef: string; baseUrl?: string }>;
      };
      // 优先级：serper > tavily > serpapi
      const priority = ["serper", "tavily", "serpapi"];
      for (const pid of priority) {
        const provider = settings.searchProviders?.find((p) => p.providerId === pid && p.enabled && p.apiKeyRef);
        if (provider) {
          return {
            providerId: provider.providerId,
            apiKey: provider.apiKeyRef,
            baseUrl: provider.baseUrl || getDefaultBaseUrl(provider.providerId),
          };
        }
      }
    }
  } catch (err) {
    stderrLog(`Failed to read search config from DB: ${err}`);
  }
  return undefined;
}

function getDefaultBaseUrl(providerId: string): string {
  const map: Record<string, string> = {
    serper: "https://google.serper.dev",
    tavily: "https://api.tavily.com",
    serpapi: "https://serpapi.com",
  };
  return map[providerId] ?? "";
}

// ── 搜索实现 ──────────────────────────────────────

async function searchSerper(query: string, maxResults: number, apiKey: string, baseUrl: string): Promise<SearchResult[]> {
  const res = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Serper error: ${res.status}`);
  const data = (await res.json()) as { organic?: Array<{ title: string; link: string; snippet: string }> };
  return (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, content: r.snippet }));
}

async function searchTavily(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, include_answer: false }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }));
}

async function searchSerpAPI(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(maxResults));
  url.searchParams.set("api_key", apiKey);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
  return (data.organic_results ?? []).map((r) => ({ title: r.title, url: r.link, content: r.snippet }));
}

async function doSearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const config = readSearchConfig();
  if (!config) throw new Error("No search provider configured. Enable one in Settings → Search.");

  const fns: Record<string, () => Promise<SearchResult[]>> = {
    serper: () => searchSerper(query, maxResults, config.apiKey, config.baseUrl),
    tavily: () => searchTavily(query, maxResults, config.apiKey),
    serpapi: () => searchSerpAPI(query, maxResults, config.apiKey),
  };

  const fn = fns[config.providerId];
  if (!fn) throw new Error(`Unsupported search provider: ${config.providerId}`);

  const results = await fn();
  return { results, engine: config.providerId };
}

// ── stderr 日志 ──────────────────────────────────────

function stderrLog(msg: string): void {
  process.stderr.write(`[WebSearchMCP] ${msg}\n`);
}

// ── MCP Server 启动 ──────────────────────────────────────

async function main(): Promise<void> {
  stderrLog(`DB_PATH=${process.env.DB_PATH ?? "NOT SET"}`);

  const server = new McpServer({ name: "web-search-mcp", version: "1.0.0" });

  server.tool(
    "web_search",
    "Search the web for current information. Returns titles, URLs, and snippets.",
    {
      query: z.string().describe("The search query"),
      max_results: z.number().int().positive().max(20).default(5).describe("Maximum number of results (1-20)"),
    },
    async ({ query, max_results }) => {
      stderrLog(`web_search: query="${query}", max_results=${max_results}`);
      try {
        const { results, engine } = await doSearch(query, max_results ?? 5);
        stderrLog(`Returning ${results.length} results (${engine})`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ query, engine, results }) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stderrLog(`web_search error: ${msg}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg, query, results: [] }) }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  stderrLog("Web Search MCP Server starting...");
  await server.connect(transport);
  stderrLog("Web Search MCP Server connected via stdio");
}

main().catch((err) => {
  stderrLog(`Fatal error: ${err}`);
  process.exit(1);
});
