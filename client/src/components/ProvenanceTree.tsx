/**
 * 生成树可视化组件 — 段落级来源追溯
 * Feature #17: 生成树可视化
 * Feature #18: 生成树 CRUD
 */
import { useEffect, useState } from "react";

interface ProvenanceNode {
  id: string;
  runId: string;
  paragraphIdx: number;
  chunkId?: string;
  webUrl?: string;
  webTitle?: string;
  webSnippet?: string;
  score: number;
  isManual: boolean;
  parentId?: string;
  createdAt: string;
}

interface ProvenanceTreeProps {
  runId: string;
  sectionTitles?: string[]; // 章节标题列表，用于替换"段落 N"
}

export default function ProvenanceTree({ runId, sectionTitles }: ProvenanceTreeProps) {
  const [nodes, setNodes] = useState<ProvenanceNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNodes();
  }, [runId]);

  async function loadNodes() {
    setLoading(true);
    try {
      const res = await fetch(`/api/provenance/${runId}`);
      const data = await res.json();
      if (data.ok) setNodes(data.nodes);
    } catch (err) {
      console.error("Failed to load provenance:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/provenance/${id}`, { method: "DELETE" });
      loadNodes();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  // 按段落分组
  const byParagraph = new Map<number, ProvenanceNode[]>();
  for (const node of nodes) {
    if (!byParagraph.has(node.paragraphIdx)) {
      byParagraph.set(node.paragraphIdx, []);
    }
    byParagraph.get(node.paragraphIdx)!.push(node);
  }

  if (loading) {
    return <div className="text-center py-4 text-gray-500">加载中...</div>;
  }

  if (nodes.length === 0) {
    return <div className="text-center py-4 text-gray-400">暂无生成树数据</div>;
  }

  return (
    <div className="space-y-3">
      {Array.from(byParagraph.entries()).sort(([a], [b]) => a - b).map(([idx, paragraphNodes]) => {
        const title = sectionTitles?.[idx] ?? `段落 ${idx + 1}`;
        const avgScore = paragraphNodes.reduce((sum, n) => sum + n.score, 0) / paragraphNodes.length;
        return (
          <div key={idx} className="bg-white rounded-lg border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]" title={title}>
                  {title}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  avgScore >= 0.8 ? "bg-green-100 text-green-700" :
                  avgScore >= 0.5 ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  {(avgScore * 100).toFixed(0)}%
                </span>
              </div>
              <span className="text-xs text-gray-400">{paragraphNodes.length} 个来源</span>
            </div>
            <div className="space-y-1">
              {paragraphNodes.sort((a, b) => b.score - a.score).map((node) => (
                <div key={node.id} className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    node.score >= 0.8 ? "bg-green-500" :
                    node.score >= 0.5 ? "bg-yellow-500" :
                    "bg-red-500"
                  }`} />
                  <span className="flex-1 truncate text-gray-600">
                    {node.webUrl ? (
                      <a href={node.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                        🌐 {node.webTitle || node.webUrl}
                      </a>
                    ) : (
                      <span>{node.chunkId?.slice(0, 8) ?? "手动"}...</span>
                    )}
                  </span>
                  <span className="text-gray-400 text-xs">{(node.score * 100).toFixed(0)}%</span>
                  {node.webUrl && (
                    <span className="px-1 py-0.5 bg-purple-100 text-purple-600 text-xs rounded">Web</span>
                  )}
                  {node.isManual && (
                    <span className="px-1 py-0.5 bg-blue-100 text-blue-600 text-xs rounded">手动</span>
                  )}
                  <button
                    onClick={() => handleDelete(node.id)}
                    className="text-gray-400 hover:text-red-500 text-xs"
                    title="删除此来源"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}