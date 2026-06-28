/**
 * Phase 4 集成测试 — 文档导出 (#13-15)
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { generateWord, generatePowerPoint, generateExcel, exportDocument } from "../../server/src/lib/docExporter.js";

const TEST_SECTIONS = [
  { title: "第一章", content: "这是第一章的内容。\n包含多个段落。", level: 1 },
  { title: "第二章", content: "这是第二章的内容。", level: 1 },
];

describe("文档导出 (#13-15)", () => {
  it("generateWord 生成标准 .docx 格式（ZIP/OOXML）", async () => {
    const buffer = await generateWord("测试文档", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeTruthy();
    expect(documentXml).toContain("测试文档");
    expect(documentXml).toContain("第一章");
    expect(documentXml).toContain("这是第一章的内容");

    const sectPrMatch = documentXml!.match(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>/);
    expect(sectPrMatch).toBeTruthy();
    expect(sectPrMatch![0]).toContain("w:pgSz");
    expect(sectPrMatch![0]).toContain("w:pgMar");
  });

  it("generatePowerPoint 生成标准 .pptx 格式", async () => {
    const buffer = await generatePowerPoint("测试PPT", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("presentationml");
  });

  it("generateExcel 生成标准 .xlsx 格式", async () => {
    const buffer = await generateExcel("测试表格", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("spreadsheetml");
    expect(contentTypes).toContain("worksheet");
  });

  it("exportDocument 统一接口返回正确的 MIME 和扩展名", async () => {
    const docx = await exportDocument("docx", "test", TEST_SECTIONS);
    expect(docx.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.extension).toBe(".docx");
    expect(docx.buffer.slice(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));

    const pptx = await exportDocument("pptx", "test", TEST_SECTIONS);
    expect(pptx.contentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(pptx.extension).toBe(".pptx");

    const xlsx = await exportDocument("xlsx", "test", TEST_SECTIONS);
    expect(xlsx.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.extension).toBe(".xlsx");
  });

  it("exportDocument 不支持的格式抛出错误", async () => {
    await expect(exportDocument("pdf" as any, "test", TEST_SECTIONS)).rejects.toThrow();
  });
});
