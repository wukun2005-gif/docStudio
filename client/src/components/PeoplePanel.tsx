import { useEffect, useState } from "react";

interface Person {
  id: string;
  name: string;
  title?: string;
  department?: string;
  email?: string;
  createdAt: string;
}

export default function PeoplePanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [orgTree, setOrgTree] = useState<Record<string, Array<{ id: string; name: string; title?: string; email?: string }>>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newPerson, setNewPerson] = useState({ name: "", title: "", department: "", email: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", title: "", department: "", email: "" });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [peopleRes, treeRes] = await Promise.all([
        fetch("/api/people").then((r) => r.json()),
        fetch("/api/people/org-tree").then((r) => r.json()),
      ]);
      if (peopleRes.ok) setPeople(peopleRes.people);
      if (treeRes.ok) setOrgTree(treeRes.tree);
    } catch (err) {
      console.error("Failed to load people data:", err);
    }
  }

  async function handleAdd() {
    if (!newPerson.name.trim()) return;
    try {
      await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPerson),
      });
      setNewPerson({ name: "", title: "", department: "", email: "" });
      setShowAdd(false);
      loadData();
    } catch (err) {
      console.error("Add person failed:", err);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除 "${name}"？`)) return;
    try {
      await fetch(`/api/people/${id}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  function startEdit(p: Person) {
    setEditingId(p.id);
    setEditForm({ name: p.name, title: p.title ?? "", department: p.department ?? "", email: p.email ?? "" });
  }

  async function handleUpdate() {
    if (!editingId || !editForm.name.trim()) return;
    try {
      await fetch(`/api/people/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      setEditingId(null);
      loadData();
    } catch (err) {
      console.error("Update failed:", err);
    }
  }

  const departments = Object.keys(orgTree);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">People Graph</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          添加人员
        </button>
      </div>

      {/* 添加人员表单 */}
      {showAdd && (
        <div className="bg-white rounded-lg p-4 shadow-sm border mb-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              placeholder="姓名 *"
              value={newPerson.name}
              onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="职位"
              value={newPerson.title}
              onChange={(e) => setNewPerson({ ...newPerson, title: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="部门"
              value={newPerson.department}
              onChange={(e) => setNewPerson({ ...newPerson, department: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="邮箱"
              value={newPerson.email}
              onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
              className="border rounded px-3 py-2"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              保存
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 组织架构树 */}
      {departments.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4">组织架构</h3>
          <div className="space-y-4">
            {departments.map((dept) => (
              <div key={dept} className="bg-white rounded-lg p-4 shadow-sm border">
                <h4 className="font-medium text-gray-700 mb-2">{dept}</h4>
                <div className="flex flex-wrap gap-3">
                  {orgTree[dept].map((p) => (
                    <div key={p.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-medium">
                        {p.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        {p.title && <div className="text-xs text-gray-500">{p.title}</div>}
                        {p.email && <div className="text-xs text-gray-400">{p.email}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 人员列表 */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-4 py-3 border-b font-medium">人员列表 ({people.length})</div>
        {people.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无人员数据</div>
        ) : (
          <div className="divide-y">
            {people.map((p) => (
              editingId === p.id ? (
                <div key={p.id} className="px-4 py-3 bg-blue-50">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <input
                      placeholder="姓名 *"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="border rounded px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="职位"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="border rounded px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="部门"
                      value={editForm.department}
                      onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                      className="border rounded px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="邮箱"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      className="border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleUpdate} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium">
                      {p.name[0]}
                    </div>
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-gray-500">
                        {[p.title, p.department].filter(Boolean).join(" · ")}
                        {p.email && ` · ${p.email}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(p)}
                      className="text-blue-500 hover:text-blue-700 text-sm"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
