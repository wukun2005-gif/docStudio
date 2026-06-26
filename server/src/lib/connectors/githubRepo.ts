/**
 * GitHub Repo 本地 Clone 连接器
 *
 * 将 GitHub repo clone 到本地，做全量切片和向量化。
 * 支持增量同步（git pull + diff → 只处理变化的文件）。
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

// ── 配置 ────────────────────────────────────────────────

const REPOS_DIR = process.env.REPOS_DIR ?? path.resolve(process.cwd(), "repos");

/** 支持索引的文件扩展名 */
const INDEXABLE_EXTENSIONS = new Set([
  // 文档
  ".md", ".txt", ".rst", ".docx", ".pdf", ".html", ".htm",
  // 代码
  ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml",
  ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".swift", ".kt", ".scala", ".sh", ".bash",
  ".sql", ".graphql", ".proto",
  // 配置
  ".toml", ".ini", ".cfg", ".conf", ".env.example",
]);

/** 排除的目录 */
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "vendor",
  "__pycache__", ".venv", "venv", "env", ".tox",
  "target", "bin", "obj", ".gradle", ".maven",
  "coverage", ".nyc_output", ".cache",
]);

/** 单文件大小限制：500KB */
const MAX_FILE_SIZE = 500 * 1024;

// ── 类型定义 ────────────────────────────────────────────

export interface RepoFileInfo {
  /** 相对于 repo 根目录的路径 */
  relativePath: string;
  /** 绝对路径 */
  absolutePath: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件扩展名 */
  extension: string;
  /** 是否为代码文件 */
  isCode: boolean;
}

export interface CloneResult {
  /** repo 本地目录 */
  repoDir: string;
  /** 是否为新 clone（false = 已存在，跳过） */
  cloned: boolean;
  /** 文件总数 */
  fileCount: number;
}

export interface SyncResult {
  /** 变化的文件列表 */
  changedFiles: string[];
  /** 新增的文件列表 */
  addedFiles: string[];
  /** 删除的文件列表 */
  deletedFiles: string[];
  /** 是否有变化 */
  hasChanges: boolean;
}

// ── 核心函数 ────────────────────────────────────────────

/**
 * Clone 一个 GitHub repo 到本地
 *
 * @param owner GitHub 用户名或组织名
 * @param repo 仓库名
 * @param branch 分支名（默认 main）
 * @param force 是否强制重新 clone
 */
