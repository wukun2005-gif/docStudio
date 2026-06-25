/**
 * 单元测试 — 导出时 Citation 解析
 * 验证 parseHtmlSections() 和 parseCitations() 正确处理各种 citation 格式
 */
import { describe, it, expect } from "vitest";

// ── 模拟 parseHtmlSections（从 generation.ts 提取） ──
function parseHtmlSections(html: string, title: string): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];

  // 先将 citation 链接转换为 [N] 纯文本，避免 HTML 标签剥离不完整导致属性残留
  // 注意：正则顺序很重要，先匹配完整的 <sup><a>...</a></sup> 结构，再匹配剩余的
  let processedHtml = html
    // 完整的链接结构：<sup><a href="..." ...>[N]</a></sup> → [N]
    .replace(/<sup><a[^>]*>\[(\d+)\]<\/a><\/sup>/g, '[$1]')
    // span 结构：<sup><span ...>[N]</span></sup> → [N]
    .replace(/<sup><span[^>]*>\[(\d+)\]<\/span><\/sup>/g, '[$1]')
    // 其他 sup 包裹：<sup...>[N]</sup> → [N]
    .replace(/<sup[^>]*>\[(\d+)\]<\/sup>/g, '[$1]')
    // 剩余的裸链接（不含 sup）：<a href="..." ...>[N]</a> → [N]
    .replace(/<a[^>]*>\[(\d+)\]<\/a>/g, '[$1]');

  // 尝试从 <section><h2>...</h2>...</section> 结构提取
  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = sectionRegex.exec(processedHtml)) !== null) {
    const sectionTitle = match[1].replace(/<[^>]+>/g, "").trim();
    const content = match[2]
      .replace(/<[^>]+>/g, "")
      .trim();
    if (content) {
      sections.push({ title: sectionTitle, content, level: 1 });
    }
  }

  // 如果没有 section 标签（如邮件格式），整体作为一个章节
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

// ── 测试用例 ──

