/**
 * 单元测试 — 处理旧的损坏 HTML
 * 用户之前导出的内容是修复前生成的，_blank 已被破坏
 */
import { describe, it, expect } from "vitest";

// 从 generation.ts 复制的最新 parseHtmlSections
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

describe("处理旧的损坏 HTML", () => {
  // 这是用户之前导出的真实 HTML（_blank 被破坏成 <em>blank）
  const oldBrokenHtml = `<div class="doc-content">
<p>王芳，你好：</p>
<p>回顾过去一周，我们团队主要专注于认证模块的设计与开发工作<sup><a href="/api/knowledge/sources/86832973/file" target="<em>blank" rel="noopener" class="cite-link" title="03-周三-设计评审会议.docx">[1]</a></sup>。</p>
<p>2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势<sup><a href="https://www.csdn.net/article/2026" target="<em>blank" rel="noopener" class="cite-link" title="2026 年文档生成工具综合实力推荐榜">[3]</a></sup>。</p>
<p>核心功能主要包括三个方面：<sup class="cite-ref">[5]</sup></p>
<footer class="citations"><h3>参考来源</h3><div class="citation-list"><div class="citation-item"><span class="citation-num">[1]</span> <a href="/api/knowledge/sources/86832973/file" target="_blank" rel="noopener" class="cite-kb-link">03-周三-设计评审会议.docx</a></div><div class="citation-item"><span class="citation-num">[3]</span> <a href="https://www.csdn.net/article/2026" target="_blank" rel="noopener">2026 年文档生成工具综合实力推荐榜</a></div><div class="citation-item"><span class="citation-num">[5]</span> 核心功能文档</div></div></footer>
</div>`;

  it("应该正确处理 _blank 被破坏的旧 HTML", () => {
    const sections = parseHtmlSections(oldBrokenHtml, "邮件");
    const content = sections[0].content;

    console.log("=== 旧 HTML 解析结果 ===");
    console.log(content);

    // 应该保留 citation 编号
    expect(content).toContain("[1]");
    expect(content).toContain("[3]");
    expect(content).toContain("[5]");

    // 不应该有 HTML 属性残留
    expect(content).not.toContain('class="cite-link"');
    expect(content).not.toContain('target=');
    expect(content).not.toContain('rel="noopener"');
    expect(content).not.toContain('<a ');
    expect(content).not.toContain('<sup');
    expect(content).not.toContain('<em');
  });
});
