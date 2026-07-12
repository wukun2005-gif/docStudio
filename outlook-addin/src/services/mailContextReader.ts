/**
 * Mail Context Reader — 读取当前邮件的元数据
 *
 * 使用 Office.context.mailbox.item API：
 * - item.subject.getAsync() — 主题
 * - item.from.getAsync() — 发件人
 * - item.body.getAsync("text") — 纯文本正文（用于 RAG 检索上下文）
 * - item.itemType — 区分 read / compose 模式
 *
 * 所有 getAsync 都是 Office.js 异步 API，必须用 callback/Promise 包装。
 */

/** 邮件模式 */
export type MailMode = "read" | "compose" | "unknown";

/** 邮件上下文 */
export interface MailContext {
  mode: MailMode;
  itemId: string | null;
  subject: string;
  from: string;
  bodyText: string;
  /** Compose 模式独有：是否支持 setAsync 写回 */
  canWrite: boolean;
  /** Office 加载错误信息（如果 Office.js 不可用） */
  error: string | null;
}

/** 将 AsyncResult<T> 包装为 Promise */
function asyncToPromise<T>(method: (cb: (r: { status: number; value?: T; error?: { message: string } }) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    method((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value as T);
      } else {
        reject(new Error(result.error?.message ?? "Office.js async call failed"));
      }
    });
  });
}

/** 等待 Office.js 准备就绪 */
export async function waitForOfficeReady(maxWaitMs = 10_000): Promise<boolean> {
  if (typeof Office === "undefined") {
    return false;
  }
  if (Office.context?.mailbox?.item) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, maxWaitMs);
    Office.onReady(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(!!Office.context?.mailbox?.item);
      }
    });
  });
}

/** 读取当前邮件的完整上下文 */
export async function readMailContext(): Promise<MailContext> {
  const ctx: MailContext = {
    mode: "unknown",
    itemId: null,
    subject: "",
    from: "",
    bodyText: "",
    canWrite: false,
    error: null,
  };

  try {
    const ready = await waitForOfficeReady();
    if (!ready || !Office.context?.mailbox?.item) {
      ctx.error = "Office.js 不可用或 mail item 未加载";
      return ctx;
    }

    const item = Office.context.mailbox.item;
    ctx.itemId = item.itemId ?? null;
    ctx.canWrite = typeof item.body?.setAsync === "function";

    // 区分 read / compose 模式
    if (item.itemType === Office.MailboxEnums.ItemType.Message && typeof item.body?.setAsync === "function") {
      ctx.mode = "compose";
    } else if (item.itemType === Office.MailboxEnums.ItemType.Message) {
      ctx.mode = "read";
    }

    // 读取 subject / from / body（并发）
    const [subject, from, bodyText] = await Promise.all([
      asyncToPromise<string>((cb) => item.subject.getAsync((r) => cb(r as any)))
        .catch(() => ""),
      asyncToPromise<{ displayName: string; emailAddress: string }>((cb) => item.from.getAsync((r) => cb(r as any)))
        .catch(() => null)
        .then((v) => (v ? `${v.displayName} <${v.emailAddress}>` : "")),
      asyncToPromise<string>((cb) => item.body.getAsync(Office.CoercionType.Text, (r) => cb(r as any)))
        .catch(() => ""),
    ]);

    ctx.subject = subject ?? "";
    ctx.from = from ?? "";
    ctx.bodyText = (bodyText ?? "").slice(0, 2000); // 截断避免 RAG context 爆炸
  } catch (err) {
    ctx.error = err instanceof Error ? err.message : String(err);
  }

  return ctx;
}
