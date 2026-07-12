/**
 * i-Write PowerPoint Add-in — React 入口
 *
 * 应用始终渲染，不依赖 Office.js 初始化完成。
 * Office.js 异步初始化，API 调用时检查可用性。
 * 与 word-addin 保持一致。
 */
import ReactDOM from 'react-dom/client';
import { FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AppShell from './components/AppShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

// 移除 loading 占位符，立即渲染 React 应用
const rootEl = document.getElementById('root')!;
rootEl.innerHTML = '';

// 始终渲染 React 应用（不等待 Office.js，但 Office.js 已同步加载完成）
ReactDOM.createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <FluentProvider theme={isDark ? webDarkTheme : webLightTheme}>
      <AppShell />
    </FluentProvider>
  </QueryClientProvider>
);

// Office.js 异步初始化（不阻塞渲染）
if (typeof (window as any).Office !== 'undefined' && (window as any).Office.onReady) {
  (window as any).Office.onReady(() => {
    console.log('[i-Write PPT] Office.js 初始化完成');
  }).catch((err: Error) => {
    console.warn('[i-Write PPT] Office.js 初始化失败:', err.message);
  });
} else {
  console.warn('[i-Write PPT] Office.js 未加载，将在加载后初始化');
  window.addEventListener('load', () => {
    if (typeof (window as any).Office !== 'undefined' && (window as any).Office.onReady) {
      (window as any).Office.onReady(() => {
        console.log('[i-Write PPT] Office.js 延迟初始化完成');
      });
    }
  });
}
