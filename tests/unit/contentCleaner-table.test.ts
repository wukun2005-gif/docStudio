/**
 * 单元测试：contentCleaner 的 markdown 表格解析
 * 覆盖 case 1782966166476 中发现的两个问题：
 * 1. 表格行之间有空行时，不应拆成独立 <p>
 * 2. 首行缺少前导 | 时，也应识别为表格行
 */
import { describe, it, expect } from "vitest";
import { cleanContent } from "../../server/src/lib/contentCleaner.js";

describe("markdownToHtml: 表格解析", () => {
  it("case 1782966166476：表格行间有空行 + 首行无前导|", () => {
    const input = [
      "本周项目进展如下：",
      "",
      "0 升级 | 进行中 | 45% | 赵强 | 6/5-6/25 | 性能测试中 |",
      "",
      "| 安全审计 | 代码安全扫描 | 待开始 | 0% | 孙丽 | 6/20-7/5 | 计划下周启动 |",
      "",
      "| 性能优化 | Redis 缓存策略 | 进行中 | 30% | 陈明 | 6/10-6/28 | 内存使用率降低 15% |",
      "",
      "其他内容正常。",
    ].join("\n");

    const result = cleanContent(input, "html", []);

    // 应该有一个 <table>
    expect(result).toContain("<table>");
    // 不应该有以 | 开头的 <p> 标签
    expect(result).not.toMatch(/<p>[^<]*\|/);
    // 普通段落应该保留
    expect(result).toContain("本周项目进展如下");
    expect(result).toContain("其他内容正常");
  });

  it("标准 GFM 表格（无空行）", () => {
    const input = "| 列1 | 列2 |\n|---|---|\n| a | b |\n| c | d |";
    const result = cleanContent(input, "html", []);
    expect(result).toContain("<table>");
    expect(result).toContain("<th>列1</th>");
    expect(result).toContain("<td>a</td>");
  });

  it("标准 GFM 表格（带空行+分隔行）", () => {
    const input = "| 列1 | 列2 |\n\n|---|---|\n\n| a | b |\n\n| c | d |";
    const result = cleanContent(input, "html", []);
    expect(result).toContain("<table>");
    expect(result).toContain("<th>列1</th>");
    expect(result).toContain("<td>b</td>");
  });

  it("首行无前导|（无空行）", () => {
    const input = "项目 | 状态 |\n|---|---|\n| 升级 | 进行中 |\n| 审计 | 待开始 |";
    const result = cleanContent(input, "html", []);
    expect(result).toContain("<table>");
    expect(result).toContain("<th>项目</th>");
  });

  it("普通文本含单个 | 不应被识别为表格", () => {
    const input = "这是 a | b 的说明。";
    const result = cleanContent(input, "html", []);
    // 单个 | 不够 2 个，不构成表格行
    expect(result).not.toContain("<table>");
    expect(result).toContain("<p>这是 a | b 的说明。</p>");
  });

  it("表格后接段落应正确分割", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |\n\n这是后面的段落。";
    const result = cleanContent(input, "html", []);
    expect(result).toContain("<table>");
    expect(result).toContain("这是后面的段落");
  });
});
