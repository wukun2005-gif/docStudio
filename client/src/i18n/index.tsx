import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import zhCN from "./zh-CN.json";
import en from "./en.json";

export type Locale = "zh-CN" | "en";

const translations: Record<Locale, typeof zhCN> = {
  "zh-CN": zhCN,
  en,
};

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((acc, key) => acc?.[key], obj) as string | undefined;
}

// ── 模块级 locale（供 store / 非组件模块使用，避免依赖 React Context）──

let currentLocale: Locale = "zh-CN";

/**
 * 为所有 /api/* 请求附加语言标记，服务端据此返回本地化文案（错误/提示/模板名…）。
 *
 * 逐个 fetch 传 language 需要在 20+ 处调用点重复改动，容易遗漏；
 * 这里集中在一处注入，新增接口自动生效。
 *
 * **为什么用 Accept-Language 而不是自定义头**：
 * 客户端在开发态会直连 `http://localhost:3000`（绝对地址，跨域），
 * 自定义请求头会触发 CORS preflight；只要服务端 `Access-Control-Allow-Headers`
 * 没同步放行，浏览器就会在网络层直接拦掉，表现为 **"Failed to fetch"**。
 * `Accept-Language` 属于 CORS 安全列表内的请求头，不会因白名单问题被拦，
 * 语义上也正好是「告诉服务端我期望的语言」。
 * 服务端 `readLanguage()` 同时兼容 body/query/Accept-Language/自定义头。
 */
export function installApiLanguageHeader(): void {
  if (typeof window === "undefined" || (window as any).__docstudioLangHeaderInstalled) return;
  (window as any).__docstudioLangHeaderInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // 仅处理字符串 URL（Request 对象无法安全改写 header，且本项目未使用）
    if (typeof input !== "string" || !input.includes("/api/")) {
      return originalFetch(input as any, init);
    }
    try {
      const headers = new Headers(init?.headers ?? {});
      if (!headers.has("Accept-Language")) {
        headers.set("Accept-Language", currentLocale);
      }
      return originalFetch(input, { ...init, headers });
    } catch {
      return originalFetch(input, init);
    }
  };
}

/** 读取当前语言（组件外使用） */
export function getCurrentLocale(): Locale {
  return currentLocale;
}

/** 组件外翻译（store、工具函数等非 React 环境使用） */
export function translate(key: string, params?: Record<string, string | number>): string {
  const value = getNestedValue(translations[currentLocale], key);
  if (value === undefined) {
    console.warn(`[i18n] Missing key: ${key} (${currentLocale})`);
    return key;
  }
  if (!params) return value;
  return Object.entries(params).reduce(
    (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    value
  );
}

/** 解析初始语言（localStorage → 浏览器语言 → zh-CN） */
function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem("docstudio-locale");
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch {}
  return navigator.language.startsWith("zh") ? "zh-CN" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = resolveInitialLocale();
    currentLocale = initial;
    try {
      document.documentElement.lang = initial === "zh-CN" ? "zh-CN" : "en";
    } catch {}
    return initial;
  });

  const setLocale = useCallback((newLocale: Locale) => {
    currentLocale = newLocale;
    setLocaleState(newLocale);
    try {
      localStorage.setItem("docstudio-locale", newLocale);
    } catch {}
    document.documentElement.lang = newLocale === "zh-CN" ? "zh-CN" : "en";
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const value = getNestedValue(translations[locale], key);
      if (value === undefined) {
        console.warn(`[i18n] Missing key: ${key} (${locale})`);
        return key;
      }
      if (!params) return value;
      return Object.entries(params).reduce(
        (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
        value
      );
    },
    [locale]
  );

  const formatDate = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
      const d = typeof date === "string" ? new Date(date) : date;
      const localeCode = locale === "zh-CN" ? "zh-CN" : "en-US";
      return d.toLocaleString(localeCode, options);
    },
    [locale]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, formatDate }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
