/**
 * Phase 2 集成测试 — RAG 引擎 (#9-12)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDbForTesting, getDb, closeDb } from "../../server/src/lib/db.js";
import { expandQuery, generateQueryVariants } from "../../server/src/lib/queryExpand.js";
import { hybridSearch } from "../../server/src/lib/hybridSearch.js";
import { localRerank, rerank } from "../../server/src/lib/reranker.js";
import { splitIntoSentences, buildJudgePrompt } from "../../server/src/lib/groundednessCheck.js";
import { addSource, addChunks, clearKnowledgeDb } from "../../server/src/lib/knowledgeDb.js";
import crypto from "crypto";

describe("Query Expansion (#9)", () => {
  it("expandQuery 返回扩展结果", () => {
    const result = expandQuery("项目进展");
    expect(result.original).toBe("项目进展");
    expect(result.expanded.length).toBeGreaterThanOrEqual(1);
    expect(result.combined).toContain("项目");
  });

  it("跨语言扩展包含英文", () => {
    const result = expandQuery("项目计划");
    expect(result.expanded.some((q) => q.includes("project"))).toBe(true);
  });

  it("同义词扩展", () => {
    const result = expandQuery("完成情况");
    expect(result.expanded.some((q) => q.includes("达成") || q.includes("实现"))).toBe(true);
  });

  it("generateQueryVariants 生成多个变体", () => {
    const variants = generateQueryVariants("团队问题");
    expect(variants.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Hybrid Search (#10)", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
    // 注入测试数据
    const sourceId = crypto.randomUUID();
    addSource({ id: sourceId, name: "test.txt", type: "txt", chunkCount: 5, status: "ready" });
    addChunks([
      { id: "c1", sourceId, content: "项目进展顺利，本周完成了核心功能开发", chunkIndex: 0 },
      { id: "c2", sourceId, content: "团队遇到了性能问题，需要优化数据库查询", chunkIndex: 1 },
      { id: "c3", sourceId, content: "下周计划发布新版本，包含多项改进", chunkIndex: 2 },
      { id: "c4", sourceId, content: "产品需求文档已更新，新增三个功能需求", chunkIndex: 3 },
      { id: "c5", sourceId, content: "技术架构评审通过，采用微服务方案", chunkIndex: 4 },
    ]);
  });

  afterAll(() => {
    closeDb();
  });

  it("hybridSearch 返回相关结果", () => {
    const results = hybridSearch("项目进展", { useQueryExpansion: false });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("项目");
  });

  it("hybridSearch 多关键词匹配", () => {
    const results = hybridSearch("性能优化", { useQueryExpansion: false });
    expect(results.length).toBeGreaterThan(0);
    // 应该能找到性能相关的 chunk
    const hasPerformance = results.some((r) => r.content.includes("性能"));
    expect(hasPerformance).toBe(true);
  });

  it("hybridSearch 空查询返回空结果", () => {
    const results = hybridSearch("", { useQueryExpansion: false });
    expect(results).toHaveLength(0);
  });

  it("hybridSearch 带查询扩展", () => {
    const results = hybridSearch("项目计划", { useQueryExpansion: true });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("Reranker (#11)", () => {
  it("localRerank 重排序结果", () => {
    const input = [
      { chunkId: "a", text: "项目进展顺利", score: 0.5 },
      { chunkId: "b", text: "项目计划已定", score: 0.3 },
      { chunkId: "c", text: "无关内容", score: 0.8 },
    ];
    const result = localRerank(input, "项目进展");
    expect(result.length).toBe(3);
    // 项目相关的应该排在前面
    const topIds = result.slice(0, 2).map((r) => r.chunkId);
    expect(topIds).toContain("a");
  });

  it("localRerank 单个结果直接返回", () => {
    const input = [{ chunkId: "a", text: "test", score: 0.5 }];
    const result = localRerank(input, "test");
    expect(result).toHaveLength(1);
  });

  it("rerank 降级到本地启发式", async () => {
    const input = [
      { chunkId: "a", text: "项目进展", score: 0.5 },
      { chunkId: "b", text: "无关", score: 0.8 },
    ];
    const result = await rerank(input, "项目");
    expect(result.length).toBe(2);
  });
});

describe("Groundedness Check (#12)", () => {
  it("splitIntoSentences 按句号拆分", () => {
    const sentences = splitIntoSentences("这是第一句。这是第二句！这是第三句？");
    expect(sentences).toHaveLength(3);
  });

  it("splitIntoSentences 合并短句", () => {
    const sentences = splitIntoSentences("长句子内容在这里。短");
    expect(sentences).toHaveLength(1);
  });

  it("splitIntoSentences 空文本返回空数组", () => {
    expect(splitIntoSentences("")).toHaveLength(0);
    expect(splitIntoSentences("   ")).toHaveLength(0);
  });

  it("buildJudgePrompt 构建正确", () => {
    const { system, user } = buildJudgePrompt(
      ["声明一", "声明二"],
      [{ source: "文档A", excerpt: "相关内容" }],
    );
    expect(system).toContain("事实核查");
    expect(user).toContain("声明一");
    expect(user).toContain("文档A");
  });
});
