/**
 * Chat Router — 智能判断需求复杂度
 * Feature #5: Chat Box 交互
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { generateOutline, type OutlineSection } from "./narrativeEngine.js";
import { logger } from "./logger.js";
import { CASE_1783257530743 } from "../providers/fixtures/case-1783257530743.js";

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
  skipEdit?: boolean; // 情况1：用户没要求大纲但需求里有大纲，跳过编辑步骤
}

/** 用户意图分析结果 */
interface IntentAnalysis {
  intent: "simple" | "document" | "unclear";
  outlineRequested: boolean;  // 用户是否明确要求列出大纲
  hasUserOutline: boolean;    // 用户需求里是否已经包含大纲结构
  extractedOutline?: Array<{ title: string; description?: string }>;  // 提取的用户大纲
}

/** 用 LLM 分析用户意图 */
async function analyzeIntentWithLLM(
  message: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  providerPreference?: string[],
  modelId?: string,
  apiKey?: string,
  providerBaseUrls?: Record<string, string>,
): Promise<IntentAnalysis> {
  const systemPrompt = `你是一个意图分析助手。分析用户消息，判断以下两个维度：

1. **intent** - 用户意图类型：
   - "document": 用户想要生成文档（邮件、报告、周报、方案等）
   - "simple": 用户只是简单聊天或提问
   - "unclear": 用户意图不明确

2. **outlineRequested** - 用户是否明确要求列出大纲：
   - true: 用户明确说"列出大纲"、"显示大纲"、"先给我看大纲"等
   - false: 用户没有明确要求列出大纲

3. **hasUserOutline** - 用户需求里是否已经包含大纲结构：
   - true: 用户消息中已经列出了章节结构，如"1. xxx 2. xxx 3. xxx"或"第一部分...第二部分..."
   - false: 用户只是描述了需求，没有列出具体章节结构

4. **extractedOutline** - 如果 hasUserOutline=true，提取用户的大纲结构：
   - 格式: [{ "title": "章节标题", "description": "章节描述" }]
   - 如果 hasUserOutline=false，返回空数组

输出 JSON 格式：
{
  "intent": "document" | "simple" | "unclear",
  "outlineRequested": true | false,
  "hasUserOutline": true | false,
  "extractedOutline": [{ "title": "...", "description": "..." }]
}

注意：
- 直接输出 JSON，不要 markdown 代码块
- 如果用户只是说"写一份周报"，没有列出章节，hasUserOutline=false
- 如果用户说"写一份周报，包含：1.本周完成 2.下周计划 3.风险"，hasUserOutline=true
- outlineRequested 只在用户明确说"列出大纲"、"显示大纲"等时为 true`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(conversationHistory ?? []),
    { role: "user" as const, content: message },
  ];

  try {
    const dbSettings = readSettingsFromDb();
    const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
    const providers = providerPreference ?? defaultProviders;

    const providerApiKeys: Record<string, string> = {};
    for (const pid of providers) {
      const key = apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const { response } = await registry.runWithFallback(
      providers,
      {
        modelId: modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
        messages,
        apiKey: "",
        temperature: 0.1,
        timeoutMs: 30_000,
      },
      undefined, undefined,
      providerApiKeys,
      providerBaseUrls,
    );

    if (response.error) {
      logger.error(`[ChatRouter] Intent analysis LLM error: ${response.error.message}`);
      // Fallback 到简单规则
      return fallbackIntentAnalysis(message);
    }

    const parsed = JSON.parse(response.text) as IntentAnalysis;
    logger.info(`[ChatRouter] Intent analysis: intent=${parsed.intent}, outlineRequested=${parsed.outlineRequested}, hasUserOutline=${parsed.hasUserOutline}, extractedOutline=${parsed.extractedOutline?.length ?? 0} items`);
    return parsed;
  } catch (err) {
    logger.error(`[ChatRouter] Intent analysis failed: ${err}`);
    return fallbackIntentAnalysis(message);
  }
}

/** Fallback：简单规则判断（LLM 调用失败时使用） */
function fallbackIntentAnalysis(message: string): IntentAnalysis {
  // 强意图关键词
  const strongKeywords = ["邮件", "email", "PPT", "Excel", "周报", "月报", "年报", "报告", "方案", "大纲"];
  const hasStrongKeyword = strongKeywords.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));

  // 一般文档关键词
  const documentKeywords = ["生成", "写", "文档", "总结", "计划", "通知", "邀请函"];
  const hasDocumentKeyword = documentKeywords.some((kw) => message.includes(kw));

  let intent: "simple" | "document" | "unclear" = "simple";
  if (hasStrongKeyword) intent = "document";
  else if (hasDocumentKeyword && message.length > 5) intent = "document";
  else if (message.length < 3) intent = "unclear";

  // 简单检测大纲关键词
  const outlineKeywords = ["列出大纲", "显示大纲", "show outline", "大纲如下"];
  const outlineRequested = outlineKeywords.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));

  // 简单检测数字编号
  const hasNumberedItems = /^\s*\d+[\.\)、]/m.test(message) || /^[一二三四五六七八九十]+[、．]/m.test(message);

  return {
    intent,
    outlineRequested,
    hasUserOutline: hasNumberedItems,
    extractedOutline: hasNumberedItems ? [] : undefined,
  };
}

