import { describe, expect, it } from "vitest";
import { generateEml, CitationItem } from "../../server/src/lib/docExporter";

/** 从 HTML 内容中解析参考来源列表（从 generation.ts 复制） */
function parseCitations(html: string): Array<{ index: number; title: string; url?: string }> {
  const citations: Array<{ index: number; title: string; url?: string }> = [];

  // 提取 footer 中的参考来源
  const footerMatch = html.match(/<footer class="citations">([\s\S]*?)<\/footer>/);
  if (!footerMatch) return citations;

  const footerHtml = footerMatch[1];

  // 匹配 citation-item 中的 [N] 和链接
  const itemRegex = /<div class="citation-item">([\s\S]*?)<\/div>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(footerHtml)) !== null) {
    const itemHtml = itemMatch[1];

    // 提取 [N] 编号
    const numMatch = itemHtml.match(/\[(\d+)\]/);
    if (!numMatch) continue;
    const index = parseInt(numMatch[1], 10);

    // 提取链接和标题
    const linkMatch = itemHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
    if (linkMatch) {
      citations.push({ index, url: linkMatch[1], title: linkMatch[2].trim() });
    } else {
      // 无链接，提取纯文本标题
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

describe("真实HTML导出流程测试", () => {
  // 模拟用户之前发的真实HTML内容
  const realHtml = `
<footer class="citations"><h3>参考来源</h3><div class="citation-list"><div class="citation-item"><span class="citation-num">[2]</span> <a href="/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file" target="_blank" rel="noopener" class="cite-kb-link">07-王芳-客户-产品演示确认.eml</a></div><div class="citation-item"><span class="citation-num">[3]</span> <a href="/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file" target="_blank" rel="noopener" class="cite-kb-link">03-周三-设计评审会议.docx</a></div><div class="citation-item"><span class="citation-num">[11]</span> <a href="https://www.csdn.net/article/2026-06-12/161934138" target="_blank" rel="noopener">2026 年文档生成工具综合实力推荐榜：智能办公时代选型全指南</a></div><div class="citation-item"><span class="citation-num">[12]</span> <a href="https://www.alixpartners.com/insights/102migz/2026ai/" target="_blank" rel="noopener">《2026年企业软件技术预测报告》报告发布！速览AI时代的行业生存 ...</a></div></div></footer>
`;

  it("parseCitations 应该正确提取 citations", () => {
    const citations = parseCitations(realHtml);
    console.log("parseCitations 结果:", JSON.stringify(citations, null, 2));

    expect(citations).toHaveLength(4);
    expect(citations[0]).toEqual({
      index: 2,
      url: "/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file",
      title: "07-王芳-客户-产品演示确认.eml"
    });
    expect(citations[2]).toEqual({
      index: 11,
      url: "https://www.csdn.net/article/2026-06-12/161934138",
      title: "2026 年文档生成工具综合实力推荐榜：智能办公时代选型全指南"
    });
  });

  it("generateEml 应该过滤内部API路径", () => {
    const citations = parseCitations(realHtml);
    console.log("传入 generateEml 的 citations:", JSON.stringify(citations, null, 2));

    const sections = [{ title: "测试", content: "测试内容" }];
    const buffer = generateEml("测试", sections, citations);
    const emlStr = buffer.toString();

    // EML是base64编码的，需要解码body部分
    const base64Match = emlStr.match(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/);
    expect(base64Match).toBeTruthy();
    const decoded = Buffer.from(base64Match![1].replace(/\r\n/g, ""), "base64").toString("utf-8");

    console.log("EML 解码内容:", decoded);

    // 内部文件应该显示为可点击链接
    expect(decoded).toContain('href="/api/knowledge/sources/cba04966-ccbe-421a-807e-d81df604f322/file"');
    expect(decoded).toContain(">07-王芳-客户-产品演示确认.eml</a>");

    // 外部URL应该显示为可点击链接
    expect(decoded).toContain('href="https://www.csdn.net/article/2026-06-12/161934138"');

    // 文件名应该显示
    expect(decoded).toContain("03-周三-设计评审会议.docx");
    expect(decoded).toContain("2026 年文档生成工具综合实力推荐榜：智能办公时代选型全指南");
  });
});
