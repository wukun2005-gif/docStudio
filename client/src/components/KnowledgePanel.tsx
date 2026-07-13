import { useEffect, useState, useRef } from "react";
import PeoplePanel from "./PeoplePanel";

type TabId = "sources" | "code" | "remote" | "people" | "outlook";

const tabs: { id: TabId; label: string; demoId: string }[] = [
  { id: "sources", label: "本地文档", demoId: "demo-kb-tab-sources" },
  { id: "code", label: "远程 GitHub Repo", demoId: "demo-kb-tab-code" },
  { id: "remote", label: "远程文档", demoId: "demo-kb-tab-remote" },
  { id: "people", label: "People Graph", demoId: "demo-kb-tab-people" },
  { id: "outlook", label: "Outlook 邮件", demoId: "demo-kb-tab-outlook" },
];

interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  chunkCount: number;
  status: string;
  createdAt: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  language: string;
  stargazersCount: number;
  updatedAt: string;
}

interface SyncJob {
  id: string;
  sourceType: string;
  config: Record<string, unknown>;
  status: string;
  progress?: { total: number; processed: number; skipped: number; errors: number };
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
}

interface IndexedRepo {
  owner: string;
  repo: string;
  fileCount: number;
  totalChunks: number;
  lastIndexed: string;
}

