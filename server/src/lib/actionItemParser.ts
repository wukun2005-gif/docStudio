/**
 * Action Item Parser — 从会议纪要中提取 Action Items
 *
 * Feature #41: Action Item 解析
 *
 * 使用 LLM 从 Teams 会议纪要中提取任务和待办事项。
 */
import { registry } from "../providers/registry.js";
import { logger } from "./logger.js";

export interface ActionItem {
  id: string;
  assignee: string;
  task: string;
  documentType: string; // "report" | "spec" | "slides" | "email" | "analysis"
  priority: "high" | "medium" | "low";
  dueDate?: string;
  context: string;
}

// ── Parsing ────────────────────────────────────────────

export async function parseActionItems(
  meetingNotes: string,
  providerId: string,
  modelId: string,
  apiKey: string,
): Promise<ActionItem[]> {
  try {
    const result = await registry.runWithFallback(
      [providerId],
      {
        modelId,
        messages: [
          {
            role: "system",
            content: `你是会议纪要分析助手。从会议纪要中提取所有 Action Items（待办事项、任务分配）。

输出 JSON 数组格式：
[
  {
    "assignee": "负责人姓名",
    "task": "任务描述",
    "documentType": "需要生成的文档类型: report|spec|slides|email|analysis",
    "priority": "high|medium|low",
    "context": "任务的上下文信息"
  }
]

只输出 JSON，不要输出其他内容。`,
          },
          {
            role: "user",
            content: `请从以下会议纪要中提取 Action Items：\n\n${meetingNotes}`,
          },
        ],
        apiKey,
        maxTokens: 2000,
        temperature: 0.3,
      },
      undefined, undefined,
      { [providerId]: apiKey },
    );

    if (result.response.error) {
      logger.warn(`[ActionItemParser] LLM error: ${result.response.error.message}`);
      return [];
    }

    const text = result.response.text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]!) as Array<Record<string, unknown>>;
    return parsed.map((item, i) => ({
      id: `ai-${Date.now()}-${i}`,
      assignee: typeof item.assignee === "string" ? item.assignee : "unknown",
      task: typeof item.task === "string" ? item.task : "",
      documentType: typeof item.documentType === "string" ? item.documentType : "report",
      priority: ["high", "medium", "low"].includes(item.priority as string) ? item.priority as ActionItem["priority"] : "medium",
      context: typeof item.context === "string" ? item.context : "",
    }));
  } catch (err) {
    logger.warn(`[ActionItemParser] Parse failed: ${err}`);
    return [];
  }
}
