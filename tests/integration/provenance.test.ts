/**
 * Phase 5-6 集成测试 — 生成树 & 评估体系
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDbForTesting, getDb, closeDb } from "../../server/src/lib/db.js";
import {
  addProvenanceNode,
  getProvenanceByRunId,
  deleteProvenanceNode,
  updateProvenanceScore,
  replaceSource,
  getParagraphTree,
  buildProvenanceTree,
} from "../../server/src/lib/provenanceTree.js";
import { computeTrustScore } from "../../server/src/lib/evalMetrics.js";
import type { TrustMetrics } from "../../server/src/lib/evalMetrics.js";
import crypto from "crypto";

describe("生成树 (#17-19)", () => {
  const runId = crypto.randomUUID();

  beforeAll(() => {
    resetDbForTesting(":memory:");
    // 创建一个 generation_run
    const db = getDb();
    db.prepare("INSERT INTO generation_runs (id, title, status) VALUES (?, ?, ?)").run(runId, "test", "done");
  });

  afterAll(() => {
    closeDb();
  });

  it("addProvenanceNode / getProvenanceByRunId", () => {
    addProvenanceNode({
      id: crypto.randomUUID(),
      runId,
      paragraphIdx: 0,
      chunkId: "chunk-1",
      score: 0.9,
    });
    addProvenanceNode({
      id: crypto.randomUUID(),
      runId,
      paragraphIdx: 0,
      chunkId: "chunk-2",
      score: 0.7,
    });

    const nodes = getProvenanceByRunId(runId);
    expect(nodes.length).toBe(2);
  });

  it("getParagraphTree 按段落查询", () => {
    const nodes = getParagraphTree(runId, 0);
    expect(nodes.length).toBe(2);
    expect(nodes[0].score).toBeGreaterThanOrEqual(nodes[1].score); // 按分数降序
  });

  it("deleteProvenanceNode", () => {
    const id = crypto.randomUUID();
    addProvenanceNode({ id, runId, paragraphIdx: 1, score: 0.5 });
    expect(getProvenanceByRunId(runId).length).toBe(3);
    deleteProvenanceNode(id);
    expect(getProvenanceByRunId(runId).length).toBe(2);
  });

  it("updateProvenanceScore", () => {
    const nodes = getProvenanceByRunId(runId);
    const firstId = nodes[0].id;
    updateProvenanceScore(firstId, 0.95);
    const updated = getProvenanceByRunId(runId).find((n) => n.id === firstId);
    expect(updated!.score).toBe(0.95);
  });

  it("replaceSource (#18)", () => {
    const nodes = getProvenanceByRunId(runId);
    replaceSource(nodes[0].id, "new-chunk-id");
    const updated = getProvenanceByRunId(runId).find((n) => n.id === nodes[0].id);
    expect(updated!.chunkId).toBe("new-chunk-id");
    expect(updated!.isManual).toBe(true);
  });
});

describe("评估指标 (#20)", () => {
  it("computeTrustScore 计算加权平均", () => {
    const metrics: TrustMetrics = {
      faithfulness: 0.9,
      groundedness: 0.8,
      coherence: 0.7,
      fluency: 0.6,
      completeness: 0.5,
    };
    const score = computeTrustScore(metrics);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    // 验证加权计算
    const expected = 0.9 * 0.3 + 0.8 * 0.3 + 0.7 * 0.15 + 0.6 * 0.1 + 0.5 * 0.15;
    expect(score).toBeCloseTo(expected, 2);
  });

  it("computeTrustScore 全零返回 0", () => {
    const metrics: TrustMetrics = {
      faithfulness: 0,
      groundedness: 0,
      coherence: 0,
      fluency: 0,
      completeness: 0,
    };
    expect(computeTrustScore(metrics)).toBe(0);
  });

  it("computeTrustScore 全一返回 1", () => {
    const metrics: TrustMetrics = {
      faithfulness: 1,
      groundedness: 1,
      coherence: 1,
      fluency: 1,
      completeness: 1,
    };
    expect(computeTrustScore(metrics)).toBeCloseTo(1, 2);
  });
});
