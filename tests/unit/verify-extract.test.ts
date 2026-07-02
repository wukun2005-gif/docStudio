/**
 * 验证 AST-based (marked) 代码块提取方案能覆盖所有 LLM 输出格式
 *
 * 比正则方案更健壮：marked 实现了完整的 CommonMark 规范，
 * 能正确处理 ```python、``` (裸)、~~~、缩进代码 等所有标准 markdown 格式。
 */
import { describe, expect, it } from "vitest";

// ── 模拟生产代码逻辑：使用 marked.lexer() 提取代码块 ──
function extractCodeBlocksFromText(rawText: string): {
  cleanedText: string;
  pythonScript?: string;
  chartSpecsRaw?: string[];
} {
  if (!rawText) return { cleanedText: rawText };

  const pythonScripts: string[] = [];
  const chartSpecsRaw: string[] = [];
  const removeIndices = new Set<number>();

  const { marked } = require("marked");
  const tokens = marked.lexer(rawText);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as any;

    if (token.type === "code") {
      const code = (token.text || "").trim();
      if (!code) continue;

      if (/xlsxwriter/i.test(code)) {
        pythonScripts.push(code);
        removeIndices.add(i);
      } else if (/^\s*\[\s*\{\s*"type"\s*:/i.test(code)) {
        chartSpecsRaw.push(code);
        removeIndices.add(i);
      }
    }

    // /chart ... /chart markers (non-standard)
    if (token.type === "paragraph" && token.tokens && !removeIndices.has(i)) {
      const paraText = token.tokens.map((t: any) => t.text || "").join("");
      const chartBlockMatch = paraText.match(/^\/chart\s*\n([\s\S]*?)\n\/chart$/i);
      if (chartBlockMatch) {
        const json = chartBlockMatch[1]!.trim();
        if (json.startsWith("[") && json.includes('"type"')) {
          chartSpecsRaw.push(json);
          removeIndices.add(i);
        }
      } else if (/^\/chart$/i.test(paraText.trim())) {
        removeIndices.add(i);
      }
    }
  }

  const keptTokens = tokens.filter((_t, idx) => !removeIndices.has(idx));
  let cleanedText = keptTokens.map((t: any) => t.raw || "").join("");
  cleanedText = cleanedText.replace(/\n{3,}/g, "\n\n").trim();

  return {
    cleanedText,
    pythonScript: pythonScripts.length > 0 ? pythonScripts.join("\n\n# SEP\n\n") : undefined,
    chartSpecsRaw: chartSpecsRaw.length > 0 ? chartSpecsRaw : undefined,
  };
}

// ── 模拟 case 1782975901147 的实际 LLM 输出 ──
const bareFenceOutput = `本周 Nexora Tech 项目团队取得了显著进展。

Sprint 3 在本周顺利结束，整体完成率达到 89%。

` + "```" + `
import sys, xlsxwriter

wb = xlsxwriter.Workbook(sys.argv[1])
hdr_fmt = wb.add_format({"bold": True, "bg_color": "#2563EB"})
ws1 = wb.add_worksheet("项目进度")
ws1.set_column(0, 5, 15)
wb.close()
` + "```" + `

/chart
[{"type": "bar", "title": "部门任务完成率", "categories": ["技术部", "产品部", "设计部", "QA"], "series": [{"name": "完成率%", "values": [85, 72, 90, 88]}]}]
/chart

本周项目进度详细表展示了各项任务执行情况。`;

describe("AST-based code block extraction", () => {
  // ── 格式覆盖 ──

  it("bare ``` fences (no language) — case 1782975901147", () => {
    const result = extractCodeBlocksFromText(bareFenceOutput);
    expect(result.pythonScript).toBeDefined();
    expect(result.pythonScript).toContain("xlsxwriter");
    expect(result.pythonScript).toContain("wb.close()");
  });

  it("/chart ... /chart markers — case 1782975901147", () => {
    const result = extractCodeBlocksFromText(bareFenceOutput);
    expect(result.chartSpecsRaw).toBeDefined();
    expect(result.chartSpecsRaw!.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(result.chartSpecsRaw![0]);
    expect(parsed[0].type).toBe("bar");
  });

  it("```python fences (standard)", () => {
    const input = "Text\n\n```python\nimport xlsxwriter\nwb = xlsxwriter.Workbook('t.xlsx')\n```\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeDefined();
  });

  it("~~~ fences (tilde syntax)", () => {
    const input = "Text\n\n~~~\nimport xlsxwriter\nwb = xlsxwriter.Workbook('t.xlsx')\n~~~\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeDefined();
  });

  it("~~~python fences (tilde + language)", () => {
    const input = "Text\n\n~~~python\nimport xlsxwriter\nwb = xlsxwriter.Workbook('t.xlsx')\n~~~\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeDefined();
  });

  it("tab-indented code blocks", () => {
    const input = "Text\n\n\timport xlsxwriter\n\twb = xlsxwriter.Workbook('t.xlsx')\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeDefined();
  });

  it("4-space indented code blocks", () => {
    const input = "Text\n\n    import xlsxwriter\n    wb = xlsxwriter.Workbook('t.xlsx')\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeDefined();
  });

  // ── 内容保护 ──

  it("cleanedText preserves narrative text", () => {
    const result = extractCodeBlocksFromText(bareFenceOutput);
    expect(result.cleanedText).toContain("Nexora Tech");
    expect(result.cleanedText).toContain("Sprint 3");
    expect(result.cleanedText).toContain("89%");
  });

  it("cleanedText has NO Python code", () => {
    const result = extractCodeBlocksFromText(bareFenceOutput);
    expect(result.cleanedText).not.toContain("xlsxwriter");
    expect(result.cleanedText).not.toContain("import sys");
    expect(result.cleanedText).not.toContain("wb.close()");
  });

  it("cleanedText has NO /chart markers", () => {
    const result = extractCodeBlocksFromText(bareFenceOutput);
    expect(result.cleanedText).not.toContain("/chart");
  });

  // ── 边缘情况 ──

  it("returns original text for non-code markdown", () => {
    const input = "This is just **bold** and *italic* text.\n\nNo code here.";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeUndefined();
    expect(result.chartSpecsRaw).toBeUndefined();
    expect(result.cleanedText).toContain("bold");
  });

  it("handles empty input", () => {
    const result = extractCodeBlocksFromText("");
    expect(result.cleanedText).toBe("");
    expect(result.pythonScript).toBeUndefined();
  });

  it("does NOT extract non-xlsxwriter code blocks as pythonScript", () => {
    const input = "Text\n\n```javascript\nconsole.log('hello');\n```\n\n```python\nprint('hello')\n```\n\nMore";
    const result = extractCodeBlocksFromText(input);
    expect(result.pythonScript).toBeUndefined();
    expect(result.cleanedText).toContain("console.log");
    expect(result.cleanedText).toContain("print('hello')");
  });

  it("```chart code fence → chart JSON in code block", () => {
    const input = "Text\n\n```chart\n[{\"type\": \"column\", \"categories\": [\"A\"], \"series\": [{\"name\": \"X\", \"values\": [1]}]}]\n```\n\nMore";
    const result = extractCodeBlocksFromText(input);
    // marked sees ```chart as a code block (lang="chart"), type is "code"
    // Code starts with [{"type": → matched by chart JSON pattern
    expect(result.chartSpecsRaw).toBeDefined();
    expect(result.cleanedText).not.toContain('"type"');
  });
});
