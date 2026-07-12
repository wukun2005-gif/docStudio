/**
 * Mail Write Service — 将生成的邮件写回 Outlook 当前邮件正文
 *
 * 核心 API: Office.context.mailbox.item.body.setAsync(htmlBody, { coercionType: 'html' })
 *
 * 模式：
 * - Compose 模式：直接覆盖（用户预期会写回 draft）
 * - Read 模式：拒绝覆盖（避免误覆盖原邮件正文）
 *
 * 安全约束（与 project_rules.md 中 Office.js 一致）：
 * - 使用 Office enum 而非 string
 * - 用 setAsync 单一原子调用，避免多次异步导致半写状态
 * - 失败时抛出可识别的错误，让 UI 提示用户
 */
import type { EmailWritePayload } from "./apiClient";

export interface WriteResult {
  ok: boolean;
  bytesWritten: number;
  error?: string;
}

/** 检查当前 mail item 是否支持写回 */
export function canWriteToMail(): boolean {
  if (typeof Office === "undefined") return false;
  const item = Office.context?.mailbox?.item;
  if (!item) return false;
  return typeof item.body?.setAsync === "function";
}

/** 获取当前 mail item 的 mode（read / compose） */
export function getMailMode(): "read" | "compose" | "unknown" {
  if (typeof Office === "undefined") return "unknown";
  const item = Office.context?.mailbox?.item;
  if (!item) return "unknown";
  // Compose 模式：item.body.setAsync 存在
  return typeof item.body?.setAsync === "function" ? "compose" : "read";
}

/**
 * 将 email payload 写回当前邮件正文。
 *
 * @param payload - 服务端 /api/generation/email 返回的 emailPayload
 * @returns WriteResult
 *
 * 行为：
 * - Compose 模式：覆盖当前 draft body，prepend 邮件主题提示
 * - Read 模式：拒绝操作（返回 ok=false, error=...）
 * - 写入前在 bodyHtml 顶部添加「由 i-Write 起草」+ 当前时间戳
 * - 写入完成输出字符数 + 字节数
 */
export async function writeEmailToMail(payload: EmailWritePayload): Promise<WriteResult> {
  const mode = getMailMode();
  if (mode !== "compose") {
    return {
      ok: false,
      bytesWritten: 0,
      error: `当前为 ${mode} 模式，不支持写回邮件正文（仅 compose 模式可写回）`,
    };
  }

  if (typeof Office === "undefined" || !Office.context?.mailbox?.item) {
    return { ok: false, bytesWritten: 0, error: "Office.js 不可用" };
  }

  const item = Office.context.mailbox.item;

  // 在 HTML 顶部添加 i-Write 标识 + 主题 + 时间
  const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
  const banner = `<div style="background:#f3f2f1;padding:8px 12px;border-left:3px solid #1a73e8;margin-bottom:12px;font-size:12px;color:#666">
    <strong>由 i-Write 起草</strong> · ${timestamp} · 主题：${escapeHtml(payload.subject)}
  </div>`;
  const fullHtml = banner + payload.bodyHtml;

  return new Promise<WriteResult>((resolve) => {
    item.body.setAsync(
      fullHtml,
      { coercionType: Office.CoercionType.Html },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve({ ok: true, bytesWritten: fullHtml.length });
        } else {
          resolve({
            ok: false,
            bytesWritten: 0,
            error: result.error?.message ?? "setAsync 失败",
          });
        }
      },
    );
  });
}

/**
 * 设置邮件主题（Compose 模式可用）
 */
export async function setMailSubject(subject: string): Promise<WriteResult> {
  const mode = getMailMode();
  if (mode !== "compose") {
    return { ok: false, bytesWritten: 0, error: `当前为 ${mode} 模式，不支持设置主题` };
  }
  if (typeof Office === "undefined" || !Office.context?.mailbox?.item) {
    return { ok: false, bytesWritten: 0, error: "Office.js 不可用" };
  }

  const item = Office.context.mailbox.item;
  return new Promise<WriteResult>((resolve) => {
    item.subject.setAsync(subject, (result: { status: number; error?: { message: string } }) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve({ ok: true, bytesWritten: subject.length });
      } else {
        resolve({
          ok: false,
          bytesWritten: 0,
          error: result.error?.message ?? "setSubject 失败",
        });
      }
    });
  });
}

/** HTML 文本转义（防 XSS 注入到邮件正文） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
