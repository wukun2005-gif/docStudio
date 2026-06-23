import { useState } from "react";
import Settings from "./components/Settings";

type Page = "home" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">i-Write</h1>
          <div className="flex gap-4">
            <button
              onClick={() => setPage("home")}
              className={`px-3 py-1 rounded ${page === "home" ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}
            >
              首页
            </button>
            <button
              onClick={() => setPage("settings")}
              className={`px-3 py-1 rounded ${page === "settings" ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}
            >
              设置
            </button>
          </div>
        </div>
      </nav>

      {/* 页面内容 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {page === "home" && <HomePage />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}

function HomePage() {
  return (
    <div className="text-center py-20">
      <h2 className="text-3xl font-bold text-gray-800 mb-4">i-Write — 可信文档生成工作台</h2>
      <p className="text-gray-600 mb-8">连接知识碎片，生成可信文档</p>
      <div className="flex justify-center gap-4">
        <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          开始创作
        </button>
        <button className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">
          查看知识库
        </button>
      </div>
    </div>
  );
}
