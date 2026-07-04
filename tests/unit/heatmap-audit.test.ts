/**
 * 单元测试 — nf2 置信度热力图颜色计算 + nf3 AI 自审组件
 */
import { describe, it, expect } from "vitest";
import { computeHeatmapColors, type SectionData } from "../../client/src/components/DocPreview.js";

describe("computeHeatmapColors (nf2)", () => {
  const makeSection = (overrides: Partial<SectionData>): SectionData => ({
    title: "test",
    content: "<p>段落1</p><p>段落2</p>",
    sources: [],
    webCitations: [],
    groundingScore: 0.9,
    ...overrides,
  });

  it("空 sections → 返回空对象", () => {
    expect(computeHeatmapColors([])).toEqual({});
  });

  it("groundedness < 0.5 → AI 推断 (红色)", () => {
    const colors = computeHeatmapColors([makeSection({ groundingScore: 0.3 })]);
    expect(colors[1].label).toBe("AI 推断");
    expect(colors[1].color).toContain("239,68,68"); // red
    expect(colors[2].label).toBe("AI 推断"); // second paragraph
  });

  it("多源(>=2) + groundedness >= 0.5 → 多源验证 (绿色)", () => {
    const colors = computeHeatmapColors([
      makeSection({
        sources: [
          { chunkId: "a", sourceId: "src1", content: "", score: 0.9, sourceName: "A" },
          { chunkId: "b", sourceId: "src2", content: "", score: 0.8, sourceName: "B" },
          { chunkId: "c", sourceId: "src1", content: "", score: 0.7, sourceName: "A" },
        ],
      }),
    ]);
    expect(colors[1].label).toBe("多源验证");
    expect(colors[1].color).toContain("34,197,94"); // green
  });

  it("单源 + groundedness >= 0.5 → 单源支撑 (黄色)", () => {
    const colors = computeHeatmapColors([
      makeSection({
        sources: [
          { chunkId: "a", sourceId: "src1", content: "", score: 0.9, sourceName: "A" },
        ],
      }),
    ]);
    expect(colors[1].label).toBe("单源支撑");
    expect(colors[1].color).toContain("234,179,8"); // yellow
  });

  it("多个 section → 全局段落索引连续", () => {
    const colors = computeHeatmapColors([
      makeSection({ content: "<p>A</p><h2>B</h2>" }),
      makeSection({ content: "<p>C</p><li>D</li><p>E</p>" }),
    ]);
    expect(Object.keys(colors).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("sourceId 为 null/undefined → 只计数有效 sourceId", () => {
    const colors = computeHeatmapColors([
      makeSection({
        sources: [
          { chunkId: "a", sourceId: "src1", content: "", score: 0.9, sourceName: "A" },
          { chunkId: "b", sourceId: undefined as unknown as string, content: "", score: 0.8 },
          { chunkId: "c", sourceId: null as unknown as string, content: "", score: 0.7 },
        ],
      }),
    ]);
    // Only "src1" is valid → single source → yellow
    expect(colors[1].label).toBe("单源支撑");
  });

  it("无内容段落 → 至少 1 个段落", () => {
    const colors = computeHeatmapColors([
      makeSection({ content: "" }),
    ]);
    expect(colors[1]).toBeDefined();
  });
});
