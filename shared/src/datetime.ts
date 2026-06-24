/**
 * 本地时间工具 — 所有用户/开发者可见的时间都用本地时间
 */

/** 返回本地时间的 ISO-like 字符串（带时区偏移），如 "2026-06-23T14:30:00.000+08:00" */
export function localIso(date: Date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const hh = pad(offset / 60);
  const mm = pad(offset % 60);

  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${sign}${hh}:${mm}`;
}

/** 返回本地时间的短格式，如 "2026-06-23 14:30:00" */
export function localShort(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
