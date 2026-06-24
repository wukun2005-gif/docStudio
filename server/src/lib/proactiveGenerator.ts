/**
 * Proactive Generator — 主动生成与建议
 *
 * Feature #43: 主动生成与建议
 *
 * 质量达标后主动建议用户，支持查看/编辑/忽略。
 */
import { localIso } from "../../../shared/src/datetime.js";
import { parseActionItems, type ActionItem } from "./actionItemParser.js";
import { discoverRelevantSources, type DiscoveredSource } from "./knowledgeDiscovery.js";
import { generateDocument, type GenerateDocRequest } from "./docGenerator.js";
import { evaluateOnline, computeTrustScore } from "./evalMetrics.js";
import { logger } from "./logger.js";

export interface ProactiveSuggestion {
  id: string;
  actionItem: ActionItem;
  discoveredSources: DiscoveredSource[];
  generatedContent?: string;
  trustScore?: number;
  status: "pending" | "generated" | "suggested" | "accepted" | "rejected";
  createdAt: string;
}

// ── Proactive Generation Pipeline ──────────────────────

export async function processMeetingNotes(
  meetingNotes: string,
  providerId: string,
  modelId: string,
  apiKey: string,
): Promise<ProactiveSuggestion[]> {
  // 1. Parse action items
  const actionItems = await parseActionItems(meetingNotes, providerId, modelId, apiKey);
  if (actionItems.length === 0) {
    logger.info("[ProactiveGenerator] No action items found");
    return [];
  }

  logger.info(`[ProactiveGenerator] Found ${actionItems.length} action items`);

  const suggestions: ProactiveSuggestion[] = [];

  for (const item of actionItems) {
    const suggestion: ProactiveSuggestion = {
      id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actionItem: item,
      discoveredSources: [],
      status: "pending",
      createdAt: localIso(),
    };

    try {
      // 2. Discover relevant sources
      const sources = await discoverRelevantSources(item.task, item.context);
      suggestion.discoveredSources = sources;

      if (sources.length === 0) {
        logger.info(`[ProactiveGenerator] No sources found for: ${item.task}`);
        suggestions.push(suggestion);
        continue;
      }

      // 3. Generate document
      const generationResult = await generateDocument({
        title: item.task,
        outline: [{
          id: "main",
          title: item.task,
          level: 0,
          children: [],
          description: item.context,
        }],
        format: "docx",
        providerPreference: [providerId],
        modelId,
        apiKey,
      });

      if (generationResult.content) {
        suggestion.generatedContent = generationResult.content;

        // 4. Quality gate: check trust score
        const metrics = await evaluateOnline({
          content: generationResult.content,
          sources: sources.map(s => ({ content: s.content, score: s.relevanceScore })),
          providerPreference: [providerId],
          modelId,
          apiKey,
        });

        suggestion.trustScore = computeTrustScore(metrics);

        // 5. Only suggest if quality is acceptable
        if (suggestion.trustScore >= 0.7) {
          suggestion.status = "suggested";
          logger.info(`[ProactiveGenerator] Suggestion ready: ${item.task} (trust=${suggestion.trustScore.toFixed(2)})`);
        } else {
          logger.info(`[ProactiveGenerator] Quality too low: ${item.task} (trust=${suggestion.trustScore.toFixed(2)})`);
        }
      }
    } catch (err) {
      logger.warn(`[ProactiveGenerator] Failed to process: ${item.task}: ${err}`);
    }

    suggestions.push(suggestion);
  }

  return suggestions;
}

// ── Suggestion Management ──────────────────────────────

export function formatSuggestionForUser(suggestion: ProactiveSuggestion): string {
  const { actionItem, discoveredSources, trustScore } = suggestion;

  let message = `💡 **来自会议纪要的建议**\n\n`;
  message += `**任务**: ${actionItem.task}\n`;
  message += `**负责人**: ${actionItem.assignee}\n`;
  message += `**优先级**: ${actionItem.priority}\n\n`;

  if (discoveredSources.length > 0) {
    message += `**已收集相关知识源**:\n`;
    for (const source of discoveredSources.slice(0, 5)) {
      message += `- ${source.name} (相关度: ${source.relevanceScore.toFixed(2)})\n`;
    }
    message += `\n`;
  }

  if (suggestion.generatedContent && trustScore !== undefined) {
    message += `**预览**:\n${suggestion.generatedContent.slice(0, 300)}...\n\n`;
    message += `📊 信任度: ${trustScore.toFixed(2)}\n\n`;
    message += `[查看完整文档]  [编辑后使用]  [忽略]`;
  }

  return message;
}
