/**
 * Chat-Driven Document Editing 集成测试
 * 验证 chat-box 自然语言指令修改文档的核心链路（纯本地逻辑，零外部依赖）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resetDbForTesting } from "../../server/src/lib/db.js";
import { fallbackIntentAnalysis } from "../../server/src/lib/chatRouter.js";
import { quickFilter, getDownstreamTriggers } from "../../server/src/lib/editImpactAnalyzer.js";
import type { EditSignificance } from "../../server/src/lib/editImpactAnalyzer.js";

describe("Chat 驱动修改 — 意图识别 (fallback)", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  it("识别 '改' 关键词 → edit 意图", () => {
    const result = fallbackIntentAnalysis("把最后一段改得简洁一些");
    expect(result.intent).toBe("edit");
  });

  it("识别 '语气' 关键词 → edit 意图", () => {
    const result = fallbackIntentAnalysis("语气太正式了，改得轻松一点");
    expect(result.intent).toBe("edit");
  });

  it("识别 '第三章' + '更新' → edit 意图", () => {
    const result = fallbackIntentAnalysis("第三章的数据更新到 2024 年");
    expect(result.intent).toBe("edit");
  });

  it("识别 '换成' 关键词 → edit 意图", () => {
    const result = fallbackIntentAnalysis("把第一段换成英文");
    expect(result.intent).toBe("edit");
  });

  it("识别 '删除' 关键词 → edit 意图", () => {
    const result = fallbackIntentAnalysis("删除最后一句");
    expect(result.intent).toBe("edit");
  });

  it("普通聊天 → simple 意图", () => {
    const result = fallbackIntentAnalysis("今天天气怎么样");
    expect(result.intent).toBe("simple");
  });

  it("生成文档请求 → document 意图", () => {
    const result = fallbackIntentAnalysis("写一份周报");
    expect(result.intent).toBe("document");
  });

  it("edit 关键词优先级高于 document 关键词", () => {
    // "写"是 document 关键词，"改"是 edit 关键词
    const result = fallbackIntentAnalysis("写得太长了，改短一点");
    expect(result.intent).toBe("edit");
  });
});

describe("Chat 驱动修改 — 修改影响分析 (quickFilter)", () => {
  it("长文本改一个标点 → cosmetic（零 LLM 成本）", () => {
    const oldText = "这是一个很长的测试段落，包含了大量的文字内容，用来验证在文本长度足够长的情况下，仅仅修改一个标点符号是否会被正确识别为 cosmetic 级别的改动。根据系统的设计原则，这种情况下应该直接判定为 cosmetic，不需要调用 LLM 进行额外的语义分析，从而节省计算成本和响应时间。";
    const newText = oldText.replace("。", "!");
    const result = quickFilter(oldText, newText);
    expect(result).not.toBeNull();
    expect(result!.significance).toBe("cosmetic");
    expect(result!.skipLLM).toBe(true);
    expect(result!.triggers).toEqual([]);
  });

  it("长文本改一个空格 → cosmetic", () => {
    const oldText = "This is a long paragraph with plenty of text content to verify that changing just a single space character in a sufficiently long text will be correctly identified as a cosmetic level change without requiring any LLM semantic analysis.";
    const newText = oldText.replace(" ", "  ");
    const result = quickFilter(oldText, newText);
    expect(result).not.toBeNull();
    expect(result!.significance).toBe("cosmetic");
  });

  it("改一个数字（语义影响大但编辑距离小）→ 需要 LLM 判断", () => {
    const oldText = "2024年营收100万元。";
    const newText = "2024年营收200万元。";
    const result = quickFilter(oldText, newText);
    // 编辑距离=1（100→200），<3 但改动比例 > 1%？
    // 100/200 = 50%，ratio = 1/7 ≈ 14%，不满足 < 1%
    // 所以应该返回 null，需要 LLM 判断
    expect(result).toBeNull();
  });

  it("大幅改动 → substantive（跳过 LLM）", () => {
    const oldText = "原内容很短。";
    const newText = "这是一段完全不同的新内容，包含很多新的信息和观点，完全改写了原来的意思。";
    const result = quickFilter(oldText, newText);
    expect(result).not.toBeNull();
    expect(result!.significance).toBe("substantive");
    expect(result!.skipLLM).toBe(true);
  });

  it("中间地带改动 → 需要 LLM 判断", () => {
    const oldText = "该方案具有显著的成本优势，能够有效降低运营开支。";
    const newText = "该方案具有明显的成本优势，可以显著降低运营支出。";
    const result = quickFilter(oldText, newText);
    expect(result).toBeNull();
  });

  it("空字符串 → substantive", () => {
    const result = quickFilter("", "新内容");
    expect(result).not.toBeNull();
    expect(result!.significance).toBe("substantive");
  });
});

describe("Chat 驱动修改 — downstream 触发映射", () => {
  it("cosmetic 不触发任何 downstream", () => {
    const triggers = getDownstreamTriggers("cosmetic");
    expect(triggers).toEqual([]);
  });

  it("stylistic 只触发 trustScore", () => {
    const triggers = getDownstreamTriggers("stylistic");
    expect(triggers).toEqual(["trustScore"]);
  });

  it("substantive 触发 groundedness + provenance + trustScore + completeness + relevance", () => {
    const triggers = getDownstreamTriggers("substantive");
    expect(triggers).toContain("groundedness");
    expect(triggers).toContain("provenance");
    expect(triggers).toContain("trustScore");
    expect(triggers).toContain("completeness");
    expect(triggers).toContain("relevance");
    expect(triggers).not.toContain("conflicts");
  });

  it("structural 触发全部 downstream", () => {
    const triggers = getDownstreamTriggers("structural");
    expect(triggers).toContain("groundedness");
    expect(triggers).toContain("provenance");
    expect(triggers).toContain("trustScore");
    expect(triggers).toContain("completeness");
    expect(triggers).toContain("relevance");
    expect(triggers).toContain("conflicts");
  });

  it("非法 significance 回退到 substantive", () => {
    const triggers = getDownstreamTriggers("unknown" as EditSignificance);
    expect(triggers).toEqual(getDownstreamTriggers("substantive"));
  });
});
