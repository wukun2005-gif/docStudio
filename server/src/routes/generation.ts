/**
 * 文档生成 API 路由
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { Router } from "express";
import crypto from "crypto";
import { generateDocument, toHtml } from "../lib/docGenerator.js";
import { exportDocument, type ExportFormat, type ExportSection } from "../lib/docExporter.js";
import { buildProvenanceTree, getProvenanceByRunId } from "../lib/provenanceTree.js";
import { getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { logAudit } from "../lib/auditLog.js";
import type { OutlineSection } from "../lib/narrativeEngine.js";

export const generationRouter = Router();

/** 根据用户需求生成简短文件名（启发式，无需 LLM） */
function generateDocTitle(userRequest: string, outline: OutlineSection[]): string {
  if (!userRequest) return outline[0]?.title ?? "文档";

  const req = userRequest.replace(/[，。！？、；：""''（）\[\]【】?!,.]/g, " ").replace(/\s+/g, " ").trim();

  // 邮件类：收件人 + 核心主题
  const isEmail = /邮件|email|写信/i.test(req);
  if (isEmail) {
    // 提取收件人：找"给/致/向"后面的名字（到动词或"的"为止）
    const recipientMatch = req.match(/(?:给|致|向|写给)\s*([^\s,，。写发寄打做干]{1,4})/);
    const recipient = recipientMatch?.[1] ?? "";
    // 从大纲提取核心主题（多章节时跳过问候类）
    const meaningfulSections = outline.length > 1
      ? outline.filter((s) => !/问候|近况|开头|称呼/.test(s.title))
      : outline;
    const topics = meaningfulSections.map((s) => s.title).join(" ");
    const theme = topics.slice(0, 12);
    return recipient ? `致${recipient}-${theme}` : (theme || "邮件");
  }

  // 报告/方案类
  const reportMatch = req.match(/(周报|月报|年报|报告|方案|总结|计划|通知|邀请函)/);
  if (reportMatch) {
    const type = reportMatch[1];
    const after = req.slice(req.indexOf(type) + type.length).trim().slice(0, 12);
    return (after ? `${after}${type}` : type).slice(0, 20);
  }

  // 其他：大纲标题组合
  return outline.map((s) => s.title).join("、").slice(0, 20) || req.slice(0, 20);
}

