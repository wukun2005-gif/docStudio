/**
 * 知识源连接器 API 路由
 *
 * Feature #28-33: MS OAuth, OneDrive, GitHub, arXiv, Outlook, Teams
 */
import { Router } from "express";
import { listOneDriveFiles, downloadOneDriveFile, listOutlookEmails, listTeamsChats, listCalendarEvents, importFromMsGraph } from "../lib/connectors/msGraph.js";
import { listRepos, listIssues, listPRs, listCommits, importFromGitHub } from "../lib/connectors/github.js";
import { searchArxiv, importFromArxiv } from "../lib/connectors/arxiv.js";
import { logger } from "../lib/logger.js";

export const connectorsRouter = Router();

// ── Microsoft Graph ────────────────────────────────────

/** POST /api/connectors/msgraph/onedrive — 列出 OneDrive 文件 */
connectorsRouter.post("/msgraph/onedrive", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "accessToken is required" });
      return;
    }
    const files = await listOneDriveFiles({ accessToken });
    res.json({ ok: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] OneDrive error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/msgraph/onedrive/download — 下载 OneDrive 文件 */
connectorsRouter.post("/msgraph/onedrive/download", async (req, res) => {
  try {
    const { accessToken, fileId } = req.body;
    if (!accessToken || !fileId) {
      res.status(400).json({ ok: false, error: "accessToken and fileId are required" });
      return;
    }
    const content = await downloadOneDriveFile({ accessToken }, fileId);
    res.json({ ok: true, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] OneDrive download error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/msgraph/outlook — 列出 Outlook 邮件 */
connectorsRouter.post("/msgraph/outlook", async (req, res) => {
  try {
    const { accessToken, top, filter } = req.body;
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "accessToken is required" });
      return;
    }
    const emails = await listOutlookEmails({ accessToken }, { top, filter });
    res.json({ ok: true, emails });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] Outlook error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/msgraph/teams — 列出 Teams 聊天 */
connectorsRouter.post("/msgraph/teams", async (req, res) => {
  try {
    const { accessToken, top } = req.body;
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "accessToken is required" });
      return;
    }
    const chats = await listTeamsChats({ accessToken }, { top });
    res.json({ ok: true, chats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] Teams error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/msgraph/calendar — 列出日历事件 */
connectorsRouter.post("/msgraph/calendar", async (req, res) => {
  try {
    const { accessToken, top, startDateTime, endDateTime } = req.body;
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "accessToken is required" });
      return;
    }
    const events = await listCalendarEvents({ accessToken }, { top, startDateTime, endDateTime });
    res.json({ ok: true, events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] Calendar error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/msgraph/import — 批量导入 */
connectorsRouter.post("/msgraph/import", async (req, res) => {
  try {
    const { accessToken, sources } = req.body;
    if (!accessToken || !sources) {
      res.status(400).json({ ok: false, error: "accessToken and sources are required" });
      return;
    }
    const results = await importFromMsGraph({ accessToken }, sources);
    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] MS Graph import error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── GitHub ─────────────────────────────────────────────

/** POST /api/connectors/github/repos — 列出 GitHub repos */
connectorsRouter.post("/github/repos", async (req, res) => {
  try {
    const { token, owner, perPage } = req.body;
    if (!token) {
      res.status(400).json({ ok: false, error: "token is required" });
      return;
    }
    const repos = await listRepos({ token }, { owner, perPage });
    res.json({ ok: true, repos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] GitHub repos error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/github/issues — 列出 GitHub Issues */
connectorsRouter.post("/github/issues", async (req, res) => {
  try {
    const { token, owner, repo, state, perPage } = req.body;
    if (!token || !owner || !repo) {
      res.status(400).json({ ok: false, error: "token, owner, repo are required" });
      return;
    }
    const issues = await listIssues({ token }, owner, repo, { state, perPage });
    res.json({ ok: true, issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] GitHub issues error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/github/prs — 列出 GitHub PRs */
connectorsRouter.post("/github/prs", async (req, res) => {
  try {
    const { token, owner, repo, state, perPage } = req.body;
    if (!token || !owner || !repo) {
      res.status(400).json({ ok: false, error: "token, owner, repo are required" });
      return;
    }
    const prs = await listPRs({ token }, owner, repo, { state, perPage });
    res.json({ ok: true, prs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] GitHub PRs error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/github/commits — 列出 GitHub Commits */
connectorsRouter.post("/github/commits", async (req, res) => {
  try {
    const { token, owner, repo, since, perPage } = req.body;
    if (!token || !owner || !repo) {
      res.status(400).json({ ok: false, error: "token, owner, repo are required" });
      return;
    }
    const commits = await listCommits({ token }, owner, repo, { since, perPage });
    res.json({ ok: true, commits });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] GitHub commits error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/github/import — 批量导入 */
connectorsRouter.post("/github/import", async (req, res) => {
  try {
    const { token, repos } = req.body;
    if (!token || !repos) {
      res.status(400).json({ ok: false, error: "token and repos are required" });
      return;
    }
    const results = await importFromGitHub({ token }, repos);
    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] GitHub import error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── arXiv ──────────────────────────────────────────────

/** POST /api/connectors/arxiv/search — 搜索 arXiv 论文 */
connectorsRouter.post("/arxiv/search", async (req, res) => {
  try {
    const { query, maxResults, sortBy } = req.body;
    if (!query) {
      res.status(400).json({ ok: false, error: "query is required" });
      return;
    }
    const papers = await searchArxiv(query, { maxResults, sortBy });
    res.json({ ok: true, papers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] arXiv search error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/connectors/arxiv/import — 批量导入 arXiv 论文 */
connectorsRouter.post("/arxiv/import", async (req, res) => {
  try {
    const { queries, maxResultsPerQuery } = req.body;
    if (!queries) {
      res.status(400).json({ ok: false, error: "queries is required" });
      return;
    }
    const results = await importFromArxiv(queries, maxResultsPerQuery);
    res.json({ ok: true, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] arXiv import error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});
