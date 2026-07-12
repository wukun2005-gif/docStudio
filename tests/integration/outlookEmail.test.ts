/**
 * Outlook Add-in 集成测试 — emailPayloadBuilder + readOutlookCaseFromDb
 *
 * 测试目的：
 * 1. toEmailPayload 纯函数：HTML sections → EmailWritePayload（subject/bodyHtml/citations）
 * 2. readOutlookCaseFromDb：内存 DB 中注入 mock sync_data → 解析为 StubCaseResult
 * 3. /api/generation/email stub 模式端到端（简化版，避免启 server）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resetDbForTesting, getDb } from "../../server/src/lib/db.js";
import { toEmailPayload, type EmailWritePayload } from "../../server/src/lib/emailPayloadBuilder.js";
import { readOutlookCaseFromDb } from "../../server/src/lib/stubDataReader.js";
import type { GenerateDocResult } from "../../server/src/lib/docGenerator.js";

describe("toEmailPayload 纯函数", () => {
  it("基础 3 段邮件：subject 去除 eml: 前缀 + bodyHtml 含 section 内容", () => {
    const result: GenerateDocResult = {
      content: "<html></html>",
      sections: [
        { title: "邮件开头", content: "<p>王芳你好，本周工作汇报如下。</p>", sources: [], webCitations: [], groundingScore: 0, citationLinks: [] },
        { title: "本周进展", content: "<p>完成了知识库 V2 上线和 Reranker 集成。</p>", sources: [], webCitations: [], groundingScore: 0, citationLinks: [] },
        { title: "下周计划", content: "<p>推进 Outlook add-in demo 与 demo 重录。</p>", sources: [], webCitations: [], groundingScore: 0, citationLinks: [] },
      ],
      trustScore: 0.93,
      documentStyle: "email",
      title: "eml: 产品开发汇报邮件",
    };

    const payload: EmailWritePayload = toEmailPayload(result, { citations: [] });

    expect(payload.subject).toBe("产品开发汇报邮件"); // 去除 "eml: "
    expect(payload.documentStyle).toBe("email");
    expect(payload.trustScore).toBeCloseTo(0.93);
    expect(payload.bodyCharCount).toBeGreaterThan(0);
    expect(payload.bodyHtml).toContain("王芳你好");
    expect(payload.bodyHtml).toContain("知识库 V2 上线");
    expect(payload.bodyHtml).toContain("Outlook add-in demo");
    expect(payload.bodyText).toContain("王芳你好");
    expect(payload.citations).toEqual([]);
  });

  it("title 没有 eml: 前缀时直接使用", () => {
    const result: GenerateDocResult = {
      content: "",
      sections: [{ title: "s1", content: "<p>hello</p>", sources: [], webCitations: [], groundingScore: 0, citationLinks: [] }],
      trustScore: 0.5,
      documentStyle: "email",
      title: "客户咨询回复",
    };
    const payload = toEmailPayload(result);
    expect(payload.subject).toBe("客户咨询回复");
  });

  it("空 title 兜底为 '邮件草稿'", () => {
    const result: GenerateDocResult = {
      content: "",
      sections: [],
      trustScore: 0,
      documentStyle: "email",
      title: "",
    };
    const payload = toEmailPayload(result);
    expect(payload.subject).toBe("邮件草稿");
  });

  it("citations 列表在 bodyHtml 末尾追加参考来源 block", () => {
    const result: GenerateDocResult = {
      content: "",
      sections: [{ title: "正文", content: "<p>详见 Reranker 报告 [1]。</p>", sources: [], webCitations: [], groundingScore: 0, citationLinks: [] }],
      trustScore: 0.9,
      documentStyle: "email",
      title: "测试邮件",
    };
    const payload = toEmailPayload(result, {
      citations: [
        { index: 1, title: "BAAI/bge-reranker-v2-m3", url: "https://huggingface.co/BAAI/bge-reranker-v2-m3" },
        { index: 2, title: "Outlook Add-in Docs", url: "https://learn.microsoft.com/outlook-addins" },
      ],
    });
    expect(payload.citations.length).toBe(2);
    expect(payload.bodyHtml).toContain("BAAI/bge-reranker-v2-m3");
    expect(payload.bodyHtml).toContain("https://huggingface.co/BAAI/bge-reranker-v2-m3");
    expect(payload.bodyHtml).toContain("href=\"https://learn.microsoft.com/outlook-addins\"");
    expect(payload.bodyText).toContain("[1] BAAI/bge-reranker-v2-m3");
  });

  it("HTML 标签在 bodyText 中被去除（保留段落换行）", () => {
    const result: GenerateDocResult = {
      content: "",
      sections: [{
        title: "s1",
        content: "<h2>章节标题</h2><p>段落1<br>换行</p><p>段落2</p>",
        sources: [], webCitations: [], groundingScore: 0, citationLinks: [],
      }],
      trustScore: 0,
      documentStyle: "email",
      title: "测试",
    };
    const payload = toEmailPayload(result);
    expect(payload.bodyText).not.toContain("<h2>");
    expect(payload.bodyText).not.toContain("<p>");
    expect(payload.bodyText).toContain("章节标题");
    expect(payload.bodyText).toContain("段落1");
    expect(payload.bodyText).toContain("段落2");
  });
});

describe("readOutlookCaseFromDb — 内存 DB", () => {
  beforeAll(() => {
    resetDbForTesting(":memory:");
  });

  it("空 DB 返回 null（case-1782296242386 不存在）", () => {
    const result = readOutlookCaseFromDb();
    expect(result).toBeNull();
  });

  it("mock 注入 case-1782296242386 → 成功读取元数据", () => {
    const db = getDb();
    const CASE_ID = "case-1782296242386";
    const mockRunId = "00000000-0000-0000-0000-000000000001";

    // 1. 注入 sync_data
    const caseData = {
      title: "eml: 产品开发汇报邮件",
      userRequest: "向王芳写一封邮件，汇报最近一周在做什么产品...",
      lastRunId: mockRunId,
      outline: [
        { title: "邮件开头（问候+简要目的）", description: "向王芳致意" },
        { title: "本周核心工作进展", description: "详细描述本周完成" },
        { title: "下周计划与需要协调事项", description: "下周计划" },
      ],
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))",
    ).run("cases", CASE_ID, JSON.stringify(caseData));

    // 2. 注入 generation_runs（带 HTML content）
    const htmlContent = `<div class="doc-content">
      <h1>产品开发汇报邮件</h1>
      <section><h2>邮件开头</h2><p>王芳你好，本周工作汇报。</p></section>
      <section><h2>本周进展</h2><p>完成了知识库 V2 上线。</p></section>
      <section><h2>下周计划</h2><p>Outlook add-in demo。</p></section>
      <footer><ol><li>[1] Reranker 报告 https://huggingface.co/BAAI/bge-reranker-v2-m3</li></ol></footer>
    </div>`;
    db.prepare(
      `INSERT INTO generation_runs (id, title, content, outline, status, trust_score, document_style, format, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'done', 0.93, 'email', 'email', datetime('now','localtime'), datetime('now','localtime'))`,
    ).run(
      mockRunId,
      "eml: 产品开发汇报邮件",
      htmlContent,
      JSON.stringify(caseData.outline),
    );

    // 3. 注入 provenance_nodes
    db.prepare(
      `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
       VALUES (?, 0, '邮件开头', NULL, 'https://example.com/reranker', 'Reranker 报告', 0.95, 0.9, 0, datetime('now','localtime'))`,
    ).run(mockRunId);

    // 4. 注入 trust_evaluations
    db.prepare(
      `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
    ).run("eval-001", mockRunId, JSON.stringify({ trust_score: 0.93, groundedness: 0.95 }));

    // 5. 读 case
    const result = readOutlookCaseFromDb();
    expect(result).not.toBeNull();
    expect(result!.title).toBe("eml: 产品开发汇报邮件");
    expect(result!.documentStyle).toBe("email");
    expect(result!.trustScore).toBeCloseTo(0.93);
    expect(result!.sourceRunId).toBe(mockRunId);
    expect(result!.sections.length).toBeGreaterThanOrEqual(3);
    expect(result!.sections.map((s) => s.title)).toContain("邮件开头（问候+简要目的）");
    expect(result!.sections.map((s) => s.title)).toContain("本周核心工作进展");
    expect(result!.sections.map((s) => s.title)).toContain("下周计划与需要协调事项");
    expect(result!.provenanceNodes.length).toBe(1);
    expect(result!.provenanceNodes[0].webUrl).toBe("https://example.com/reranker");
  });

  it("mock case 存在但 lastRunId 指向不存在的 generation_run → null", () => {
    const db = getDb();
    const CASE_ID = "case-1782296242386";
    // 清理上一轮
    db.prepare("DELETE FROM sync_data WHERE record_id = ?").run(CASE_ID);
    db.prepare(`INSERT INTO sync_data (store_name, record_id, data, updated_at) VALUES ('cases', ?, ?, datetime('now','localtime'))`).run(
      CASE_ID,
      JSON.stringify({
        title: "test",
        lastRunId: "00000000-0000-0000-0000-000000000999", // 不存在的 runId
        outline: [],
      }),
    );
    const result = readOutlookCaseFromDb();
    expect(result).toBeNull();
  });
});
