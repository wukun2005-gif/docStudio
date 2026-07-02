/**
 * Bug 5: Citation 去重 — 同一文件的不同 chunk / 不同 sourceId 但相同文件名的去重
 *
 * 根本原因：
 * 1. fuseAndRank 没有按 sourceId 去重 rag citations → 修复 2
 * 2. toHtml 中的 dedupKey 过度依赖 sourceId → 修复 1（URL > sourceId > title）
 * 3. filterConflictingContent 的本地重新编号破坏了全局编号的唯一性
 */
import { describe, it, expect } from "vitest";
import { toHtml, type GenerateDocResult } from "../../server/src/lib/docGenerator.js";
import { cleanContent } from "../../server/src/lib/contentCleaner.js";

function makeSection(
  title: string,
  citations: Array<{ index: number; title: string; sourceId?: string; url?: string }>,
) {
  const sources = citations.map((c, i) => ({
    chunkId: `chunk_${title}_${i}`,
    content: `内容片段 ${i}`,
    score: 0.9 - i * 0.05,
    sourceId: c.sourceId || "",
    sourceName: c.title,
  }));
  const citationLinks = citations.map((c) => ({
    index: c.index,
    title: c.title,
    url: c.url || "",
    sourceId: c.sourceId || "",
  }));
  const rawContent = citations.map((c) => `引用了${c.title} [${c.index}]。`).join(" ");
  const content = cleanContent(rawContent, "docx" as any, citationLinks);
  return { title, content, sources, webCitations: [] as any[], groundingScore: 0.9, citationLinks };
}

describe("Bug 5: Citation 去重", () => {
  it("同章节内相同 sourceId 的 citations 应该被去重（并重新编号为 1, 2, ...）", () => {
    const section = makeSection("数据安全", [
      { index: 10, title: "数据安全合规方案.docx", sourceId: "uuid-same-123" },
      { index: 11, title: "数据安全合规方案.docx", sourceId: "uuid-same-123" },
      { index: 12, title: "其他文档.docx", sourceId: "uuid-other" },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    // 检查 citation-item 的数量（不是字符串出现次数，因为 URL 中可能也包含标题）
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    expect(itemMatches.length).toBe(2); // 去重后应该只有 2 个条目（同一 sourceId 合并）
    // 重新编号后：原 [10] → [1], [12] → [2]
    expect(html).toContain(">[1]<");
    expect(html).toContain(">[2]<");
    expect(html).not.toContain(">[10]<");
    expect(html).not.toContain(">[11]<");
    expect(html).not.toContain(">[12]<");
  });

  it("跨章节相同 sourceId 的 citations 应该被去重", () => {
    const section1 = makeSection("章节一", [
      { index: 1, title: "数据安全合规方案.docx", sourceId: "uuid-aaa" },
      { index: 2, title: "其他文件.docx", sourceId: "uuid-bbb" },
    ]);
    const section2 = makeSection("章节二", [
      { index: 5, title: "数据安全合规方案.docx", sourceId: "uuid-aaa" },
      { index: 6, title: "另一个文件.docx", sourceId: "uuid-ccc" },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section1, section2], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    expect(itemMatches.length).toBe(3); // uuid-aaa 被去重
    expect(html).toContain(">[1]<");
    expect(html).not.toContain(">[5]<");
  });

  it("不同 sourceId 但相同 URL 的 citations 应该被去重（并重新编号为 1）", () => {
    const sameUrl = "https://github.com/user/repo/blob/main/docs/backlog.md";
    const section = makeSection("参考文档", [
      { index: 3, title: "backlog.md", sourceId: "uuid-x", url: sameUrl },
      { index: 4, title: "backlog.md", sourceId: "uuid-y", url: sameUrl },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    expect(itemMatches.length).toBe(1); // 相同 URL 被去重
    // 重新编号后：原 [3] → [1]
    expect(html).toContain(">[1]<");
    expect(html).not.toContain(">[3]<");
    expect(html).not.toContain(">[4]<");
  });

  it("不同 sourceId 且 URL 为空但相同文件名的 citations 不应该被去重（它们是不同的文件）", () => {
    // 注意：在真实 log 中重复是因为 sourceId 相同（fuseAndRank 没有去重），
    // 不是因为不同 sourceId 的文件名巧合
    const section = makeSection("本地文件", [
      { index: 7, title: "客户案例研究.docx", sourceId: "uuid-case-a" },
      { index: 8, title: "客户案例研究.docx", sourceId: "uuid-case-b" },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    // 不同 sourceId 是不同的文件，保留
    expect(itemMatches.length).toBe(2);
  });

  it("sourceId 为空但 URL 相同的 citations 应该被去重（Web 搜索场景）", () => {
    const webUrl = "https://example.com/article";
    const section = makeSection("搜索结果", [
      { index: 1, title: "Example Article", url: webUrl },
      { index: 2, title: "Example Article", url: webUrl },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    expect(itemMatches.length).toBe(1);
  });

  it("不同文件（不同 sourceId 不同 title）不应该被去重", () => {
    const section = makeSection("多文件", [
      { index: 1, title: "文件A.docx", sourceId: "uuid-a" },
      { index: 2, title: "文件B.docx", sourceId: "uuid-b" },
      { index: 3, title: "文件C.docx", sourceId: "uuid-c" },
    ]);
    const result: GenerateDocResult = {
      content: "测试", documentStyle: "report", sections: [section], trustScore: 0.9,
    };
    const html = toHtml(result);
    const refListMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(refListMatch).not.toBeNull();
    const itemMatches = refListMatch![0].match(/<div class="citation-item">/g) || [];
    expect(itemMatches.length).toBe(3); // 3 个不同文件都保留
  });
});