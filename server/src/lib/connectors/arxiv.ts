/**
 * arXiv API Connector
 *
 * Feature #31: arXiv 连接器
 *
 * 公开 API 搜索和导入 arXiv 论文。
 */

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  published: string;
  updated: string;
  pdfUrl: string;
  absUrl: string;
}

// ── Search ─────────────────────────────────────────────

export async function searchArxiv(
  query: string,
  options?: { maxResults?: number; sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate" },
): Promise<ArxivPaper[]> {
  const maxResults = options?.maxResults ?? 10;
  const sortBy = options?.sortBy ?? "relevance";

  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: String(maxResults),
    sortBy,
    sortOrder: "descending",
  });

  const url = `http://export.arxiv.org/api/query?${params.toString()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`arXiv API error: ${res.status} ${body}`);
  }

  const xml = await res.text();
  return parseArxivXml(xml);
}

// ── XML Parsing ────────────────────────────────────────

function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];

  // Simple XML parsing (no external dependency)
  const entries = xml.split("<entry>").slice(1);

  for (const entry of entries) {
    const id = extractTag(entry, "id") ?? "";
    const title = extractTag(entry, "title")?.replace(/\s+/g, " ").trim() ?? "";
    const abstract = extractTag(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
    const published = extractTag(entry, "published") ?? "";
    const updated = extractTag(entry, "updated") ?? "";

    // Extract authors
    const authors: string[] = [];
    const authorBlocks = entry.split("<author>").slice(1);
    for (const block of authorBlocks) {
      const name = extractTag(block, "name");
      if (name) authors.push(name);
    }

    // Extract categories
    const categories: string[] = [];
    const categoryMatches = entry.matchAll(/<category[^>]*term="([^"]*)"[^>]*>/g);
    for (const match of categoryMatches) {
      if (match[1]) categories.push(match[1]);
    }

    // Extract PDF URL
    let pdfUrl = "";
    const pdfMatch = entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]*)"[^>]*>/);
    if (pdfMatch) {
      pdfUrl = pdfMatch[1] ?? "";
    }

    // Extract abs URL
    let absUrl = "";
    const absMatch = entry.match(/<link[^>]*title="abs"[^>]*href="([^"]*)"[^>]*>/);
    if (absMatch) {
      absUrl = absMatch[1] ?? "";
    }

    if (id && title) {
      papers.push({
        id: id.replace("http://arxiv.org/abs/", ""),
        title,
        authors,
        abstract,
        categories,
        published,
        updated,
        pdfUrl,
        absUrl: absUrl || `https://arxiv.org/abs/${id.replace("http://arxiv.org/abs/", "")}`,
      });
    }
  }

  return papers;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? null;
}

// ── Paper Import ───────────────────────────────────────

export async function importArxivPaper(paperId: string): Promise<ArxivPaper | null> {
  const papers = await searchArxiv(`id:${paperId}`, { maxResults: 1 });
  return papers[0] ?? null;
}

export async function importArxivPapers(
  query: string,
  maxResults: number = 10,
): Promise<ArxivPaper[]> {
  return searchArxiv(query, { maxResults, sortBy: "relevance" });
}

// ── 统一导入接口 ───────────────────────────────────────

export interface ArxivImportResult {
  query: string;
  papersFound: number;
  papers: ArxivPaper[];
  errors: string[];
}

export async function importFromArxiv(
  queries: string[],
  maxResultsPerQuery: number = 5,
): Promise<ArxivImportResult[]> {
  const results: ArxivImportResult[] = [];

  for (const query of queries) {
    try {
      const papers = await searchArxiv(query, { maxResults: maxResultsPerQuery });
      results.push({
        query,
        papersFound: papers.length,
        papers,
        errors: [],
      });
    } catch (err) {
      results.push({
        query,
        papersFound: 0,
        papers: [],
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return results;
}
