/**
 * i-Write Excel Add-in — React 入口
 *
 * 应用始终渲染，不依赖 Office.js 初始化完成。
 * Office.js 异步初始化，API 调用时检查可用性。
 */
import React from 'react';
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

// 始终渲染 React 应用（不等待 Office.js）
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={isDark ? webDarkTheme : webLightTheme}>
        <AppShell />
      </FluentProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

// Office.js 异步初始化（不阻塞渲染）
if (typeof Office !== 'undefined' && Office.onReady) {
  Office.onReady(() => {
    console.log('[i-Write] Office.js 初始化完成');
  }).catch((err: Error) => {
    console.warn('[i-Write] Office.js 初始化失败:', err.message);
  });
} else {
  console.warn('[i-Write] Office.js 未加载，将在加载后初始化');
  // 等待 Office.js 加载后重试
  window.addEventListener('load', () => {
    if (typeof Office !== 'undefined' && Office.onReady) {
      Office.onReady(() => {
        console.log('[i-Write] Office.js 延迟初始化完成');
      });
    }
  });
}