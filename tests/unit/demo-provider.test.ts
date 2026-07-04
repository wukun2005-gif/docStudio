/**
 * 单元测试 — DemoProvider（nf1 Mock Mode）
 *
 * 验证 DemoProvider 正确实现 ProviderAdapter 接口，
 * 能按 system prompt 关键词匹配返回正确的 fixture。
 */
import { describe, it, expect } from "vitest";
import { DemoProvider } from "../../server/src/providers/demo.js";

function makeMessages(system: string, user = "写一份 Q3 技术决策报告") {
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

describe("DemoProvider", () => {
  const provider = new DemoProvider();

  it("正确注册 id 和 defaultBaseUrl", () => {
    expect(provider.id).toBe("demo");
    expect(provider.defaultBaseUrl).toBe("demo://local");
  });

  it("supportedModels 返回 demo-mode", () => {
    expect(provider.supportedModels()).toEqual(["demo-mode"]);
  });

  it("listModels 返回 demo-mode", async () => {
    const models = await provider.listModels("");
    expect(models).toEqual([{ id: "demo-mode" }]);
  });

  it("embed 返回 1024 维零向量", async () => {
    const result = await provider.embed!({ modelId: "demo-mode", input: ["test"], apiKey: "" });
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toHaveLength(1024);
  });

  // ── Intent Analysis ──

  it("意图分析 → 返回 document intent", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("你是一个意图分析助手，分析用户需求..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.intent).toBe("document");
    expect(parsed.outlineRequested).toBe(false);
    expect(parsed.hasUserOutline).toBe(false);
    expect(parsed.extractedOutline).toEqual([]);
  });

  // ── Outline Generation ──

  it("大纲生成 → 返回预录大纲", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("你是一个大纲生成助手，基于模板生成文档大纲..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.sections).toHaveLength(5);
    expect(parsed.sections[0].title).toBe("概述与目标");
  });

  // ── Title Generation ──

  it("标题生成 → 返回预录标题", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("请为文档生成标题，并提取读者信息..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.title).toBe("Nexora Tech Q3 技术决策报告");
    expect(parsed.readers).toHaveLength(2);
  });

  // ── Groundedness Check ──

  it("Groundedness 验证 → 返回通过", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("Groundedness Check: 验证以下内容..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.groundedRatio).toBe(0.89);
  });

  // ── Conflict Detection ──

  it("冲突检测 → 返回无冲突", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("冲突检测：分析以下内容是否存在矛盾..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.hasConflicts).toBe(false);
    expect(parsed.conflictRate).toBe(0);
  });

  // ── Trust Report ──

  it("信任度报告 → 返回四项指标", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("信任度评估：计算文档信任度指标..."),
    });
    const parsed = JSON.parse(resp.text);
    expect(parsed.groundedness.score).toBe(0.89);
    expect(parsed.relevance.score).toBe(0.92);
    expect(parsed.completeness.score).toBe(0.87);
    expect(parsed.conflicts.hasConflicts).toBe(false);
  });

  // ── Generic Fallback ──

  it("未匹配 → 返回通用 mock 响应", async () => {
    const resp = await provider.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("未知类型的请求..."),
    });
    expect(resp.text).toContain("Demo mode");
    expect(resp.error).toBeUndefined();
  });

  // ── Stream ──

  it("chatStream 返回完整文本", async () => {
    const stream = provider.chatStream!({
      modelId: "demo-mode",
      apiKey: "",
      messages: makeMessages("你是一个意图分析助手..."),
    });
    const chunks: string[] = [];
    for await (const chunk of stream) {
      if (chunk.text) chunks.push(chunk.text);
    }
    expect(chunks.join("")).toContain("intent");
  });

  // ── Error handling ──

  it("所有 fixture 返回均无 error", async () => {
    const prompts = [
      "你是一个意图分析助手...",
      "你是一个大纲生成助手...",
      "请为文档生成标题...",
      "Groundedness Check: ...",
      "冲突检测：...",
      "信任度评估：...",
    ];
    for (const sys of prompts) {
      const resp = await provider.chat({
        modelId: "demo-mode",
        apiKey: "",
        messages: makeMessages(sys),
      });
      expect(resp.error).toBeUndefined();
      expect(resp.text.length).toBeGreaterThan(0);
    }
  });
});
