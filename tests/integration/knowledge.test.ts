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
  addRelationship,
  getRelationships,
} from "../../server/src/lib/peopleGraph.js";
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
    const before = getAllPeople().length;
    addPerson({ id: "p1", name: "陈强", title: "工程师", department: "技术部" });
    addPerson({ id: "p2", name: "刘伟", title: "产品经理", department: "产品部" });
    const people = getAllPeople();
    expect(people).toHaveLength(before + 2);
  });

  it("getPersonById", () => {
    const person = getPersonById("p1");
    expect(person).toBeDefined();
    expect(person!.name).toBe("陈强");
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
    expect(ctx).toContain("陈强");
    expect(ctx).toContain("工程师");
    expect(ctx).toContain("技术部");
  });
});

describe("PeopleGraph 双向关系", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  afterAll(() => {
    closeDb();
  });

  it("addRelationship 自动创建反向关系 (manager↔direct_report)", () => {
    addPerson({ id: "mgr1", name: "张总", title: "CTO", department: "技术部" });
    addPerson({ id: "emp1", name: "李工", title: "工程师", department: "技术部" });
    addRelationship({ sourceId: "emp1", targetId: "mgr1", type: "manager", context: "直接汇报" });

    // 正向: emp1 → manager → mgr1
    const empRels = getRelationships("emp1");
    expect(empRels).toHaveLength(1);
    expect(empRels[0].relationship.type).toBe("manager");
    expect(empRels[0].person.id).toBe("mgr1");

    // 反向: mgr1 → direct_report → emp1
    const mgrRels = getRelationships("mgr1");
    expect(mgrRels).toHaveLength(1);
    expect(mgrRels[0].relationship.type).toBe("direct_report");
    expect(mgrRels[0].person.id).toBe("emp1");
  });

  it("addRelationship 自动创建反向关系 (peer↔peer)", () => {
    addPerson({ id: "peer1", name: "王五", title: "产品经理", department: "产品部" });
    addPerson({ id: "peer2", name: "赵六", title: "设计师", department: "设计部" });
    addRelationship({ sourceId: "peer1", targetId: "peer2", type: "peer" });

    const rels1 = getRelationships("peer1");
    expect(rels1.some((r) => r.person.id === "peer2" && r.relationship.type === "peer")).toBe(true);

    const rels2 = getRelationships("peer2");
    expect(rels2.some((r) => r.person.id === "peer1" && r.relationship.type === "peer")).toBe(true);
  });

  it("deletePerson 清理反向关系", () => {
    addPerson({ id: "mgr2", name: "周总", title: "VP", department: "管理层" });
    addPerson({ id: "emp2", name: "吴工", title: "工程师", department: "技术部" });
    addRelationship({ sourceId: "emp2", targetId: "mgr2", type: "manager" });

    // 删除 emp2 前，mgr2 有指向 emp2 的关系
    let mgrRels = getRelationships("mgr2");
    expect(mgrRels.some((r) => r.person.id === "emp2")).toBe(true);

    // 删除 emp2
    deletePerson("emp2");

    // mgr2 中指向 emp2 的关系应被清理
    mgrRels = getRelationships("mgr2");
    expect(mgrRels.some((r) => r.person.id === "emp2")).toBe(false);
  });

  it("getPersonContext 包含关系网络信息", () => {
    addPerson({ id: "ctx1", name: "郑经理", title: "部门经理", department: "产品部", attributes: { communicationStyle: "formal" } });
    addPerson({ id: "ctx2", name: "孙工", title: "工程师", department: "技术部" });
    addRelationship({ sourceId: "ctx2", targetId: "ctx1", type: "manager" });

    const ctx = getPersonContext("ctx2");
    expect(ctx).toContain("孙工");
    expect(ctx).toContain("关系网络");
    expect(ctx).toContain("郑经理");
    expect(ctx).toContain("上级");
  });

  it("getPersonContext 包含沟通风格", () => {
    const ctx = getPersonContext("ctx1");
    expect(ctx).toContain("沟通风格");
    expect(ctx).toContain("正式风格");
  });
});
