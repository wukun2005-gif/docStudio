import { useState } from "react";
import Settings from "./components/Settings";
import KnowledgePanel from "./components/KnowledgePanel";
import GenerationPage from "./components/GenerationPage";
import CaseList from "./components/CaseList";
import ChatBox from "./components/ChatBox";
import { useCaseStore } from "./store/caseStore.js";

type Page = "home" | "generate" | "knowledge" | "settings";

const NAV_ITEMS: Array<{ id: Page; label: string }> = [
  { id: "home", label: "首页" },
  { id: "generate", label: "生成文档" },
  { id: "knowledge", label: "知识库" },
  { id: "settings", label: "设置" },
];

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const currentCase = useCaseStore((s) => s.currentCase);

  const showSidePanels = page === "generate" || page === "home";

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b shrink-0 z-10">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {showSidePanels && (
              <button
                onClick={() => setLeftCollapsed(!leftCollapsed)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                title={leftCollapsed ? "展开文档列表" : "收起文档列表"}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {leftCollapsed ? (
                    <path d="M3 12h18M3 6h18M3 18h18" />
                  ) : (
                    <>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                    </>
                  )}
                </svg>
              </button>
            )}
            <h1 className="text-lg font-bold text-gray-800">i-Write<span className="text-xs font-normal text-gray-500 ml-1">, a Studio of Document Generation w/ Knowledge</span></h1>
          </div>
          <div className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  page === item.id ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {showSidePanels && (
            <button
              onClick={() => setRightCollapsed(!rightCollapsed)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title={rightCollapsed ? "展开对话面板" : "收起对话面板"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}
        </div>
      </nav>

      {/* 三栏布局 */}
      <div className="flex-1 flex min-h-0" ref={(el) => {
        if (el) console.log("[App] main layout width:", el.offsetWidth, "children:", el.children.length);
      }}>
        {/* 左侧：Case 列表 */}
        {showSidePanels && (
          <CaseList collapsed={leftCollapsed} onToggle={() => setLeftCollapsed(!leftCollapsed)} />
        )}

        {/* 中间：主内容区 */}
        <main className="flex-1 overflow-hidden min-w-0" ref={(el) => {
          if (el) console.log("[App] main content width:", el.offsetWidth, "clientWidth:", el.clientWidth);
        }}>
          {page === "home" && !currentCase && <HomePage onNavigate={setPage} />}
          {page === "home" && currentCase && <GenerationPage />}
          {page === "generate" && <GenerationPage />}
          {page === "knowledge" && (
            <div className="h-full overflow-auto px-6 py-6">
              <KnowledgePanel />
            </div>
          )}
          {page === "settings" && (
            <div className="h-full overflow-auto px-6 py-6">
              <Settings />
            </div>
          )}
        </main>

        {/* 右侧：Chat 面板 */}
        {showSidePanels && (
          <div className={`${rightCollapsed ? "w-12" : "w-[360px]"} shrink-0 border-l bg-white overflow-hidden flex flex-col transition-all`}>
            <ChatBox collapsed={rightCollapsed} />
          </div>
        )}
      </div>
    </div>
  );
}

function HomePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { cases } = useCaseStore();

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-lg">
        <h2 className="text-2xl font-bold text-gray-800 mb-1">i-Write</h2>
        <p className="text-sm text-gray-500 mb-1">a Studio of Document Generation w/ Knowledge</p>
        <p className="text-xs text-gray-400 mb-8">连接知识碎片，生成可信文档</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => onNavigate("generate")}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            开始创作
          </button>
          <button
            onClick={() => onNavigate("knowledge")}
            className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            管理知识库
          </button>
        </div>
        {cases.length > 0 && (
          <p className="text-xs text-gray-400 mt-6">← 左侧选择已有文档继续编辑</p>
        )}
      </div>
    </div>
  );
}
