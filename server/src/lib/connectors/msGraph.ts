/**
 * Microsoft Graph API Connector
 *
 * Feature #28: MS OAuth 登录
 * Feature #29: OneDrive/SharePoint 连接器
 * Feature #32: Outlook 连接器
 * Feature #33: Teams 连接器
 *
 * 通过 Microsoft Graph API 拉取用户的 OneDrive、SharePoint、Outlook、Teams 内容。
 */

export interface MsGraphConfig {
  accessToken: string;
}

export interface MsGraphFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webUrl: string;
  lastModifiedDateTime: string;
  content?: string;
}

export interface MsGraphEmail {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
  importance: string;
}

export interface MsGraphChat {
  id: string;
  topic: string;
  lastMessageDateTime: string;
  messages: MsGraphChatMessage[];
}

export interface MsGraphChatMessage {
  id: string;
  from: string;
  body: string;
  createdDateTime: string;
}

export interface MsGraphEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  body: string;
  attendees: string[];
  location?: string;
}

// ── OneDrive / SharePoint ──────────────────────────────

export async function listOneDriveFiles(config: MsGraphConfig): Promise<MsGraphFile[]> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OneDrive API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    value: Array<{
      id: string;
      name: string;
      file?: { mimeType: string; hashes?: { quickXorHash?: string } };
      folder?: unknown;
      size: number;
      webUrl: string;
      lastModifiedDateTime: string;
    }>;
  };

  return data.value
    .filter(item => !item.folder) // 只返回文件，不包括文件夹
    .map(item => ({
      id: item.id,
      name: item.name,
      mimeType: item.file?.mimeType ?? "application/octet-stream",
      size: item.size,
      webUrl: item.webUrl,
      lastModifiedDateTime: item.lastModifiedDateTime,
    }));
}

export async function downloadOneDriveFile(
  config: MsGraphConfig,
  fileId: string,
): Promise<string> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OneDrive download error: ${res.status} ${body}`);
  }

  return res.text();
}

export async function searchOneDrive(
  config: MsGraphConfig,
  query: string,
): Promise<MsGraphFile[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(query)}')`,
    {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OneDrive search error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    value: Array<{
      id: string;
      name: string;
      file?: { mimeType: string };
      size: number;
      webUrl: string;
      lastModifiedDateTime: string;
    }>;
  };

  return data.value
    .filter(item => item.file)
    .map(item => ({
      id: item.id,
      name: item.name,
      mimeType: item.file?.mimeType ?? "application/octet-stream",
      size: item.size,
      webUrl: item.webUrl,
      lastModifiedDateTime: item.lastModifiedDateTime,
    }));
}

// ── Outlook ────────────────────────────────────────────

export async function listOutlookEmails(
  config: MsGraphConfig,
  options?: { top?: number; filter?: string },
): Promise<MsGraphEmail[]> {
  const top = options?.top ?? 20;
  let url = `https://graph.microsoft.com/v1.0/me/messages?$top=${top}&$orderby=receivedDateTime desc`;
  if (options?.filter) {
    url += `&$filter=${encodeURIComponent(options.filter)}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Outlook API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    value: Array<{
      id: string;
      subject: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      receivedDateTime: string;
      bodyPreview: string;
      body?: { content?: string };
      importance: string;
    }>;
  };

  return data.value.map(item => ({
    id: item.id,
    subject: item.subject,
    from: item.from?.emailAddress?.name ?? item.from?.emailAddress?.address ?? "unknown",
    receivedDateTime: item.receivedDateTime,
    bodyPreview: item.bodyPreview,
    body: item.body?.content ?? item.bodyPreview,
    importance: item.importance,
  }));
}

// ── Teams ──────────────────────────────────────────────

export async function listTeamsChats(
  config: MsGraphConfig,
  options?: { top?: number },
): Promise<MsGraphChat[]> {
  const top = options?.top ?? 10;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/chats?$top=${top}&$expand=messages($top=20;$orderby=createdDateTime desc)`,
    {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Teams API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    value: Array<{
      id: string;
      topic?: string;
      lastMessageDateTime?: string;
      messages?: Array<{
        id: string;
        from?: { user?: { displayName?: string } };
        body?: { content?: string };
        createdDateTime: string;
      }>;
    }>;
  };

  return data.value.map(chat => ({
    id: chat.id,
    topic: chat.topic ?? "Untitled Chat",
    lastMessageDateTime: chat.lastMessageDateTime ?? "",
    messages: (chat.messages ?? []).map(msg => ({
      id: msg.id,
      from: msg.from?.user?.displayName ?? "unknown",
      body: msg.body?.content ?? "",
      createdDateTime: msg.createdDateTime,
    })),
  }));
}

// ── Calendar (Teams Meetings) ──────────────────────────

export async function listCalendarEvents(
  config: MsGraphConfig,
  options?: { top?: number; startDateTime?: string; endDateTime?: string },
): Promise<MsGraphEvent[]> {
  const top = options?.top ?? 20;
  let url = `https://graph.microsoft.com/v1.0/me/events?$top=${top}&$orderby=start/dateTime desc`;

  if (options?.startDateTime && options?.endDateTime) {
    url += `&$filter=start/dateTime ge '${options.startDateTime}' and end/dateTime le '${options.endDateTime}'`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    value: Array<{
      id: string;
      subject: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      body?: { content?: string };
      attendees?: Array<{ emailAddress?: { address?: string } }>;
      location?: { displayName?: string };
    }>;
  };

  return data.value.map(event => ({
    id: event.id,
    subject: event.subject,
    start: event.start?.dateTime ?? "",
    end: event.end?.dateTime ?? "",
    body: event.body?.content ?? "",
    attendees: (event.attendees ?? []).map(a => a.emailAddress?.address ?? "unknown"),
    location: event.location?.displayName,
  }));
}

// ── 统一导入接口 ───────────────────────────────────────

export interface MsGraphImportResult {
  source: "onedrive" | "outlook" | "teams";
  items: number;
  errors: string[];
}

export async function importFromMsGraph(
  config: MsGraphConfig,
  sources: Array<"onedrive" | "outlook" | "teams">,
): Promise<MsGraphImportResult[]> {
  const results: MsGraphImportResult[] = [];

  for (const source of sources) {
    const result: MsGraphImportResult = { source, items: 0, errors: [] };

    try {
      switch (source) {
        case "onedrive": {
          const files = await listOneDriveFiles(config);
          result.items = files.length;
          break;
        }
        case "outlook": {
          const emails = await listOutlookEmails(config, { top: 50 });
          result.items = emails.length;
          break;
        }
        case "teams": {
          const chats = await listTeamsChats(config, { top: 20 });
          result.items = chats.reduce((sum, chat) => sum + chat.messages.length, 0);
          break;
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push(result);
  }

  return results;
}
