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
      conflict_resolution TEXT,             -- JSON: 生成阶段的冲突解决结果（resolved/unresolved/excludedChunkIds）
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

    -- 远程知识源轻量索引
    CREATE TABLE IF NOT EXISTS kb_remote_index (
      id            TEXT PRIMARY KEY,
      source_type   TEXT NOT NULL,          -- 'github_repo' | 'onedrive' | 'sharepoint'
      remote_id     TEXT NOT NULL,          -- 平台侧 ID（GitHub: owner/repo path, OneDrive: fileId）
      name          TEXT NOT NULL,
      url           TEXT,
      metadata      TEXT,                   -- JSON: { owner, repo, branch, path, mimeType, size, lastModified }
      content_hash  TEXT,                   -- 内容 hash（用于增量同步判断）
      indexed_at    TEXT,                   -- 最后索引时间
      chunk_count   INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'indexed'  -- 'indexed' | 'syncing' | 'error'
    );
    CREATE INDEX IF NOT EXISTS idx_remote_source_type ON kb_remote_index(source_type);
    CREATE INDEX IF NOT EXISTS idx_remote_remote_id ON kb_remote_index(remote_id);

    -- 同步任务管理
    CREATE TABLE IF NOT EXISTS kb_sync_jobs (
      id            TEXT PRIMARY KEY,
      source_type   TEXT NOT NULL,          -- 'github_repo' | 'onedrive'
      config        TEXT NOT NULL,           -- JSON: { owner, repo, branch } 或 { folderId }
      status        TEXT DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'error'
      progress      TEXT,                   -- JSON: { total, processed, skipped, errors }
      last_sync_at  TEXT,
      error_message TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sync_source_type ON kb_sync_jobs(source_type);
    CREATE INDEX IF NOT EXISTS idx_sync_status ON kb_sync_jobs(status);

    -- 生成树（段落级来源追溯）
    CREATE TABLE IF NOT EXISTS provenance_nodes (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      paragraph_idx  INTEGER NOT NULL,
      chunk_id       TEXT,
      web_url        TEXT,
      web_title      TEXT,
      web_snippet    TEXT,
      score          REAL DEFAULT 0,
      is_manual      INTEGER DEFAULT 0,
      parent_id      TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

  // 增量迁移：generation_runs 添加 document_style 列
  try {
    const runCols = db.prepare("PRAGMA table_info(generation_runs)").all() as Array<{ name: string }>;
    const runColNames = new Set(runCols.map((c) => c.name));
    if (!runColNames.has("document_style")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN document_style TEXT");
      logger.info("[DB] Migration: added generation_runs.document_style");
    }
  } catch (e) {
    // 表可能还不存在，CREATE TABLE 已经处理了
  }

  // 增量迁移：provenance_nodes 添加 paragraph_title、grounding_score 和 web search 列
  try {
    const provCols = db.prepare("PRAGMA table_info(provenance_nodes)").all() as Array<{ name: string }>;
    const provColNames = new Set(provCols.map((c) => c.name));
    if (!provColNames.has("paragraph_title")) {
      db.exec("ALTER TABLE provenance_nodes ADD COLUMN paragraph_title TEXT");
      logger.info("[DB] Migration: added provenance_nodes.paragraph_title");
    }
    if (!provColNames.has("grounding_score")) {
      db.exec("ALTER TABLE provenance_nodes ADD COLUMN grounding_score REAL");
      logger.info("[DB] Migration: added provenance_nodes.grounding_score");
    }
    if (!provColNames.has("web_url")) {
      db.exec("ALTER TABLE provenance_nodes ADD COLUMN web_url TEXT");
      logger.info("[DB] Migration: added provenance_nodes.web_url");
    }
    if (!provColNames.has("web_title")) {
      db.exec("ALTER TABLE provenance_nodes ADD COLUMN web_title TEXT");
      logger.info("[DB] Migration: added provenance_nodes.web_title");
    }
    if (!provColNames.has("web_snippet")) {
      db.exec("ALTER TABLE provenance_nodes ADD COLUMN web_snippet TEXT");
      logger.info("[DB] Migration: added provenance_nodes.web_snippet");
    }
  } catch (e) {
    // 表可能还不存在，CREATE TABLE 已经处理了
  }

  // 增量迁移：generation_runs 添加 conflict_resolution 列（Bug 4 fix：持久化冲突解决结果）
  try {
    const runCols2 = db.prepare("PRAGMA table_info(generation_runs)").all() as Array<{ name: string }>;
    const runColNames2 = new Set(runCols2.map((c) => c.name));
    if (!runColNames2.has("conflict_resolution")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN conflict_resolution TEXT");
      logger.info("[DB] Migration: added generation_runs.conflict_resolution");
    }
    if (!runColNames2.has("excel_payload")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN excel_payload TEXT");
      logger.info("[DB] Migration: added generation_runs.excel_payload");
    }
    if (!runColNames2.has("progress_json")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN progress_json TEXT");
      logger.info("[DB] Migration: added generation_runs.progress_json");
    }
    if (!runColNames2.has("word_payload")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN word_payload TEXT");
      logger.info("[DB] Migration: added generation_runs.word_payload");
    }
    if (!runColNames2.has("ppt_payload")) {
      db.exec("ALTER TABLE generation_runs ADD COLUMN ppt_payload TEXT");
      logger.info("[DB] Migration: added generation_runs.ppt_payload");
    }
  } catch (e) {
    // 表可能还不存在，CREATE TABLE 已经处理了
  }

  // 设置版本号
  if (versionRow < 6) {
    db.pragma("user_version = 6");
  }

  // ── 种子数据：当前用户（黄薇）──
  seedCurrentUser(db);

  logger.info(`[DB] Migration 完成, version=4`);
}

/** 首次启动时自动创建当前用户到 People Graph + sender_profile */
function seedCurrentUser(db: Database.Database): void {
  const SENDER_ID = "current-user";
  const SENDER_NAME = "黄薇";

  // 检查是否已有 sender_profile
  const existingProfile = db.prepare("SELECT value FROM user_settings WHERE key = 'sender_profile'").get() as { value: string } | undefined;

  // 检查 people 表是否已有此人（按姓名匹配）
  const existingPerson = db.prepare("SELECT id FROM people WHERE name = ?").get(SENDER_NAME) as { id: string } | undefined;

  if (existingPerson) {
    // 已有同名 person（可能来自 Entra 同步），标记为当前用户
    const attrs = db.prepare("SELECT attributes FROM people WHERE id = ?").get(existingPerson.id) as { attributes: string | null } | undefined;
    let parsed: Record<string, unknown> = {};
    try { parsed = attrs?.attributes ? JSON.parse(attrs.attributes) : {}; } catch { /* ignore */ }
    parsed.isCurrentUser = true;
    db.prepare("UPDATE people SET attributes = ? WHERE id = ?").run(JSON.stringify(parsed), existingPerson.id);
    logger.info(`[DB] 种子数据: 标记已有用户 ${SENDER_NAME} 为当前用户`);
  } else if (!existingProfile) {
    // 无同名 person 且从未初始化过 —— 创建种子用户
    db.prepare(`INSERT OR REPLACE INTO people (id, name, title, department, email, attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
      .run(SENDER_ID, SENDER_NAME, null, null, null, JSON.stringify({ isCurrentUser: true }));
    logger.info(`[DB] 种子数据: 创建当前用户 ${SENDER_NAME}（People Graph）`);
  }

  // 写入 sender_profile（仅首次）
  if (!existingProfile) {
    db.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))")
      .run("sender_profile", JSON.stringify({ name: SENDER_NAME }));
    logger.info(`[DB] 种子数据: 创建 sender_profile（${SENDER_NAME}）`);
  }
}