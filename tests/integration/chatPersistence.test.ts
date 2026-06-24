/**
 * Chat 持久化集成测试
 * 测试 sync_data 表 CRUD + chat session/message 完整流程
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDbForTesting, getDb, closeDb } from "../../server/src/lib/db.js";

describe("Chat 持久化 — sync_data KV 存储", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  afterAll(() => {
    closeDb();
  });

  it("sync_data 表已创建", () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("sync_data");
  });

  it("创建 chatSession", () => {
    const db = getDb();
    const session = { title: "测试对话", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatSessions", "session-1", JSON.stringify(session));

    const row = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ? AND record_id = ?")
      .get("chatSessions", "session-1") as { record_id: string; data: string };
    expect(row.record_id).toBe("session-1");
    expect(JSON.parse(row.data).title).toBe("测试对话");
  });

  it("创建 chatMessage", () => {
    const db = getDb();
    const message = {
      sessionId: "session-1",
      role: "user",
      content: "你好",
      createdAt: "2026-01-01T00:00:00Z",
    };
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatMessages", "msg-1", JSON.stringify(message));

    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?")
      .get("chatMessages", "msg-1") as { data: string };
    const parsed = JSON.parse(row.data);
    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("你好");
  });

  it("按 sessionId 查询 messages", () => {
    const db = getDb();
    // 再加一条 msg-2
    const msg2 = { sessionId: "session-1", role: "assistant", content: "你好！有什么可以帮你的？", createdAt: "2026-01-01T00:00:01Z" };
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatMessages", "msg-2", JSON.stringify(msg2));

    // 查询所有 chatMessages，然后按 sessionId 过滤
    const rows = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?")
      .all("chatMessages") as Array<{ record_id: string; data: string }>;
    const sessionMessages = rows
      .map((r) => ({ id: r.record_id, ...JSON.parse(r.data) }))
      .filter((m) => m.sessionId === "session-1");

    expect(sessionMessages.length).toBe(2);
    expect(sessionMessages[0].role).toBe("user");
    expect(sessionMessages[1].role).toBe("assistant");
  });

  it("删除 session 及其 messages（应用层级联删除）", () => {
    const db = getDb();

    // 删除 session
    const result = db.prepare("DELETE FROM sync_data WHERE store_name = ? AND record_id = ?")
      .run("chatSessions", "session-1");
    expect(result.changes).toBe(1);

    // 应用层：查找并删除关联的 messages
    const rows = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?")
      .all("chatMessages") as Array<{ record_id: string; data: string }>;
    const sessionMessages = rows
      .map((r) => ({ id: r.record_id, ...JSON.parse(r.data) }))
      .filter((m) => m.sessionId === "session-1");

    for (const msg of sessionMessages) {
      db.prepare("DELETE FROM sync_data WHERE store_name = ? AND record_id = ?")
        .run("chatMessages", msg.id);
    }

    // 验证 messages 已删除
    const remaining = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?")
      .all("chatMessages") as Array<{ record_id: string; data: string }>;
    const remainingForSession = remaining
      .map((r) => ({ id: r.record_id, ...JSON.parse(r.data) }))
      .filter((m) => m.sessionId === "session-1");

    expect(remainingForSession.length).toBe(0);
  });

  it("多个 session 独立存储", () => {
    const db = getDb();

    // 创建两个 session
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatSessions", "s1", JSON.stringify({ title: "对话1" }));
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatSessions", "s2", JSON.stringify({ title: "对话2" }));

    // 各自添加 messages
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatMessages", "m1", JSON.stringify({ sessionId: "s1", role: "user", content: "消息1" }));
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))")
      .run("chatMessages", "m2", JSON.stringify({ sessionId: "s2", role: "user", content: "消息2" }));

    // 查询 s1 的消息
    const allMsgs = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?")
      .all("chatMessages") as Array<{ record_id: string; data: string }>;
    const s1Msgs = allMsgs
      .map((r) => ({ id: r.record_id, ...JSON.parse(r.data) }))
      .filter((m) => m.sessionId === "s1");
    const s2Msgs = allMsgs
      .map((r) => ({ id: r.record_id, ...JSON.parse(r.data) }))
      .filter((m) => m.sessionId === "s2");

    expect(s1Msgs.length).toBe(1);
    expect(s2Msgs.length).toBe(1);
    expect(s1Msgs[0].content).toBe("消息1");
    expect(s2Msgs[0].content).toBe("消息2");

    // 清理
    db.prepare("DELETE FROM sync_data WHERE store_name = ?").run("chatSessions");
    db.prepare("DELETE FROM sync_data WHERE store_name = ?").run("chatMessages");
  });
});
