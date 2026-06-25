/**
 * 单元测试 — 使用真实生成的 HTML 验证导出解析
 * 不是自己构造 HTML，而是调用 cleanContent() + toHtml() 生成真实 HTML
 */
import { describe, it, expect } from "vitest";
import { cleanContent, type CitationLink } from "../../server/src/lib/contentCleaner.js";
import { toHtml, type GenerateDocResult } from "../../server/src/lib/docGenerator.js";

// ── 模拟 parseHtmlSections（从 generation.ts 提取） ──
function parseHtmlSections(html: string, title: string): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];

  let processedHtml = html
    .replace(/<sup><a[^>]*>\[(\d+)\]<\/a><\/sup>/g, '[$1]')
    .replace(/<sup><span[^>]*>\[(\d+)\]<\/span><\/sup>/g, '[$1]')
    .replace(/<sup[^>]*>\[(\d+)\]<\/sup>/g, '[$1]')
    .replace(/<a[^>]*>\[(\d+)\]<\/a>/g, '[$1]');

  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = sectionRegex.exec(processedHtml)) !== null) {
    const sectionTitle = match[1].replace(/<[^>]+>/g, "").trim();
    const content = match[2].replace(/<[^>]+>/g, "").trim();
    if (content) {
      sections.push({ title: sectionTitle, content, level: 1 });
    }
  }

  if (sections.length === 0) {
    const text = processedHtml
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) {
      sections.push({ title, content: text, level: 1 });
    }
  }

  return sections;
}

// ── 模拟 parseCitations（从 generation.ts 提取） ──
function parseCitations(html: string): Array<{ index: number; title: string; url?: string }> {
  const citations: Array<{ index: number; title: string; url?: string }> = [];

  const footerMatch = html.match(/<footer class="citations">([\s\S]*?)<\/footer>/);
  if (!footerMatch) return citations;

  const footerHtml = footerMatch[1];

  const itemRegex = /<div class="citation-item">([\s\S]*?)<\/div>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(footerHtml)) !== null) {
    const itemHtml = itemMatch[1];

    const numMatch = itemHtml.match(/\[(\d+)\]/);
    if (!numMatch) continue;
    const index = parseInt(numMatch[1], 10);

    const linkMatch = itemHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
    if (linkMatch) {
      citations.push({ index, url: linkMatch[1], title: linkMatch[2].trim() });
    } else {
      const titleText = itemHtml
        .replace(/<span[^>]*>\[\d+\]<\/span>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (titleText) {
        citations.push({ index, title: titleText });
      }
    }
  }

  return citations;
}

