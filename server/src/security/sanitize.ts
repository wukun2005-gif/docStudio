/**
 * 输入清理模块 — PII 移除 + prompt injection 中和
 */

/** 移除 PII（手机号、邮箱、身份证号） */
export function removePII(text: string): string {
  let result = text;
  // 手机号
  result = result.replace(/1[3-9]\d{9}/g, "***手机号***");
  // 邮箱
  result = result.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "***邮箱***");
  // 身份证号
  result = result.replace(/\d{17}[\dXx]/g, "***身份证***");
  return result;
}

/** 中和 prompt injection 尝试 */
export function neutralizeInjection(text: string): string {
  // 移除常见的 injection 模式
  let result = text;
  result = result.replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[已过滤]");
  result = result.replace(/system:\s*/gi, "[已过滤]");
  result = result.replace(/<\|im_start\|>/g, "[已过滤]");
  result = result.replace(/<\|im_end\|>/g, "[已过滤]");
  return result;
}
