/**
 * 集成测试 — 确认 DemoProvider 正确注册到 ProviderRegistry
 */
import { describe, it, expect } from "vitest";
import { registry } from "../../server/src/providers/registry.js";

describe("Registry — DemoProvider 集成", () => {
  it("registry 中包含 DemoProvider", () => {
    const dp = registry.get("demo");
    expect(dp).toBeDefined();
    expect(dp!.id).toBe("demo");
    expect(dp!.defaultBaseUrl).toBe("demo://local");
  });

  it("DemoProvider chat 返回可用响应", async () => {
    const dp = registry.get("demo")!;
    const resp = await dp.chat({
      modelId: "demo-mode",
      apiKey: "",
      messages: [
        { role: "system", content: "你是一个意图分析助手" },
        { role: "user", content: "test" },
      ],
    });
    expect(resp.text).toContain("intent");
    expect(resp.error).toBeUndefined();
  });
});
