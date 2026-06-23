import { useEffect, useState, useRef } from "react";

interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  chunkCount: number;
  status: string;
  createdAt: string;
}

export default function KnowledgePanel() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [stats, setStats] = useState({ sourceCount: 0, chunkCount: 0, vectorCount: 0 });
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [sourcesRes, statsRes] = await Promise.all([
        fetch("/api/knowledge/sources").then((r) => r.json()),
        fetch("/api/knowledge/stats").then((r) => r.json()),
      ]);
      if (sourcesRes.ok) setSources(sourcesRes.sources);
      if (statsRes.ok) setStats(statsRes);
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

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">知识库管理</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="text-3xl font-bold text-blue-600">{stats.sourceCount}</div>
          <div className="text-sm text-gray-500">知识源</div>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="text-3xl font-bold text-green-600">{stats.chunkCount}</div>
          <div className="text-sm text-gray-500">文本块</div>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="text-3xl font-bold text-purple-600">{stats.vectorCount}</div>
          <div className="text-sm text-gray-500">向量</div>
        </div>
      </div>

      {/* 上传区域 */}
      <div className="mb-6">
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-blue-400", "bg-blue-50"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("border-blue-400", "bg-blue-50"); }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-blue-400", "bg-blue-50");
            handleUpload(e.dataTransfer.files);
          }}
        >
          <div className="text-4xl mb-2">📁</div>
          <p className="text-gray-600 mb-2">拖拽文件到这里，或点击选择</p>
          <p className="text-sm text-gray-400">支持 PDF、DOCX、TXT、HTML、Markdown</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt,.md,.markdown,.html,.htm"
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

      {/* 知识源列表 */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-4 py-3 border-b font-medium">知识源列表</div>
        {sources.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无知识源，请上传文件</div>
        ) : (
          <div className="divide-y">
            {sources.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-sm text-gray-500">
                    {s.type.toUpperCase()} · {s.chunkCount} 块 · {new Date(s.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs ${
                    s.status === "ready" ? "bg-green-100 text-green-700" :
                    s.status === "processing" ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {s.status}
                  </span>
                  <button
                    onClick={() => handleDelete(s.id, s.name)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
