/**
 * Knowledge Discovery — 智能知识源发现
 *
 * Feature #42: 智能知识源发现
 *
 * 根据 Action Item 自动搜索相关知识源。
 */
import { hybridSearch, type SearchResult } from "./hybridSearch.js";
import { logger } from "./logger.js";

export interface DiscoveredSource {
  id: string;
  name: string;
  content: string;
  relevanceScore: number;
  sourceType: "kb" | "email" | "chat" | "document";
}

// ── Discovery ──────────────────────────────────────────

export async function discoverRelevantSources(
  actionItem: string,
  context: string,
): Promise<DiscoveredSource[]> {
  try {
    // 1. Hybrid search from action item + context
    const query = `${actionItem} ${context}`;
    const searchResults = hybridSearch(query, { limit: 10 });

    // 2. Map to discovered sources
    return searchResults.map((result, i) => ({
      id: result.chunkId ?? `disc-${i}`,
      name: result.sourceId ?? "unknown",
      content: result.content,
      relevanceScore: result.score ?? 0,
      sourceType: "kb" as const,
    }));
  } catch (err) {
    logger.warn(`[KnowledgeDiscovery] Discovery failed: ${err}`);
    return [];
  }
}
