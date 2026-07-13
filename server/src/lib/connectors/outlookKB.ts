/**
 * Outlook 邮箱知识库同步
 *
 * 将用户 Outlook 邮箱中的邮件和联系人向量化，
 * 通过 MS Graph API 拉取数据，复用统一分块 pipeline。
 */
import { logger } from "../logger.js";
import { ingestFile, type EmbeddingConfig } from "../ingestion.js";
import {
  addRemoteIndex,
  getRemoteIndexesByType,
  getRemoteIndexByRemoteId,
  deleteSource,
  deleteRemoteIndex,
  computeTextHash,
  getAllSources,
  getChunksBySourceId,
} from "../knowledgeDb.js";
import { getAllPeople, type Person } from "../peopleGraph.js";

// ── 类型 ──────────────────────────────────────────────

export interface OutlookKBConfig {
  accessToken: string;
}

export interface OutlookEmail {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
  importance: string;
}

export interface OutlookContact {
  id: string;
  displayName: string;
  emailAddresses: string[];
  companyName?: string;
  jobTitle?: string;
  department?: string;
}

// ── 邮件拉取 ──────────────────────────────────────────

const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphFetch(url: string, accessToken: string, timeout = 30_000): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API error: ${res.status} ${body}`);
  }

  return res;
}

/**
 * 分页拉取所有邮件（包含完整 body）
 */
async function fetchAllEmails(config: OutlookKBConfig, maxEmails = 500): Promise<OutlookEmail[]> {
  const emails: OutlookEmail[] = [];
  let url = `${MS_GRAPH_BASE}/me/messages?$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,importance&$orderby=receivedDateTime desc`;

  while (url && emails.length < maxEmails) {
    const res = await graphFetch(url, config.accessToken);
    const data = (await res.json()) as {
      value: Array<{
        id: string;
        subject: string;
        from?: { emailAddress?: { name?: string; address?: string } };
        toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
        ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
        receivedDateTime: string;
        body?: { content?: string; contentType?: string };
        importance: string;
      }>;
      "@odata.nextLink"?: string;
    };

    for (const item of data.value) {
      emails.push({
        id: item.id,
        subject: item.subject ?? "(无主题)",
        from: item.from?.emailAddress?.name ?? item.from?.emailAddress?.address ?? "unknown",
        to: (item.toRecipients ?? []).map(r => r.emailAddress?.name ?? r.emailAddress?.address ?? "unknown"),
        cc: (item.ccRecipients ?? []).map(r => r.emailAddress?.name ?? r.emailAddress?.address ?? "unknown"),
        receivedDateTime: item.receivedDateTime,
        bodyPreview: "",
        body: item.body?.content ?? "",
        importance: item.importance,
      });
    }

    url = data["@odata.nextLink"] ?? "";
  }

  logger.info(`[OutlookKB] 拉取到 ${emails.length} 封邮件`);
  return emails;
}

/**
 * 将邮件转换为可索引文本
 */
function emailToText(email: OutlookEmail): string {
  const parts: string[] = [];
  parts.push(`Subject: ${email.subject}`);
  parts.push(`From: ${email.from}`);
  if (email.to.length > 0) parts.push(`To: ${email.to.join(", ")}`);
  if (email.cc.length > 0) parts.push(`CC: ${email.cc.join(", ")}`);
  parts.push(`Received: ${email.receivedDateTime}`);
  parts.push(`Importance: ${email.importance}`);
  parts.push("");
  parts.push(email.body);
  return parts.join("\n");
}

// ── 联系人拉取 ────────────────────────────────────────

/**
 * 拉取 Outlook 联系人
 */
async function fetchAllContacts(config: OutlookKBConfig, maxContacts = 200): Promise<OutlookContact[]> {
  const contacts: OutlookContact[] = [];
  let url = `${MS_GRAPH_BASE}/me/contacts?$top=100&$select=id,displayName,emailAddresses,companyName,jobTitle,department`;

  while (url && contacts.length < maxContacts) {
    const res = await graphFetch(url, config.accessToken);
    const data = (await res.json()) as {
      value: Array<{
        id: string;
        displayName?: string;
        emailAddresses?: Array<{ address?: string; name?: string }>;
        companyName?: string;
        jobTitle?: string;
        department?: string;
      }>;
      "@odata.nextLink"?: string;
    };

    for (const item of data.value) {
      contacts.push({
        id: item.id,
        displayName: item.displayName ?? "未知",
        emailAddresses: (item.emailAddresses ?? []).map(e => e.address ?? e.name ?? "").filter(Boolean),
        companyName: item.companyName,
        jobTitle: item.jobTitle,
        department: item.department,
      });
    }

    url = data["@odata.nextLink"] ?? "";
  }

  logger.info(`[OutlookKB] 拉取到 ${contacts.length} 个联系人`);
  return contacts;
}

/**
 * 将联系人转换为可索引文本
 */
function contactToText(contact: OutlookContact): string {
  const parts: string[] = [];
  parts.push(`Name: ${contact.displayName}`);
  if (contact.emailAddresses.length > 0) parts.push(`Email: ${contact.emailAddresses.join(", ")}`);
  if (contact.jobTitle) parts.push(`Title: ${contact.jobTitle}`);
  if (contact.department) parts.push(`Department: ${contact.department}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  return parts.join("\n");
}

