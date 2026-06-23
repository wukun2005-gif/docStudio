/**
 * Phase 4 集成测试 — 文档导出 (#13-15)
 */
import { describe, it, expect } from "vitest";
import { generateWord, generatePowerPoint, generateExcel, exportDocument } from "../../server/src/lib/docExporter.js";

const TEST_SECTIONS = [
  { title: "第一章", content: "这是第一章的内容。\n包含多个段落。", level: 1 },
  { title: "第二章", content: "这是第二章的内容。", level: 1 },
];

describe("文档导出 (#13-15)", () => {
  it("generateWord 生成 Word 文档", () => {
    const buffer = generateWord("测试文档", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(0);
    const html = buffer.toString("utf-8");
    expect(html).toContain("测试文档");
    expect(html).toContain("第一章");
  });

  it("generatePowerPoint 生成 PPT", () => {
    const buffer = generatePowerPoint("测试PPT", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(0);
    const html = buffer.toString("utf-8");
    expect(html).toContain("测试PPT");
    expect(html).toContain("slide");
  });

  it("generateExcel 生成 CSV", () => {
    const buffer = generateExcel("测试表格", TEST_SECTIONS);
    expect(buffer.length).toBeGreaterThan(0);
    const csv = buffer.toString("utf-8");
    expect(csv).toContain("章节");
    expect(csv).toContain("第一章");
  });

  it("exportDocument 统一接口", () => {
    const docx = exportDocument("docx", "test", TEST_SECTIONS);
    expect(docx.contentType).toBe("application/msword");
    expect(docx.extension).toBe(".doc");

    const pptx = exportDocument("pptx", "test", TEST_SECTIONS);
    expect(pptx.contentType).toBe("application/vnd.ms-powerpoint");

    const xlsx = exportDocument("xlsx", "test", TEST_SECTIONS);
    expect(xlsx.contentType).toBe("application/vnd.ms-excel");
  });

  it("exportDocument 不支持的格式抛出错误", () => {
    expect(() => exportDocument("pdf" as any, "test", TEST_SECTIONS)).toThrow();
  });
});
