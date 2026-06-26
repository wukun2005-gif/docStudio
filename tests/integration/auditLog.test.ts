/**
 * 审计日志集成测试 — 文件方案
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { resetDbForTesting, getDb, closeDb } from "../../server/src/lib/db.js";
import { logAudit, queryAuditLogs, setTestLogFile, clearTestLogFile } from "../../server/src/lib/auditLog.js";
import { addSource, deleteSource, updateSourceStatus } from "../../server/src/lib/knowledgeDb.js";
import { addPerson, deletePerson } from "../../server/src/lib/peopleGraph.js";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const TEST_LOG = join(process.cwd(), "data", "test-audit.log");

beforeAll(() => {
  resetDbForTesting(":memory:");
  setTestLogFile(TEST_LOG);
});

afterAll(() => {
  clearTestLogFile();
  closeDb();
  // 清理测试日志文件
  try { if (existsSync(TEST_LOG)) unlinkSync(TEST_LOG); } catch { /* ignore */ }
});

beforeEach(() => {
  // 清空测试日志文件
  writeFileSync(TEST_LOG, "");
});

describe("logAudit 基本功能", () => {
  it("INSERT 操作记录审计", () => {
    logAudit({
      table: "test_table",
      operation: "INSERT",
      recordId: "test-001",
      newData: { name: "测试数据" },
      source: "test",
    });

    const logs = queryAuditLogs({ table: "test_table" });
    expect(logs).toHaveLength(1);
    expect(logs[0].table_name).toBe("test_table");
    expect(logs[0].operation).toBe("INSERT");
    expect(logs[0].record_id).toBe("test-001");
    expect(JSON.parse(logs[0].new_data!)).toEqual({ name: "测试数据" });
    expect(logs[0].source).toBe("test");
  });

  it("UPDATE 操作记录 old_data + new_data", () => {
    logAudit({
      table: "test_table",
      operation: "UPDATE",
      recordId: "test-002",
      oldData: { name: "旧数据" },
      newData: { name: "新数据" },
      source: "test",
    });

    const logs = queryAuditLogs({ table: "test_table" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("UPDATE");
    expect(JSON.parse(logs[0].old_data!)).toEqual({ name: "旧数据" });
    expect(JSON.parse(logs[0].new_data!)).toEqual({ name: "新数据" });
  });

  it("DELETE 操作记录 old_data", () => {
    logAudit({
      table: "test_table",
      operation: "DELETE",
      recordId: "test-003",
      oldData: { name: "被删除的数据" },
      source: "test",
    });

    const logs = queryAuditLogs({ table: "test_table" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("DELETE");
    expect(JSON.parse(logs[0].old_data!)).toEqual({ name: "被删除的数据" });
    expect(logs[0].new_data).toBeNull();
  });
});

describe("知识库操作审计", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM kb_sources").run();
  });

  it("addSource 记录审计", () => {
    addSource({
      id: "src-001",
      name: "测试文档",
      type: "txt",
      chunkCount: 0,
      status: "ready",
    });

    const logs = queryAuditLogs({ table: "kb_sources" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("INSERT");
    expect(logs[0].record_id).toBe("src-001");
    expect(logs[0].source).toBe("knowledge");
  });

  it("deleteSource 记录审计", () => {
    addSource({
      id: "src-002",
      name: "待删除文档",
      type: "txt",
      chunkCount: 0,
      status: "ready",
    });

    // 清空审计日志，只关注 delete 操作
    writeFileSync(TEST_LOG, "");

    deleteSource("src-002");

    const logs = queryAuditLogs({ table: "kb_sources", recordId: "src-002" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("DELETE");
  });

  it("updateSourceStatus 记录审计", () => {
    addSource({
      id: "src-003",
      name: "待更新文档",
      type: "txt",
      chunkCount: 0,
      status: "ready",
    });

    // 清空审计日志
    writeFileSync(TEST_LOG, "");

    updateSourceStatus("src-003", "processing");

    const logs = queryAuditLogs({ table: "kb_sources", recordId: "src-003" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("UPDATE");
    expect(JSON.parse(logs[0].new_data!).status).toBe("processing");
  });
});

describe("People 操作审计", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM people").run();
  });

  it("addPerson 记录审计", () => {
    addPerson({
      id: "person-001",
      name: "测试人员",
      title: "工程师",
      department: "技术部",
    });

    const logs = queryAuditLogs({ table: "people" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("INSERT");
    expect(logs[0].record_id).toBe("person-001");
    expect(logs[0].source).toBe("people");
  });

  it("deletePerson 记录审计", () => {
    addPerson({
      id: "person-002",
      name: "待删除人员",
    });

    // 清空审计日志
    writeFileSync(TEST_LOG, "");

    deletePerson("person-002");

    const logs = queryAuditLogs({ table: "people", recordId: "person-002" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("DELETE");
  });
});

describe("审计日志异常处理", () => {
  it("审计失败不影响业务操作", () => {
    // 设置一个不存在的目录路径，模拟写入失败
    const origPath = join(process.cwd(), "nonexistent-dir", "audit.log");
    setTestLogFile(origPath);

    // 调用 logAudit 应该不会抛出异常
    expect(() => {
      logAudit({
        table: "test_table",
        operation: "INSERT",
        recordId: "test-001",
        source: "test",
      });
    }).not.toThrow();

    // 恢复正常路径
    setTestLogFile(TEST_LOG);
  });
});

describe("queryAuditLogs 查询功能", () => {
  it("按 table 查询", () => {
    logAudit({ table: "table_a", operation: "INSERT", recordId: "1", source: "test" });
    logAudit({ table: "table_b", operation: "INSERT", recordId: "2", source: "test" });
    logAudit({ table: "table_a", operation: "UPDATE", recordId: "3", source: "test" });

    const logs = queryAuditLogs({ table: "table_a" });
    expect(logs).toHaveLength(2);
  });

  it("按 source 查询", () => {
    logAudit({ table: "test", operation: "INSERT", recordId: "1", source: "module_a" });
    logAudit({ table: "test", operation: "INSERT", recordId: "2", source: "module_b" });
    logAudit({ table: "test", operation: "INSERT", recordId: "3", source: "module_a" });

    const logs = queryAuditLogs({ source: "module_a" });
    expect(logs).toHaveLength(2);
  });

  it("按 recordId 查询", () => {
    logAudit({ table: "test", operation: "INSERT", recordId: "rec-001", source: "test" });
    logAudit({ table: "test", operation: "UPDATE", recordId: "rec-001", source: "test" });
    logAudit({ table: "test", operation: "INSERT", recordId: "rec-002", source: "test" });

    const logs = queryAuditLogs({ recordId: "rec-001" });
    expect(logs).toHaveLength(2);
  });

  it("limit 参数生效", () => {
    for (let i = 0; i < 10; i++) {
      logAudit({ table: "test", operation: "INSERT", recordId: `rec-${i}`, source: "test" });
    }

    const logs = queryAuditLogs({ limit: 5 });
    expect(logs).toHaveLength(5);
  });
});
