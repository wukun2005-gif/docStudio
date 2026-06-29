/**
 * 文档生成 API 路由
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { Router } from "express";
import crypto from "crypto";
import { generateDocument, toHtml, type GenerateDocResult } from "../lib/docGenerator.js";
import { exportDocument, type ExportFormat, type ExportSection } from "../lib/docExporter.js";
import { buildProvenanceTree, getProvenanceByRunId } from "../lib/provenanceTree.js";
import { dbRun, dbGet, dbAll, dbTransaction } from "../lib/dbQuery.js";
import { logger } from "../lib/logger.js";
import type { OutlineSection } from "../lib/narrativeEngine.js";

export const generationRouter = Router();

/** POST /api/generation/generate — 一键生成文档 */
generationRouter.post("/generate", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // ── 并发去重：检查是否已有同名文档正在生成 ──
    // 注意：若进程中途崩溃/停止，记录可能永远停留在 status='generating'，
    // 因此用 created_at 时间窗口（10 分钟）判定为「遗留死锁」，自动清理后放行
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating'",
      [title],
    );

    if (existing) {
      // SQLite 时间窗口判定：当前时间 - created_at > 10 分钟 → 视为遗留死锁
      // 注意：章节级 LLM 调用多轮 3-5 分钟是常态，必须使用分钟级阈值，
      // 否则正常任务会被误判为死锁并清理，造成"既 crashed 又在继续写"的竞态。
      const STALE_THRESHOLD_SECONDS = 10 * 60;
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        logger.warn(`[Generation] 清理遗留死锁记录 ${existing.id} (created_at=${existing.created_at})，允许新请求`);
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else {
        logger.warn(`[Generation] 拒绝并发请求: "${title}" 已有生成任务 ${existing.id}`);
        res.status(409).json({ ok: false, error: "同名文档正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    runId = crypto.randomUUID();
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), format ?? "html", "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: format ?? "html", status: "generating" } });

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
    });

    // 更新记录
    const htmlContent = toHtml(result, baseUrl);

    // 使用 LLM 生成的标题（已在 generateDocument 中完成）
    const docTitle = result.title;

    dbRun(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [docTitle, htmlContent, result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, runId],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: result.trustScore, documentStyle: result.documentStyle } });

    // 构建生成树（段落级来源追溯）
    try {
      const paragraphs = result.sections.map((s, sIdx) => ({
        idx: sIdx,
        title: s.title,
        groundingScore: s.groundingScore,
        sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })),
        webCitations: s.webCitations?.length ? s.webCitations : undefined,
      }));
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
      ...(result.conflictResolution ? { conflictResolution: result.conflictResolution } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 生成失败: ${msg}`);
    try {
      dbRun(`UPDATE generation_runs SET status = 'crashed', updated_at = datetime('now','localtime') WHERE id = ?`,
        [runId], { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "crashed" } });
    } catch {}
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/generation/generate/stream — 流式生成文档（SSE，章节级推送） */
generationRouter.post("/generate/stream", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // ── 并发去重（与非流式版本相同） ──
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating'",
      [title],
    );

    if (existing) {
      // 与非流式版本保持一致：10 分钟阈值
      const STALE_THRESHOLD_SECONDS = 10 * 60;
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        logger.warn(`[Generation] 清理遗留死锁记录 ${existing.id} (created_at=${existing.created_at})，允许新请求`);
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else {
        logger.warn(`[Generation] 拒绝并发请求: "${title}" 已有生成任务 ${existing.id}`);
        res.status(409).json({ ok: false, error: "同名文档正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    runId = crypto.randomUUID();
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), format ?? "html", "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: format ?? "html", status: "generating" } });

    // ── 设置 SSE headers ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // SSE 推送助手：每次 write 后强制 flush（避免 Node.js/代理 buffering）
    const writeSSE = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 先推送 runId，让客户端知道请求已被接受
    writeSSE("start", { ok: true, runId });
    logger.info(`[Generation] 流式生成开始: ${title}, runId=${runId}, 章节数=${outline.length}`);

    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // ── 流式生成：每个章节生成后立即推送 SSE ──
    const totalSections = outline.length;
    let sectionIndex = 0;
    const result = await generateDocument({
      title,
      outline: outline as OutlineSection[],
      format: format ?? "html",
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
      userRequest,
    }, (section, phase) => {
      if (phase === "start") {
        // 章节开始生成 — 立即推送进度提示
        writeSSE("section-start", { index: sectionIndex, total: totalSections, title: section.title });
        logger.info(`[Generation] SSE 推送: section-start [${sectionIndex + 1}/${totalSections}] ${section.title}`);
      } else {
        // 章节完成 — 推送章节内容（类型断言：done 阶段 section 是完整对象）
        const doneSection = section as GenerateDocResult["sections"][number];
        writeSSE("section", {
          index: sectionIndex,
          section: {
            title: doneSection.title,
            content: doneSection.content,
            groundingScore: doneSection.groundingScore,
            sources: doneSection.sources.map((s) => ({ chunkId: s.chunkId, score: s.score, sourceName: s.sourceName, sourceUrl: s.sourceUrl })),
            webCitations: doneSection.webCitations,
          },
        });
        logger.info(`[Generation] SSE 推送: section [${sectionIndex + 1}/${totalSections}] ${doneSection.title} (content=${doneSection.content?.length || 0} chars)`);
        sectionIndex++;
      }
    });

    // ── 生成完成：更新 DB 记录，构建 provenance tree ──
    const htmlContent = toHtml(result, baseUrl);
    const docTitle = result.title;

    dbRun(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [docTitle, htmlContent, result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, runId],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: result.trustScore, documentStyle: result.documentStyle } });

    try {
      const paragraphs = result.sections.map((s, sIdx) => ({
        idx: sIdx,
        title: s.title,
        groundingScore: s.groundingScore,
        sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })),
        webCitations: s.webCitations?.length ? s.webCitations : undefined,
      }));
      if (paragraphs.length > 0) {
        buildProvenanceTree(runId, paragraphs);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 生成树构建失败（不影响生成）: ${treeErr}`);
    }

    logger.info(`[Generation] 流式文档生成完成: ${docTitle}`);

    // ── 推送最终结果（done event） ──
    const donePayload = {
      ok: true,
      runId,
      title: docTitle,
      content: htmlContent,
      sections: result.sections.map((s) => ({ title: s.title, content: s.content, groundingScore: s.groundingScore })),
      trustScore: result.trustScore,
      documentStyle: result.documentStyle,
      ...(result.conflictResolution ? { conflictResolution: result.conflictResolution } : {}),
    };
    const doneJson = JSON.stringify(donePayload);
    logger.info(`[Generation] done event JSON: jsonLen=${doneJson.length} contentLen=${htmlContent.length} sections=${result.sections.length} conflictRes=${!!result.conflictResolution}`);

    // 诊断：检查 JSON 是否包含未转义的换行符（会破坏 SSE 协议）
    const nlInJson = doneJson.split('\n').length - 1;
    if (nlInJson > 0) {
      logger.warn(`[Generation] done event JSON 包含 ${nlInJson} 个实际换行符（应为 0）— 会导致客户端 SSE 解析失败`);
    }

    const write1Ok = res.write(`event: done\n`);
    const write2Ok = res.write(`data: ${doneJson}\n\n`);
    if (!write1Ok) logger.warn(`[Generation] done event write1 返回 false（backpressure）`);
    if (!write2Ok) logger.warn(`[Generation] done event write2 返回 false（backpressure）`);
    res.end();
    logger.info(`[Generation] done event sent & stream ended, total=${13 + doneJson.length + 2} bytes`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 流式生成失败: ${msg}`);
    try {
      dbRun(`UPDATE generation_runs SET status = 'crashed', updated_at = datetime('now','localtime') WHERE id = ?`,
        [runId], { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "crashed" } });
    } catch {}
    // 如果还能写，就写 error event
    if (!res.writableEnded) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ ok: false, error: msg })}\n\n`);
      res.end();
    }
  }
});

