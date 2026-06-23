/**
 * GitHub API Connector
 *
 * Feature #30: GitHub 连接器
 *
 * 通过 GitHub API 读取 repo 代码、Issues、PR。
 */

export interface GitHubConfig {
  token: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
  language: string;
  stargazersCount: number;
  updatedAt: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  htmlUrl: string;
}

export interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  htmlUrl: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

// ── Repos ──────────────────────────────────────────────

export async function listRepos(
  config: GitHubConfig,
  options?: { owner?: string; perPage?: number },
): Promise<GitHubRepo[]> {
  const perPage = options?.perPage ?? 30;
  const url = options?.owner
    ? `https://api.github.com/users/${options.owner}/repos?per_page=${perPage}&sort=updated`
    : `https://api.github.com/user/repos?per_page=${perPage}&sort=updated`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    language: string | null;
    stargazers_count: number;
    updated_at: string;
  }>;

  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description ?? "",
    htmlUrl: repo.html_url,
    language: repo.language ?? "unknown",
    stargazersCount: repo.stargazers_count,
    updatedAt: repo.updated_at,
  }));
}

// ── Issues ─────────────────────────────────────────────

export async function listIssues(
  config: GitHubConfig,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; perPage?: number },
): Promise<GitHubIssue[]> {
  const state = options?.state ?? "all";
  const perPage = options?.perPage ?? 30;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub Issues API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Array<{
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    created_at: string;
    updated_at: string;
    labels: Array<{ name: string }>;
    html_url: string;
    pull_request?: unknown;
  }>;

  return data
    .filter(item => !item.pull_request) // 排除 PR（PR 也是 issue）
    .map(issue => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      state: issue.state,
      user: issue.user.login,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      labels: issue.labels.map(l => l.name),
      htmlUrl: issue.html_url,
    }));
}

// ── Pull Requests ──────────────────────────────────────

export async function listPRs(
  config: GitHubConfig,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; perPage?: number },
): Promise<GitHubPR[]> {
  const state = options?.state ?? "all";
  const perPage = options?.perPage ?? 30;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub PR API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Array<{
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    html_url: string;
    changed_files?: number;
    additions?: number;
    deletions?: number;
  }>;

  return data.map(pr => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    state: pr.state,
    user: pr.user.login,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    mergedAt: pr.merged_at,
    htmlUrl: pr.html_url,
    changedFiles: pr.changed_files ?? 0,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
  }));
}

// ── Commits ────────────────────────────────────────────

export async function listCommits(
  config: GitHubConfig,
  owner: string,
  repo: string,
  options?: { since?: string; perPage?: number },
): Promise<GitHubCommit[]> {
  const perPage = options?.perPage ?? 30;
  let url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}`;
  if (options?.since) {
    url += `&since=${encodeURIComponent(options.since)}`;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub Commits API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Array<{
    sha: string;
    commit: {
      message: string;
      author?: { name?: string; date?: string };
    };
    html_url: string;
  }>;

  return data.map(commit => ({
    sha: commit.sha.slice(0, 7),
    message: commit.commit.message.split("\n")[0] ?? "",
    author: commit.commit.author?.name ?? "unknown",
    date: commit.commit.author?.date ?? "",
    htmlUrl: commit.html_url,
  }));
}

// ── 统一导入接口 ───────────────────────────────────────

export interface GitHubImportResult {
  repo: string;
  issues: number;
  prs: number;
  commits: number;
  errors: string[];
}

export async function importFromGitHub(
  config: GitHubConfig,
  repos: string[],
): Promise<GitHubImportResult[]> {
  const results: GitHubImportResult[] = [];

  for (const repoPath of repos) {
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) {
      results.push({ repo: repoPath, issues: 0, prs: 0, commits: 0, errors: ["Invalid repo format"] });
      continue;
    }

    const result: GitHubImportResult = { repo: repoPath, issues: 0, prs: 0, commits: 0, errors: [] };

    try {
      const [issues, prs, commits] = await Promise.allSettled([
        listIssues(config, owner, repo, { state: "all", perPage: 50 }),
        listPRs(config, owner, repo, { state: "all", perPage: 50 }),
        listCommits(config, owner, repo, { perPage: 50 }),
      ]);

      if (issues.status === "fulfilled") result.issues = issues.value.length;
      if (prs.status === "fulfilled") result.prs = prs.value.length;
      if (commits.status === "fulfilled") result.commits = commits.value.length;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push(result);
  }

  return results;
}
