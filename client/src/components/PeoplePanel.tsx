import { useEffect, useState } from "react";

interface OrgNode {
  id: string;
  name: string;
  title?: string;
  email?: string;
  department?: string;
  children: OrgNode[];
}

export default function PeoplePanel() {
  const [hierarchy, setHierarchy] = useState<OrgNode[]>([]);
  const [peopleCount, setPeopleCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAppConfig, setHasAppConfig] = useState(false);
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  useEffect(() => {
    checkConfig();
    loadData();
    fetch("/api/settings/sender_profile")
      .then(r => r.json())
      .then(data => { if (data.value?.name) setCurrentUserName(data.value.name); })
      .catch(() => {});
  }, []);

  async function checkConfig() {
    try {
      const res = await fetch("/api/connectors/msgraph/config");
      const data = await res.json();
      setHasAppConfig(data.ok && (data.configured || !!data.config));
    } catch {
      // ignore
    }
  }

  async function loadData() {
    try {
      const [peopleRes, hierRes] = await Promise.all([
        fetch("/api/people").then((r) => r.json()),
        fetch("/api/people/org-hierarchy").then((r) => r.json()),
      ]);
      if (peopleRes.ok) {
        const filtered = peopleRes.people.filter(
          (p: any) => !p.email?.includes("#EXT#") && (p.department || p.title || p.attributes?.isCurrentUser),
        );
        setPeopleCount(filtered.length);
      }
      if (hierRes.ok) {
        setHierarchy(hierRes.hierarchy);
      }
    } catch (err) {
      console.error("Failed to load people data:", err);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/people/sync-msgraph", { method: "POST" });
      const result = await res.json();
      if (result.ok) {
        setLastSyncCount(result.imported);
        if (result.errors?.length) {
          setError(`${result.errors.length} 个警告: ${result.errors[0]}`);
        }
        loadData();
      } else {
        setError(result.error || "同步失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  const depts = new Set<string>();
  let allCount = 0;
  let relCount = 0;
  function walk(nodes: OrgNode[]) {
    for (const n of nodes) {
      allCount++;
      if (n.department) depts.add(n.department);
      relCount += n.children.length;
      walk(n.children);
    }
  }
  walk(hierarchy);

  function OrgNodeCard({ node }: { node: OrgNode }) {
    const isCurrentUser = currentUserName && node.name === currentUserName;
    const hasChildren = node.children.length > 0;

    return (
      <li>
        <div
          className={`border rounded-lg px-3 py-1.5 bg-white shadow-sm text-center min-w-[90px] max-w-[140px] cursor-default transition-shadow hover:shadow-md ${
            isCurrentUser ? "border-blue-400 ring-2 ring-blue-200" : "border-gray-200"
          }`}
        >
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mx-auto mb-1 ${
              isCurrentUser ? "bg-blue-500 text-white" : "bg-blue-100 text-blue-600"
            }`}
          >
            {node.name[0]}
          </div>
          <div className="text-xs font-semibold leading-tight flex items-center justify-center gap-0.5 flex-wrap">
            {node.name}
            {isCurrentUser && (
              <span className="px-0.5 py-0 rounded text-[9px] bg-blue-500 text-white font-medium shrink-0">我</span>
            )}
          </div>
          {node.title && <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{node.title}</div>}
          {node.department && <div className="text-[9px] text-gray-400 mt-0.5">{node.department}</div>}
        </div>
        {hasChildren && (
          <ul>
            {node.children.map((child) => (
              <OrgNodeCard key={child.id} node={child} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const hasHierarchy = hierarchy.some((n) => n.children.length > 0);

  return (
    <div className="space-y-6">
      {/* Entra ID 连接卡片 */}
      <div className="bg-white rounded-lg shadow-sm border py-2 px-3">
        {!hasAppConfig && (
          <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs text-amber-700">
            ⚠️ 请先在 <strong>设置 → 知识库</strong> 中配置 Azure 应用信息
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base">🏢</span>
          <span className="font-medium text-sm">Microsoft Entra ID</span>
          {allCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">已同步</span>
          )}
          <span className="text-xs text-gray-400">
            {allCount > 0 ? `${allCount} 人 · ${relCount} 关系` : "从 Entra ID 同步组织架构"}
          </span>
          {hasAppConfig && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="ml-auto px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "同步中..." : "🔗 同步"}
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* 组织架构图 */}
      {allCount > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-3 border-b font-medium flex items-center gap-3">
            <span>组织架构</span>
            <span className="font-normal text-xs text-gray-400">·</span>
            <span className="text-xs text-blue-500 font-normal">{allCount} 人</span>
            <span className="font-normal text-xs text-gray-400">·</span>
            <span className="text-xs text-green-500 font-normal">{depts.size} 部门</span>
            <span className="font-normal text-xs text-gray-400">·</span>
            <span className="text-xs text-purple-500 font-normal">{relCount} 关系</span>
          </div>
          <div className="p-6 overflow-y-auto max-h-[60vh] text-center" id="demo-people-org-tree">
            {hasHierarchy ? (
              <div className="org-chart">
                <ul>
                  {hierarchy.map((root) => (
                    <OrgNodeCard key={root.id} node={root} />
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-10 text-sm">
                暂无汇报关系数据，"同步组织架构"后将展示层级架构图
              </div>
            )}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {allCount === 0 && hasAppConfig && !syncing && (
        <div className="text-center text-gray-400 py-12">
          点击"同步组织架构"从 Entra ID 拉取人员数据
        </div>
      )}
    </div>
  );
}