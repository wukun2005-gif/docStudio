/**
 * 知识源连接器 API 路由
 *
 * Feature #28-33: MS OAuth, OneDrive, GitHub, arXiv, Outlook, Teams
 */
import { Router } from "express";
import crypto from "node:crypto";
import { listOneDriveFiles, downloadOneDriveFile, listOutlookEmails, listTeamsChats, listCalendarEvents, importFromMsGraph } from "../lib/connectors/msGraph.js";
import { listRepos, listIssues, listPRs, listCommits, importFromGitHub } from "../lib/connectors/github.js";
import { searchArxiv, importFromArxiv } from "../lib/connectors/arxiv.js";
import {
  getMsGraphAppConfig, saveMsGraphAppConfig, saveMsGraphTokens,
  getAuthUrl, exchangeCodeForTokens, getValidAccessToken,
  getConnectionStatus, clearMsGraphTokens,
} from "../lib/connectors/msGraphOAuth.js";
import { logger } from "../lib/logger.js";

export const connectorsRouter = Router();

// ── MS Graph OAuth ───────────────────────────────────

/** 临时 state 存储（防 CSRF） */
const pendingStates = new Map<string, { redirectUri: string; createdAt: number }>();
// 清理超过 10 分钟的 state
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
  }
}, 60_000);

/** GET /api/connectors/msgraph/status — 获取连接状态 */
connectorsRouter.get("/msgraph/status", (_req, res) => {
  const status = getConnectionStatus();
  res.json({ ok: true, ...status });
});

/** GET /api/connectors/msgraph/auth — 生成 OAuth 授权 URL */
connectorsRouter.get("/msgraph/auth", (req, res) => {
  const config = getMsGraphAppConfig();
  if (!config) {
    res.status(400).json({ ok: false, error: "请先在设置中配置 Azure 应用信息（Client ID、Client Secret、Tenant ID）" });
    return;
  }

  const protocol = req.protocol;
  const host = req.get("host");
  const redirectUri = `${protocol}://${host}/api/connectors/msgraph/callback`;
  const state = crypto.randomUUID();

  pendingStates.set(state, { redirectUri, createdAt: Date.now() });

  const url = getAuthUrl(config, redirectUri, state);
  res.json({ ok: true, url });
});

/** GET /api/connectors/msgraph/callback — OAuth 回调处理 */
connectorsRouter.get("/msgraph/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  if (error) {
    const desc = req.query.error_description as string | undefined;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(callbackHtml(false, `授权失败: ${error} - ${desc ?? ""}`));
    return;
  }

  if (!code || !state) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(callbackHtml(false, "缺少 code 或 state 参数"));
    return;
  }

  const pending = pendingStates.get(state);
  if (!pending) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(callbackHtml(false, "无效或过期的 state，请重新授权"));
    return;
  }
  pendingStates.delete(state);

  const config = getMsGraphAppConfig();
  if (!config) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(callbackHtml(false, "Azure 应用配置丢失"));
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(config, code, pending.redirectUri);
    saveMsGraphTokens(tokens);
    logger.info(`[Connectors] MS Graph OAuth 成功: ${tokens.userDisplayName} (${tokens.userEmail})`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(callbackHtml(true, `连接成功：${tokens.userDisplayName ?? tokens.userEmail ?? "Microsoft 账户"}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Connectors] MS Graph OAuth 失败: ${msg}`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(callbackHtml(false, `Token 交换失败: ${msg}`));
  }
});

/** POST /api/connectors/msgraph/disconnect — 断开连接 */
connectorsRouter.post("/msgraph/disconnect", (_req, res) => {
  clearMsGraphTokens();
  res.json({ ok: true });
});

/** POST /api/connectors/msgraph/config — 保存 Azure 应用配置 */
connectorsRouter.post("/msgraph/config", (req, res) => {
  const { clientId, clientSecret, tenantId } = req.body;
  if (!clientId || !tenantId) {
    res.status(400).json({ ok: false, error: "clientId 和 tenantId 是必填项" });
    return;
  }
  // 如果 clientSecret 为空，说明用户没有修改，保留原有值
  const existing = getMsGraphAppConfig();
  const secretToSave = clientSecret || existing?.clientSecret;
  if (!secretToSave) {
    res.status(400).json({ ok: false, error: "首次配置时 clientSecret 是必填项" });
    return;
  }
  saveMsGraphAppConfig({ clientId, clientSecret: secretToSave, tenantId });
  res.json({ ok: true });
});

/** GET /api/connectors/msgraph/config — 读取 Azure 应用配置（脱敏） */
connectorsRouter.get("/msgraph/config", (_req, res) => {
  const config = getMsGraphAppConfig();
  if (!config) {
    res.json({ ok: true, configured: false });
    return;
  }
  res.json({
    ok: true,
    configured: true,
    clientId: config.clientId,
    tenantId: config.tenantId,
    clientSecret: "••••••••", // 脱敏
  });
});

/** OAuth 回调 HTML 页面 */
function callbackHtml(success: boolean, message: string): string {
  // Note: res.send(html) should set Content-Type: text/html automatically
  // but we'll be explicit in the caller
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OneDrive 授权</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .box { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  .msg { font-size: 16px; color: ${success ? "#16a34a" : "#dc2626"}; }
</style></head>
<body>
<div class="box">
  <div class="icon">${success ? "✅" : "❌"}</div>
  <div class="msg">${message}</div>
  <p style="color:#888;margin-top:16px;font-size:13px;">此窗口可关闭</p>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "msgraph-auth-${success ? "success" : "error"}", message: "${message.replace(/"/g, '\\"')}" }, "*");
  }
  setTimeout(() => window.close(), 2000);
</script>
</body></html>`;
}

// ── Microsoft Graph ────────────────────────────────────

/** POST /api/connectors/msgraph/onedrive — 列出 OneDrive 文件 */
connectorsRouter.post("/msgraph/onedrive", async (req, res) => {
  try {
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 OneDrive，请先完成 OAuth 授权" });
      return;
    }
    const files = await listOneDriveFiles({ accessToken: token });
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
    const { fileId } = req.body;
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token || !fileId) {
      res.status(400).json({ ok: false, error: "未连接 OneDrive 或缺少 fileId" });
      return;
    }
    const content = await downloadOneDriveFile({ accessToken: token }, fileId);
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
    const { top, filter } = req.body;
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户" });
      return;
    }
    const emails = await listOutlookEmails({ accessToken: token }, { top, filter });
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
    const { top } = req.body;
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户" });
      return;
    }
    const chats = await listTeamsChats({ accessToken: token }, { top });
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
    const { top, startDateTime, endDateTime } = req.body;
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户" });
      return;
    }
    const events = await listCalendarEvents({ accessToken: token }, { top, startDateTime, endDateTime });
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
    const { sources } = req.body;
    const token = req.body.accessToken || await getValidAccessToken();
    if (!token || !sources) {
      res.status(400).json({ ok: false, error: "未连接 Microsoft 账户或缺少 sources" });
      return;
    }
    const results = await importFromMsGraph({ accessToken: token }, sources);
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
