import { useEffect, useState } from "react";

interface Person {
  id: string;
  name: string;
  title?: string;
  department?: string;
  email?: string;
  attributes?: { relationships?: Array<{ targetPersonId: string; type: string }>; isCurrentUser?: boolean };
  createdAt: string;
}

export default function PeoplePanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [orgTree, setOrgTree] = useState<Record<string, Array<{ id: string; name: string; title?: string; email?: string }>>>({});
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAppConfig, setHasAppConfig] = useState(false);
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  useEffect(() => {
    checkConfig();
    loadData();
    // 加载当前用户身份
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
      const [peopleRes, treeRes] = await Promise.all([
        fetch("/api/people").then((r) => r.json()),
        fetch("/api/people/org-tree").then((r) => r.json()),
      ]);
      if (peopleRes.ok) {
        // 过滤掉外部来宾用户（邮箱含 #EXT#），但始终保留当前用户
        const filtered = peopleRes.people.filter(
          (p: Person) => !p.email?.includes("#EXT#") && (p.department || p.title || p.attributes?.isCurrentUser),
        );
        setPeople(filtered);
      }
      if (treeRes.ok) {
        // 过滤掉空部门和外部用户
        const tree: Record<string, typeof treeRes.tree[string]> = {};
        for (const [dept, members] of Object.entries(treeRes.tree)) {
          if (!dept) continue; // 跳过"未分配"
          const filtered = (members as typeof treeRes.tree[string]).filter(
            (m: any) => !m.email?.includes("#EXT#"),
          );
          if (filtered.length > 0) tree[dept] = filtered;
        }
        setOrgTree(tree);
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

  const departments = Object.keys(orgTree);
  const peopleCount = people.length;

  return (
    <div className="space-y-6">
      {/* Entra ID 连接卡片 */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🏢</span>
          <span className="font-medium flex-1">Microsoft Entra ID</span>
          {peopleCount > 0 && (
            <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">已同步</span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-3">
          从 Microsoft Entra ID 同步组织架构。同步后，人员信息和上下级关系会在文档生成时自动引用。
        </p>

        {!hasAppConfig && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            ⚠️ 请先在 <strong>设置 → 知识库</strong> 中配置 Azure 应用信息（Tenant ID、Client ID、Client Secret）
          </div>
        )}

        {hasAppConfig && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "同步中..." : "🔗 同步组织架构"}
            </button>
            {lastSyncCount !== null && !syncing && (
              <span className="text-sm text-gray-500">
                上次同步: {lastSyncCount} 人
              </span>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 统计卡片 */}
      {peopleCount > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm border text-center">
            <div className="text-3xl font-bold text-blue-600">{peopleCount}</div>
            <div className="text-sm text-gray-500">人员</div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm border text-center">
            <div className="text-3xl font-bold text-green-600">{departments.length}</div>
            <div className="text-sm text-gray-500">部门</div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm border text-center">
            <div className="text-3xl font-bold text-purple-600">
              {people.reduce((n, p) => n + (p.attributes?.relationships?.length ?? 0), 0)}
            </div>
            <div className="text-sm text-gray-500">关系</div>
          </div>
        </div>
      )}

      {/* 组织架构树 */}
      {departments.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-3 border-b font-medium">组织架构</div>
          <div className="p-4 space-y-4">
            {departments.map((dept) => (
              <div key={dept} className="border rounded-lg p-3">
                <h4 className="font-medium text-gray-700 mb-2">{dept || "未分配"}</h4>
                <div className="flex flex-wrap gap-3">
                  {orgTree[dept].map((p) => {
                    const isCurrentUser = currentUserName && p.name === currentUserName;
                    return (
                      <div key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isCurrentUser ? "bg-blue-50 border border-blue-300 ring-1 ring-blue-200" : "bg-gray-50"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${isCurrentUser ? "bg-blue-500 text-white" : "bg-blue-100 text-blue-600"}`}>
                          {p.name[0]}
                        </div>
                        <div>
                          <div className="text-sm font-medium flex items-center gap-1.5">
                            {p.name}
                            {isCurrentUser && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500 text-white font-medium">我</span>}
                          </div>
                          {p.title && <div className="text-xs text-gray-500">{p.title}</div>}
                          {p.email && <div className="text-xs text-gray-400">{p.email}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {peopleCount === 0 && hasAppConfig && !syncing && (
        <div className="text-center text-gray-400 py-12">
          点击"同步组织架构"从 Entra ID 拉取人员数据
        </div>
      )}
    </div>
  );
}
