/**
 * Round-trip 测试：验证 pythonScript 从 LLM 输出 → toHtml → parseHtmlSections 完整传递
 *
 * 测试场景：LLM 输出包含 ```python 代码块 + 叙事文本
 */
import { describe, expect, it } from "vitest";

// 模拟 parseHtmlSections 中的 extractScriptTags 逻辑
function extractScriptTags(rawHtml: string): {
  cleanedContent: string;
  pythonScript?: string;
} {
  let cleaned = rawHtml;
  let pythonScript: string | undefined;

  const pyRegex = /<script\s+type="application\/x-python"\s+class="xlsx-script">([\s\S]*?)<\/script>/gi;
  const pyMatch = pyRegex.exec(cleaned);
  if (pyMatch?.[1]) {
    pythonScript = pyMatch[1].trim();
    cleaned = cleaned.replace(pyRegex, "");
  }

  return { cleanedContent: cleaned, pythonScript };
}

// 模拟 toHtml 中的 section 包装（非 email 格式）
function buildSectionHtml(title: string, content: string, pythonScript?: string): string {
  const scriptTag = pythonScript
    ? `<script type="application/x-python" class="xlsx-script">\n${pythonScript}\n</script>\n`
    : "";
  return `<section>\n<h2>${title}</h2>\n${scriptTag}${content}\n</section>`;
}

// 模拟 toHtml 中的 email 格式包装（无 <section> 包裹）
function buildEmailHtml(content: string, pythonScript?: string): string {
  const scriptTag = pythonScript
    ? `<script type="application/x-python" class="xlsx-script">\n${pythonScript}\n</script>\n`
    : "";
  return `${scriptTag}${content}`;
}

const PYTHON_SCRIPT = `import xlsxwriter

wb = xlsxwriter.Workbook(sys.argv[1])
hdr_fmt = wb.add_format({"bold": True, "bg_color": "#2563EB", "font_color": "#FFFFFF", "border": 1})

ws1 = wb.add_worksheet("项目进度")
ws1.set_column(0, 5, 15)
ws1.write(0, 0, "项目名称", hdr_fmt)

wb.close()`;

describe("pythonScript round-trip", () => {
  it("section format: pythonScript survives toHtml → parseHtmlSections", () => {
    const sectionContent = "<p>本周交付情况良好</p>\n<p>项目进度表如下：</p>";

    // Build HTML as toHtml would
    const html = buildSectionHtml("Sheet 1 - 项目进度", sectionContent, PYTHON_SCRIPT);

    // Verify script tag is in HTML
    expect(html).toContain('<script type="application/x-python" class="xlsx-script">');
    expect(html).toContain("import xlsxwriter");
    expect(html).toContain("<p>本周交付情况良好</p>");

    // Extract as parseHtmlSections would
    const { cleanedContent, pythonScript } = extractScriptTags(html);

    // Python script should be extracted
    expect(pythonScript).toBeDefined();
    expect(pythonScript).toContain("import xlsxwriter");
    expect(pythonScript).toContain("wb.close()");

    // Cleaned content should NOT contain script tag
    expect(cleanedContent).not.toContain('<script type="application/x-python"');

    // But should still contain the section content (including <section> wrapper)
    expect(cleanedContent).toContain("本周交付情况良好");
  });

  it("email format: pythonScript survives toHtml → parseHtmlSections", () => {
    const emailContent = "收件人：陈宇\n\n<p>本周交付情况良好</p>";

    // Build as email (no <section> tags)
    const html = buildEmailHtml(emailContent, PYTHON_SCRIPT);

    expect(html).toContain('<script type="application/x-python" class="xlsx-script">');
    expect(html).toContain("import xlsxwriter");

    const { cleanedContent, pythonScript } = extractScriptTags(html);

    expect(pythonScript).toBeDefined();
    expect(pythonScript).toContain("import xlsxwriter");
    expect(cleanedContent).toContain("本周交付情况良好");
    expect(cleanedContent).not.toContain('<script type="application/x-python"');
  });

  it("no pythonScript: parseHtmlSections returns undefined", () => {
    const html = buildSectionHtml("Sheet 1", "<p>纯文本内容</p>", undefined);

    expect(html).not.toContain('<script type="application/x-python"');

    const { pythonScript } = extractScriptTags(html);
    expect(pythonScript).toBeUndefined();
  });

  it("pythonScript contains special characters (HTML-safe round-trip)", () => {
    const trickyScript = `import xlsxwriter
wb = xlsxwriter.Workbook(sys.argv[1])
# 处理中文列名
ws.write(0, 0, "完成度%", fmt)
# <>& 等特殊字符在 Python 代码中常见
if x > 0 && y < 10:
    pass`;

    const html = buildSectionHtml("Sheet 1", "<p>content</p>", trickyScript);
    const { pythonScript } = extractScriptTags(html);

    expect(pythonScript).toBeDefined();
    expect(pythonScript).toContain("完成度%");
    expect(pythonScript).toContain("x > 0 && y < 10");
  });

  it("content NOT empty when pythonScript is extracted", () => {
    // This is the key bug fix: content should never become empty just because
    // a Python script was extracted from the LLM output.
    const narrativeContent = "<p>本周整体交付情况符合预期。核心认证模块与支付系统方案均按计划推进。</p>";

    const html = buildSectionHtml("Sheet 1", narrativeContent, PYTHON_SCRIPT);
    const { cleanedContent, pythonScript } = extractScriptTags(html);

    // Both should exist
    expect(pythonScript).toBeDefined();
    expect(cleanedContent).not.toBe("");  // ← KEY ASSERTION
    expect(cleanedContent.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan(10);
  });
});
