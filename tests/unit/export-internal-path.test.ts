import { describe, expect, it } from "vitest";
import { generateEml, generateWord, generatePowerPoint, generateExcel, CitationItem } from "../../server/src/lib/docExporter";

describe("内部API路径不应该显示", () => {
  const citations: CitationItem[] = [
    { index: 1, title: "03-周三-设计评审会议.docx", url: "/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file" },
    { index: 2, title: "2026年文档生成工具综合实力推荐榜", url: "https://www.csdn.net/article/2026-06-12/161934138" },
    { index: 3, title: "产品规划文档-Q3-2026.docx", url: "/api/knowledge/sources/4493ede7-4741-4c96-a8f8-128084c3c39b/file" },
    { index: 4, title: "无URL引用" },
  ];

  const sections = [{ title: "测试", content: "测试内容" }];

  it("EML 格式应该显示可点击链接", () => {
    const buffer = generateEml("测试", sections, citations);
    const emlStr = buffer.toString();

    // EML是base64编码的，需要解码body部分
    const base64Match = emlStr.match(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/);
    expect(base64Match).toBeTruthy();
    const decoded = Buffer.from(base64Match![1].replace(/\r\n/g, ""), "base64").toString("utf-8");

    // 内部文件应该显示为可点击链接
    expect(decoded).toContain('href="/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file"');
    expect(decoded).toContain(">03-周三-设计评审会议.docx</a>");

    // 外部URL应该显示为可点击链接
    expect(decoded).toContain('href="https://www.csdn.net/article/2026-06-12/161934138"');
    expect(decoded).toContain(">2026年文档生成工具综合实力推荐榜</a>");

    // 文件名应该显示
    expect(decoded).toContain("产品规划文档-Q3-2026.docx");
    expect(decoded).toContain("无URL引用");
  });

  it("Word 格式不应该显示内部API路径", () => {
    const result = generateWord("测试", sections, citations).toString();

    // 内部路径不应该显示
    expect(result).not.toContain("/api/knowledge/sources/");
    expect(result).not.toContain("86832973-1df9-48f1-b312-c08d09c93e05");

    // 外部URL应该显示为可点击链接
    expect(result).toContain('href="https://www.csdn.net/article/2026-06-12/161934138"');

    // 文件名应该显示
    expect(result).toContain("[1] 03-周三-设计评审会议.docx");
  });

  it("PPT 格式不应该显示内部API路径", () => {
    const result = generatePowerPoint("测试", sections, citations).toString();

    // 内部路径不应该显示
    expect(result).not.toContain("/api/knowledge/sources/");

    // 外部URL应该显示为可点击链接
    expect(result).toContain('href="https://www.csdn.net/article/2026-06-12/161934138"');

    // 文件名应该显示
    expect(result).toContain("[1] 03-周三-设计评审会议.docx");
  });

  it("Excel 格式不应该显示内部API路径", () => {
    const result = generateExcel("测试", sections, citations).toString();

    // 内部路径不应该显示
    expect(result).not.toContain("/api/knowledge/sources/");

    // 外部URL应该显示
    expect(result).toContain("https://www.csdn.net/article/2026-06-12/161934138");

    // 文件名应该显示（注意Excel中引用在第二列）
    expect(result).toContain('"[1]","03-周三-设计评审会议.docx"');
  });
});
