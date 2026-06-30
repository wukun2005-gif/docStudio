/**
 * 单元测试 — extractJudgeJson 解析兜底 + 结构适配
 *
 * 验证 Fix 1：策略 3/4 级联、claims object→array 适配
 */
import { describe, it, expect } from "vitest";
import { extractJudgeJson } from "../../server/src/lib/groundednessCheck.js";

describe("extractJudgeJson", () => {
  it("标准 JSON（claims 是数组）→ 正常解析", () => {
    const json = JSON.stringify({
      claims: [
        { text: "声明1", verdict: "grounded", evidence: "文档A", reason: "有支撑" },
        { text: "声明2", verdict: "ungrounded", evidence: "", reason: "无支撑" },
      ],
      groundedRatio: 0.5,
      overallVerdict: "partial",
    });
    const result = extractJudgeJson(json);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(2);
    expect(result!.groundedRatio).toBe(0.5);
    expect(result!.overallVerdict).toBe("partial");
  });

  it("claims 是 object（模型按 S1/S2 索引输出）→ 适配为数组", () => {
    // 模拟模型输出：{ claims: { "S1": {...}, "S2": {...} } }
    const json = JSON.stringify({
      claims: {
        S1: { text: "声明1", verdict: "grounded", evidence: "doc", reason: "ok" },
        S2: { text: "声明2", verdict: "ungrounded", evidence: "", reason: "no" },
      },
      groundedRatio: 0.5,
      overallVerdict: "partial",
    });
    const result = extractJudgeJson(json);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(2);
    expect(result!.claims[0].text).toBe("声明1");
    expect(result!.claims[1].text).toBe("声明2");
  });

  it("markdown code block 包裹 → 剥离后正常解析", () => {
    const json = JSON.stringify({
      claims: [{ text: "声明1", verdict: "grounded", evidence: "", reason: "" }],
      groundedRatio: 1.0,
      overallVerdict: "pass",
    });
    const text = "```json\n" + json + "\n```";
    const result = extractJudgeJson(text);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(1);
  });

  it("markdown fence 无语言标记 → 剥离后正常解析", () => {
    const json = JSON.stringify({
      claims: [{ text: "声明1", verdict: "grounded", evidence: "", reason: "" }],
      groundedRatio: 1.0,
      overallVerdict: "pass",
    });
    const text = "```\n" + json + "\n```";
    const result = extractJudgeJson(text);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(1);
  });

  it("JSON 前后有额外文字 → 策略 2 提取首尾大括号后正常解析", () => {
    const json = JSON.stringify({
      claims: [{ text: "声明1", verdict: "grounded", evidence: "", reason: "" }],
      groundedRatio: 1.0,
      overallVerdict: "pass",
    });
    const text = "以下是检查结果：\n" + json + "\n检查完毕。";
    const result = extractJudgeJson(text);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(1);
  });

  it("trailing comma → 策略 4 修复后正常解析", () => {
    const text = `{
      "claims": [
        { "text": "声明1", "verdict": "grounded", "evidence": "", "reason": "" },
      ],
      "groundedRatio": 1.0,
      "overallVerdict": "pass",
    }`;
    const result = extractJudgeJson(text);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(1);
  });

  it("unquoted key → 策略 4 修复后正常解析", () => {
    const text = `{
      claims: [
        { text: "声明1", verdict: "grounded", evidence: "", reason: "" }
      ],
      groundedRatio: 1.0,
      overallVerdict: "pass"
    }`;
    const result = extractJudgeJson(text);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(1);
  });

  it("完全无效的输入 → 返回 null", () => {
    const result = extractJudgeJson("这是纯文本，没有任何 JSON 结构");
    expect(result).toBeNull();
  });

  it("groundedRatio 缺失 → 回退为 0.5", () => {
    const json = JSON.stringify({
      claims: [{ text: "声明1", verdict: "grounded", evidence: "", reason: "" }],
      overallVerdict: "pass",
    });
    const result = extractJudgeJson(json);
    expect(result).not.toBeNull();
    expect(result!.groundedRatio).toBe(0.5);
  });

  it("overallVerdict 非法值 → 回退为 partial", () => {
    const json = JSON.stringify({
      claims: [{ text: "声明1", verdict: "grounded", evidence: "", reason: "" }],
      groundedRatio: 0.9,
      overallVerdict: "unknown",
    });
    const result = extractJudgeJson(json);
    expect(result).not.toBeNull();
    expect(result!.overallVerdict).toBe("partial");
  });

  it("claims 为空数组 → 返回空", () => {
    const json = JSON.stringify({
      claims: [],
      groundedRatio: 0,
      overallVerdict: "fail",
    });
    const result = extractJudgeJson(json);
    expect(result).not.toBeNull();
    expect(result!.claims).toHaveLength(0);
  });
});