/**
 * DemoProvider — 一键 Demo 的 Mock LLM Provider
 *
 * 实现 ProviderAdapter 接口，不修改任何业务代码。
 * 在 Demo 模式下，所有 LLM 调用路由到此 provider，返回预录 fixture。
 *
 * nf1: 一键 Demo（Mock Mode + FakeCursor + 90s 视频）
 */
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
  StreamChunk,
} from "./openai.js";
import { DEMO_FIXTURES } from "./fixtures/demo-fixtures.js";

/** 基于 system prompt 关键词识别调用类型 */
function classifyCall(messages: Array<{ role: string; content: string }>): {
  type: "intent" | "outline" | "title" | "section" | "groundedness" | "fidelity" | "conflict" | "trust" | "generic";
  sectionIndex?: number;
} {
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsg = messages.find((m) => m.role === "user")?.content ?? "";

  if (systemMsg.includes("意图分析助手")) return { type: "intent" };
  if (systemMsg.includes("大纲生成") || (systemMsg.includes("大纲") && systemMsg.includes("模板"))) return { type: "outline" };
  if (systemMsg.includes("文档标题") || (systemMsg.includes("标题") && systemMsg.includes("读者"))) return { type: "title" };
  if (systemMsg.includes("Groundedness") || systemMsg.includes("groundedness") || systemMsg.includes("事实验证")) return { type: "groundedness" };
  if (systemMsg.includes("fidelity") || systemMsg.includes("引用准确性") || systemMsg.includes("citation accuracy")) return { type: "fidelity" };
  if (systemMsg.includes("冲突检测") || systemMsg.includes("conflict")) return { type: "conflict" };
  if (systemMsg.includes("信任度") || systemMsg.includes("trust") || systemMsg.includes("指标评分")) return { type: "trust" };
  if (systemMsg.includes("专业的文档生成助手")) return { type: "section", sectionIndex: 0 };
  if (systemMsg.includes("文档生成") && !systemMsg.includes("标题") && !systemMsg.includes("大纲")) return { type: "section", sectionIndex: 0 };

  return { type: "generic" };
}

function buildChatResponse(text: string): ChatResponse {
  return {
    text,
    rawResponse: { text },
    tokenUsage: { input: 100, output: text.length, total: 100 + text.length },
  };
}

export class DemoProvider implements ProviderAdapter {
  id = "demo";
  defaultBaseUrl = "demo://local";

  supportedModels(): string[] {
    return ["demo-mode"];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { type } = classifyCall(req.messages);

    switch (type) {
      case "intent":
        return buildChatResponse(DEMO_FIXTURES.intentAnalysis);

      case "outline":
        return buildChatResponse(DEMO_FIXTURES.outline);

      case "title":
        return buildChatResponse(DEMO_FIXTURES.title);

      case "section":
        return buildChatResponse(DEMO_FIXTURES.sectionContent(0));

      case "groundedness":
        return buildChatResponse(DEMO_FIXTURES.groundedness);

      case "fidelity":
        return buildChatResponse(DEMO_FIXTURES.fidelity);

      case "conflict":
        return buildChatResponse(DEMO_FIXTURES.conflictDetection);

      case "trust":
        return buildChatResponse(DEMO_FIXTURES.trustReport);

      default:
        // Generic fallback — return a helpful but non-breaking response
        return buildChatResponse(
          JSON.stringify({ message: "Demo mode — this is a mock response." }),
        );
    }
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const response = await this.chat(req);
    yield { text: response.text, done: true };
  }

  async embed(): Promise<{ embeddings: number[][]; tokenUsage?: { input: number; output: number; total: number } }> {
    return {
      embeddings: [new Array(1024).fill(0.01)],
      tokenUsage: { input: 10, output: 0, total: 10 },
    };
  }

  async listModels(): Promise<{ id: string }[]> {
    return [{ id: "demo-mode" }];
  }
}