export async function cloneRepo(
  owner: string,
  repo: string,
  branch: string = "main",
  force: boolean = false,
): Promise<CloneResult> {
  const repoDir = getRepoDir(owner, repo);

  // 如果已存在且不强制，跳过 clone
  if (fs.existsSync(repoDir) && !force) {
    logger.info(`[GitHubRepo] Repo 已存在，跳过 clone: ${owner}/${repo}`);
    const files = listRepoFiles(repoDir);
    return { repoDir, cloned: false, fileCount: files.length };
  }

  // 确保 repos 目录存在
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  // 如果强制重新 clone，先删除旧目录
  if (force && fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  logger.info(`[GitHubRepo] 开始 clone: ${cloneUrl} (branch: ${branch})`);

  try {
    await execFileAsync("git", [
      "clone",
      "--depth", "1",           // 浅 clone，只取最新版本
      "--branch", branch,
      "--single-branch",        // 只 clone 指定分支
      "--no-tags",              // 不 clone tags
      cloneUrl,
      repoDir,
    ], { timeout: 120_000 });   // 2 分钟超时

    logger.info(`[GitHubRepo] Clone 完成: ${owner}/${repo}`);
    const files = listRepoFiles(repoDir);
    return { repoDir, cloned: true, fileCount: files.length };
  } catch (err) {
    // 清理失败的 clone 目录
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    throw new Error(`Clone 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 列出 repo 中所有可索引的文件
 */
export function listRepoFiles(repoDir: string): RepoFileInfo[] {
  const files: RepoFileInfo[] = [];

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过排除的目录
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walkDir(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!INDEXABLE_EXTENSIONS.has(ext)) continue;

      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      if (stat.size === 0) continue;

      const relativePath = path.relative(repoDir, fullPath);
      files.push({
        relativePath,
        absolutePath: fullPath,
        size: stat.size,
        extension: ext,
        isCode: isCodeExtension(ext),
      });
    }
  }

  walkDir(repoDir);
  return files;
}

/**
 * 读取文件内容
 * - 文本文件返回 string
 * - 二进制文件（docx/pdf）返回 Buffer
 */
export function readFileContent(
  filePath: string,
  encoding: "utf-8" | "buffer" = "utf-8",
): string | Buffer {
  if (encoding === "buffer") {
    return fs.readFileSync(filePath);
  }
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * 计算文件内容的 hash
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * 增量同步：git pull + diff
 *
 * @returns 变化的文件列表（相对于 repo 根目录的路径）
 */
export async function syncRepo(
  owner: string,
  repo: string,
  branch: string = "main",
): Promise<SyncResult> {
  const repoDir = getRepoDir(owner, repo);

  if (!fs.existsSync(repoDir)) {
    throw new Error(`Repo 目录不存在: ${repoDir}，请先 clone`);
  }

  logger.info(`[GitHubRepo] 开始同步: ${owner}/${repo}`);

  try {
    // 记录同步前的 HEAD
    const { stdout: oldHead } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const oldHeadSha = oldHead.trim();

    // git fetch + reset（浅 clone 不能用 pull）
    await execFileAsync("git", ["fetch", "origin", branch, "--depth", "1"], { cwd: repoDir, timeout: 60_000 });
    await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], { cwd: repoDir });

    // 获取新的 HEAD
    const { stdout: newHead } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const newHeadSha = newHead.trim();

    // 如果 HEAD 没变，没有新提交
    if (oldHeadSha === newHeadSha) {
      logger.info(`[GitHubRepo] 无新提交: ${owner}/${repo}`);
      return { changedFiles: [], addedFiles: [], deletedFiles: [], hasChanges: false };
    }

    // 获取变化的文件列表
    const { stdout: diffOutput } = await execFileAsync("git", [
      "diff", "--name-status", oldHeadSha, newHeadSha,
    ], { cwd: repoDir });

    const changedFiles: string[] = [];
    const addedFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const line of diffOutput.split("\n")) {
      if (!line.trim()) continue;
      const [status, filePath] = line.split("\t");
      if (!filePath) continue;

      switch (status) {
        case "M":
          changedFiles.push(filePath);
          break;
        case "A":
          addedFiles.push(filePath);
          break;
        case "D":
          deletedFiles.push(filePath);
          break;
        default:
          // R (rename), C (copy) 等
          changedFiles.push(filePath);
      }
    }

    logger.info(`[GitHubRepo] 同步完成: ${owner}/${repo}, ${changedFiles.length} 修改, ${addedFiles.length} 新增, ${deletedFiles.length} 删除`);

    return {
      changedFiles,
      addedFiles,
      deletedFiles,
      hasChanges: changedFiles.length + addedFiles.length + deletedFiles.length > 0,
    };
  } catch (err) {
    throw new Error(`同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 获取 repo 的本地目录路径
 */
export function getRepoDir(owner: string, repo: string): string {
  return path.join(REPOS_DIR, `${owner}_${repo}`);
}

/**
 * 检查 repo 是否已 clone
 */
export function isRepoCloned(owner: string, repo: string): boolean {
  const repoDir = getRepoDir(owner, repo);
  return fs.existsSync(path.join(repoDir, ".git"));
}

/**
 * 删除本地 clone 的 repo
 */
export function removeRepo(owner: string, repo: string): void {
  const repoDir = getRepoDir(owner, repo);
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    logger.info(`[GitHubRepo] 已删除 repo 目录: ${repoDir}`);
  }
}

/**
 * 获取 repo 的当前 HEAD commit SHA
 */
export async function getRepoHead(owner: string, repo: string): Promise<string> {
  const repoDir = getRepoDir(owner, repo);
  if (!fs.existsSync(repoDir)) return "";
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    return stdout.trim();
  } catch {
    return "";
  }
}

// ── 辅助函数 ────────────────────────────────────────────

function isCodeExtension(ext: string): boolean {
  const codeExts = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs",
    ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".kt",
    ".scala", ".sh", ".bash", ".sql", ".graphql", ".proto",
  ]);
  return codeExts.has(ext);
}
