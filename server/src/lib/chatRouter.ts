/**
 * Chat Router — 智能判断需求复杂度
 * Feature #5: Chat Box 交互
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { generateOutline, type OutlineSection } from "./narrativeEngine.js";
import { logger } from "./logger.js";

export interface ChatRequest {
  message: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  providerPreference?: string[];
  modelId?: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
}

export interface ChatResponse {
  type: "direct_answer" | "outline_request" | "clarification";
  content: string;
  suggestedOutline?: OutlineSection[];
  followUpQuestions?: string[];
}

/** 判断用户意图 */
async function classifyIntent(message: string): Promise<"simple" | "document" | "unclear"> {
  const documentKeywords = ["生成", "写", "文档", "报告", "周报", "总结", "方案", "PPT", "Excel", "大纲", "邮件", "信"];
  const hasDocumentKeyword = documentKeywords.some((kw) => message.includes(kw));

  if (hasDocumentKeyword && message.length > 10) return "document";
  if (message.length < 5) return "unclear";
  return "simple";
}

/** Chat 处理 */
export async function handleChat(req: ChatRequest): Promise<ChatResponse> {
  const intent = await classifyIntent(req.message);

  logger.info(`[ChatRouter] intent=${intent}, message="${req.message.slice(0, 50)}..."`);

  if (intent === "unclear") {
    return {
      type: "clarification",
      content: "我不太确定你的需求，能否提供更多细节？",
      followUpQuestions: [
        "你想生成什么类型的文档？",
        "需要包含哪些内容？",
        "有特定的格式要求吗？",
      ],
    };
  }

  if (intent === "simple") {
    const dbSettings = readSettingsFromDb();
    const defaultProviders = dbSettings.providerPreference?.length
      ? dbSettings.providerPreference
      : ["mimo"];
    const providers = req.providerPreference ?? defaultProviders;

    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = req.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const messages = [
      { role: "system" as const, content: "你是 i-Write 文档助手，帮助用户完成文档相关工作。简洁回答。" },
      ...(req.conversationHistory ?? []),
      { role: "user" as const, content: req.message },
    ];

    const { response } = await registry.runWithFallback(
      providers,
      { modelId: req.modelId ?? dbSettings.modelId ?? "mimo-v2-pro", messages, apiKey: "" },
      undefined, undefined,
      providerApiKeys,
      req.providerBaseUrls,
    );

    return {
      type: "direct_answer",
      content: response.error ? "抱歉，处理请求时出错了。" : response.text,
    };
  }

  // intent === "document" — 调用 LLM 生成大纲（而非硬编码）
  logger.info(`[ChatRouter] Generating outline for: "${req.message.slice(0, 80)}"`);

  try {
    const outline = await generateOutline({
      userRequest: req.message,
      providerPreference: req.providerPreference,
      modelId: req.modelId,
      apiKey: req.apiKey,
      providerBaseUrls: req.providerBaseUrls,
    });

    return {
      type: "outline_request",
      content: `我理解你想生成文档。让我为你创建一个大纲，你可以调整后再一键生成。`,
      suggestedOutline: outline,
    };
  } catch (err) {
    logger.error(`[ChatRouter] Outline generation failed: ${err}`);
    // Fallback: 返回默认大纲
    return {
      type: "outline_request",
      content: `我理解你想生成文档。让我为你创建一个大纲，你可以调整后再一键生成。`,
      suggestedOutline: [
        { id: "s1", title: "概述", level: 1, description: "文档背景和目标", children: [] },
        { id: "s2", title: "主要内容", level: 1, description: "核心信息和数据", children: [] },
        { id: "s3", title: "总结", level: 1, description: "结论和下一步", children: [] },
      ],
    };
  }
}
