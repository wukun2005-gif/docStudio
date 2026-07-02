/**
 * XlsxWriter Generator & Chart Spec Parser — 单元测试
 *
 * 测试覆盖：
 * - extractCodeBlocksFromText（code block 提取，间接测试通过 docGenerator）
 * - chartSpecParser: JSON 提取 + jsonrepair + 校验
 * - chartDataExtractor: 规则引擎兜底提取
 * - xlsxWriterGenerator: Python 检测（仅检查函数存在，不实际执行 Python）
 * - generateExcel: 多 Sheet 纯文本 fallback
 */
import { describe, expect, it } from "vitest";
import { extractChartSpecFromText } from "../../server/src/lib/chartSpecParser";
import { extractChartDataFromText } from "../../server/src/lib/chartDataExtractor";
import {
  isPythonAvailable,
  isXlsxWriterAvailable,
  validatePythonScript,
  resetPythonDetectionCache,
} from "../../server/src/lib/xlsxWriterGenerator";
import { generateExcel, type ChartSpec } from "../../server/src/lib/docExporter";

// ── chartSpecParser ──────────────────────────────────────

describe("chartSpecParser", () => {
  it("extracts valid chart spec from ```chart block", () => {
    const text = `一些正文内容

\`\`\`chart
[{"type": "bar", "title": "任务完成率", "categories": ["技术部", "产品部", "设计部"], "series": [{"name": "完成率%", "values": [85, 72, 90]}]}]
\`\`\`

更多内容`;

    const specs = extractChartSpecFromText(text);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.type).toBe("bar");
    expect(specs[0]!.title).toBe("任务完成率");
    expect(specs[0]!.categories).toEqual(["技术部", "产品部", "设计部"]);
    expect(specs[0]!.series).toHaveLength(1);
    expect(specs[0]!.series[0]!.values).toEqual([85, 72, 90]);
  });

  it("extracts valid chart spec from ```json chart block", () => {
    const text = `\`\`\`json chart
[{"type": "pie", "title": "Bug 优先级分布", "categories": ["高", "中", "低"], "series": [{"name": "数量", "values": [5, 3, 2]}]}]
\`\`\``;

    const specs = extractChartSpecFromText(text);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.type).toBe("pie");
  });

  it("rejects invalid chart specs", () => {
    const text = `\`\`\`chart
[{"type": "invalid_type", "title": "", "categories": [], "series": []}]
\`\`\``;

    const specs = extractChartSpecFromText(text);
    expect(specs).toHaveLength(0); // invalid type + empty arrays → rejected
  });

  it("handles missing chart block gracefully", () => {
    const specs = extractChartSpecFromText("普通文本，无代码块");
    expect(specs).toHaveLength(0);
  });

  it("handles empty input", () => {
    const specs = extractChartSpecFromText("");
    expect(specs).toHaveLength(0);
  });

  it("extracts multiple chart specs", () => {
    const text = `\`\`\`chart
[
  {"type": "column", "title": "柱状图1", "categories": ["A", "B"], "series": [{"name": "S1", "values": [1, 2]}]},
  {"type": "pie", "title": "饼图1", "categories": ["X", "Y"], "series": [{"name": "S2", "values": [3, 4]}]}
]
\`\`\``;

    const specs = extractChartSpecFromText(text);
    expect(specs).toHaveLength(2);
  });
});

// ── chartDataExtractor ───────────────────────────────────

describe("chartDataExtractor", () => {
  it("extracts department people distribution", () => {
    const text = "技术部 18 人、产品部 12 人、设计部 9 人、QA 部 10 人";
    const specs = extractChartDataFromText(text, "部门人员分布");
    expect(specs.length).toBeGreaterThanOrEqual(1);
    if (specs.length > 0) {
      expect(specs[0]!.categories.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("extracts percentage data", () => {
    const text = "正式风格占比 45%，技术风格占比 30%，轻松风格占比 25%";
    const specs = extractChartDataFromText(text, "沟通风格分布");
    expect(specs.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for non-numeric text", () => {
    const specs = extractChartDataFromText("这是一段没有数字数据的纯文本描述。", "无数据");
    expect(specs).toHaveLength(0);
  });

  it("returns empty for empty input", () => {
    const specs = extractChartDataFromText("", "空");
    expect(specs).toHaveLength(0);
  });
});

// ── xlsxWriterGenerator ──────────────────────────────────

describe("xlsxWriterGenerator", () => {
  it("validatePythonScript rejects non-python text", async () => {
    const result = await validatePythonScript("这是普通文本，不是 Python 代码");
    expect(result).toBe(false);
  });

  it("validatePythonScript rejects script without xlsxwriter import", async () => {
    const result = await validatePythonScript("print('hello world')");
    expect(result).toBe(false);
  });

  it("validatePythonScript rejects syntactically invalid script", async () => {
    const result = await validatePythonScript("import xlsxwriter\nwb = xlsxwriter.Workbook(\n# missing close paren");
    expect(result).toBe(false);
  });

  it("validatePythonScript accepts valid xlsxwriter script", async () => {
    resetPythonDetectionCache();
    const script = `import xlsxwriter
wb = xlsxwriter.Workbook(sys.argv[1])
ws = wb.add_worksheet("Sheet1")
ws.write(0, 0, "Hello")
wb.close()`;
    const result = await validatePythonScript(script);
    expect(result).toBe(true);
  });

  it("python3 detection works", async () => {
    resetPythonDetectionCache();
    const available = await isPythonAvailable();
    expect(available).toBe(true); // python3 should be available in dev env
  });

  it("xlsxwriter detection works", async () => {
    resetPythonDetectionCache();
    const available = await isXlsxWriterAvailable();
    expect(available).toBe(true); // xlsxwriter was installed
  });
});

// ── generateExcel (Tier 3 fallback) ──────────────────────

describe("generateExcel (multi-sheet fallback)", () => {
  it("creates one sheet per section", async () => {
    const sections = [
      { title: "Sheet 1 - 项目进度", content: "内容1\n第二行" },
      { title: "Sheet 2 - Bug 分析", content: "内容2" },
      { title: "Sheet 3 - 协作分析", content: "内容3\n更多内容" },
    ];

    const buffer = await generateExcel("测试报告", sections);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1024); // should be a valid xlsx

    // Verify it's a valid ZIP (xlsx is a ZIP)
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4B); // 'K'
  });

  it("includes citations when provided", async () => {
    const sections = [{ title: "S1", content: "test" }];
    const citations = [
      { index: 1, title: "来源1", url: "https://example.com" },
    ];

    const buffer = await generateExcel("测试", sections, citations);
    // With citations, file should be larger
    expect(buffer.length).toBeGreaterThan(1024);
  });
});