export default function KnowledgePanel() {
  const [activeTab, setActiveTab] = useState<TabId>("sources");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub 代码 tab 状态
  const [githubToken, setGithubToken] = useState("");
  const [githubSaved, setGithubSaved] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);
  const [connectedRepos, setConnectedRepos] = useState<string[]>([]);

  // GitHub 同步状态
  const [indexedRepos, setIndexedRepos] = useState<IndexedRepo[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<Record<string, { total: number; processed: number; skipped: number; errors: number }>>({});
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // OneDrive 状态
  const [onedriveFiles, setOnedriveFiles] = useState<any[]>([]);
  const [onedriveLoading, setOnedriveLoading] = useState(false);
  const [onedriveError, setOnedriveError] = useState<string | null>(null);

  const [msGraphStatus, setMsGraphStatus] = useState<{ connected: boolean; userDisplayName?: string; userEmail?: string; hasAppConfig: boolean } | null>(null);

  // Outlook KB 状态
  const [outlookEmailEnabled, setOutlookEmailEnabled] = useState(false);
  const [outlookContactEnabled, setOutlookContactEnabled] = useState(false);
  const [outlookSyncing, setOutlookSyncing] = useState<string | null>(null);
  const [outlookProgress, setOutlookProgress] = useState<Record<string, { total: number; processed: number; skipped: number; errors: number }>>({});
  const [outlookStatus, setOutlookStatus] = useState<{
    email?: { count: number; totalChunks: number };
    contact?: { count: number; totalChunks: number };
  } | null>(null);
  const [outlookEmails, setOutlookEmails] = useState<any[]>([]);
  const [outlookContacts, setOutlookContacts] = useState<any[]>([]);
  const outlookPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadData();
    loadGithubConfig();
    loadIndexedRepos();
    loadMsGraphStatus();
    loadOutlookStatus();
    loadOutlookLists();
  }, []);

  // 监听 OAuth 弹窗回调
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "msgraph-auth-success") {
        loadMsGraphStatus();
        loadOnedriveFiles();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function loadData() {
    try {
      const res = await fetch("/api/knowledge/sources").then((r) => r.json());
      if (res.ok) {
        // 本地文档 tab 只显示非 GitHub 来源的文件
        const localSources = res.sources.filter((s: KnowledgeSource) => s.type !== "github_file");
        setSources(localSources);
      }
    } catch (err) {
      console.error("Failed to load knowledge data:", err);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.ok) {
        const okCount = data.results.filter((r: any) => r.status === "ok").length;
        const dupCount = data.results.filter((r: any) => r.status === "duplicate").length;
        setMessage(`上传成功: ${okCount} 个文件${dupCount > 0 ? `, ${dupCount} 个重复跳过` : ""}`);
        loadData();
      } else {
        setMessage(`上传失败: ${data.error}`);
      }
    } catch (err) {
      setMessage(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除 "${name}"？`)) return;
    try {
      await fetch(`/api/knowledge/sources/${id}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  // ── GitHub 相关 ──────────────────────────────────────

  async function loadGithubConfig() {
    try {
      const res = await fetch("/api/settings/connector_github");
      const data = await res.json();
      if (data.ok && data.value) {
        if (data.value.token) {
          setGithubToken(data.value.token);
          setGithubSaved(true);
        }
        if (Array.isArray(data.value.repos)) {
          setConnectedRepos(data.value.repos);
        }
      }
    } catch {
      // ignore
    }
  }

  async function saveGithubConfig(token: string, repos: string[]) {
    await fetch("/api/settings/connector_github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { token, repos } }),
    });
  }

  async function handleSaveGithubToken() {
    if (!githubToken.trim()) return;
    try {
      await saveGithubConfig(githubToken.trim(), connectedRepos);
      setGithubSaved(true);
      setGithubError(null);
    } catch (err) {
      setGithubError(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleVerifyGithub() {
    setGithubLoading(true);
    setGithubError(null);
    setGithubRepos([]);
    setSelectedRepos(new Set());

    try {
      const res = await fetch("/api/connectors/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubToken.trim(), perPage: 50 }),
      });
      const data = await res.json();
      if (data.ok) {
        setGithubRepos(data.repos);
      } else {
        setGithubError(data.error || "连接失败");
      }
    } catch (err) {
      setGithubError(`验证失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGithubLoading(false);
    }
  }

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function handleConnectGithub() {
    if (selectedRepos.size === 0) return;
    setConnecting(true);
    setGithubError(null);

    try {
      // 合并已连接的和新选中的，去重
      const merged = Array.from(new Set([...connectedRepos, ...selectedRepos]));
      await saveGithubConfig(githubToken.trim(), merged);
      setConnectedRepos(merged);
      setSelectedRepos(new Set());
    } catch (err) {
      setGithubError(`连接失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnectRepo(repo: string) {
    const updated = connectedRepos.filter((r) => r !== repo);
    try {
      await saveGithubConfig(githubToken.trim(), updated);
      setConnectedRepos(updated);
    } catch (err) {
      setGithubError(`断开失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── GitHub 同步 ────────────────────────────────────────

  async function loadIndexedRepos() {
    try {
      const res = await fetch("/api/knowledge/github/repos");
      const data = await res.json();
      if (data.ok) {
        setIndexedRepos(data.repos);
      }
    } catch {
      // ignore
    }
  }

  async function handleSyncRepo(owner: string, repo: string) {
    const key = `${owner}/${repo}`;
    setSyncing(key);
    setGithubError(null);
    setSyncProgress((prev) => ({ ...prev, [key]: { total: 0, processed: 0, skipped: 0, errors: 0 } }));

    try {
      const res = await fetch("/api/knowledge/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      });
      const data = await res.json();
      if (data.ok) {
        pollSyncStatus(data.jobId, key);
      } else {
        setGithubError(`同步失败: ${data.error}`);
        setSyncing(null);
      }
    } catch (err) {
      setGithubError(`同步失败: ${err instanceof Error ? err.message : String(err)}`);
      setSyncing(null);
    }
  }

  async function handleIncrementalSync(owner: string, repo: string) {
    const key = `${owner}/${repo}`;
    setSyncing(key);
    setGithubError(null);
    setSyncProgress((prev) => ({ ...prev, [key]: { total: 0, processed: 0, skipped: 0, errors: 0 } }));

    try {
      const res = await fetch("/api/knowledge/github/sync/incremental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      });
      const data = await res.json();
      if (data.ok) {
        pollSyncStatus(data.jobId, key);
      } else {
        setGithubError(`增量同步失败: ${data.error}`);
        setSyncing(null);
      }
    } catch (err) {
      setGithubError(`增量同步失败: ${err instanceof Error ? err.message : String(err)}`);
      setSyncing(null);
    }
  }

  function pollSyncStatus(jobId: string, repoKey: string) {
    const poll = async () => {
      try {
        const res = await fetch(`/api/knowledge/sync/job/${jobId}`);
        const data = await res.json();
        if (data.ok && data.job) {
          const job = data.job;
          // 更新进度
          if (job.progress) {
            setSyncProgress((prev) => ({ ...prev, [repoKey]: job.progress }));
          }

          if (job.status === "completed") {
            setSyncing(null);
            setSyncProgress((prev) => {
              const next = { ...prev };
              delete next[repoKey];
              return next;
            });
            setMessage(`✅ ${repoKey} 同步完成: ${job.progress?.processed ?? 0} 个文件已处理`);
            loadIndexedRepos();
            loadData();
            return;
          }
          if (job.status === "error") {
            setSyncing(null);
            setSyncProgress((prev) => {
              const next = { ...prev };
              delete next[repoKey];
              return next;
            });
            setGithubError(`同步失败: ${job.errorMessage}`);
            return;
          }
        }
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(poll, 1500);
      } catch {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(poll, 1000);
  }

  async function handleDeleteRepo(owner: string, repo: string) {
    if (!confirm(`确定删除 ${owner}/${repo} 的所有索引数据？`)) return;

    try {
      const res = await fetch("/api/knowledge/github/repo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(`已删除 ${owner}/${repo}，${data.deletedFiles} 个索引文件`);
        loadIndexedRepos();
        loadData();
      }
    } catch (err) {
      setGithubError(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── OneDrive ───────────────────────────────────────────

  async function loadMsGraphStatus() {
    try {
      const res = await fetch("/api/connectors/msgraph/status");
      const data = await res.json();
      if (data.ok) {
        setMsGraphStatus(data);
        if (data.connected) {
          loadOnedriveFiles();
        }
      }
    } catch {
      // ignore
    }
  }

  async function loadOnedriveFiles() {
    setOnedriveLoading(true);
    setOnedriveError(null);
    try {
      const res = await fetch("/api/connectors/msgraph/onedrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        setOnedriveFiles(data.files);
      } else {
        setOnedriveError(data.error || "加载失败");
      }
    } catch (err) {
      setOnedriveError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOnedriveLoading(false);
    }
  }

  async function handleConnectOnedrive() {
    setOnedriveError(null);
    try {
      const res = await fetch("/api/connectors/msgraph/auth");
      const data = await res.json();
      if (!data.ok) {
        setOnedriveError(data.error || "获取授权链接失败");
        return;
      }
      // 打开 OAuth 弹窗
      const width = 600, height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(data.url, "msgraph-auth", `width=${width},height=${height},left=${left},top=${top}`);
    } catch (err) {
      setOnedriveError(`连接失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDisconnectOnedrive() {
    try {
      await fetch("/api/connectors/msgraph/disconnect", { method: "POST" });
      setMsGraphStatus({ connected: false, hasAppConfig: true });
      setOnedriveFiles([]);
    } catch {
      // ignore
    }
  }

  // ── Outlook KB ──────────────────────────────────────────

  async function loadOutlookStatus() {
    try {
      const res = await fetch("/api/knowledge/outlook/status");
      const data = await res.json();
      if (data.ok) {
        setOutlookStatus(data);
      }
    } catch {
      // ignore
    }
  }

  async function loadOutlookLists() {
    try {
      const [emailRes, contactRes] = await Promise.all([
        fetch("/api/knowledge/outlook/email/list").then(r => r.json()),
        fetch("/api/knowledge/outlook/contact/list").then(r => r.json()),
      ]);
      if (emailRes.ok) setOutlookEmails(emailRes.emails);
      if (contactRes.ok) setOutlookContacts(contactRes.contacts);
    } catch {
      // ignore
    }
  }

  async function handleOutlookSync(sourceType: "email" | "contact") {
    if (!msGraphStatus?.connected) {
      setMessage("请先连接 Microsoft 账户");
      return;
    }

    const label = sourceType === "email" ? "邮件" : "联系人";
    const endpoint = `/api/knowledge/outlook/${sourceType}/sync`;
    const progressKey = `outlook_${sourceType}`;

    setOutlookSyncing(progressKey);
    setMessage(null);
    setOutlookProgress((prev) => ({ ...prev, [progressKey]: { total: 0, processed: 0, skipped: 0, errors: 0 } }));

    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (data.ok) {
        pollOutlookStatus(data.jobId, progressKey, label);
      } else {
        setOutlookSyncing(null);
        setMessage(`同步失败: ${data.error}`);
      }
    } catch (err) {
      setOutlookSyncing(null);
      setMessage(`同步失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function pollOutlookStatus(jobId: string, progressKey: string, label: string) {
    const poll = async () => {
      try {
        const res = await fetch(`/api/knowledge/sync/job/${jobId}`);
        const data = await res.json();
        if (data.ok && data.job) {
          const job = data.job;
          if (job.progress) {
            setOutlookProgress((prev) => ({ ...prev, [progressKey]: job.progress }));
          }
          if (job.status === "completed") {
            setOutlookSyncing(null);
            setOutlookProgress((prev) => {
              const next = { ...prev };
              delete next[progressKey];
              return next;
            });
            setMessage(`${label}同步完成: ${job.progress?.processed ?? 0} 条已处理`);
            loadOutlookStatus();
            loadOutlookLists();
            loadData();
            return;
          }
          if (job.status === "error") {
            setOutlookSyncing(null);
            setOutlookProgress((prev) => {
              const next = { ...prev };
              delete next[progressKey];
              return next;
            });
            setMessage(`同步失败: ${job.errorMessage}`);
            return;
          }
        }
        if (outlookPollRef.current) clearTimeout(outlookPollRef.current);
        outlookPollRef.current = setTimeout(poll, 2000);
      } catch {
        if (outlookPollRef.current) clearTimeout(outlookPollRef.current);
        outlookPollRef.current = setTimeout(poll, 3000);
      }
    };
    if (outlookPollRef.current) clearTimeout(outlookPollRef.current);
    outlookPollRef.current = setTimeout(poll, 1000);
  }

  async function handleClearOutlook(sourceType: "email" | "contact") {
    const label = sourceType === "email" ? "邮件" : "联系人";
    if (!confirm(`确定清除所有已索引的${label}？`)) return;
    try {
      const res = await fetch(`/api/knowledge/outlook/${sourceType}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setMessage(`已清除 ${data.deleted} 条${label}索引`);
        loadOutlookStatus();
        loadData();
      }
    } catch (err) {
      setMessage(`清除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className={activeTab === "people" ? "w-full" : "max-w-4xl mx-auto"}>
      <h2 className="text-2xl font-bold mb-6">知识库管理</h2>

      {/* Tab 切换 */}
      <div className="flex border-b mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tab.demoId}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* People Graph Tab */}
      {activeTab === "people" && <PeoplePanel />}

      {/* 代码 Tab */}
      {activeTab === "code" && (
      <div className="space-y-6">
        {/* 已索引的 Repo（带同步状态） */}
        {indexedRepos.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b font-medium">已索引的 Repo ({indexedRepos.length})</div>
            <div className="divide-y">
              {indexedRepos.map((repo) => {
                const repoKey = `${repo.owner}/${repo.repo}`;
                const progress = syncProgress[repoKey];
                const isSyncing = syncing === repoKey;
                return (
                  <div key={repoKey} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm">{repoKey}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleIncrementalSync(repo.owner, repo.repo)}
                          disabled={isSyncing}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 disabled:opacity-50"
                        >
                          {isSyncing ? "同步中..." : "增量同步"}
                        </button>
                        <button
                          onClick={() => handleSyncRepo(repo.owner, repo.repo)}
                          disabled={isSyncing}
                          className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 disabled:opacity-50"
                        >
                          全量重建
                        </button>
                        <button
                          onClick={() => handleDeleteRepo(repo.owner, repo.repo)}
                          className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 flex gap-4">
                      <span>📄 {repo.fileCount} 个文件</span>
                      <span>🧩 {repo.totalChunks} 个 chunks</span>
                      <span>🕐 最后索引: {new Date(repo.lastIndexed).toLocaleString()}</span>
                    </div>
                    {isSyncing && progress && progress.total > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>同步中...</span>
                          <span>{progress.processed + progress.skipped + progress.errors} / {progress.total}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${Math.round(((progress.processed + progress.skipped + progress.errors) / progress.total) * 100)}%` }}
                          />
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-gray-400">
                          <span>✅ {progress.processed}</span>
                          <span>⏭️ {progress.skipped}</span>
                          {progress.errors > 0 && <span>❌ {progress.errors}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 已连接但未索引的 Repo */}
        {connectedRepos.filter(r => !indexedRepos.some(ir => `${ir.owner}/${ir.repo}` === r)).length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b font-medium">已连接的 Repo（未索引）</div>
            <div className="divide-y">
              {connectedRepos
                .filter(r => !indexedRepos.some(ir => `${ir.owner}/${ir.repo}` === r))
                .map((repo) => {
                  const [owner, repoName] = repo.split("/");
                  const progress = syncProgress[repo];
                  const isSyncing = syncing === repo;
                  return (
                    <div key={repo} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">{repo}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSyncRepo(owner, repoName)}
                            disabled={isSyncing}
                            className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 disabled:opacity-50"
                          >
                            {isSyncing ? "索引中..." : "开始索引"}
                          </button>
                          <button
                            onClick={() => handleDisconnectRepo(repo)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            断开
                          </button>
                        </div>
                      </div>
                      {isSyncing && progress && progress.total > 0 && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>处理中...</span>
                            <span>{progress.processed + progress.skipped + progress.errors} / {progress.total}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${Math.round(((progress.processed + progress.skipped + progress.errors) / progress.total) * 100)}%` }}
                            />
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-gray-400">
                            <span>✅ {progress.processed}</span>
                            <span>⏭️ {progress.skipped}</span>
                            {progress.errors > 0 && <span>❌ {progress.errors}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* GitHub Token 状态提示 */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔑</span>
            <span className="font-medium">GitHub Personal Access Token</span>
            {githubSaved && githubToken ? (
              <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">已配置</span>
            ) : (
              <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">未配置</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            请在「<span className="font-medium">设置 → 知识库 → GitHub</span>」中配置 Token，然后返回此页面查询并选择 Repo。
          </p>
        </div>

        {/* 错误提示 */}
        {githubError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {githubError}
          </div>
        )}

        {/* 可选 Repo 列表 */}
        {githubRepos.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <span className="font-medium">可选 Repos ({githubRepos.length})</span>
              <button
                onClick={handleConnectGithub}
                disabled={selectedRepos.size === 0 || connecting}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {connecting ? "连接中..." : `连接选中 (${selectedRepos.size})`}
              </button>
            </div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {githubRepos.map((repo) => (
                <label
                  key={repo.id}
                  className={`px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-gray-50 ${
                    connectedRepos.includes(repo.fullName) ? "bg-green-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(repo.fullName) || connectedRepos.includes(repo.fullName)}
                    disabled={connectedRepos.includes(repo.fullName)}
                    onChange={() => toggleRepo(repo.fullName)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {repo.fullName}
                      {connectedRepos.includes(repo.fullName) && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">已连接</span>
                      )}
                    </div>
                    {repo.description && (
                      <div className="text-xs text-gray-500 truncate">{repo.description}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1 flex gap-3">
                      {repo.language && <span>🔤 {repo.language}</span>}
                      <span>⭐ {repo.stargazersCount}</span>
                      <span>更新: {new Date(repo.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {githubRepos.length === 0 && !githubLoading && !githubError && (
          <div className="text-center text-gray-400 py-12">
            在「设置 → 知识库」中配置 GitHub Token 后，即可查询并选择 Repo
          </div>
        )}
      </div>
      )}

      {/* 远程文档 Tab */}
      {activeTab === "remote" && (
      <div className="space-y-6">
        {/* OneDrive 连接 */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">☁️</span>
            <span className="font-medium flex-1">Microsoft OneDrive / SharePoint</span>
            {msGraphStatus?.connected && (
              <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">已连接</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-3">
            连接 OneDrive 后，可以在文档生成时自动搜索和引用远程文档。
            使用两阶段检索：先通过关键词粗筛，再对候选文件做语义匹配。
          </p>

          {!msGraphStatus?.hasAppConfig && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              ⚠️ 请先在 <strong>设置 → 知识库</strong> 中配置 Azure 应用信息（Tenant ID、Client ID、Client Secret）
            </div>
          )}

          {msGraphStatus?.hasAppConfig && !msGraphStatus?.connected && (
            <button
              onClick={handleConnectOnedrive}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              🔗 连接 OneDrive
            </button>
          )}

          {msGraphStatus?.connected && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                ✅ {msGraphStatus.userDisplayName ?? msGraphStatus.userEmail ?? "Microsoft 账户"}
              </span>
              <button
                onClick={handleDisconnectOnedrive}
                className="text-sm text-red-500 hover:text-red-700 hover:underline"
              >
                断开连接
              </button>
            </div>
          )}
        </div>

        {/* OneDrive 错误提示 */}
        {onedriveError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {onedriveError}
          </div>
        )}

        {/* OneDrive 文件列表 */}
        {onedriveFiles.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>OneDrive 文件 ({onedriveFiles.length})</span>
              <button
                onClick={() => loadOnedriveFiles()}
                disabled={onedriveLoading}
                className={`text-xs px-3 py-1 rounded border transition-colors ${
                  onedriveLoading
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200"
                    : "bg-white text-blue-600 border-blue-300 hover:bg-blue-50 hover:border-blue-400"
                }`}
                title="刷新远程文档列表"
              >
                {onedriveLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    刷新中...
                  </span>
                ) : (
                  "刷新"
                )}
              </button>
            </div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {onedriveFiles.map((file) => (
                <div key={file.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{file.name}</div>
                    <div className="text-xs text-gray-500">
                      {file.mimeType} · {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-blue-500 hover:underline text-sm"
                  >
                    打开
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
      )}

      {/* Outlook 邮箱 Tab */}
      {activeTab === "outlook" && (
      <div className="space-y-6">
        {/* Microsoft 账户状态 */}
        {!msGraphStatus?.connected && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
            请先在「远程文档」tab 中连接 Microsoft 账户。
          </div>
        )}

        {msGraphStatus?.connected && (
          <>
            {/* 邮件知识源 */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">✉️</span>
                <span className="font-medium flex-1">Outlook 邮件</span>
                {outlookStatus?.email && outlookStatus.email.count > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                    已索引 ({outlookStatus.email.count} 封, {outlookStatus.email.totalChunks} 块)
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-3">
                将 Outlook 邮箱中所有邮件内容向量化，支持按邮件主题、发件人、正文内容进行语义搜索。
                建议优先选择该选项，邮件是工作中最重要的知识来源之一。
              </p>
              <div className="flex items-center gap-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={outlookEmailEnabled}
                    onChange={(e) => setOutlookEmailEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">将邮件纳入知识库</span>
                </label>
              </div>
              {outlookEmailEnabled && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOutlookSync("email")}
                    disabled={outlookSyncing === "outlook_email"}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {outlookSyncing === "outlook_email" ? "同步中..." : "全量同步邮件"}
                  </button>
                  {outlookStatus?.email && outlookStatus.email.count > 0 && (
                    <button
                      onClick={() => handleClearOutlook("email")}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
                    >
                      清除邮件索引
                    </button>
                  )}
                </div>
              )}
              {outlookProgress["outlook_email"] && (
                <div className="mt-3">
                  <div className="flex items-center gap-3 text-sm text-gray-600 mb-1">
                    <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>
                      邮件同步中: {outlookProgress["outlook_email"].processed}/{outlookProgress["outlook_email"].total}
                      {outlookProgress["outlook_email"].skipped > 0 && ` (${outlookProgress["outlook_email"].skipped} 跳过)`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${outlookProgress["outlook_email"].total > 0
                          ? ((outlookProgress["outlook_email"].processed + outlookProgress["outlook_email"].skipped) / outlookProgress["outlook_email"].total) * 100
                          : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 联系人知识源 */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">👤</span>
                <span className="font-medium flex-1">Outlook 联系人</span>
                {outlookStatus?.contact && outlookStatus.contact.count > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                    已索引 ({outlookStatus.contact.count} 人, {outlookStatus.contact.totalChunks} 块)
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-3">
                将 Outlook 联系人的姓名、邮箱、职位、部门等信息向量化，支持按人名、公司、职位等维度搜索。
              </p>
              <div className="flex items-center gap-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={outlookContactEnabled}
                    onChange={(e) => setOutlookContactEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">将联系人纳入知识库</span>
                </label>
              </div>
              {outlookContactEnabled && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOutlookSync("contact")}
                    disabled={outlookSyncing === "outlook_contact"}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {outlookSyncing === "outlook_contact" ? "同步中..." : "全量同步联系人"}
                  </button>
                  {outlookStatus?.contact && outlookStatus.contact.count > 0 && (
                    <button
                      onClick={() => handleClearOutlook("contact")}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
                    >
                      清除联系人索引
                    </button>
                  )}
                </div>
              )}
              {outlookProgress["outlook_contact"] && (
                <div className="mt-3">
                  <div className="flex items-center gap-3 text-sm text-gray-600 mb-1">
                    <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>
                      联系人同步中: {outlookProgress["outlook_contact"].processed}/{outlookProgress["outlook_contact"].total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${outlookProgress["outlook_contact"].total > 0
                          ? ((outlookProgress["outlook_contact"].processed + outlookProgress["outlook_contact"].skipped) / outlookProgress["outlook_contact"].total) * 100
                          : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 已索引邮件列表 */}
            {outlookEmails.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
                  <span>已索引邮件 ({outlookEmails.length})</span>
                  <button
                    onClick={loadOutlookLists}
                    className="text-xs px-3 py-1 rounded border bg-white text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    刷新
                  </button>
                </div>
                <div className="divide-y max-h-96 overflow-y-auto">
                  {outlookEmails.map((email: any) => (
                    <div key={email.id} className="px-4 py-3">
                      <div className="font-medium text-sm truncate">{email.name}</div>
                      <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                        <div>发件人: {email.from}</div>
                        {email.to && <div>收件人: {email.to}</div>}
                        {email.receivedDateTime && (
                          <div>时间: {new Date(email.receivedDateTime).toLocaleString("zh-CN")}</div>
                        )}
                        <div>分块: {email.chunks} · 索引时间: {new Date(email.indexedAt).toLocaleString("zh-CN")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 已索引联系人列表 */}
            {outlookContacts.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
                  <span>已索引联系人 ({outlookContacts.length})</span>
                  <button
                    onClick={loadOutlookLists}
                    className="text-xs px-3 py-1 rounded border bg-white text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    刷新
                  </button>
                </div>
                <div className="divide-y max-h-96 overflow-y-auto">
                  {outlookContacts.map((contact: any) => (
                    <div key={contact.id} className="px-4 py-3">
                      <div className="font-medium text-sm">{contact.name}</div>
                      <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {contact.emailAddresses && <div>邮箱: {contact.emailAddresses}</div>}
                        {contact.jobTitle && <div>职位: {contact.jobTitle}</div>}
                        {contact.department && <div>部门: {contact.department}</div>}
                        {contact.companyName && <div>公司: {contact.companyName}</div>}
                        <div>分块: {contact.chunks} · 索引时间: {new Date(contact.indexedAt).toLocaleString("zh-CN")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 工具：发送 .eml 邮件 & 创建联系人 */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🔄</span>
                <span className="font-medium">同步到 wukun20261@outlook.com</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    if (!confirm("将知识库中所有 .eml 文件逐封发送到 wukun20261@outlook.com（CC 同地址）？")) return;
                    try {
                      const res = await fetch("/api/connectors/outlook/send-emails", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          toAddress: "wukun20261@outlook.com",
                          ccAddress: "wukun20261@outlook.com",
                        }),
                      });
                      const data = await res.json();
                      setMessage(data.ok ? "邮件发送已开始" : `失败: ${data.error}`);
                    } catch (err) {
                      setMessage(`失败: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  }}
                  className="px-3 py-1.5 bg-orange-600 text-white rounded text-sm hover:bg-orange-700"
                >
                  发送所有 .eml 邮件
                </button>
                <button
                  onClick={async () => {
                    if (!confirm("将 People Graph 中所有联系人创建到 wukun20261@outlook.com？")) return;
                    try {
                      const res = await fetch("/api/connectors/outlook/create-contacts", {
                        method: "POST",
                      });
                      const data = await res.json();
                      setMessage(data.ok ? "联系人创建已开始" : `失败: ${data.error}`);
                    } catch (err) {
                      setMessage(`失败: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  }}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                >
                  创建 People Graph 联系人
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* 文档 Tab */}
      {activeTab === "sources" && (
      <div className="space-y-6">
      {/* 上传区域 */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📁</span>
          <span className="font-medium">上传本地文档</span>
        </div>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-blue-400", "bg-blue-50"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("border-blue-400", "bg-blue-50"); }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-blue-400", "bg-blue-50");
            handleUpload(e.dataTransfer.files);
          }}
        >
          <p className="text-gray-600 mb-1">拖拽文件到这里，或点击选择</p>
          <p className="text-xs text-gray-400">支持 PDF、DOCX、TXT、HTML、Markdown、EML、JSON、XLSX、PPTX</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt,.md,.markdown,.html,.htm,.eml,.json,.xlsx,.pptx"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
        {uploading && (
          <div className="mt-2 text-blue-600 text-sm">上传中...</div>
        )}
        {message && (
          <div className={`mt-2 text-sm ${message.includes("失败") ? "text-red-600" : "text-green-600"}`}>
            {message}
          </div>
        )}
      </div>

      {/* 文档列表 */}
      {sources.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="font-medium">已索引文档 ({sources.length})</span>
          </div>
          <div className="divide-y max-h-[400px] overflow-y-auto" id="demo-kb-sources-list">
            {sources.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{s.name}</div>
                  <button
                    onClick={() => handleDelete(s.id, s.name)}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                  >
                    删除
                  </button>
                </div>
                <div className="text-xs text-gray-500 flex gap-4 mt-1">
                  <span>📄 {s.type.toUpperCase()}</span>
                  <span>🧩 {s.chunkCount} 块</span>
                  <span>🕐 {new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {sources.length === 0 && !uploading && (
        <div className="text-center text-gray-400 py-12">
          暂无本地文档，上传文件后即可使用
        </div>
      )}
      </div>
      )}
    </div>
  );
}