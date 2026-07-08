/**
 * i-Write Excel Add-in — React 入口
 *
 * 初始化 Office.js、Fluent UI 主题、React Query。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AppShell from './components/AppShell';

// Office.js 初始化
Office.onReady(() => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });

  // 跟随 Excel 主题
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <FluentProvider theme={isDark ? webDarkTheme : webLightTheme}>
          <AppShell />
        </FluentProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
