/**
 * 单元测试 — 完整导出管线测试
 * 直接调用 cleanContent() + toHtml()，然后验证导出解析
 * 不自己构造 HTML，完全走真实代码路径
 */
import { describe, it, expect } from "vitest";
import { cleanContent } from "../../server/src/lib/contentCleaner.js";
import { toHtml, type GenerateDocResult } from "../../server/src/lib/docGenerator.js";

// 直接从 generation.ts 复制的函数，确保一致性
function parseHtmlSections(html: string, title: string): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];

  let processedHtml = html
    .replace(/<sup><a[\s\S]*?>\[(\d+)\]<\/a><\/sup>/g, '[$1]')
    .replace(/<sup><span[\s\S]*?>\[(\d+)\]<\/span><\/sup>/g, '[$1]')
    .replace(/<sup[\s\S]*?>\[(\d+)\]<\/sup>/g, '[$1]')
    .replace(/<a[\s\S]*?>\[(\d+)\]<\/a>/g, '[$1]');

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

describe("完整导出管线测试", () => {
  // 模拟真实生成流程：raw content → cleanContent → toHtml → parseHtmlSections
  it("完整流程：raw content 经过 cleanContent 和 toHtml 后应该正确解析", () => {
    // 1. 模拟 LLM 生成的原始内容
    const rawContent = `王芳，你好：
回顾过去一周，我们团队主要专注于认证模块的设计与开发工作[1]。在上周三召开的评审会议上，我们确认了认证模块的技术方案[2]。
2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势[3]。预计75%的企业软件将把对话式界面作为用户与业务数据交互的主要方式[4]。
核心功能主要包括三个方面：知识源连接，文档生成以及生成树溯源[5]。`;

    // 2. 模拟 citationLinks
    const citationLinks = [
      { index: 1, title: "03-周三-设计评审会议.docx", url: "", sourceId: "86832973-1df9-48f1-b312-c08d09c93e05" },
      { index: 2, title: "07-王芳-客户-产品演示确认.eml", url: "", sourceId: "cba04966-ccbe-421a-807e-d81df604f322" },
      { index: 3, title: "2026年文档生成工具综合实力推荐榜", url: "https://www.csdn.net/article/2026-06-12/161934138" },
      { index: 4, title: "2026年企业软件技术预测报告", url: "https://www.alixpartners.com/insights/102migz/2026ai/" },
      { index: 5, title: "产品规划文档-Q3-2026.docx", url: "", sourceId: "4493ede7-4741-4c96-a8f8-128084c3c39b" },
    ];

    // 3. 调用 cleanContent（真实代码路径）
    const cleanedContent = cleanContent(rawContent, "html", citationLinks, "email");

    console.log("=== cleanContent 输出 ===");
    console.log(cleanedContent);

    // 4. 构建 GenerateDocResult
    const result: GenerateDocResult = {
      content: "测试",
      documentStyle: "email",
      sections: [{
        title: "产品开发进展汇报",
        content: cleanedContent,
        sources: [],
        webCitations: [],
        groundingScore: 0.9,
        citationLinks,
      }],
      trustScore: 0.9,
    };

    // 5. 调用 toHtml（真实代码路径）
    const html = toHtml(result);

    console.log("\n=== toHtml 输出 ===");
    console.log(html.substring(0, 1500));

    // 6. 调用 parseHtmlSections
    const sections = parseHtmlSections(html, "邮件");
    const content = sections[0].content;

    console.log("\n=== parseHtmlSections 输出 ===");
    console.log(content);

    // 7. 验证
    expect(content).toContain("[1]");
    expect(content).toContain("[2]");
    expect(content).toContain("[3]");
    expect(content).toContain("[4]");
    expect(content).toContain("[5]");

    // 不应该有 HTML 属性残留
    expect(content).not.toContain('class="cite-link"');
    expect(content).not.toContain('target=');
    expect(content).not.toContain('rel="noopener"');
    expect(content).not.toContain('<a ');
    expect(content).not.toContain('<sup');
    expect(content).not.toContain('<em');

    // 不应该有双重括号
    expect(content).not.toContain("[[");
    expect(content).not.toContain("]]");
  });

  it("cleanContent 输出的 HTML 结构应该正确", () => {
    const rawContent = "测试内容[1]和[2]。";
    const citationLinks = [
      { index: 1, title: "来源1", url: "", sourceId: "src1" },
      { index: 2, title: "Web来源", url: "https://example.com" },
    ];

    const cleaned = cleanContent(rawContent, "html", citationLinks, "email");

    console.log("=== cleanContent 输出 ===");
    console.log(cleaned);

    // 应该包含 citation 链接
    expect(cleaned).toContain("<sup");
    expect(cleaned).toContain("[1]");
    expect(cleaned).toContain("[2]");

    // 检查 target="_blank" 是否被 markdown 破坏
    if (cleaned.includes('target="<em>')) {
      console.log("警告：target=\"_blank\" 被 markdown 破坏！");
    }
  });

  it("toHtml 生成的 HTML 应该可以直接被 parseHtmlSections 解析", () => {
    const result: GenerateDocResult = {
      content: "测试",
      documentStyle: "email",
      sections: [{
        title: "邮件",
        content: '<p>内容<sup><a href="/api/knowledge/sources/src1/file" target="_blank" rel="noopener" class="cite-link" title="来源1">[1]</a></sup></p>',
        sources: [],
        webCitations: [],
        groundingScore: 0.9,
        citationLinks: [
          { index: 1, title: "来源1", url: "", sourceId: "src1" },
        ],
      }],
      trustScore: 0.9,
    };

    const html = toHtml(result);
    const sections = parseHtmlSections(html, "邮件");
    const content = sections[0].content;

    console.log("=== toHtml → parseHtmlSections ===");
    console.log("Input HTML:", html);
    console.log("Output content:", content);

    expect(content).toContain("[1]");
    expect(content).not.toContain('<sup');
    expect(content).not.toContain('<a ');
  });
});