/** GET /api/generation/history — 获取生成历史 */
generationRouter.get("/history", (_req, res) => {
  try {
    const runs = dbAll<any>(
      "SELECT id, title, outline, format, status, trust_score, created_at FROM generation_runs ORDER BY created_at DESC LIMIT 50",
    );

    // 动态修正：标题看起来像大纲章节名的，尝试从关联 case 的 userRequest 重新生成
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
      const caseRow = dbAll<{ data: string }>(`
        SELECT data FROM sync_data
        WHERE store_name = 'cases'
          AND data IS NOT NULL
          AND json_extract(data, '$.userRequest') IS NOT NULL
          AND json_extract(data, '$.userRequest') != ''
        LIMIT 100
      `);

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

      // 历史记录标题修正：用用户请求前 10 字作为标题（不调 LLM，避免额外开销）
      const newTitle = userRequest
        ?.replace(/[^一-鿿\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10) || "";

      if (newTitle && newTitle !== title) {
        dbRun("UPDATE generation_runs SET title = ? WHERE id = ?",
          [newTitle, run.id],
          { table: "generation_runs", recordId: run.id, source: "generation" });
        run.title = newTitle;
        logger.info(`[Generation] 动态修正标题: "${title}" → "${newTitle}" (run: ${run.id})`);
      }
    }

    // 同步修正 case 标题：标题为"新文档"或空的 case，用最近的 generation run 标题更新
    const allCases = dbAll<{ record_id: string; data: string }>(`
      SELECT record_id, data FROM sync_data WHERE store_name = 'cases' AND data IS NOT NULL
    `);
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
          dbRun("UPDATE sync_data SET data = ?, updated_at = datetime('now','localtime') WHERE store_name = 'cases' AND record_id = ?",
            [JSON.stringify(caseData), row.record_id],
            { table: "sync_data", recordId: row.record_id, source: "generation", newData: caseData });
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
    const run = dbGet<any>("SELECT outline, content FROM generation_runs WHERE id = ?", [req.params.id]);
    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const outline: Array<{ title: string; description?: string }> = run.outline ? JSON.parse(run.outline) : [];

    // 从 provenance_nodes + kb_chunks + kb_sources 重建 sources（同时包含 web 来源）
    const nodes = dbAll<any>(`
      SELECT p.paragraph_idx, p.paragraph_title, p.grounding_score, p.chunk_id, p.score, p.is_manual,
             p.web_url, p.web_title, p.web_snippet,
             c.content AS chunk_content, c.source_id,
             s.name AS source_name, s.url AS source_url
      FROM provenance_nodes p
      LEFT JOIN kb_chunks c ON c.id = p.chunk_id
      LEFT JOIN kb_sources s ON s.id = c.source_id
      WHERE p.run_id = ?
      ORDER BY p.paragraph_idx, p.score DESC
    `, [req.params.id]);

    // 优先按 paragraph_title 匹配，回退到 paragraph_idx
    const byTitle = new Map<string, Array<any>>();
    const byIdx = new Map<number, Array<any>>();
    for (const n of nodes) {
      // 按 title 分组（取该节点的 paragraph_title，或从 outline 取）
      const title = n.paragraph_title ?? outline[n.paragraph_idx]?.title;
      if (title) {
        if (!byTitle.has(title)) byTitle.set(title, []);
        byTitle.get(title)!.push(n);
      }
      // 同时按 idx 分组（作为回退）
      if (!byIdx.has(n.paragraph_idx)) byIdx.set(n.paragraph_idx, []);
      byIdx.get(n.paragraph_idx)!.push(n);
    }

    // 构建 sections 数组：从 provenance 中同时提取知识库来源和 web 来源
    const sections = outline.map((sec, idx) => {
      // 优先用 title 匹配，回退到 idx
      const provNodes = byTitle.get(sec.title) ?? byIdx.get(idx) ?? [];
      // 取该组中第一个有 grounding_score 的值
      const storedGrounding = provNodes.find((n) => n.grounding_score != null)?.grounding_score;
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
      // 从 provenance 节点中提取 web 来源（有 web_url 的节点）
      const webCitations = provNodes
        .filter((n) => n.web_url)
        .map((n) => ({
          title: n.web_title || n.web_url,
          url: n.web_url,
          snippet: n.web_snippet ?? "",
        }));
      return {
        title: sec.title,
        content: "", // 无法从 DB 恢复每章节原始内容
        sources,
        webCitations,
        groundingScore: storedGrounding ?? 0.5,
      };
    });

    // Fallback：如果 provenance 中没有 web 来源（老数据或 web 未写入 provenance），
    // 尝试从 HTML footer 解析 URL 并按内容匹配到章节
    const totalWebFromProv = sections.reduce((sum, s) => sum + s.webCitations.length, 0);
    if (totalWebFromProv === 0 && run.content) {
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
        // 尝试按 URL 在文档内容中出现的位置归属到章节
        if (webCitations.length > 0 && sections.length > 0) {
          // 从 HTML 中提取各章节内容片段用于匹配
          const sectionContents = sections.map((s) => {
            // 用 outline title 在 HTML 中定位章节
            const titleRegex = new RegExp(`<h[1-3][^>]*>\\s*${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h[1-3]>([\\s\\S]*?)(?=<h[1-3]|$)`, "i");
            const match = run.content.match(titleRegex);
            return match ? match[1] : "";
          });
          for (const cite of webCitations) {
            let assigned = false;
            // 检查 URL 是否出现在某个章节内容中
            for (let i = 0; i < sectionContents.length; i++) {
              if (sectionContents[i].includes(cite.url)) {
                sections[i].webCitations.push(cite);
                assigned = true;
                break;
              }
            }
            // 未匹配到则放入最后一个章节（通常是"参考文献"或附录）
            if (!assigned && sections.length > 0) {
              sections[sections.length - 1].webCitations.push(cite);
            }
          }
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
    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
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
  // 逐层清理：先处理完整 sup+link 结构，再处理残留
  let processedHtml = html
    // 完整的 <sup><a ...>[N]</a></sup> 或 <sup><span ...>[N]</span></sup> → [N]
    .replace(/<sup>\s*<(?:a|span)[^>]*?>\[(\d+)\]<\/(?:a|span)>\s*<\/sup>/gi, '[$1]')
    // 残留 sup 标签包裹的：[N] → [N]
    .replace(/<sup[^>]*?>\s*\[(\d+)\]\s*<\/sup>/gi, '[$1]')
    // 残留裸 a 链接：[N] → [N]
    .replace(/<a[^>]*?>\s*\[(\d+)\]\s*<\/a>/gi, '[$1]')
    // 残留裸 span：[N] → [N]
    .replace(/<span[^>]*?>\s*\[(\d+)\]\s*<\/span>/gi, '[$1]');

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
generationRouter.get("/:id/export/:format", async (req, res) => {
  try {
    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
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

    const result = await exportDocument(format, run.title, sections, resolvedCitations);

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

    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.runId]);
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
    });

    // 重新生成完整文档 HTML：替换对应章节
    const _oldContent = run.content || "";
    const _fullOutline = JSON.parse(run.outline || "[]");
    // 重新生成所有章节的 HTML（用新章节替换旧章节）
    const _newSectionHtml = toHtml(result, baseUrl);

    // 简单策略：返回新章节内容，由前端拼接
    const newSectionData = result.sections[0];

    // 更新 provenance：删除旧章节的节点，写入新节点
    try {
      const oldNodes = dbAll<any>("SELECT id FROM provenance_nodes WHERE run_id = ? AND paragraph_idx = ?",
        [req.params.runId, sectionIdx]);
      dbTransaction(() => {
        for (const n of oldNodes) {
          dbRun("DELETE FROM provenance_nodes WHERE id = ?", [n.id],
            { table: "provenance_nodes", recordId: n.id, source: "generation.regenerate-section" });
        }
      });
      const hasSources = newSectionData.sources.length > 0;
      const hasWebCitations = newSectionData.webCitations && newSectionData.webCitations.length > 0;
      if (hasSources || hasWebCitations) {
        buildProvenanceTree(req.params.runId, [{
          idx: sectionIdx,
          title: newSectionData.title,
          groundingScore: newSectionData.groundingScore,
          sources: newSectionData.sources.map((src) => ({ chunkId: src.chunkId, score: src.score })),
          webCitations: hasWebCitations ? newSectionData.webCitations : undefined,
        }]);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 章节生成树更新失败: ${treeErr}`);
    }

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

    dbRun("UPDATE generation_runs SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      [content, req.params.id],
      { table: "generation_runs", recordId: req.params.id, source: "generation" });

    logger.info(`[Generation] 文档内容已更新: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/generation/:id/evaluate — 计算用户可见指标（有据可查度、内容相关度、内容完整度） */
generationRouter.post("/:id/evaluate", async (req, res) => {
  try {
    const { apiKey: reqApiKey, providerId, modelId, userRequest } = req.body;

    // 动态导入评估模块
    const { checkDocumentRelevance } = await import("../lib/relevanceCheck.js");
    const { checkDocumentCompleteness } = await import("../lib/completenessCheck.js");
    const { detectConflicts } = await import("../lib/conflictDetection.js");
    const { readSettingsFromDb } = await import("../lib/settingsReader.js");
    const { getApiKey } = await import("../security/keyStore.js");

    // 读取用户配置的 provider 和 model
    const dbSettings = readSettingsFromDb();
    const effectiveProvider = providerId ?? dbSettings.providerPreference?.[0] ?? "mimo";
    const effectiveModel = modelId ?? dbSettings.modelId ?? "mimo-v2-pro";

    // ── 模型 fallback: 仅当用户显式启用时生效 ─────────────────────────────
    // 用户明确配置 enableModelFallback[provider] = true 时，
    // 在主模型超时/失败时自动切换到备用模型。未启用时不切换。
    const fallbackEnabled = dbSettings.enableModelFallback?.[effectiveProvider] === true;
    const fallbackModels = fallbackEnabled ? (dbSettings.modelFallbacks?.[effectiveProvider] ?? []) : [];
    const modelCandidates = [effectiveModel, ...fallbackModels.filter((m) => m !== effectiveModel)];

    logger.info(`[Generation] 评估模型配置: provider=${effectiveProvider}, primaryModel=${effectiveModel}, fallbackEnabled=${fallbackEnabled}, candidates=[${modelCandidates.join(", ")}]`);

    // 封装: 按 modelCandidates 顺序尝试调用，失败时切换（仅 fallback 启用时）
    async function tryWithFallback<T>(
      fn: (model: string) => Promise<T>,
      taskName: string,
    ): Promise<T> {
      let lastErr: unknown = null;
      for (let i = 0; i < modelCandidates.length; i++) {
        const candidate = modelCandidates[i];
        try {
          if (i > 0) logger.info(`[Generation] ${taskName} 尝试备用模型 ${i + 1}/${modelCandidates.length}: ${candidate}`);
          return await fn(candidate);
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[Generation] ${taskName} 模型 ${candidate} 失败: ${msg}`);
          // 若 fallback 未启用，只尝试主模型
          if (!fallbackEnabled) break;
        }
      }
      throw lastErr ?? new Error(`${taskName} 所有模型均失败`);
    }

    // 获取 API Key：优先使用请求中的，否则从 keyStore 读取
    const apiKey = reqApiKey ?? getApiKey(effectiveProvider);
    if (!apiKey) {
      res.status(400).json({ ok: false, error: "apiKey is required（请在设置页配置或在请求中提供）" });
      return;
    }

    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    // 从 HTML 中解析章节
    const sections = run.content ? parseHtmlSections(run.content, run.title) : [];
    if (sections.length === 0) {
      res.status(400).json({ ok: false, error: "No sections found in document" });
      return;
    }

    // 获取用户原始需求：优先使用请求中的 userRequest，否则从关联 case 获取，最后 fallback 到 run.title
    let requirement = userRequest;
    if (!requirement) {
      // 尝试从关联的 case 获取原始 userRequest
      const runTime = new Date(run.created_at).getTime() / 1000;
      const caseRows = dbAll<{ data: string }>(`
        SELECT data FROM sync_data
        WHERE store_name = 'cases'
          AND data IS NOT NULL
          AND json_extract(data, '$.userRequest') IS NOT NULL
          AND json_extract(data, '$.userRequest') != ''
        LIMIT 100
      `);

      let bestMatch: { userRequest: string; diff: number } | null = null;
      for (const row of caseRows) {
        try {
          const caseData = JSON.parse(row.data);
          if (!caseData.userRequest || !caseData.createdAt) continue;
          const caseTime = new Date(caseData.createdAt).getTime() / 1000;
          const diff = Math.abs(caseTime - runTime);
          if (diff < 86400 && (!bestMatch || diff < bestMatch.diff)) {
            bestMatch = { userRequest: caseData.userRequest, diff };
          }
        } catch { /* skip parse errors */ }
      }
      requirement = bestMatch?.userRequest ?? run.title;
    }
    logger.info(`[Generation] 评估需求来源: ${requirement === userRequest ? '请求参数' : requirement === run.title ? 'run.title' : '关联case'}`);

    // 从 provenance 重建章节来源详情（用于冲突检测）
    const provNodes = dbAll<any>(`
      SELECT p.paragraph_idx, p.paragraph_title, p.chunk_id, p.score,
             c.content AS chunk_content, s.name AS source_name
      FROM provenance_nodes p
      LEFT JOIN kb_chunks c ON c.id = p.chunk_id
      LEFT JOIN kb_sources s ON s.id = c.source_id
      WHERE p.run_id = ?
      ORDER BY p.paragraph_idx, p.score DESC
    `, [req.params.id]);

    // 按章节分组来源
    const outline: Array<{ title: string }> = run.outline ? JSON.parse(run.outline) : [];
    const sectionsWithSources = sections.map((sec, idx) => {
      const nodes = provNodes.filter((n) => n.paragraph_idx === idx);
      return {
        title: sec.title,
        content: sec.content,
        sources: nodes.map((n) => ({
          chunkId: n.chunk_id ?? "",
          content: n.chunk_content ?? "",
          score: n.score ?? 0,
          sourceName: n.source_name ?? undefined,
        })),
      };
    });

    // 串行计算相关度、完整度和冲突检测
    // 注意：不使用 Promise.all 并行调用。百炼等网关对同一 API Key 有严格并发限制，
    // 3 个长推理请求并发会导致全部排队挂起，最终 180s 超时。串行更可靠。
    logger.info(`[Generation] 开始评估: runId=${req.params.id}, provider=${effectiveProvider}, model=${effectiveModel}, sections=${sections.length}`);

    const relevanceResult = await tryWithFallback(
      (model) => checkDocumentRelevance(sections, requirement, apiKey, effectiveProvider, model),
      "内容相关度评估"
    );
    const completenessResult = await tryWithFallback(
      (model) => checkDocumentCompleteness(sections, requirement, apiKey, effectiveProvider, model),
      "内容完整度评估"
    );
    const conflictResult = await tryWithFallback(
      (model) => detectConflicts(sectionsWithSources, apiKey, effectiveProvider, model),
      "冲突检测"
    );

    logger.info(`[Generation] 评估完成: relevance=${relevanceResult.score.toFixed(2)}, completeness=${completenessResult.score.toFixed(2)}, conflicts=${conflictResult.conflicts.length}`);

    // ── Bug 4 fix：与生成阶段的冲突解决结果交叉对比 ──
    // 加载持久化的 conflictResolution，标记已解决的冲突（resolved），过滤掉已不存在的 losing sources
    type ResolvedItem = { topic: string; winningSource: string; losingSources: string[]; reason: string; resolution: string };
    let priorResolution: { resolved: ResolvedItem[]; unresolved: ResolvedItem[]; excludedChunkIds: string[] } | null = null;
    if (run.conflict_resolution) {
      try {
        priorResolution = JSON.parse(run.conflict_resolution);
        logger.info(`[Generation] 已加载 conflict_resolution: resolved=${priorResolution?.resolved?.length ?? 0}, unresolved=${priorResolution?.unresolved?.length ?? 0}, excluded=${priorResolution?.excludedChunkIds?.length ?? 0}`);
      } catch (e) {
        logger.warn(`[Generation] conflict_resolution JSON 解析失败: ${e}`);
      }
    }

    // 收集当前 provenance 中实际存在的 source names（按 section+source 归一化）
    const provenanceSources = new Set<string>();
    const provenanceChunkIds = new Set<string>();
    for (const sec of sectionsWithSources) {
      for (const s of sec.sources) {
        if (s.sourceName) provenanceSources.add(`${sec.title} - ${s.sourceName}`);
        if (s.sourceName) provenanceSources.add(s.sourceName);
        if (s.chunkId) provenanceChunkIds.add(s.chunkId);
      }
    }

    // 模糊 source 匹配 helper（与 conflictDetection.ts 一致）
    const normalizeSourceName = (s: string): string =>
      s.toLowerCase().replace(/[\s_\-./\\|:：,，;；()（）\[\]【】《》]+/g, "").replace(/\.(pdf|docx|txt|md|eml|pptx|json|csv|xlsx)$/i, "");

    // 模糊 topic 匹配 helper（LLM 两次检测可能 paraphrase 同一主题）
    const normalizeTopic = (s: string): string =>
      s.toLowerCase().replace(/[\s_\-./\\|:：,，;；()（）\[\]【】《》]+/g, "");

    const topicsClose = (a: string, b: string): boolean => {
      const na = normalizeTopic(a);
      const nb = normalizeTopic(b);
      if (na === nb) return true;
      if (na.includes(nb) || nb.includes(na)) return true;
      // 字符级 Jaccard 相似度（2-gram）
      const grams = (s: string) => {
        const set = new Set<string>();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
      };
      const ga = grams(na);
      const gb = grams(nb);
      if (ga.size === 0 || gb.size === 0) return false;
      let inter = 0;
      for (const g of ga) if (gb.has(g)) inter++;
      const jaccard = inter / (ga.size + gb.size - inter);
      return jaccard >= 0.5;
    };

    // 检查某个 source name 是否仍在 provenance 中（任意 section 里）
    const isSourceInProvenance = (llmSource: string): boolean => {
      const norm = normalizeSourceName(llmSource);
      for (const ps of provenanceSources) {
        const nps = normalizeSourceName(ps);
        if (nps === norm || nps.includes(norm) || norm.includes(nps)) return true;
      }
      return false;
    };

    type EvalConflictItem = (typeof conflictResult.conflicts)[number] & { status?: "resolved" | "unresolved" | "new"; resolutionReason?: string };
    const filteredConflicts: EvalConflictItem[] = [];
    const stillActive: EvalConflictItem[] = [];

    for (const c of conflictResult.conflicts) {
      // 尝试匹配 generation 阶段的 resolved 项（按 topic 模糊匹配）
      const matchedResolved = priorResolution?.resolved.find((r) => topicsClose(r.topic, c.topic));
      if (matchedResolved) {
        // 检查 losing sources 是否已被排除（不再出现在 provenance 中）
        const losersStillPresent = matchedResolved.losingSources.filter((ls) => isSourceInProvenance(ls));
        if (losersStillPresent.length === 0) {
          // 全部 losing sources 已排除 → 标记为已解决，不返回给用户
          continue;
        }
        // 部分解决 → 标记为 resolved 但保留展示（让用户知道处理中）
        const item: EvalConflictItem = {
          ...c,
          status: "resolved",
          resolutionReason: `${matchedResolved.resolution} — ${matchedResolved.reason}`,
        };
        filteredConflicts.push(item);
        stillActive.push(item);
        continue;
      }
      // 未匹配到 resolved → 检查是否匹配 unresolved 项
      const matchedUnresolved = priorResolution?.unresolved.find((u) => topicsClose(u.topic, c.topic));
      if (matchedUnresolved) {
        const item: EvalConflictItem = { ...c, status: "unresolved", resolutionReason: "生成阶段未能自动解决" };
        filteredConflicts.push(item);
        stillActive.push(item);
        continue;
      }
      // 新发现的冲突
      const item: EvalConflictItem = { ...c, status: "new" };
      filteredConflicts.push(item);
      stillActive.push(item);
    }

    if (priorResolution) {
      logger.info(`[Generation] 冲突过滤: 原 ${conflictResult.conflicts.length} 个 → 展示 ${filteredConflicts.length} 个（resolved=${filteredConflicts.filter(c => c.status === "resolved").length}, unresolved=${filteredConflicts.filter(c => c.status === "unresolved").length}, new=${filteredConflicts.filter(c => c.status === "new").length}）`);
    }

    const finalConflicts = {
      conflicts: filteredConflicts,
      conflictRate: filteredConflicts.length > 0 ? conflictResult.conflictRate : 0,
      hasConflicts: filteredConflicts.length > 0,
    };

    // 获取已有的 groundedness 分数（从 provenance_nodes 中取平均）
    const groundingNodes = dbAll<{ grounding_score: number }>(`
      SELECT grounding_score FROM provenance_nodes WHERE run_id = ? AND grounding_score IS NOT NULL
    `, [req.params.id]);
    const groundingScores = groundingNodes.map((n) => n.grounding_score).filter((s) => s > 0);
    const groundednessScore = groundingScores.length > 0
      ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
      : 0.5;

    // 保存评估结果到数据库（包含完整详情）
    try {
      const evalId = crypto.randomUUID();
      dbRun(`
        INSERT INTO trust_evaluations (id, run_id, metrics, created_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
      `, [
        evalId,
        req.params.id,
        JSON.stringify({
          groundedness: groundednessScore,
          relevance: relevanceResult.score,
          completeness: completenessResult.score,
          conflictRate: finalConflicts.conflictRate,
          hasConflicts: finalConflicts.hasConflicts,
          // 保存详情供前端展示
          irrelevantSentences: relevanceResult.irrelevantSentences ?? [],
          coveredPoints: completenessResult.coveredPoints ?? [],
          missingPoints: completenessResult.missingPoints ?? [],
          conflictItems: finalConflicts.conflicts ?? [],
        }),
      ], { table: "trust_evaluations", recordId: evalId, source: "generation" });
      logger.info(`[Generation] 评估结果已保存: runId=${req.params.id}`);
    } catch (e) {
      // 评估表可能不存在，忽略错误
      logger.warn(`[Generation] 保存评估结果失败: ${e}`);
    }

    res.json({
      ok: true,
      metrics: {
        groundedness: {
          score: groundednessScore,
          label: "有据可查度",
          description: "内容是否有来源支撑",
        },
        relevance: {
          score: relevanceResult.score,
          label: "内容相关度",
          description: "内容是否与需求相关",
          irrelevantSentences: relevanceResult.irrelevantSentences,
        },
        completeness: {
          score: completenessResult.score,
          label: "内容完整度",
          description: "是否覆盖需求的所有要点",
          coveredPoints: completenessResult.coveredPoints,
          missingPoints: completenessResult.missingPoints,
        },
        conflicts: {
          hasConflicts: finalConflicts.hasConflicts,
          conflictRate: finalConflicts.conflictRate,
          items: finalConflicts.conflicts,
          label: "内容冲突",
          description: "不同来源之间的矛盾信息",
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 评估失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/generation/:id/evaluate/stream — 流式计算用户可见指标（SSE，phase-level progress） */
generationRouter.post("/:id/evaluate/stream", async (req, res) => {
  // ── SSE setup ──
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const writeSSE = (event: string, data: object) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { apiKey: reqApiKey, providerId, modelId, userRequest } = req.body;

    // 动态导入评估模块
    const { checkDocumentRelevance } = await import("../lib/relevanceCheck.js");
    const { checkDocumentCompleteness } = await import("../lib/completenessCheck.js");
    const { detectConflicts } = await import("../lib/conflictDetection.js");
    const { readSettingsFromDb } = await import("../lib/settingsReader.js");
    const { getApiKey } = await import("../security/keyStore.js");

    // 读取用户配置的 provider 和 model
    const dbSettings = readSettingsFromDb();
    const effectiveProvider = providerId ?? dbSettings.providerPreference?.[0] ?? "mimo";
    const effectiveModel = modelId ?? dbSettings.modelId ?? "mimo-v2-pro";

    const fallbackEnabled = dbSettings.enableModelFallback?.[effectiveProvider] === true;
    const fallbackModels = fallbackEnabled ? (dbSettings.modelFallbacks?.[effectiveProvider] ?? []) : [];
    const modelCandidates = [effectiveModel, ...fallbackModels.filter((m) => m !== effectiveModel)];

    async function tryWithFallback<T>(fn: (model: string) => Promise<T>, taskName: string): Promise<T> {
      let lastErr: unknown = null;
      for (let i = 0; i < modelCandidates.length; i++) {
        const candidate = modelCandidates[i];
        try {
          if (i > 0) logger.info(`[Generation] ${taskName} 尝试备用模型 ${i + 1}/${modelCandidates.length}: ${candidate}`);
          return await fn(candidate);
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[Generation] ${taskName} 模型 ${candidate} 失败: ${msg}`);
          if (!fallbackEnabled) break;
        }
      }
      throw lastErr ?? new Error(`${taskName} 所有模型均失败`);
    }

    const apiKey = reqApiKey ?? getApiKey(effectiveProvider);
    if (!apiKey) {
      writeSSE("error", { ok: false, error: "apiKey is required（请在设置页配置或在请求中提供）" });
      res.end();
      return;
    }

    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
    if (!run) {
      writeSSE("error", { ok: false, error: "Run not found" });
      res.end();
      return;
    }

    const sections = run.content ? parseHtmlSections(run.content, run.title) : [];
    if (sections.length === 0) {
      writeSSE("error", { ok: false, error: "No sections found in document" });
      res.end();
      return;
    }

    let requirement = userRequest;
    if (!requirement) {
      const runTime = new Date(run.created_at).getTime() / 1000;
      const caseRows = dbAll<{ data: string }>(`
        SELECT data FROM sync_data
        WHERE store_name = 'cases'
          AND data IS NOT NULL
          AND json_extract(data, '$.userRequest') IS NOT NULL
          AND json_extract(data, '$.userRequest') != ''
        LIMIT 100
      `);
      let bestMatch: { userRequest: string; diff: number } | null = null;
      for (const row of caseRows) {
        try {
          const caseData = JSON.parse(row.data);
          if (!caseData.userRequest || !caseData.createdAt) continue;
          const caseTime = new Date(caseData.createdAt).getTime() / 1000;
          const diff = Math.abs(caseTime - runTime);
          if (diff < 86400 && (!bestMatch || diff < bestMatch.diff)) {
            bestMatch = { userRequest: caseData.userRequest, diff };
          }
        } catch { /* skip parse errors */ }
      }
      requirement = bestMatch?.userRequest ?? run.title;
    }

    // 从 provenance 重建章节来源详情（用于冲突检测）
    const provNodes = dbAll<any>(`
      SELECT p.paragraph_idx, p.paragraph_title, p.chunk_id, p.score,
             c.content AS chunk_content, s.name AS source_name
      FROM provenance_nodes p
      LEFT JOIN kb_chunks c ON c.id = p.chunk_id
      LEFT JOIN kb_sources s ON s.id = c.source_id
      WHERE p.run_id = ? AND p.chunk_id IS NOT NULL
      ORDER BY p.paragraph_idx, p.score DESC
    `, [req.params.id]);

    const sectionsWithSources = sections.map((sec, idx) => {
      const secNodes = provNodes.filter((n) => n.paragraph_idx === idx);
      const sourceMap = new Map<string, { content: string; score: number; sourceName: string; chunkId: string }>();
      for (const n of secNodes) {
        const key = n.chunk_id ?? (n.source_name && n.chunk_content ? `${n.source_name}:${n.chunk_content.slice(0, 40)}` : null);
        if (key && !sourceMap.has(key)) {
          sourceMap.set(key, {
            content: n.chunk_content ?? "",
            score: n.score ?? 0,
            sourceName: n.source_name ?? "Unknown",
            chunkId: n.chunk_id ?? "",
          });
        }
      }
      return { ...sec, sources: Array.from(sourceMap.values()) };
    });

    logger.info(`[Generation] 开始流式评估: runId=${req.params.id}, provider=${effectiveProvider}, model=${effectiveModel}, sections=${sections.length}`);

    // ── Emit start ──
    writeSSE("evaluate-start", {
      ok: true,
      runId: req.params.id,
      totalTasks: 3,
      tasks: [
        { id: "relevance", label: "内容相关度" },
        { id: "completeness", label: "内容完整度" },
        { id: "conflicts", label: "内容冲突检测" },
      ],
    });

    // ── Task 1: Relevance ──
    writeSSE("evaluate-progress", { task: "relevance", taskIndex: 0, taskLabel: "内容相关度", status: "running" });
    const relevanceResult = await tryWithFallback(
      (model) => checkDocumentRelevance(sections, requirement, apiKey, effectiveProvider, model),
      "内容相关度评估"
    );
    writeSSE("evaluate-progress", {
      task: "relevance", taskIndex: 0, taskLabel: "内容相关度", status: "done",
      score: relevanceResult.score,
      irrelevantSentences: relevanceResult.irrelevantSentences,
    });

    // ── Task 2: Completeness ──
    writeSSE("evaluate-progress", { task: "completeness", taskIndex: 1, taskLabel: "内容完整度", status: "running" });
    const completenessResult = await tryWithFallback(
      (model) => checkDocumentCompleteness(sections, requirement, apiKey, effectiveProvider, model),
      "内容完整度评估"
    );
    writeSSE("evaluate-progress", {
      task: "completeness", taskIndex: 1, taskLabel: "内容完整度", status: "done",
      score: completenessResult.score,
      coveredPoints: completenessResult.coveredPoints,
      missingPoints: completenessResult.missingPoints,
    });

    // ── Task 3: Conflicts ──
    writeSSE("evaluate-progress", { task: "conflicts", taskIndex: 2, taskLabel: "内容冲突检测", status: "running" });
    const conflictResult = await tryWithFallback(
      (model) => detectConflicts(sectionsWithSources, apiKey, effectiveProvider, model),
      "冲突检测"
    );

    // 冲突与 generation 阶段交叉对比（复用现有逻辑）
    type ResolvedItem = { topic: string; winningSource: string; losingSources: string[]; reason: string; resolution: string };
    let priorResolution: { resolved: ResolvedItem[]; unresolved: ResolvedItem[]; excludedChunkIds: string[] } | null = null;
    if (run.conflict_resolution) {
      try {
        priorResolution = JSON.parse(run.conflict_resolution);
      } catch (e) {
        logger.warn(`[Generation] conflict_resolution JSON 解析失败: ${e}`);
      }
    }

    const provenanceSources = new Set<string>();
    for (const sec of sectionsWithSources) {
      for (const s of sec.sources) {
        if (s.sourceName) provenanceSources.add(s.sourceName);
      }
    }

    const normalizeSourceName = (s: string): string =>
      s.toLowerCase().replace(/[\s_\-./\\|:：,，;；()（）\[\]【】《》]+/g, "").replace(/\.(pdf|docx|txt|md|eml|pptx|json|csv|xlsx)$/i, "");
    const normalizeTopic = (s: string): string =>
      s.toLowerCase().replace(/[\s_\-./\\|:：,，;；()（）\[\]【】《》]+/g, "");
    const topicsClose = (a: string, b: string): boolean => {
      const na = normalizeTopic(a), nb = normalizeTopic(b);
      if (na === nb || na.includes(nb) || nb.includes(na)) return true;
      const grams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
      const ga = grams(na), gb = grams(nb);
      if (ga.size === 0 || gb.size === 0) return false;
      let inter = 0; for (const g of ga) if (gb.has(g)) inter++;
      return inter / (ga.size + gb.size - inter) >= 0.5;
    };
    const isSourceInProvenance = (llmSource: string): boolean => {
      const norm = normalizeSourceName(llmSource);
      for (const ps of provenanceSources) {
        const nps = normalizeSourceName(ps);
        if (nps === norm || nps.includes(norm) || norm.includes(nps)) return true;
      }
      return false;
    };

    type EvalConflictItem = (typeof conflictResult.conflicts)[number] & { status?: "resolved" | "unresolved" | "new"; resolutionReason?: string };
    const filteredConflicts: EvalConflictItem[] = [];

    for (const c of conflictResult.conflicts) {
      const matchedResolved = priorResolution?.resolved.find((r) => topicsClose(r.topic, c.topic));
      if (matchedResolved) {
        const losersStillPresent = matchedResolved.losingSources.filter((ls) => isSourceInProvenance(ls));
        if (losersStillPresent.length === 0) continue;
        filteredConflicts.push({ ...c, status: "resolved", resolutionReason: `${matchedResolved.resolution} — ${matchedResolved.reason}` });
        continue;
      }
      const matchedUnresolved = priorResolution?.unresolved.find((u) => topicsClose(u.topic, c.topic));
      if (matchedUnresolved) {
        filteredConflicts.push({ ...c, status: "unresolved", resolutionReason: "生成阶段未能自动解决" });
        continue;
      }
      filteredConflicts.push({ ...c, status: "new" });
    }

    const finalConflicts = {
      conflicts: filteredConflicts,
      conflictRate: filteredConflicts.length > 0 ? conflictResult.conflictRate : 0,
      hasConflicts: filteredConflicts.length > 0,
    };

    writeSSE("evaluate-progress", {
      task: "conflicts", taskIndex: 2, taskLabel: "内容冲突检测", status: "done",
      hasConflicts: finalConflicts.hasConflicts,
      conflictRate: finalConflicts.conflictRate,
      conflictItems: finalConflicts.conflicts,
    });

    // 获取 groundedness 分数
    const groundingNodes = dbAll<{ grounding_score: number }>(`
      SELECT grounding_score FROM provenance_nodes WHERE run_id = ? AND grounding_score IS NOT NULL
    `, [req.params.id]);
    const groundingScores = groundingNodes.map((n) => n.grounding_score).filter((s) => s > 0);
    const groundednessScore = groundingScores.length > 0
      ? groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length
      : 0.5;

    // 计算 faithfulness：基于 provenance 数据，有源可查的章节比例
    const sectionsWithAnySource = sectionsWithSources.filter((s) => s.sources.length > 0).length;
    const faithfulnessScore = sections.length > 0
      ? Math.min(1, (sectionsWithAnySource / sections.length) * (groundednessScore > 0 ? 1 : 0.5))
      : 0.5;

    // 保存评估结果
    try {
      const evalId = crypto.randomUUID();
      dbRun(`
        INSERT INTO trust_evaluations (id, run_id, metrics, created_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
      `, [
        evalId,
        req.params.id,
        JSON.stringify({
          faithfulness: faithfulnessScore,
          groundedness: groundednessScore,
          relevance: relevanceResult.score,
          completeness: completenessResult.score,
          conflictRate: finalConflicts.conflictRate,
          hasConflicts: finalConflicts.hasConflicts,
          irrelevantSentences: relevanceResult.irrelevantSentences ?? [],
          coveredPoints: completenessResult.coveredPoints ?? [],
          missingPoints: completenessResult.missingPoints ?? [],
          conflictItems: finalConflicts.conflicts ?? [],
        }),
      ], { table: "trust_evaluations", recordId: evalId, source: "generation" });
    } catch (e) {
      logger.warn(`[Generation] 保存评估结果失败: ${e}`);
    }

    logger.info(`[Generation] 流式评估完成: runId=${req.params.id}, faithfulness=${faithfulnessScore.toFixed(3)}, groundedness=${groundednessScore.toFixed(3)}, relevance=${relevanceResult.score.toFixed(3)}, completeness=${completenessResult.score.toFixed(3)}, conflicts=${finalConflicts.conflicts.length}`);

    writeSSE("evaluate-done", {
      ok: true,
      runId: req.params.id,
      metrics: {
        faithfulness: { score: faithfulnessScore, label: "事实忠实度", description: "文档内容是否忠实于参考来源" },
        groundedness: { score: groundednessScore, label: "有据可查度", description: "内容是否有来源支撑" },
        relevance: { score: relevanceResult.score, label: "内容相关度", description: "内容是否与需求相关", irrelevantSentences: relevanceResult.irrelevantSentences },
        completeness: { score: completenessResult.score, label: "内容完整度", description: "是否覆盖需求的所有要点", coveredPoints: completenessResult.coveredPoints, missingPoints: completenessResult.missingPoints },
        conflicts: { hasConflicts: finalConflicts.hasConflicts, conflictRate: finalConflicts.conflictRate, items: finalConflicts.conflicts, label: "内容冲突", description: "不同来源之间的矛盾信息" },
      },
    });

    res.end();
    logger.info(`[Generation] 流式评估 SSE 响应已关闭: runId=${req.params.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 流式评估失败: ${msg}`);
    if (!res.writableEnded) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ ok: false, error: msg })}\n\n`);
      res.end();
    }
  }
});

/** GET /api/generation/:id/evaluation — 获取已缓存的评估结果 */
generationRouter.get("/:id/evaluation", (req, res) => {
  try {
    // 获取最新的评估结果
    const evaluation = dbGet<{ metrics: string; created_at: string }>(`
      SELECT metrics, created_at FROM trust_evaluations
      WHERE run_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.params.id]);

    if (!evaluation) {
      res.json({ ok: true, evaluation: null });
      return;
    }

    const rawMetrics = JSON.parse(evaluation.metrics);

    // 转换为前端期望的格式（兼容旧格式和新格式）
    const metrics = {
      faithfulness: {
        score: rawMetrics.faithfulness ?? 0.5,
        label: "事实忠实度",
        description: "文档内容是否忠实于参考来源",
      },
      groundedness: {
        score: rawMetrics.groundedness ?? 0.5,
        label: "有据可查度",
        description: "内容是否有来源支撑",
      },
      relevance: {
        score: typeof rawMetrics.relevance === 'object' ? rawMetrics.relevance.score : (rawMetrics.relevance ?? 1),
        label: "内容相关度",
        description: "内容是否与需求相关",
        irrelevantSentences: rawMetrics.irrelevantSentences ?? rawMetrics.relevance?.irrelevantSentences ?? [],
      },
      completeness: {
        score: typeof rawMetrics.completeness === 'object' ? rawMetrics.completeness.score : (rawMetrics.completeness ?? 1),
        label: "内容完整度",
        description: "是否覆盖需求的所有要点",
        coveredPoints: rawMetrics.coveredPoints ?? rawMetrics.completeness?.coveredPoints ?? [],
        missingPoints: rawMetrics.missingPoints ?? rawMetrics.completeness?.missingPoints ?? [],
      },
      conflicts: {
        hasConflicts: rawMetrics.hasConflicts ?? rawMetrics.conflicts?.hasConflicts ?? false,
        conflictRate: rawMetrics.conflictRate ?? rawMetrics.conflicts?.conflictRate ?? 0,
        items: rawMetrics.conflictItems ?? rawMetrics.conflicts?.items ?? [],
        label: "内容冲突",
        description: "不同来源之间的矛盾信息",
      },
    };

    res.json({
      ok: true,
      evaluation: {
        metrics,
        evaluatedAt: evaluation.created_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] 获取评估结果失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});