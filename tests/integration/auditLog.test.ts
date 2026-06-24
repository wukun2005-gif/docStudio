/**
 * 审计日志集成测试
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { resetDbForTesting, getDb } from "../../server/src/lib/db.js";
import { logAudit, queryAuditLogs } from "../../server/src/lib/auditLog.js";
import { addSource, deleteSource, updateSourceStatus } from "../../server/src/lib/knowledgeDb.js";
import { addPerson, deletePerson } from "../../server/src/lib/peopleGraph.js";

let db: Database.Database;

beforeAll(() => {
  resetDbForTesting(":memory:");
  db = getDb();
});

beforeEach(() => {
  // 清空审计日志表
  db.prepare("DELETE FROM audit_log").run();
});

describe("audit_log 表创建", () => {
  it("audit_log 表存在", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").all();
    expect(tables).toHaveLength(1);
  });

  it("audit_log 表有正确的列", () => {
    const columns = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("timestamp");
    expect(colNames).toContain("table_name");
    expect(colNames).toContain("operation");
    expect(colNames).toContain("record_id");
    expect(colNames).toContain("old_data");
    expect(colNames).toContain("new_data");
    expect(colNames).toContain("source");
  });
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
    db.prepare("DELETE FROM audit_log").run();

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
    db.prepare("DELETE FROM audit_log").run();

    updateSourceStatus("src-003", "processing");

    const logs = queryAuditLogs({ table: "kb_sources", recordId: "src-003" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("UPDATE");
    expect(JSON.parse(logs[0].new_data!).status).toBe("processing");
  });
});

describe("People 操作审计", () => {
  beforeEach(() => {
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
    db.prepare("DELETE FROM audit_log").run();

    deletePerson("person-002");

    const logs = queryAuditLogs({ table: "people", recordId: "person-002" });
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("DELETE");
  });
});

describe("审计日志异常处理", () => {
  it("审计失败不影响业务操作", () => {
    // 模拟审计失败（表不存在）
    db.exec("DROP TABLE IF EXISTS audit_log");

    // 调用 logAudit 应该不会抛出异常
    expect(() => {
      logAudit({
        table: "test_table",
        operation: "INSERT",
        recordId: "test-001",
        source: "test",
      });
    }).not.toThrow();

    // 恢复 audit_log 表
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        record_id TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        source TEXT
      )
    `);
  });
});

describe("queryAuditLogs 查询功能", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM audit_log").run();
  });

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