/** Chat 处理 */
export async function handleChat(req: ChatRequest): Promise<ChatResponse> {
  // ── Demo replay mode: return saved outline, skip all LLM calls ──
  if (req.providerPreference?.length === 1 && req.providerPreference[0] === "demo") {
    const fixture = CASE_1783257530743;
    logger.info(`[ChatRouter] Demo replay: returning saved outline from case ${fixture.caseId} (${fixture.outline.length} sections)`);
    return {
      type: "outline_request",
      content: `我理解你想生成文档。让我为你创建一个大纲，你可以调整后再一键生成。`,
      suggestedOutline: fixture.outline as OutlineSection[],
      skipEdit: true,
    };
  }

  // 使用 LLM 分析用户意图
  const analysis = await analyzeIntentWithLLM(
    req.message,
    req.conversationHistory,
    req.providerPreference,
    req.modelId,
    req.apiKey,
    req.providerBaseUrls,
  );

  logger.info(`[ChatRouter] intent=${analysis.intent}, outlineRequested=${analysis.outlineRequested}, hasUserOutline=${analysis.hasUserOutline}, message="${req.message.slice(0, 50)}..."`);

  // 情况1：用户没要求大纲，但需求里有大纲 → 直接用用户大纲，跳过编辑
  if (analysis.intent === "document" && !analysis.outlineRequested && analysis.hasUserOutline) {
    logger.info(`[ChatRouter] 情况1: 用户没要求大纲但需求里有大纲，直接使用用户大纲`);

    // 如果 LLM 没有提取出大纲，用简单规则提取
    let userOutline = analysis.extractedOutline;
    if (!userOutline || userOutline.length === 0) {
      userOutline = extractOutlineFromText(req.message);
    }

    const suggestedOutline = userOutline.map((item, idx) => ({
      id: `s${idx + 1}`,
      title: item.title,
      level: 1,
      children: [],
      description: item.description,
    }));

    return {
      type: "outline_request",
      content: `已识别到你提供的大纲结构，将直接使用。`,
      suggestedOutline,
      skipEdit: true, // 告诉前端跳过编辑步骤
    };
  }

  if (analysis.intent === "unclear") {
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

  if (analysis.intent === "simple") {
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
      { modelId: req.modelId ?? dbSettings.modelId ?? "mimo-v2-pro", messages, apiKey: "", timeoutMs: 60_000 },
      undefined, undefined,
      providerApiKeys,
      req.providerBaseUrls,
    );

    return {
      type: "direct_answer",
      content: response.error ? "抱歉，处理请求时出错了。" : response.text,
    };
  }

  // intent === "document" — 需要生成大纲
  // 情况2：用户没要求大纲，需求里也没大纲 → 生成大纲
  // 情况3：用户要求列出大纲，需求里有大纲 → LLM 结合用户大纲生成
  // 情况4：用户要求列出大纲，需求里没大纲 → 生成大纲

  logger.info(`[ChatRouter] 生成大纲: outlineRequested=${analysis.outlineRequested}, hasUserOutline=${analysis.hasUserOutline}`);

  try {
    // 情况3：如果有用户大纲，传给 LLM 参考
    let userRequest = req.message;
    if (analysis.hasUserOutline && analysis.extractedOutline && analysis.extractedOutline.length > 0) {
      // 在用户需求后面附加提取的大纲结构，让 LLM 参考
      const outlineText = analysis.extractedOutline.map((item, idx) =>
        `${idx + 1}. ${item.title}${item.description ? `: ${item.description}` : ""}`
      ).join("\n");
      userRequest = `${req.message}\n\n用户已提供的大纲结构（请参考并优化）：\n${outlineText}`;
    }

    const outline = await generateOutline({
      userRequest,
      providerPreference: req.providerPreference,
      modelId: req.modelId,
      apiKey: req.apiKey,
      providerBaseUrls: req.providerBaseUrls,
    });

    return {
      type: "outline_request",
      content: analysis.outlineRequested
        ? `根据你的需求，我生成了以下大纲，你可以调整后再一键生成。`
        : `我理解你想生成文档。让我为你创建一个大纲，你可以调整后再一键生成。`,
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

/** 从文本中提取大纲结构（简单规则，作为 LLM 提取的 fallback） */
function extractOutlineFromText(text: string): Array<{ title: string; description?: string }> {
  const outline: Array<{ title: string; description?: string }> = [];

  // 匹配数字编号：1. xxx 2. xxx 或 1、xxx 2、xxx 或 1) xxx 2) xxx
  const numberedPattern = /^\s*(\d+)[\.\)、]\s*(.+)$/gm;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    outline.push({ title: match[2].trim() });
  }

  // 如果没匹配到数字编号，尝试中文编号：一、二、三、
  if (outline.length === 0) {
    const chinesePattern = /^\s*([一二三四五六七八九十]+)[、．]\s*(.+)$/gm;
    while ((match = chinesePattern.exec(text)) !== null) {
      outline.push({ title: match[2].trim() });
    }
  }

  // 如果还没匹配到，尝试 - 或 * 开头的列表
  if (outline.length === 0) {
    const listPattern = /^\s*[-*]\s+(.+)$/gm;
    while ((match = listPattern.exec(text)) !== null) {
      outline.push({ title: match[1].trim() });
    }
  }

  return outline;
}