// ── 同步主函数 ────────────────────────────────────────

export interface OutlookSyncResult {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

/**
 * 全量同步 Outlook 邮件到知识库
 */
export async function syncEmailsToKB(
  config: OutlookKBConfig,
  options: { maxEmails?: number; embedding?: EmbeddingConfig },
): Promise<OutlookSyncResult> {
  const result: OutlookSyncResult = { total: 0, processed: 0, skipped: 0, errors: 0, errorMessages: [] };
  const maxEmails = options.maxEmails ?? 500;

  const emails = await fetchAllEmails(config, maxEmails);
  result.total = emails.length;
  const sourceType = "outlook_email" as const;

  for (const email of emails) {
    try {
      const text = emailToText(email);
      const contentHash = computeTextHash(text);

      const existing = getRemoteIndexByRemoteId(sourceType, email.id);
      if (existing && existing.contentHash === contentHash) {
        result.skipped++;
        continue;
      }

      if (existing) deleteSource(existing.id);

      const ingestResult = await ingestFile({
        content: text,
        fileName: `${email.subject.slice(0, 80)}.eml`,
        sourceType,
        url: `https://outlook.office.com/mail/inbox/id/${email.id}`,
        filePath: `outlook://email/${email.id}`,
        contentHash,
        skipDuplicateCheck: true,
        embedding: options.embedding,
      });

      if (ingestResult.status === "empty") { result.skipped++; continue; }

      addRemoteIndex({
        id: ingestResult.sourceId,
        sourceType,
        remoteId: email.id,
        name: email.subject.slice(0, 200),
        url: `https://outlook.office.com/mail/inbox/id/${email.id}`,
        metadata: {
          from: email.from,
          to: email.to.join(", "),
          receivedDateTime: email.receivedDateTime,
          importance: email.importance,
        },
        contentHash,
        chunkCount: ingestResult.chunkCount,
        status: "indexed",
      });

      result.processed++;
    } catch (err) {
      result.errors++;
      const msg = `邮件 "${email.subject.slice(0, 50)}" 同步失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errorMessages.push(msg);
      logger.warn(`[OutlookKB] ${msg}`);
    }
  }

  logger.info(`[OutlookKB] 邮件同步完成: total=${result.total} processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`);
  return result;
}

/**
 * 全量同步 Outlook 联系人到知识库
 */
export async function syncContactsToKB(
  config: OutlookKBConfig,
  options: { maxContacts?: number; embedding?: EmbeddingConfig },
): Promise<OutlookSyncResult> {
  const result: OutlookSyncResult = { total: 0, processed: 0, skipped: 0, errors: 0, errorMessages: [] };
  const maxContacts = options.maxContacts ?? 200;

  const contacts = await fetchAllContacts(config, maxContacts);
  result.total = contacts.length;
  const sourceType = "outlook_contact" as const;

  for (const contact of contacts) {
    try {
      const text = contactToText(contact);
      const contentHash = computeTextHash(text);

      const existing = getRemoteIndexByRemoteId(sourceType, contact.id);
      if (existing && existing.contentHash === contentHash) {
        result.skipped++;
        continue;
      }

      if (existing) deleteSource(existing.id);

      const ingestResult = await ingestFile({
        content: text,
        fileName: `${contact.displayName}.txt`,
        sourceType,
        filePath: `outlook://contact/${contact.id}`,
        contentHash,
        skipDuplicateCheck: true,
        embedding: options.embedding,
      });

      if (ingestResult.status === "empty") { result.skipped++; continue; }

      addRemoteIndex({
        id: ingestResult.sourceId,
        sourceType,
        remoteId: contact.id,
        name: contact.displayName,
        metadata: {
          displayName: contact.displayName,
          emailAddresses: contact.emailAddresses.join(", "),
          jobTitle: contact.jobTitle ?? "",
          department: contact.department ?? "",
          companyName: contact.companyName ?? "",
        },
        contentHash,
        chunkCount: ingestResult.chunkCount,
        status: "indexed",
      });

      result.processed++;
    } catch (err) {
      result.errors++;
      const msg = `联系人 "${contact.displayName}" 同步失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errorMessages.push(msg);
      logger.warn(`[OutlookKB] ${msg}`);
    }
  }

  logger.info(`[OutlookKB] 联系人同步完成: total=${result.total} processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`);
  return result;
}

/**
 * 清除指定类型的 Outlook KB 数据
 */
export function clearOutlookKB(sourceType: "outlook_email" | "outlook_contact"): number {
  const indexes = getRemoteIndexesByType(sourceType);
  for (const idx of indexes) {
    deleteSource(idx.id);
    deleteRemoteIndex(idx.id);
  }
  logger.info(`[OutlookKB] 已清除 ${sourceType}: ${indexes.length} 条`);
  return indexes.length;
}

/**
 * 获取 Outlook KB 同步状态
 */
export function getOutlookKBStatus(sourceType: "outlook_email" | "outlook_contact"): {
  count: number;
  totalChunks: number;
} {
  const indexes = getRemoteIndexesByType(sourceType);
  return {
    count: indexes.length,
    totalChunks: indexes.reduce((sum, idx) => sum + idx.chunkCount, 0),
  };
}

// ── 邮件发送（.eml 批量发送到 Outlook） ──────────────

export interface SendEmlResult {
  total: number;
  sent: number;
  errors: number;
  errorMessages: string[];
}

async function sendMailViaGraph(
  accessToken: string,
  subject: string,
  body: string,
  toAddress: string,
  ccAddress?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    message: {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: toAddress } }],
    },
  };
  if (ccAddress) {
    (payload.message as Record<string, unknown>).ccRecipients = [
      { emailAddress: { address: ccAddress } },
    ];
  }

  const res = await fetch(`${MS_GRAPH_BASE}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sendMail failed: ${res.status} ${text}`);
  }
}

/**
 * 将知识库中所有 .eml 源逐封发送到指定 Outlook 邮箱
 */
export async function sendEmlFilesAsEmails(
  config: OutlookKBConfig,
  toAddress: string,
  ccAddress?: string,
): Promise<SendEmlResult> {
  const result: SendEmlResult = { total: 0, sent: 0, errors: 0, errorMessages: [] };

  const sources = getAllSources().filter(s => s.name.toLowerCase().endsWith(".eml"));
  result.total = sources.length;

  if (sources.length === 0) {
    logger.info("[OutlookKB] 没有找到 .eml 源");
    return result;
  }

  logger.info(`[OutlookKB] 开始发送 ${sources.length} 封 .eml 邮件`);

  for (const source of sources) {
    try {
      const chunks = getChunksBySourceId(source.id);
      const bodyChunks = chunks.map(c => c.content).join("\n");
      const cleanBody = stripHtmlTags(bodyChunks);
      const subject = source.name.replace(/\.eml$/i, "");

      await sendMailViaGraph(config.accessToken, subject, cleanBody, toAddress, ccAddress);
      result.sent++;
      logger.info(`[OutlookKB] 邮件已发送: ${subject}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      result.errors++;
      const msg = `发送 "${source.name}" 失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errorMessages.push(msg);
      logger.warn(`[OutlookKB] ${msg}`);
    }
  }

  logger.info(`[OutlookKB] 邮件发送完成: total=${result.total} sent=${result.sent} errors=${result.errors}`);
  return result;
}

// ── 联系人创建（People Graph → Outlook Contacts） ────

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

async function createContactViaGraph(
  accessToken: string,
  displayName: string,
  emailAddresses: string[],
  jobTitle?: string,
  department?: string,
  companyName?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    displayName,
    emailAddresses: emailAddresses.map(addr => ({ address: addr })),
  };
  if (jobTitle) payload.jobTitle = jobTitle;
  if (department) payload.department = department;
  if (companyName) payload.companyName = companyName;

  const res = await fetch(`${MS_GRAPH_BASE}/me/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`createContact failed: ${res.status} ${text}`);
  }
}

