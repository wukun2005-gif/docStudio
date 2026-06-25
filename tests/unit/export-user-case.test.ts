/**
 * 单元测试 — 使用用户实际导出的内容验证修复
 * 这是用户真实遇到的 bug 场景
 */
import { describe, it, expect } from "vitest";

// ── 模拟 parseHtmlSections（从 generation.ts 提取） ──
function parseHtmlSections(html: string, title: string): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];

  // 使用 [\s\S]*? 而不是 [^>]*，因为 markdown 处理可能破坏 HTML 结构
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

describe("用户实际导出内容验证", () => {
  // 模拟用户导出时遇到的问题 HTML
  // 这是 markdownToHtml 处理后 _blank 变成 <em>blank 的情况
  const problematicHtml = `<div class="doc-content">
<p>苏楠，你好：</p>
<p>回顾过去一周，我们团队主要专注于认证模块的设计与开发工作<sup><a href="/api/knowledge/sources/86832973/file" target="<em>blank" rel="noopener" class="cite-link" title="03-周三-设计评审会议.docx">[1]</a></sup>。</p>
<p>2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势<sup><a href="https://www.csdn.net/article/2026" target="<em>blank" rel="noopener" class="cite-link" title="2026 年文档生成工具综合实力推荐榜">[3]</a></sup>。</p>
<p>核心功能主要包括三个方面：<sup class="cite-ref">[5]</sup></p>
</div>`;

  it("应该处理 target=<em>blank 的损坏 HTML", () => {
    const sections = parseHtmlSections(problematicHtml, "邮件");
    const content = sections[0].content;

    console.log("=== 解析结果 ===");
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

  // 测试正常的 HTML（修复后应该生成这种）
  const normalHtml = `<div class="doc-content">
<p>苏楠，你好：</p>
<p>回顾过去一周，我们团队主要专注于认证模块的设计与开发工作<sup><a href="/api/knowledge/sources/86832973/file" target="_blank" rel="noopener" class="cite-link" title="03-周三-设计评审会议.docx">[1]</a></sup>。</p>
<p>2026年，文档生成工具市场呈现出垂直深耕与全能拓展并行的发展态势<sup><a href="https://www.csdn.net/article/2026" target="_blank" rel="noopener" class="cite-link" title="2026 年文档生成工具综合实力推荐榜">[3]</a></sup>。</p>
<p>核心功能主要包括三个方面：<sup class="cite-ref">[5]</sup></p>
</div>`;

  it("应该正确处理正常的 HTML", () => {
    const sections = parseHtmlSections(normalHtml, "邮件");
    const content = sections[0].content;

    console.log("=== 正常 HTML 解析结果 ===");
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
  });

  // 测试各种边界情况
  it("应该处理各种 citation 格式", () => {
    const mixedHtml = `<div class="doc-content">
<p>测试<sup><a href="/api/knowledge/sources/src1/file" target="_blank" rel="noopener" class="cite-link" title="来源1">[1]</a></sup></p>
<p>测试<sup><a href="https://example.com" target="_blank" rel="noopener" class="cite-link" title="Web来源">[2]</a></sup></p>
<p>测试<sup class="cite-ref">[3]</sup></p>
<p>测试<sup><span class="cite-ref" title="来源4">[4]</span></sup></p>
<p>测试<sup><a href="/api/knowledge/sources/src5/file" target="<em>blank" rel="noopener" class="cite-link" title="来源5">[5]</a></sup></p>
</div>`;

    const sections = parseHtmlSections(mixedHtml, "测试");
    const content = sections[0].content;

    console.log("=== 混合格式解析结果 ===");
    console.log(content);

    // 所有 citation 编号都应该保留
    expect(content).toContain("[1]");
    expect(content).toContain("[2]");
    expect(content).toContain("[3]");
    expect(content).toContain("[4]");
    expect(content).toContain("[5]");

    // 不应该有任何 HTML 标签残留
    expect(content).not.toContain('<sup');
    expect(content).not.toContain('<a ');
    expect(content).not.toContain('<span');
    expect(content).not.toContain('class=');
    expect(content).not.toContain('target=');
    expect(content).not.toContain('href=');
  });
});
