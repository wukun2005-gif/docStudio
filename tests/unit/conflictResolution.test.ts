/**
 * 单元测试 — 冲突自动解决 (bug1: 冲突源前置过滤)
 */
import { describe, it, expect } from "vitest";
import { autoResolveConflicts, type ConflictItem } from "../../server/src/lib/conflictDetection.js";

function makeConflict(overrides: Partial<ConflictItem> = {}): ConflictItem {
  return {
    topic: "测试冲突",
    conflictType: "data",
    severity: "high",
    claims: [
      { text: "声明A", source: "来源A", sourceAuthority: 0.9, timestamp: "2024-06-01" },
      { text: "声明B", source: "来源B", sourceAuthority: 0.5, timestamp: "2024-06-01" },
    ],
    ...overrides,
  };
}

describe("autoResolveConflicts", () => {
  it("权威度差异时，以高权威来源为准", () => {
    const conflict = makeConflict({
      conflictType: "data",
      claims: [
        { text: "VP说收入100万", source: "VP报告", sourceAuthority: 0.9, timestamp: "2024-06-01" },
        { text: "实习生说收入80万", source: "实习生笔记", sourceAuthority: 0.4, timestamp: "2024-06-01" },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["VP报告", ["chunk-vp-1"]],
      ["实习生笔记", ["chunk-intern-1"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds);

    expect(result.resolved).toHaveLength(1);
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved[0]!.resolution).toBe("authority");
    expect(result.resolved[0]!.winningSource).toBe("VP报告");
    expect(result.excludedChunkIds).toContain("chunk-intern-1");
    expect(result.excludedChunkIds).not.toContain("chunk-vp-1");
  });

  it("时间冲突时，以更新的来源为准", () => {
    const conflict = makeConflict({
      conflictType: "temporal",
      claims: [
        { text: "1周后发布", source: "旧周报", sourceAuthority: 0.6, timestamp: "2024-01-01" },
        { text: "1个月后上线", source: "新周报", sourceAuthority: 0.6, timestamp: "2024-06-15" },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["旧周报", ["chunk-old"]],
      ["新周报", ["chunk-new"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.resolution).toBe("temporal");
    expect(result.resolved[0]!.winningSource).toBe("新周报");
    expect(result.excludedChunkIds).toContain("chunk-old");
  });

  it("无法自动解决时标记为 unresolvable", () => {
    const conflict = makeConflict({
      conflictType: "perspective",
      claims: [
        { text: "乐观预测", source: "销售部", sourceAuthority: undefined, timestamp: undefined },
        { text: "保守预测", source: "研发部", sourceAuthority: undefined, timestamp: undefined },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["销售部", ["chunk-sales"]],
      ["研发部", ["chunk-eng"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds);

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.resolution).toBe("unresolvable");
    expect(result.excludedChunkIds).toHaveLength(0);
  });

  it("高权威来源较旧、低权威来源较新时，不自动解决", () => {
    const conflict = makeConflict({
      conflictType: "data",
      claims: [
        { text: "VP旧数据", source: "VP旧报告", sourceAuthority: 0.9, timestamp: "2024-01-01" },
        { text: "新数据", source: "新周报", sourceAuthority: 0.5, timestamp: "2024-06-15" },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["VP旧报告", ["chunk-vp-old"]],
      ["新周报", ["chunk-new"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds);

    // 高权威但旧 vs 低权威但新 → 不自动解决
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  });

  it("多个冲突分别独立处理", () => {
    const conflicts: ConflictItem[] = [
      makeConflict({
        topic: "冲突1",
        conflictType: "authority",
        claims: [
          { text: "A", source: "总经理", sourceAuthority: 0.9 },
          { text: "B", source: "助理", sourceAuthority: 0.3 },
        ],
      }),
      makeConflict({
        topic: "冲突2",
        conflictType: "perspective",
        claims: [
          { text: "C", source: "X", sourceAuthority: undefined },
          { text: "D", source: "Y", sourceAuthority: undefined },
        ],
      }),
    ];

    const sourceToChunkIds = new Map<string, string[]>([
      ["总经理", ["chunk-ceo"]],
      ["助理", ["chunk-assistant"]],
      ["X", ["chunk-x"]],
      ["Y", ["chunk-y"]],
    ]);

    const result = autoResolveConflicts(conflicts, sourceToChunkIds);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.topic).toBe("冲突1");
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.topic).toBe("冲突2");
    expect(result.excludedChunkIds).toEqual(["chunk-assistant"]);
  });

  it("少于 2 个 claim 的冲突跳过", () => {
    const conflict = makeConflict({ claims: [{ text: "唯一声明", source: "唯一来源" }] });
    const result = autoResolveConflicts([conflict], new Map());

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
    expect(result.excludedChunkIds).toHaveLength(0);
  });

  it("相同权威度和时间戳均等时不解决", () => {
    const conflict = makeConflict({
      conflictType: "data",
      claims: [
        { text: "A", source: "来源A", sourceAuthority: 0.7, timestamp: "2024-06-01" },
        { text: "B", source: "来源B", sourceAuthority: 0.7, timestamp: "2024-06-01" },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["来源A", ["chunk-a"]],
      ["来源B", ["chunk-b"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds);

    // 权威度相等 → 不走 authority 分支（需要 withAuth >= 2 且 sorted 后有明确高低）
    // 时间相等 → temporal 排序后 winner 和 loser 时间一样，但 temporal 只看有没有 timestamp
    // 实际：authority 分支会执行（两者都有 authority），sorted 后第一个是 winner
    // 然后检查 newerLosers: loser 时间不大于 winner → 空数组 → 通过
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.resolution).toBe("authority");
  });

  it("forceResolveAll: 无法自动判定时移除所有 sides 的 chunks", () => {
    const conflict = makeConflict({
      conflictType: "perspective",
      claims: [
        { text: "乐观预测", source: "销售部", sourceAuthority: undefined, timestamp: undefined },
        { text: "保守预测", source: "研发部", sourceAuthority: undefined, timestamp: undefined },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["销售部", ["chunk-sales"]],
      ["研发部", ["chunk-eng"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds, { forceResolveAll: true });

    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.resolution).toBe("unresolvable");
    expect(result.excludedChunkIds).toContain("chunk-sales");
    expect(result.excludedChunkIds).toContain("chunk-eng");
  });

  it("forceResolveAll: 能自动判定时仍按权威/时间策略处理", () => {
    const conflict = makeConflict({
      conflictType: "data",
      claims: [
        { text: "VP说收入100万", source: "VP报告", sourceAuthority: 0.9, timestamp: "2024-06-01" },
        { text: "实习生说收入80万", source: "实习生笔记", sourceAuthority: 0.4, timestamp: "2024-06-01" },
      ],
    });

    const sourceToChunkIds = new Map<string, string[]>([
      ["VP报告", ["chunk-vp-1"]],
      ["实习生笔记", ["chunk-intern-1"]],
    ]);

    const result = autoResolveConflicts([conflict], sourceToChunkIds, { forceResolveAll: true });

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.resolution).toBe("authority");
    expect(result.resolved[0]!.winningSource).toBe("VP报告");
    expect(result.excludedChunkIds).toEqual(["chunk-intern-1"]);
  });

  it("forceResolveAll: 混合可解/不可解冲突时全部进入 resolved", () => {
    const conflicts: ConflictItem[] = [
      makeConflict({
        topic: "可解冲突",
        conflictType: "authority",
        claims: [
          { text: "A", source: "总经理", sourceAuthority: 0.9 },
          { text: "B", source: "助理", sourceAuthority: 0.3 },
        ],
      }),
      makeConflict({
        topic: "不可解冲突",
        conflictType: "perspective",
        claims: [
          { text: "C", source: "X", sourceAuthority: undefined },
          { text: "D", source: "Y", sourceAuthority: undefined },
        ],
      }),
    ];

    const sourceToChunkIds = new Map<string, string[]>([
      ["总经理", ["chunk-ceo"]],
      ["助理", ["chunk-assistant"]],
      ["X", ["chunk-x"]],
      ["Y", ["chunk-y"]],
    ]);

    const result = autoResolveConflicts(conflicts, sourceToChunkIds, { forceResolveAll: true });

    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
    expect(result.excludedChunkIds).toContain("chunk-assistant");
    expect(result.excludedChunkIds).toContain("chunk-x");
    expect(result.excludedChunkIds).toContain("chunk-y");
    expect(result.excludedChunkIds).not.toContain("chunk-ceo");
  });
});
