import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generateEml, generateWord, generatePowerPoint, generateExcel, CitationItem } from "../../server/src/lib/docExporter";

describe("文档导出格式兼容性", () => {
  const citations: CitationItem[] = [
    { index: 1, title: "03-周三-设计评审会议.docx", url: "/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file" },
    { index: 2, title: "2026年文档生成工具综合实力推荐榜", url: "https://www.csdn.net/article/2026-06-12/161934138" },
    { index: 3, title: "产品规划文档-Q3-2026.docx", url: "/api/knowledge/sources/4493ede7-4741-4c96-a8f8-128084c3c39b/file" },
    { index: 4, title: "无URL引用" },
  ];

  const sections = [{ title: "测试章节", content: "测试内容段落一\n测试内容段落二" }];

  it("EML 格式应该显示可点击链接", () => {
    const buffer = generateEml("测试", sections, citations);
    const emlStr = buffer.toString();

    const base64Match = emlStr.match(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/);
    expect(base64Match).toBeTruthy();
    const decoded = Buffer.from(base64Match![1].replace(/\r\n/g, ""), "base64").toString("utf-8");

    expect(decoded).toContain('href="/api/knowledge/sources/86832973-1df9-48f1-b312-c08d09c93e05/file"');
    expect(decoded).toContain(">03-周三-设计评审会议.docx</a>");

    expect(decoded).toContain('href="https://www.csdn.net/article/2026-06-12/161934138"');
    expect(decoded).toContain(">2026年文档生成工具综合实力推荐榜</a>");

    expect(decoded).toContain("产品规划文档-Q3-2026.docx");
    expect(decoded).toContain("无URL引用");
  });

  it("Word 格式应该生成标准 OOXML .docx（兼容 Pages/Word/WPS）", async () => {
    const buffer = await generateWord("测试", sections, citations);

    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeTruthy();
    expect(documentXml).toContain("测试");
    expect(documentXml).toContain("测试章节");
    expect(documentXml).toContain("测试内容段落一");
    expect(documentXml).toContain("参考来源");
    expect(documentXml).toContain("03-周三-设计评审会议.docx");
    expect(documentXml).toContain("2026年文档生成工具综合实力推荐榜");
    expect(documentXml).toContain("无URL引用");

    expect(documentXml).toContain("w:pgSz");
    expect(documentXml).toContain("w:pgMar");

    expect(documentXml).not.toContain("<w:hyperlink");

    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("wordprocessingml");
  });

  it("PPT 格式应该生成标准 OOXML .pptx", async () => {
    const buffer = await generatePowerPoint("测试", sections, citations);

    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("presentationml");
  });

  it("Excel 格式应该生成标准 OOXML .xlsx", async () => {
    const buffer = await generateExcel("测试", sections, citations);

    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("spreadsheetml");
  });
});
