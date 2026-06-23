/**
 * 文本预处理管道 — 沿用 patentExaminator 流程
 *
 * cleanText → normalizeWidth → normalizeDate
 */

/** 清理页眉页脚、水印、多余空白 */
export function cleanText(text: string): string {
  let t = text;
  // 页眉页脚模式
  t = t.replace(/第\s*\d+\s*页/g, "");
  t = t.replace(/-\s*\d+\s*-/g, "");
  t = t.replace(/\d+\s*\/\s*\d+/g, "");
  // 水印
  t = t.replace(/仅供|内部|草稿|DRAFT|CONFIDENTIAL/gi, "");
  // 多余空白
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** 全角→半角 */
export function normalizeWidth(text: string): string {
  let r = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      r += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      r += " ";
    } else {
      r += ch;
    }
  }
  return r;
}

/** 日期标准化 */
export function normalizeDate(text: string): string {
  let t = text;
  t = t.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  t = t.replace(/(\d{4})\.(\d{1,2})\.(\d{1,2})/g, (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  return t;
}

/** 完整预处理管道 */
export function preprocessText(text: string): string {
  let t = text;
  t = cleanText(t);
  t = normalizeWidth(t);
  t = normalizeDate(t);
  return t;
}