describe("真实 HTML 导出解析验证", () => {
  // 模拟真实的 GenerateDocResult（和 toHtml 生成的一样）
  function createMockResult(style: "email" | "report" = "email"): GenerateDocResult {
    return {
      content: "测试内容",
      documentStyle: style,
      sections: [
        {
          title: "产品开发进展汇报",
          content: cleanContent(
            `苏楠，你好：
回顾过去一周，我们团队主要专注于认证模块的设计与开发工作[1]。在上周三召开的评审会议上，我们确认了认证模块的技术方案[2]。
2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势[3]。预计75%的企业软件将把对话式界面作为用户与业务数据交互的主要方式[4]。
核心功能主要包括三个方面：知识源连接，文档生成以及生成树溯源[5]。`,
            "html",
            [
              { index: 1, title: "03-周三-设计评审会议.docx", url: "", sourceId: "86832973-1df9-48f1-b312-c08d09c93e05" },
              { index: 2, title: "07-苏楠-客户-产品演示确认.eml", url: "", sourceId: "cba04966-ccbe-421a-807e-d81df604f322" },
              { index: 3, title: "2026年文档生成工具综合实力推荐榜", url: "https://www.csdn.net/article/2026-06-12/161934138" },
              { index: 4, title: "2026年企业软件技术预测报告", url: "https://www.alixpartners.com/insights/102migz/2026ai/" },
              { index: 5, title: "产品规划文档-Q3-2026.docx", url: "", sourceId: "4493ede7-4741-4c96-a8f8-128084c3c39b" },
            ],
            style
          ),
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "03-周三-设计评审会议.docx" },
          ],
          webCitations: [],
          groundingScore: 0.9,
          citationLinks: [
            { index: 1, title: "03-周三-设计评审会议.docx", url: "", sourceId: "86832973-1df9-48f1-b312-c08d09c93e05" },
            { index: 2, title: "07-苏楠-客户-产品演示确认.eml", url: "", sourceId: "cba04966-ccbe-421a-807e-d81df604f322" },
            { index: 3, title: "2026年文档生成工具综合实力推荐榜", url: "https://www.csdn.net/article/2026-06-12/161934138" },
            { index: 4, title: "2026年企业软件技术预测报告", url: "https://www.alixpartners.com/insights/102migz/2026ai/" },
            { index: 5, title: "产品规划文档-Q3-2026.docx", url: "", sourceId: "4493ede7-4741-4c96-a8f8-128084c3c39b" },
          ],
        },
      ],
      trustScore: 0.9,
    };
  }

  it("toHtml 生成的 HTML 应该包含 citation 链接", () => {
    const result = createMockResult();
    const html = toHtml(result);

    // 打印真实 HTML 便于调试
    console.log("=== toHtml 生成的真实 HTML ===");
    console.log(html.substring(0, 1000));
    console.log("...");

    // 应该包含 citation 链接
    expect(html).toContain("cite-link");
    expect(html).toContain("[1]");
    expect(html).toContain("[5]");
  });

  it("parseHtmlSections 应该正确处理 toHtml 生成的真实 HTML", () => {
    const result = createMockResult();
    const html = toHtml(result);

    const sections = parseHtmlSections(html, "邮件");

    expect(sections.length).toBe(1);
    const content = sections[0].content;

    console.log("=== parseHtmlSections 解析结果 ===");
    console.log(content);

    // 应该保留 citation 编号
    expect(content).toContain("[1]");
    expect(content).toContain("[2]");
    expect(content).toContain("[3]");
    expect(content).toContain("[4]");
    expect(content).toContain("[5]");

    // 不应该有 HTML 属性残留
    expect(content).not.toContain('class="cite-link"');
    expect(content).not.toContain('target="_blank"');
    expect(content).not.toContain('rel="noopener"');
    expect(content).not.toContain('<a ');
    expect(content).not.toContain('<sup');

    // 不应该有双重括号
    expect(content).not.toContain("[[");
    expect(content).not.toContain("]]");
  });

  it("parseCitations 应该正确解析 toHtml 生成的真实 footer", () => {
    const result = createMockResult();
    const html = toHtml(result);

    const citations = parseCitations(html);

    console.log("=== parseCitations 解析结果 ===");
    console.log(JSON.stringify(citations, null, 2));

    expect(citations.length).toBe(5);

    // 知识库来源
    expect(citations[0].index).toBe(1);
    expect(citations[0].title).toBe("03-周三-设计评审会议.docx");
    expect(citations[0].url).toContain("/api/knowledge/sources/");

    // Web 来源
    expect(citations[2].index).toBe(3);
    expect(citations[2].url).toBe("https://www.csdn.net/article/2026-06-12/161934138");
  });

  it("完整导出流程：正文 citation 与参考来源列表一一对应", () => {
    const result = createMockResult();
    const html = toHtml(result);

    const sections = parseHtmlSections(html, "邮件");
    const citations = parseCitations(html);

    // 正文中应该包含所有 citation 编号
    const content = sections[0].content;
    for (const cite of citations) {
      expect(content).toContain(`[${cite.index}]`);
    }

    // 参考来源数量应该正确
    expect(citations.length).toBe(5);
  });

  it("报告格式也应该正确处理", () => {
    const result = createMockResult("report");
    const html = toHtml(result);

    const sections = parseHtmlSections(html, "报告");
    const citations = parseCitations(html);

    // 报告格式有 section 结构
    expect(sections.length).toBeGreaterThanOrEqual(1);

    // 参考来源应该正确解析
    expect(citations.length).toBe(5);
  });
});
