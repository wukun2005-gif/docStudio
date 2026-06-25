/**
 * 单元测试 — Citation 编号和参考来源对应关系
 */
import { describe, it, expect } from "vitest";
import { toHtml, type GenerateDocResult } from "../../server/src/lib/docGenerator.js";

describe("Citation 编号修复", () => {
  it("应该正确处理有效的引用编号", () => {
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "report",
      sections: [
        {
          title: "第一章",
          content: '<p>这是测试内容，引用了来源[1]和[2]。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
            { chunkId: "chunk2", content: "来源2内容", score: 0.8, sourceId: "src2", sourceName: "来源2" },
          ],
          webCitations: [],
          groundingScore: 0.9,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
            { index: 2, title: "来源2", url: "", sourceId: "src2" },
          ],
        },
      ],
      trustScore: 0.9,
    };

    const html = toHtml(result);

    // 应该包含有效的引用链接
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");

    // 应该包含参考来源
    expect(html).toContain("参考来源");
    expect(html).toContain("来源1");
    expect(html).toContain("来源2");
  });

  it("应该移除无效的引用编号（大于来源数量）", () => {
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "report",
      sections: [
        {
          title: "第一章",
          content: '<p>这是测试内容，引用了来源[1]和[35]、[39]。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
          ],
          webCitations: [],
          groundingScore: 0.9,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
          ],
        },
      ],
      trustScore: 0.9,
    };

    const html = toHtml(result);

    // 应该包含有效的引用 [1]
    expect(html).toContain("[1]");

    // 应该移除无效的引用 [35] 和 [39]
    expect(html).not.toContain("[35]");
    expect(html).not.toContain("[39]");

    // 应该只包含有效的参考来源
    expect(html).toContain("参考来源");
    expect(html).toContain("来源1");

    // 应该在控制台输出警告（通过 logger.warn）
  });

  it("应该正确处理多个章节的全局编号", () => {
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "report",
      sections: [
        {
          title: "第一章",
          content: '<p>第一章内容，引用[1]。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
          ],
          webCitations: [],
          groundingScore: 0.9,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
          ],
        },
        {
          title: "第二章",
          content: '<p>第二章内容，引用[2]和[3]。</p>',
          sources: [
            { chunkId: "chunk2", content: "来源2内容", score: 0.8, sourceId: "src2", sourceName: "来源2" },
            { chunkId: "chunk3", content: "来源3内容", score: 0.7, sourceId: "src3", sourceName: "来源3" },
          ],
          webCitations: [],
          groundingScore: 0.8,
          citationLinks: [
            { index: 2, title: "来源2", url: "", sourceId: "src2" },
            { index: 3, title: "来源3", url: "", sourceId: "src3" },
          ],
        },
      ],
      trustScore: 0.85,
    };

    const html = toHtml(result);

    // 照搬 patentExaminator：编号已经是全局的，不需要重编号
    // 第一章的 [1] 保持不变，第二章的 [2] 和 [3] 也保持不变
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");
    expect(html).toContain("[3]");

    // 应该包含所有三个参考来源
    expect(html).toContain("来源1");
    expect(html).toContain("来源2");
    expect(html).toContain("来源3");
  });

  it("应该处理混合有效和无效引用的情况", () => {
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "report",
      sections: [
        {
          title: "第一章",
          content: '<p>引用[1]有效，引用[5]无效，引用[2]有效，引用[100]无效。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
            { chunkId: "chunk2", content: "来源2内容", score: 0.8, sourceId: "src2", sourceName: "来源2" },
          ],
          webCitations: [],
          groundingScore: 0.85,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
            { index: 2, title: "来源2", url: "", sourceId: "src2" },
          ],
        },
      ],
      trustScore: 0.85,
    };

    const html = toHtml(result);

    // 应该保留有效的引用
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");

    // 应该移除无效的引用
    expect(html).not.toContain("[5]");
    expect(html).not.toContain("[100]");

    // 应该只包含有效的参考来源
    expect(html).toContain("来源1");
    expect(html).toContain("来源2");
  });

  it("应该处理邮件格式的引用（邮件格式不显示引用标记）", () => {
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "email",
      sections: [
        {
          title: "邮件主题",
          content: '<p>这是邮件内容，引用了来源[1]。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
          ],
          webCitations: [],
          groundingScore: 0.9,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
          ],
        },
      ],
      trustScore: 0.9,
    };

    const html = toHtml(result);

    // 邮件格式应该保留引用标记（因为 cleanContent 已经处理了）
    // 但参考来源应该正常显示
    expect(html).toContain("参考来源");
    expect(html).toContain("来源1");
  });

  it("应该清理无效引用并重新提取 citedIndices（模拟真实场景）", () => {
    // 模拟用户报告的真实场景：LLM 生成了 [1]-[5] 和 [25]、[27]，但只有 7 个来源
    const result: GenerateDocResult = {
      content: "测试内容",
      documentStyle: "email",
      sections: [
        {
          title: "第一章",
          content: '<p>引用[1]和[2]有效，引用[25]和[27]无效。</p>',
          sources: [
            { chunkId: "chunk1", content: "来源1内容", score: 0.9, sourceId: "src1", sourceName: "来源1" },
            { chunkId: "chunk2", content: "来源2内容", score: 0.8, sourceId: "src2", sourceName: "来源2" },
          ],
          webCitations: [],
          groundingScore: 0.85,
          citationLinks: [
            { index: 1, title: "来源1", url: "", sourceId: "src1" },
            { index: 2, title: "来源2", url: "", sourceId: "src2" },
          ],
        },
        {
          title: "第二章",
          content: '<p>引用[3]和[4]有效，引用[5]无效。</p>',
          sources: [
            { chunkId: "chunk3", content: "来源3内容", score: 0.7, sourceId: "src3", sourceName: "来源3" },
            { chunkId: "chunk4", content: "来源4内容", score: 0.6, sourceId: "src4", sourceName: "来源4" },
          ],
          webCitations: [],
          groundingScore: 0.8,
          citationLinks: [
            { index: 3, title: "来源3", url: "", sourceId: "src3" },
            { index: 4, title: "来源4", url: "", sourceId: "src4" },
          ],
        },
      ],
      trustScore: 0.825,
    };

    const html = toHtml(result);

    // 应该保留有效的引用
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");
    expect(html).toContain("[3]");
    expect(html).toContain("[4]");

    // 应该移除无效的引用
    expect(html).not.toContain("[5]");
    expect(html).not.toContain("[25]");
    expect(html).not.toContain("[27]");

    // 应该只包含有效的参考来源（4个，不是7个）
    expect(html).toContain("来源1");
    expect(html).toContain("来源2");
    expect(html).toContain("来源3");
    expect(html).toContain("来源4");

    // 不应该包含无效来源
    expect(html).not.toContain("来源5");
    expect(html).not.toContain("来源25");
    expect(html).not.toContain("来源27");

    // 应该输出警告日志
    // 控制台会输出: [WARN] [DocGenerator] 发现 3 个无效引用编号: [5], [25], [27]，将被移除
  });
});
