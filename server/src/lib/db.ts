/**
 * SQLite 数据库模块 — i-Write 主存储
 * 使用 better-sqlite3 同步 API，WAL 模式
 * 支持测试注入内存数据库
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "./logger.js";

const DATA_DIR = process.env.DB_DIR ?? path.resolve(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "docstudio.db");

let db: Database.Database | null = null;

/** 获取或初始化 SQLite 数据库 */
export function getDb(): Database.Database {
  if (db) return db;

  // 支持测试注入的自定义路径
  const testPath = (globalThis as Record<string, unknown>).__TEST_DB_PATH__ as string | undefined;
  const effectivePath = testPath ?? DB_PATH;

  // 确保 data 目录存在（内存数据库跳过）
  if (effectivePath !== ":memory:") {
    const dir = path.dirname(effectivePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  db = new Database(effectivePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 初始化表结构
  migrate(db);

  logger.info(`[DB] 数据库已初始化: ${effectivePath}`);
  return db;
}

/** 测试用：重置数据库为内存数据库 */
export function resetDbForTesting(testPath: string = ":memory:"): void {
  if (db) {
    db.close();
    db = null;
  }
  (globalThis as Record<string, unknown>).__TEST_DB_PATH__ = testPath;
  // 下次 getDb() 调用会创建新连接
}

/** 关闭数据库连接 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Schema migration — 增量升级 */
function migrate(db: Database.Database): void {
  // 获取当前版本
  const versionRow = db.pragma("user_version", { simple: true }) as number;

  db.exec(`
    -- 知识源
    CREATE TABLE IF NOT EXISTS kb_sources (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL,          -- 'pdf' | 'docx' | 'txt' | 'html' | 'md' | 'url' | 'demo' | 'generation'
      file_path     TEXT,
      url           TEXT,
      content_hash  TEXT,
      chunk_count   INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'ready',   -- 'processing' | 'ready' | 'error'
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 知识块
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id            TEXT PRIMARY KEY,
      source_id     TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
      content       TEXT NOT NULL,
      chunk_index   INTEGER NOT NULL,
      token_count   INTEGER DEFAULT 0,
      metadata      TEXT,                   -- JSON: { page, section, ... }
      embedded      INTEGER DEFAULT 0,      -- 0=未 embedding, 1=已 embedding
      text_hash     TEXT,                   -- MD5 hash 用于断点续传
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON kb_chunks(source_id);

    -- 向量嵌入
    CREATE TABLE IF NOT EXISTS kb_vectors (
      chunk_id      TEXT PRIMARY KEY REFERENCES kb_chunks(id) ON DELETE CASCADE,
      embedding     BLOB NOT NULL,
      model_id      TEXT NOT NULL
    );

    -- 生成记录
    CREATE TABLE IF NOT EXISTS generation_runs (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL DEFAULT '',
      outline       TEXT,                   -- JSON: 大纲结构
      content       TEXT,                   -- 生成的文档内容
      format        TEXT DEFAULT 'docx',    -- 'docx' | 'pptx' | 'xlsx' | 'html'
      config        TEXT,                   -- JSON: 生成配置
      status        TEXT DEFAULT 'pending', -- 'pending' | 'generating' | 'done' | 'error'
      trust_score   REAL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 信任度评估
    CREATE TABLE IF NOT EXISTS trust_evaluations (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      metrics       TEXT NOT NULL,           -- JSON: { faithfulness, groundedness, ... }
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_trust_run ON trust_evaluations(run_id);

    -- Golden Set
    CREATE TABLE IF NOT EXISTS golden_set (
      id            TEXT PRIMARY KEY,
      question      TEXT NOT NULL,
      expected_answer TEXT NOT NULL,
      expected_sources TEXT,                -- JSON
      category      TEXT,
      difficulty    TEXT DEFAULT 'medium',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 离线评估报告
    CREATE TABLE IF NOT EXISTS eval_reports (
      id            TEXT PRIMARY KEY,
      config        TEXT,                   -- JSON
      results       TEXT,                   -- JSON
      summary       TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 用户设置
    CREATE TABLE IF NOT EXISTS user_settings (
      key           TEXT PRIMARY KEY,
      value         TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- People Graph
    CREATE TABLE IF NOT EXISTS people (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      title         TEXT,                   -- 职位
      department    TEXT,                   -- 部门
      email         TEXT,
      attributes    TEXT,                   -- JSON: 人际关系、偏好等
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 通用 KV 存储（chat sessions, messages 等）
    CREATE TABLE IF NOT EXISTS sync_data (
      store_name    TEXT NOT NULL,
      record_id     TEXT NOT NULL,
      data          TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (store_name, record_id)
    );

    -- 审计日志已改为文件方案，见 auditLog.ts（日志文件: server/data/db-audit.log）

    -- 生成树（段落级来源追溯）
    CREATE TABLE IF NOT EXISTS provenance_nodes (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      paragraph_idx INTEGER NOT NULL,
      chunk_id      TEXT,
      score         REAL DEFAULT 0,
      is_manual     INTEGER DEFAULT 0,
      parent_id     TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_provenance_run ON provenance_nodes(run_id);
  `);

  // 增量迁移：添加缺失的列
  try {
    const chunkCols = db.prepare("PRAGMA table_info(kb_chunks)").all() as Array<{ name: string }>;
    const colNames = new Set(chunkCols.map((c) => c.name));
    if (!colNames.has("embedded")) {
      db.exec("ALTER TABLE kb_chunks ADD COLUMN embedded INTEGER DEFAULT 0");
      logger.info("[DB] Migration: added kb_chunks.embedded");
    }
    if (!colNames.has("text_hash")) {
      db.exec("ALTER TABLE kb_chunks ADD COLUMN text_hash TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_text_hash ON kb_chunks(text_hash)");
      logger.info("[DB] Migration: added kb_chunks.text_hash");
    }
  } catch (e) {
    // 表可能还不存在，CREATE TABLE 已经处理了
  }

  // 设置版本号
  if (versionRow < 2) {
    db.pragma("user_version = 2");
  }

  logger.info(`[DB] Migration 完成, version=2`);
}