export interface CreateContactsResult {
  total: number;
  created: number;
  errors: number;
  errorMessages: string[];
}

/**
 * 将 People Graph 中的所有联系人创建到 Outlook 邮箱
 */
export async function createContactsFromPeopleGraph(
  config: OutlookKBConfig,
): Promise<CreateContactsResult> {
  const result: CreateContactsResult = { total: 0, created: 0, errors: 0, errorMessages: [] };

  const people = getAllPeople();
  result.total = people.length;

  if (people.length === 0) {
    logger.info("[OutlookKB] People Graph 中没有联系人");
    return result;
  }

  logger.info(`[OutlookKB] 开始创建 ${people.length} 个联系人`);

  for (const person of people) {
    try {
      await createContactViaGraph(
        config.accessToken,
        person.name,
        person.email ? [person.email] : [],
        person.title,
        person.department,
        undefined,
      );
      result.created++;
      logger.info(`[OutlookKB] 联系人已创建: ${person.name}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      result.errors++;
      const msg = `创建联系人 "${person.name}" 失败: ${err instanceof Error ? err.message : String(err)}`;
      result.errorMessages.push(msg);
      logger.warn(`[OutlookKB] ${msg}`);
    }
  }

  logger.info(`[OutlookKB] 联系人创建完成: total=${result.total} created=${result.created} errors=${result.errors}`);
  return result;
}