/** POST /api/generation/generate — 一键生成文档 */
generationRouter.post("/generate", async (req, res) => {
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    const runId = crypto.randomUUID();

    // 创建生成记录
    const db = getDb();
    db.prepare(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`)
      .run(runId, title, JSON.stringify(outline), format ?? "html", "generating");

    logAudit({
      table: "generation_runs",
      operation: "INSERT",
      recordId: runId,
      newData: { title, format: format ?? "html", status: "generating" },
      source: "generation",
    });

    // 从请求中获取服务器基础URL
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // 生成文档（超时由 registry 120s + docGenerator 180s 逐层保障）
    const result = await generateDocument({
      title,
      outline: outline as OutlineSection[],
      format: format ?? "html",
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
      userRequest,
      baseUrl,
    });

    // 更新记录
    const htmlContent = toHtml(result, baseUrl);

    // 生成简短文件名（基于用户需求 + 大纲）
    const docTitle = generateDocTitle(userRequest ?? title, outline as OutlineSection[]);

    db.prepare(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(docTitle, htmlContent, result.trustScore, result.documentStyle, runId);

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: runId,
      newData: { status: "done", trustScore: result.trustScore, documentStyle: result.documentStyle },
      source: "generation",
    });

    // 构建生成树（段落级来源追溯）
    try {
      const paragraphs = result.sections.flatMap((s, sIdx) =>
        s.sources.length > 0
          ? [{ idx: sIdx, sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })) }]
          : [],
      );
      if (paragraphs.length > 0) {
        buildProvenanceTree(runId, paragraphs);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 生成树构建失败（不影响生成）: ${treeErr}`);
    }

    logger.info(`[Generation] 文档生成完成: ${docTitle}`);

    res.json({
      ok: true,
      runId,
      title: docTitle,
      content: htmlContent,
      sections: result.sections,
      trustScore: result.trustScore,
      documentStyle: result.documentStyle,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 生成失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/history — 获取生成历史 */
generationRouter.get("/history", (_req, res) => {
  try {
    const db = getDb();
    const runs = db.prepare("SELECT id, title, outline, format, status, trust_score, created_at FROM generation_runs ORDER BY created_at DESC LIMIT 50").all() as any[];

    // 动态修正：标题看起来像大纲章节名的，尝试从关联 case 的 userRequest 重新生成
    const updateStmt = db.prepare("UPDATE generation_runs SET title = ? WHERE id = ?");
    for (const run of runs) {
      const title = run.title || "";
      const outline: Array<{ title: string }> = run.outline ? JSON.parse(run.outline) : [];
      const outlineTitles = outline.map((s) => s.title);

      // 判断标题是否就是大纲章节名（需要修正）
      const needsFix = !title || outlineTitles.includes(title) || title.length < 3;
      if (!needsFix) continue;

      // 查找关联的 case（按创建时间匹配：case 创建时间在 run 之前 24小时内）
      // case.createdAt 是 ISO 格式，run.created_at 是 SQLite local time
      const runTime = new Date(run.created_at).getTime() / 1000;
      const caseRow = db.prepare(`
        SELECT data FROM sync_data
        WHERE store_name = 'cases'
          AND data IS NOT NULL
          AND json_extract(data, '$.userRequest') IS NOT NULL
          AND json_extract(data, '$.userRequest') != ''
        LIMIT 100
      `).all() as Array<{ data: string }>;

      let matchedCase: { userRequest: string } | null = null;
      let minDiff = Infinity;
      for (const row of caseRow) {
        try {
          const caseData = JSON.parse(row.data);
          if (!caseData.userRequest || !caseData.createdAt) continue;
          const caseTime = new Date(caseData.createdAt).getTime() / 1000;
          const diff = Math.abs(caseTime - runTime);
          // case 创建时间在 run 之前 24小时内
          if (diff < minDiff && diff < 86400) {
            minDiff = diff;
            matchedCase = caseData;
          }
        } catch {}
      }

      if (!matchedCase) continue;
      const userRequest = matchedCase.userRequest;

      // 重新生成标题
      const req = userRequest.replace(/[，。！？、；：""''（）\[\]【】?!,.]/g, " ").replace(/\s+/g, " ").trim();
      let newTitle = "";

      const isEmail = /邮件|email|写信/i.test(req);
      if (isEmail) {
        const recipientMatch = req.match(/(?:给|致|向|写给)\s*([^\s,，。写发寄打做干]{1,4})/);
        const recipient = recipientMatch?.[1] ?? "";
        const meaningfulSections = outline.length > 1
          ? outline.filter((s) => !/问候|近况|开头|称呼/.test(s.title))
          : outline;
        const topics = meaningfulSections.map((s) => s.title).join(" ").slice(0, 12);
        newTitle = recipient ? `致${recipient}-${topics}` : (topics || "邮件");
      } else {
        const reportMatch = req.match(/(周报|月报|年报|报告|方案|总结|计划|通知|邀请函)/);
        if (reportMatch) {
          const type = reportMatch[1];
          const after = req.slice(req.indexOf(type) + type.length).trim().slice(0, 12);
          newTitle = after ? `${after}${type}` : type;
        } else {
          newTitle = outline.map((s) => s.title).join("、").slice(0, 20) || req.slice(0, 20);
        }
      }

      if (newTitle && newTitle !== title) {
        updateStmt.run(newTitle, run.id);
        run.title = newTitle;
        logger.info(`[Generation] 动态修正标题: "${title}" → "${newTitle}" (run: ${run.id})`);
      }
    }

    // 同步修正 case 标题：标题为"新文档"或空的 case，用最近的 generation run 标题更新
    const allCases = db.prepare(`
      SELECT record_id, data FROM sync_data WHERE store_name = 'cases' AND data IS NOT NULL
    `).all() as Array<{ record_id: string; data: string }>;
    const caseUpdateStmt = db.prepare("UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = 'cases' AND record_id = ?");
    for (const row of allCases) {
      try {
        const caseData = JSON.parse(row.data);
        const caseTitle = caseData.title || "";
        // 只修正标题为"新文档"或空的 case
        if (caseTitle && caseTitle !== "新文档") continue;
        if (!caseData.createdAt) continue;
        // 找最近的 generation run
        const caseTime = new Date(caseData.createdAt).getTime() / 1000;
        let bestRun: any = null;
        let bestDiff = Infinity;
        for (const run of runs) {
          const runTime2 = new Date(run.created_at).getTime() / 1000;
          const diff = Math.abs(runTime2 - caseTime);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestRun = run;
          }
        }
        if (bestRun && bestRun.title && bestRun.title !== "新文档" && bestDiff < 86400) {
          caseData.title = bestRun.title;
          caseUpdateStmt.run(JSON.stringify(caseData), row.record_id);
          logger.info(`[Generation] 同步修正 case 标题: "${caseTitle}" → "${bestRun.title}" (case: ${caseData.id})`);
        }
      } catch {}
    }

    // 返回时不带 outline 字段
    const result = runs.map(({ outline, ...rest }) => rest);
    res.json({ ok: true, runs: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/:id/sections — 从 provenance 重建章节来源详情（App 重启后恢复） */
generationRouter.get("/:id/sections", (req, res) => {
  try {
    const db = getDb();
    const run = db.prepare("SELECT outline, content FROM generation_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const outline: Array<{ title: string; description?: string }> = run.outline ? JSON.parse(run.outline) : [];

    // 从 provenance_nodes + kb_chunks + kb_sources 重建 sources
    const nodes = db.prepare(`
      SELECT p.paragraph_idx, p.chunk_id, p.score, p.is_manual,
             c.content AS chunk_content, c.source_id,
             s.name AS source_name, s.url AS source_url
      FROM provenance_nodes p
      LEFT JOIN kb_chunks c ON c.id = p.chunk_id
      LEFT JOIN kb_sources s ON s.id = c.source_id
      WHERE p.run_id = ?
      ORDER BY p.paragraph_idx, p.score DESC
    `).all(req.params.id) as any[];

    // 按 paragraph_idx 分组
    const grouped = new Map<number, Array<any>>();
    for (const n of nodes) {
      if (!grouped.has(n.paragraph_idx)) grouped.set(n.paragraph_idx, []);
      grouped.get(n.paragraph_idx)!.push(n);
    }

    // 构建 sections 数组
    const sections = outline.map((sec, idx) => {
      const provNodes = grouped.get(idx) ?? [];
      const sources = provNodes
        .filter((n) => n.chunk_id)
        .map((n) => ({
          chunkId: n.chunk_id,
          content: n.chunk_content ?? "",
          score: n.score,
          sourceId: n.source_id ?? undefined,
          sourceName: n.source_name ?? undefined,
          sourceUrl: n.source_url ?? undefined,
        }));
      return {
        title: sec.title,
        content: "", // 无法从 DB 恢复每章节原始内容
        sources,
        webCitations: [] as Array<{ title: string; url: string; snippet: string }>,
        groundingScore: 0.5,
      };
    });

    // 尝试从 HTML footer 提取 web citations
    if (run.content) {
      const footerMatch = run.content.match(/<footer class="citations">([\s\S]*?)<\/footer>/);
      if (footerMatch) {
        const footerHtml = footerMatch[1];
        // 提取外部链接（非 /api/knowledge/ 的链接）
        const linkRegex = /\[(\d+)\]\s*<a href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/g;
        let m;
        const webCitations: Array<{ title: string; url: string; snippet: string }> = [];
        while ((m = linkRegex.exec(footerHtml)) !== null) {
          const url = m[2];
          if (!url.includes("/api/knowledge/")) {
            webCitations.push({ title: m[3] || url, url, snippet: "" });
          }
        }
        // 将 web citations 附加到第一个 section（无法精确归属）
        if (webCitations.length > 0 && sections.length > 0) {
          sections[0].webCitations = webCitations;
        }
      }
    }

    res.json({ ok: true, sections });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 重建 sections 失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/generation/:id/tree — 获取生成树 */
generationRouter.get("/:id/tree", (req, res) => {
  try {
    const tree = getProvenanceByRunId(req.params.id);
    res.json({ ok: true, tree });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** 从大纲标题/描述推断文档风格（fallback） */
function inferDocumentStyle(outline: string | null): string | undefined {
  if (!outline) return undefined;
  try {
    const sections = JSON.parse(outline);
    const text = sections.map((s: any) => `${s.title ?? ""} ${s.description ?? ""}`).join(" ").toLowerCase();
    if (/邮件|email|mail|写信|致函/.test(text)) return "email";
    if (/ppt|演示|slides|幻灯片/.test(text)) return "ppt";
    if (/表格|table|excel/.test(text)) return "table";
    if (/报告|report/.test(text)) return "report";
    if (/代码|code|api|技术文档/.test(text)) return "code";
  } catch {}
  return undefined;
}

/** GET /api/generation/:id — 获取生成详情 */
generationRouter.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }
    // fallback：如果 document_style 为空，从大纲推断
    if (!run.document_style) {
      run.document_style = inferDocumentStyle(run.outline);
    }
    res.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** 从 HTML 内容中解析章节 */
function parseHtmlSections(html: string, title: string): ExportSection[] {
  const sections: ExportSection[] = [];

  // 先将 citation 链接转换为 [N] 纯文本，避免 HTML 标签剥离不完整导致属性残留
  // 注意：使用 [\s\S]*? 而不是 [^>]* 来匹配，因为 markdown 处理可能破坏 HTML 结构（如 _blank 变成 <em>blank）
  let processedHtml = html
    // 完整的链接结构：<sup><a ...>[N]</a></sup> → [N]
    .replace(/<sup><a[\s\S]*?>\[(\d+)\]<\/a><\/sup>/g, '[$1]')
    // span 结构：<sup><span ...>[N]</span></sup> → [N]
    .replace(/<sup><span[\s\S]*?>\[(\d+)\]<\/span><\/sup>/g, '[$1]')
    // 其他 sup 包裹：<sup...>[N]</sup> → [N]
    .replace(/<sup[\s\S]*?>\[(\d+)\]<\/sup>/g, '[$1]')
    // 剩余的裸链接（不含 sup）：<a ...>[N]</a> → [N]
    .replace(/<a[\s\S]*?>\[(\d+)\]<\/a>/g, '[$1]');

  // 尝试从 <section><h2>...</h2>...</section> 结构提取
  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = sectionRegex.exec(processedHtml)) !== null) {
    const sectionTitle = match[1].replace(/<[^>]+>/g, "").trim();
    const content = match[2]
      .replace(/<[^>]+>/g, "")  // 去 HTML 标签
      .trim();
    if (content) {
      sections.push({ title: sectionTitle, content, level: 1 });
    }
  }

  // 如果没有 section 标签（如邮件格式），整体作为一个章节
  if (sections.length === 0) {
    const text = processedHtml
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")  // 去 footer（参考来源列表单独处理）
      .replace(/<[^>]+>/g, "")  // 去 HTML 标签
      .trim();
    if (text) {
      sections.push({ title, content: text, level: 1 });
    }
  }

  return sections;
}

/** 从 HTML 内容中解析参考来源列表 */
function parseCitations(html: string): Array<{ index: number; title: string; url?: string }> {
  const citations: Array<{ index: number; title: string; url?: string }> = [];

  // 提取 footer 中的参考来源
  const footerMatch = html.match(/<footer class="citations">([\s\S]*?)<\/footer>/);
  if (!footerMatch) return citations;

  const footerHtml = footerMatch[1];

  // 匹配 citation-item 中的 [N] 和链接
  // 格式1: <span class="citation-num">[N]</span> <a href="url">title</a>
  // 格式2: <span class="citation-num">[N]</span> title (无链接)
  const itemRegex = /<div class="citation-item">([\s\S]*?)<\/div>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(footerHtml)) !== null) {
    const itemHtml = itemMatch[1];

    // 提取 [N] 编号
    const numMatch = itemHtml.match(/\[(\d+)\]/);
    if (!numMatch) continue;
    const index = parseInt(numMatch[1], 10);

    // 提取链接和标题
    const linkMatch = itemHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
    if (linkMatch) {
      citations.push({ index, url: linkMatch[1], title: linkMatch[2].trim() });
    } else {
      // 无链接，提取纯文本标题
      const titleText = itemHtml
        .replace(/<span[^>]*>\[\d+\]<\/span>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (titleText) {
        citations.push({ index, title: titleText });
      }
    }
  }

  return citations;
}

/** GET /api/generation/:id/export/:format — 导出文档 */
generationRouter.get("/:id/export/:format", (req, res) => {
  try {
    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    const format = req.params.format as ExportFormat;
    if (!["docx", "pptx", "xlsx", "eml"].includes(format)) {
      res.status(400).json({ ok: false, error: "Invalid format" });
      return;
    }

    // 从生成的 HTML 内容中解析章节（而非使用 outline description）
    const sections = run.content
      ? parseHtmlSections(run.content, run.title)
      : [];

    // 解析参考来源列表
    const citations = run.content ? parseCitations(run.content) : [];

    // 从请求中获取服务器基础URL，将相对路径转换为完整URL
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // 将相对路径转换为完整URL
    const resolvedCitations = citations.map((c) => {
      if (c.url && c.url.startsWith("/")) {
        return { ...c, url: `${baseUrl}${c.url}` };
      }
      return c;
    });

    const result = exportDocument(format, run.title, sections, resolvedCitations);

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(run.title)}${result.extension}"`);
    res.send(result.buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 导出失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/generation/:runId/regenerate-section — 重新生成单个章节 */
generationRouter.post("/:runId/regenerate-section", async (req, res) => {
  try {
    const { sectionIdx, section, outline, apiKey } = req.body;
    if (sectionIdx === undefined || !section || !outline) {
      res.status(400).json({ ok: false, error: "sectionIdx, section, and outline are required" });
      return;
    }

    const db = getDb();
    const run = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(req.params.runId) as any;
    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    // 从请求中获取服务器基础URL
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // 用单章节大纲调用 generateDocument
    const singleOutline = [section];
    const result = await generateDocument({
      title: run.title,
      outline: singleOutline,
      format: run.format ?? "html",
      apiKey,
      userRequest: run.title,
      baseUrl,
    });

    // 重新生成完整文档 HTML：替换对应章节
    const oldContent = run.content || "";
    const fullOutline = JSON.parse(run.outline || "[]");
    // 重新生成所有章节的 HTML（用新章节替换旧章节）
    const newSectionHtml = toHtml(result, baseUrl);

    // 简单策略：返回新章节内容，由前端拼接
    const newSectionData = result.sections[0];

    // 更新 provenance：删除旧章节的节点，写入新节点
    try {
      const oldNodes = db.prepare("SELECT id FROM provenance_nodes WHERE run_id = ? AND paragraph_idx = ?")
        .all(req.params.runId, sectionIdx) as any[];
      for (const n of oldNodes) {
        db.prepare("DELETE FROM provenance_nodes WHERE id = ?").run(n.id);
      }
      if (newSectionData.sources.length > 0) {
        buildProvenanceTree(req.params.runId, [{
          idx: sectionIdx,
          sources: newSectionData.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })),
        }]);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 章节生成树更新失败: ${treeErr}`);
    }

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: req.params.runId,
      source: "generation.regenerate-section",
    });

    logger.info(`[Generation] 章节 ${sectionIdx} 重新生成完成`);

    res.json({
      ok: true,
      section: {
        title: newSectionData.title,
        content: newSectionData.content,
        sources: newSectionData.sources,
        webCitations: newSectionData.webCitations,
        groundingScore: newSectionData.groundingScore,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 章节重新生成失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/generation/:id/content — 更新文档内容（在线编辑 Feature #16） */
generationRouter.put("/:id/content", (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ ok: false, error: "content is required" });
      return;
    }

    const db = getDb();
    db.prepare("UPDATE generation_runs SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(content, req.params.id);

    logAudit({
      table: "generation_runs",
      operation: "UPDATE",
      recordId: req.params.id,
      source: "generation",
    });

    logger.info(`[Generation] 文档内容已更新: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
