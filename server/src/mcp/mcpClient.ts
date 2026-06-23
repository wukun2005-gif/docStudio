/**
 * MCP Client
 *
 * 管理 Web Search MCP Server 子进程的生命周期。
 * 单例模式：整个 server 生命周期复用一个 MCP 子进程。
 * 子进程崩溃后下次调用自动重新 spawn。
 * 从 patentExaminator 照搬。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "../lib/logger.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

class McpClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private spawning = false;
  private toolsCache: McpToolDefinition[] | null = null;

  async getTools(): Promise<McpToolDefinition[]> {
    if (this.toolsCache && this.client) return this.toolsCache;
    await this.ensureConnected();
    const result = await this.client!.listTools();
    this.toolsCache = result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    logger.info(`[MCP Client] ${this.toolsCache.length} tools: ${this.toolsCache.map((t) => t.name).join(", ")}`);
    return this.toolsCache;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.ensureConnected();
    logger.info(`[MCP Client] Calling tool: ${name}, args=${JSON.stringify(args).slice(0, 200)}`);
    const result = await this.client!.callTool({ name, arguments: args });
    return result as McpToolResult;
  }

  async close(): Promise<void> {
    if (this.client) { try { await this.client.close(); } catch { /* */ } this.client = null; }
    if (this.transport) { try { await this.transport.close(); } catch { /* */ } this.transport = null; }
    this.toolsCache = null;
    logger.info("[MCP Client] Closed");
  }

  private async ensureConnected(): Promise<void> {
    if (this.client && this.transport) {
      try { await this.client.listTools(); return; } catch {
        logger.warn("[MCP Client] Connection lost, respawning...");
        this.client = null; this.transport = null; this.toolsCache = null;
      }
    }
    if (this.spawning) { while (this.spawning) await new Promise((r) => setTimeout(r, 100)); return; }
    this.spawning = true;
    try { await this.spawnServer(); } finally { this.spawning = false; }
  }

  private async spawnServer(): Promise<void> {
    const serverSrcPath = path.resolve(__dirname, "./web-search-server.ts");
    const { existsSync } = await import("fs");
    const serverDistPath = path.resolve(__dirname, "../../dist/server/src/mcp/web-search-server.js");
    const useDist = existsSync(serverDistPath);
    const command = useDist ? "node" : "npx";
    const args = useDist ? [serverDistPath] : ["tsx", serverSrcPath];

    // DB_PATH 传给子进程
    const DATA_DIR = process.env.DB_DIR ?? path.resolve(process.cwd(), "data");
    const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "docstudio.db");

    this.transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, DB_PATH },
    });

    this.client = new Client({ name: "i-write", version: "1.0.0" }, { capabilities: {} });
    await this.client.connect(this.transport);
    logger.info("[MCP Client] Connected to MCP server");
  }
}

export const mcpClient = new McpClientManager();
