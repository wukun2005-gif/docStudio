/**
 * 服务端轻量本地化助手
 *
 * 仅用于「面向用户可见」的字符串（HTTP 错误信息、SSE 报错、进度文案）。
 * 不用于内部 prompt / 日志 —— prompt 的语言由 docGenerator / narrativeEngine
 * 自身的 language 参数控制，日志保持中文便于排查。
 *
 * 约定：请求体或 query 中带 `language`（"zh-CN" | "en"），缺省为中文。
 */

export type RequestLanguage = "zh-CN" | "en";

/** 判断请求是否要求英文输出 */
export function isEnLanguage(language?: string | null): boolean {
  return language === "en";
}

/** 归一化语言标记（"en-US" → "en"，"zh" → "zh-CN"），无法识别时返回 undefined */
export function normalizeLanguage(raw?: string | null): RequestLanguage | undefined {
  if (!raw) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (!v) return undefined;
  if (v === "en" || v.startsWith("en-")) return "en";
  if (v === "zh" || v.startsWith("zh-")) return "zh-CN";
  return undefined;
}

/** 按请求语言在中文/英文文案之间选择 */
export function pickLang(language: string | undefined | null, zh: string, en: string): string {
  return isEnLanguage(language) ? en : zh;
}

/**
 * 从 express request 中提取语言标记。
 *
 * 取值优先级：body.language → query.language → x-docstudio-language → Accept-Language
 * 统一归一化为 "zh-CN" | "en"，无法识别时返回 undefined（调用方按中文处理）。
 *
 * 为什么把 Accept-Language 也认：它是 **CORS 安全列表内**的请求头，
 * 浏览器发它不会触发 preflight。跨域场景（client:5173 → server:3000）
 * 优先用它，就不会因为「自定义头没进 Access-Control-Allow-Headers」
 * 而在预检阶段被拦掉（表现为 "Failed to fetch"）。
 */
export function readLanguage(req: {
  body?: any;
  query?: any;
  get?: (name: string) => string | undefined;
}): RequestLanguage | undefined {
  const candidates = [
    req.body?.language,
    req.query?.language,
    req.get?.("x-docstudio-language"),
    req.get?.("accept-language"),
  ];
  for (const c of candidates) {
    const normalized = normalizeLanguage(typeof c === "string" ? c : undefined);
    if (normalized) return normalized;
  }
  return undefined;
}
