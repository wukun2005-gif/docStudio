import { useState } from "react";
import Settings from "./components/Settings";
import KnowledgePanel from "./components/KnowledgePanel";
import PeoplePanel from "./components/PeoplePanel";

type Page = "home" | "knowledge" | "people" | "settings";

const NAV_ITEMS: Array<{ id: Page; label: string }> = [
  { id: "home", label: "首页" },
  { id: "knowledge", label: "知识库" },
  { id: "people", label: "People Graph" },
  { id: "settings", label: "设置" },
];

export default function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">i-Write</h1>
          <div className="flex gap-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={`px-3 py-1 rounded text-sm ${page === item.id ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* 页面内容 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {page === "home" && <HomePage onNavigate={setPage} />}
        {page === "knowledge" && <KnowledgePanel />}
        {page === "people" && <PeoplePanel />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}

function HomePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <div className="text-center py-20">
      <h2 className="text-3xl font-bold text-gray-800 mb-4">i-Write — 可信文档生成工作台</h2>
      <p className="text-gray-600 mb-8">连接知识碎片，生成可信文档</p>
      <div className="flex justify-center gap-4">
        <button
          onClick={() => onNavigate("knowledge")}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          管理知识库
        </button>
        <button
          onClick={() => onNavigate("settings")}
          className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          配置 Provider
        </button>
      </div>
    </div>
  );
}
