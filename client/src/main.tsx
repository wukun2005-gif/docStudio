import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider, installApiLanguageHeader } from "./i18n";
import "./index.css";

// 所有 /api/* 请求自动带语言头，服务端据此本地化错误/提示文案
installApiLanguageHeader();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