describe("导出 Citation 解析", () => {
  // 模拟实际生成的 HTML（包含各种 citation 格式）
  const mockHtml = `<div class="doc-content">
<p>苏楠，你好：</p>
<p>回顾过去一周，我们团队主要专注于认证模块的设计与开发工作 <sup><a href="/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file" target="_blank" rel="noopener" class="cite-link" title="03-周三-设计评审会议.docx">[1]</a></sup>。在上周三召开的评审会议上，我们确认了认证模块的技术方案 <sup><a href="/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file" target="_blank" rel="noopener" class="cite-link" title="07-苏楠-客户-产品演示确认.eml">[2]</a></sup>。</p>
<p>2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势 <sup><a href="https://www.csdn.net/article/2026-06-12/161934138" target="_blank" rel="noopener" class="cite-link" title="2026年文档生成工具综合实力推荐榜">[3]</a></sup>。预计75%的企业软件将把对话式界面作为用户与业务数据交互的主要方式 <sup><a href="https://www.alixpartners.com/insights/102migz/2026ai/" target="_blank" rel="noopener" class="cite-link" title="2026年企业软件技术预测报告">[4]</a></sup>。</p>
<p>核心功能主要包括三个方面：知识源连接，文档生成以及生成树溯源 <sup class="cite-ref">[5]</sup>。</p>
<p>以上是本周的工作汇报及竞品分析。</p>
<footer class="citations"><h3>参考来源</h3><div class="citation-list"><div class="citation-item"><span class="citation-num">[1]</span> <a href="/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file" target="_blank" rel="noopener" class="cite-kb-link">03-周三-设计评审会议.docx</a></div><div class="citation-item"><span class="citation-num">[2]</span> <a href="/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file" target="_blank" rel="noopener" class="cite-kb-link">07-苏楠-客户-产品演示确认.eml</a></div><div class="citation-item"><span class="citation-num">[3]</span> <a href="https://www.csdn.net/article/2026-06-12/161934138" target="_blank" rel="noopener">2026年文档生成工具综合实力推荐榜</a></div><div class="citation-item"><span class="citation-num">[4]</span> <a href="https://www.alixpartners.com/insights/102migz/2026ai/" target="_blank" rel="noopener">2026年企业软件技术预测报告</a></div><div class="citation-item"><span class="citation-num">[5]</span> 核心功能文档</div></div></footer>
</div>`;

  describe("parseHtmlSections", () => {
    it("应该正确提取邮件正文", () => {
      const sections = parseHtmlSections(mockHtml, "邮件");
      expect(sections.length).toBe(1);
      expect(sections[0].title).toBe("邮件");
      expect(sections[0].content).toContain("苏楠，你好：");
      expect(sections[0].content).toContain("以上是本周的工作汇报及竞品分析");
    });

    it("应该保留 citation 编号 [N]", () => {
      const sections = parseHtmlSections(mockHtml, "邮件");
      const content = sections[0].content;

      expect(content).toContain("[1]");
      expect(content).toContain("[2]");
      expect(content).toContain("[3]");
      expect(content).toContain("[4]");
      expect(content).toContain("[5]");
    });

    it("不应该有 HTML 属性残留", () => {
      const sections = parseHtmlSections(mockHtml, "邮件");
      const content = sections[0].content;

      // 不应该有 HTML 标签属性残留
      expect(content).not.toContain('blank"');
      expect(content).not.toContain('rel="noopener"');
      expect(content).not.toContain('class="cite-link"');
      expect(content).not.toContain('target="_blank"');
      expect(content).not.toContain('<a ');
      expect(content).not.toContain('<sup');
    });

    it("不应该有双重括号 [[N]]", () => {
      const sections = parseHtmlSections(mockHtml, "邮件");
      const content = sections[0].content;

      // 不应该有双重括号
      expect(content).not.toContain("[[1]]");
      expect(content).not.toContain("[[2]]");
      expect(content).not.toContain("[[3]]");
      expect(content).not.toContain("[[4]]");
      expect(content).not.toContain("[[5]]");
    });

    it("应该移除 footer（参考来源列表单独处理）", () => {
      const sections = parseHtmlSections(mockHtml, "邮件");
      const content = sections[0].content;

      expect(content).not.toContain("参考来源");
      expect(content).not.toContain("footer");
    });

    it("应该处理 section 结构的文档", () => {
      const sectionHtml = `<div class="doc-content">
<section><h2>第一章</h2><p>第一章内容 <sup><a href="/api/knowledge/sources/src1/file" target="_blank" rel="noopener" class="cite-link" title="来源1">[1]</a></sup></p></section>
<section><h2>第二章</h2><p>第二章内容 <sup><a href="https://example.com" target="_blank" rel="noopener" class="cite-link" title="Web来源">[2]</a></sup></p></section>
<footer class="citations"><h3>参考来源</h3><div class="citation-list"><div class="citation-item"><span class="citation-num">[1]</span> <a href="/api/knowledge/sources/src1/file" target="_blank" rel="noopener" class="cite-kb-link">来源1</a></div><div class="citation-item"><span class="citation-num">[2]</span> <a href="https://example.com" target="_blank" rel="noopener">Web来源</a></div></div></footer>
</div>`;

      const sections = parseHtmlSections(sectionHtml, "文档");
      expect(sections.length).toBe(2);
      expect(sections[0].title).toBe("第一章");
      expect(sections[1].title).toBe("第二章");
      expect(sections[0].content).toContain("[1]");
      expect(sections[1].content).toContain("[2]");
    });
  });

  describe("parseCitations", () => {
    it("应该正确解析参考来源列表", () => {
      const citations = parseCitations(mockHtml);

      expect(citations.length).toBe(5);
      expect(citations[0]).toEqual({ index: 1, url: "/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file", title: "03-周三-设计评审会议.docx" });
      expect(citations[1]).toEqual({ index: 2, url: "/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file", title: "07-苏楠-客户-产品演示确认.eml" });
      expect(citations[2]).toEqual({ index: 3, url: "https://www.csdn.net/article/2026-06-12/161934138", title: "2026年文档生成工具综合实力推荐榜" });
      expect(citations[3]).toEqual({ index: 4, url: "https://www.alixpartners.com/insights/102migz/2026ai/", title: "2026年企业软件技术预测报告" });
    });

    it("应该处理无链接的参考来源", () => {
      const citations = parseCitations(mockHtml);
      const noLinkCitation = citations.find(c => c.index === 5);

      expect(noLinkCitation).toBeDefined();
      expect(noLinkCitation!.title).toBe("核心功能文档");
      expect(noLinkCitation!.url).toBeUndefined();
    });

    it("应该处理没有 footer 的 HTML", () => {
      const noFooterHtml = '<div class="doc-content"><p>内容</p></div>';
      const citations = parseCitations(noFooterHtml);

      expect(citations.length).toBe(0);
    });

    it("应该处理空的参考来源列表", () => {
      const emptyFooterHtml = '<footer class="citations"><h3>参考来源</h3><div class="citation-list"></div></footer>';
      const citations = parseCitations(emptyFooterHtml);

      expect(citations.length).toBe(0);
    });
  });

  describe("端到端验证", () => {
    it("应该正确处理完整的导出流程", () => {
      // 1. 解析章节
      const sections = parseHtmlSections(mockHtml, "邮件");
      expect(sections.length).toBe(1);

      // 2. 解析参考来源
      const citations = parseCitations(mockHtml);
      expect(citations.length).toBe(5);

      // 3. 验证正文中的 citation 编号与参考来源列表对应
      const content = sections[0].content;
      for (const cite of citations) {
        expect(content).toContain(`[${cite.index}]`);
      }

      // 4. 验证没有属性残留
      expect(content).not.toContain('class="cite-link"');
      expect(content).not.toContain('target="_blank"');

      // 5. 验证参考来源有正确的 URL
      const kbCitations = citations.filter(c => c.url?.startsWith("/api/knowledge/"));
      const webCitations = citations.filter(c => c.url?.startsWith("https://"));
      expect(kbCitations.length).toBe(2);
      expect(webCitations.length).toBe(2);
    });
  });
});
