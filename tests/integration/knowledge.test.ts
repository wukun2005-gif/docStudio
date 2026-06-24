/**
 * Phase 1 集成测试 — 知识源管理 (#1-4)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDbForTesting, getDb, closeDb } from "../../server/src/lib/db.js";
import {
  addSource,
  getAllSources,
  deleteSource,
  addChunks,
  getChunksBySourceId,
  getStats,
  clearKnowledgeDb,
  computeTextHash,
  chunkText,
  findDuplicateByHash,
} from "../../server/src/lib/knowledgeDb.js";
import {
  addPerson,
  getAllPeople,
  getPersonById,
  deletePerson,
  getOrgTree,
  getPersonContext,
} from "../../server/src/lib/peopleGraph.js";
import { injectSampleData } from "../../server/src/lib/sampleDataGenerator.js";
import { injectDemoPeople } from "../../server/src/lib/peopleGraph.js";
import crypto from "crypto";

describe("KnowledgeDB 模块", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  afterAll(() => {
    closeDb();
  });

  it("addSource / getAllSources", () => {
    const id = crypto.randomUUID();
    addSource({ id, name: "test.pdf", type: "pdf", chunkCount: 5, status: "ready" });
    const sources = getAllSources();
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.find((s) => s.id === id)).toBeDefined();
  });

  it("addChunks / getChunksBySourceId", () => {
    const sourceId = crypto.randomUUID();
    addSource({ id: sourceId, name: "chunks-test.txt", type: "txt", chunkCount: 3, status: "ready" });
    addChunks([
      { id: crypto.randomUUID(), sourceId, content: "chunk 1", chunkIndex: 0 },
      { id: crypto.randomUUID(), sourceId, content: "chunk 2", chunkIndex: 1 },
      { id: crypto.randomUUID(), sourceId, content: "chunk 3", chunkIndex: 2 },
    ]);
    const chunks = getChunksBySourceId(sourceId);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe("chunk 1");
  });

  it("deleteSource 级联删除 chunks", () => {
    const sourceId = crypto.randomUUID();
    addSource({ id: sourceId, name: "cascade-test.txt", type: "txt", chunkCount: 2, status: "ready" });
    addChunks([
      { id: crypto.randomUUID(), sourceId, content: "a", chunkIndex: 0 },
      { id: crypto.randomUUID(), sourceId, content: "b", chunkIndex: 1 },
    ]);
    deleteSource(sourceId);
    expect(getChunksBySourceId(sourceId)).toHaveLength(0);
  });

  it("computeTextHash 一致性", () => {
    const hash1 = computeTextHash("hello world");
    const hash2 = computeTextHash("hello world");
    expect(hash1).toBe(hash2);
    expect(computeTextHash("different")).not.toBe(hash1);
  });

  it("findDuplicateByHash 检测重复", () => {
    const hash = computeTextHash("duplicate content");
    const id = crypto.randomUUID();
    addSource({ id, name: "dup.txt", type: "txt", contentHash: hash, chunkCount: 0, status: "ready" });
    expect(findDuplicateByHash(hash)).toBe(id);
    expect(findDuplicateByHash("nonexistent")).toBeUndefined();
  });

  it("chunkText 按段落切分", () => {
    const text = "段落一\n\n段落二\n\n段落三";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("段落一");
  });

  it("chunkText 长段落按句子切分", () => {
    const longText = "这是一个很长的段落。".repeat(100);
    const chunks = chunkText(longText, 200);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(250)); // 允许一些 overlap
  });

  it("getStats 统计正确", () => {
    clearKnowledgeDb();
    const id = crypto.randomUUID();
    addSource({ id, name: "stats.txt", type: "txt", chunkCount: 2, status: "ready" });
    addChunks([
      { id: crypto.randomUUID(), sourceId: id, content: "a", chunkIndex: 0 },
      { id: crypto.randomUUID(), sourceId: id, content: "b", chunkIndex: 1 },
    ]);
    const stats = getStats();
    expect(stats.sourceCount).toBe(1);
    expect(stats.chunkCount).toBe(2);
  });
});

describe("PeopleGraph 模块", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  afterAll(() => {
    closeDb();
  });

  it("addPerson / getAllPeople", () => {
    addPerson({ id: "p1", name: "张三", title: "工程师", department: "技术部" });
    addPerson({ id: "p2", name: "李四", title: "产品经理", department: "产品部" });
    const people = getAllPeople();
    expect(people).toHaveLength(2);
  });

  it("getPersonById", () => {
    const person = getPersonById("p1");
    expect(person).toBeDefined();
    expect(person!.name).toBe("张三");
  });

  it("getOrgTree 按部门分组", () => {
    const tree = getOrgTree();
    expect(tree.has("技术部")).toBe(true);
    expect(tree.has("产品部")).toBe(true);
    expect(tree.get("技术部")!.length).toBe(1);
  });

  it("deletePerson", () => {
    deletePerson("p2");
    expect(getPersonById("p2")).toBeUndefined();
  });

  it("getPersonContext 返回上下文信息", () => {
    const ctx = getPersonContext("p1");
    expect(ctx).toContain("张三");
    expect(ctx).toContain("工程师");
    expect(ctx).toContain("技术部");
  });
});

describe("Sample Data 注入", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  afterAll(() => {
    closeDb();
  });

  it("injectSampleData 注入周报数据", () => {
    injectSampleData();
    const stats = getStats();
    expect(stats.sourceCount).toBe(3); // 3 份周报/规划文档
    expect(stats.chunkCount).toBeGreaterThan(0);
  });

  it("injectSampleData 重复调用不重复注入", () => {
    injectSampleData(); // 第二次调用
    const stats = getStats();
    expect(stats.sourceCount).toBe(3); // 仍然是 3
  });

  it("injectDemoPeople 注入组织架构", () => {
    injectDemoPeople();
    const people = getAllPeople();
    expect(people.length).toBe(7); // 张明CEO, 李华CTO, 王芳产品总监, 陈强技术负责人, 赵丽前端, 刘伟后端, 孙娜数据科学家
    expect(people.find((p) => p.name === "张明")).toBeDefined(); // CEO
  });
});
