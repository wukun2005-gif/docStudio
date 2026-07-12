/**
 * 文档生成 API 路由
 * Feature #8: 一键生成
 * Feature #13-15: Word/PPT/Excel 生成
 */
import { Router } from "express";
import crypto from "crypto";
import { generateDocument, toHtml, sanitizeCitationHtml, getQueryAnalysis, type GenerateDocResult } from "../lib/docGenerator.js";
import { exportDocument, type ExportFormat, type ExportSection, type ChartSpec } from "../lib/docExporter.js";
import { extractChartSpecs } from "../lib/chartSpecParser.js";
import { toExcelPayload } from "../lib/excelPayloadBuilder.js";
import { toWordPayload } from "../lib/wordPayloadBuilder.js";
import { toPptPayload } from "../lib/pptPayloadBuilder.js";
import { toEmailPayload } from "../lib/emailPayloadBuilder.js";
import { buildProvenanceTree, getProvenanceByRunId } from "../lib/provenanceTree.js";
import { dbRun, dbGet, dbAll, dbTransaction } from "../lib/dbQuery.js";
import { logger } from "../lib/logger.js";
import type { OutlineSection } from "../lib/narrativeEngine.js";
import type { QueryAnalysis } from "../lib/queryAnalyzer.js";
import { CASE_1783257530743 } from "../providers/fixtures/case-1783257530743.js";
import { CASE_1782966166476 } from "../providers/fixtures/case-1782966166476.js";
import { readCaseFromDb, readWordCaseFromDb, readOutlookCaseFromDb, type CitationItem, type ProvenanceNodeRow } from "../lib/stubDataReader.js";
import type { CitationLink } from "../lib/contentCleaner.js";

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
      const STALE_THRESHOLD_SECONDS = 3 * 60;
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

    // ── Demo replay mode: 完全 replay case-1783257530743 的数据，不调用任何外部 API ──
    if (providerPreference?.length === 1 && providerPreference[0] === "demo") {
      const fixture = CASE_1783257530743;
      logger.info(`[Generation] Demo replay (non-stream): replaying from case ${fixture.caseId}`);

      dbRun(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [fixture.title, fixture.htmlContent, fixture.trustScore, fixture.documentStyle, runId],
        { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: fixture.trustScore, documentStyle: fixture.documentStyle } });

      try {
        const paragraphs = fixture.sections.map((s, sIdx) => ({
          idx: sIdx, title: s.title, groundingScore: s.groundingScore,
          sources: s.sources.map(src => ({ chunkId: src.chunkId, score: src.score })),
        }));
        if (paragraphs.length > 0) buildProvenanceTree(runId, paragraphs);
      } catch (treeErr) { logger.warn(`[Generation] Demo provenance tree failed: ${treeErr}`); }

      res.json({
        ok: true, runId, title: fixture.title, content: fixture.htmlContent,
        sections: fixture.sections, trustScore: fixture.trustScore, documentStyle: fixture.documentStyle,
        ...(fixture.conflictResolution ? { conflictResolution: fixture.conflictResolution } : {}),
      });
      return;
    }

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
        sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score, sourceId: src.sourceId, sourceName: src.sourceName, sourceUrl: src.sourceUrl })),
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
      const STALE_THRESHOLD_SECONDS = 3 * 60;
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

    // ── 客户端断开时清理 generation run ──
    let clientDisconnected = false;
    req.on("close", () => {
      if (!clientDisconnected) {
        clientDisconnected = true;
        logger.info(`[Generation] 客户端连接关闭: runId=${runId}`);
        const run = dbGet<{ status: string }>("SELECT status FROM generation_runs WHERE id = ?", [runId]);
        if (run && run.status === "generating") {
          dbRun(`UPDATE generation_runs SET status = 'aborted' WHERE id = ?`, [runId],
            { table: "generation_runs", recordId: runId, source: "generation" });
          logger.info(`[Generation] generation run 标记为 aborted: runId=${runId}`);
        }
      }
    });

    // SSE 推送助手：每次 write 后强制 flush（避免 Node.js/代理 buffering）
    const writeSSE = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 先推送 runId，让客户端知道请求已被接受
    writeSSE("start", { ok: true, runId });
    // 通知客户端即将开始知识库检索和冲突检测
    writeSSE("progress", { phase: "retrieving", message: "正在检索知识库并检测冲突..." });
    logger.info(`[Generation] 流式生成开始: ${title}, runId=${runId}, 章节数=${outline.length}`);

    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // ── Demo replay mode: 完全 replay case-1783257530743 的数据，不调用任何外部 API ──
    const isDemoReplay = providerPreference?.length === 1 && providerPreference[0] === "demo";
    if (isDemoReplay) {
      const fixture = CASE_1783257530743;
      logger.info(`[Generation] Demo replay: replaying ${fixture.sections.length} sections from case ${fixture.caseId}`);

      // Simulate streaming: send section-start + section events with realistic delays
      for (let i = 0; i < fixture.sections.length; i++) {
        const sec = fixture.sections[i];
        writeSSE("section-start", { index: i, total: fixture.sections.length, title: sec.title });
        logger.info(`[Generation] Demo SSE: section-start [${i + 1}/${fixture.sections.length}] ${sec.title}`);
        await new Promise(resolve => setTimeout(resolve, 600));

        writeSSE("section", {
          index: i,
          section: {
            title: sec.title,
            content: sec.content,
            groundingScore: sec.groundingScore,
            sources: sec.sources,
            webCitations: undefined,
          },
        });
        logger.info(`[Generation] Demo SSE: section [${i + 1}/${fixture.sections.length}] ${sec.title} (content=${sec.content?.length || 0} chars)`);
      }

      // Update DB with saved content
      const docTitle = fixture.title;
      dbRun(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [docTitle, fixture.htmlContent, fixture.trustScore, fixture.documentStyle, runId],
        { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: fixture.trustScore, documentStyle: fixture.documentStyle } });

      // Build provenance tree from saved data
      try {
        const paragraphs = fixture.sections.map((s, sIdx) => ({
          idx: sIdx,
          title: s.title,
          groundingScore: s.groundingScore,
          sources: s.sources.map(src => ({ chunkId: src.chunkId, score: src.score })),
        }));
        if (paragraphs.length > 0) {
          buildProvenanceTree(runId, paragraphs);
        }
      } catch (treeErr) {
        logger.warn(`[Generation] Demo provenance tree build failed: ${treeErr}`);
      }

      logger.info(`[Generation] Demo replay 完成: ${docTitle}`);

      // Send done event
      const donePayload = {
        type: 'done',
        ok: true,
        runId,
        title: docTitle,
        content: "",
        sections: fixture.sections.map(s => ({ title: s.title, content: s.content, groundingScore: s.groundingScore })),
        trustScore: fixture.trustScore,
        documentStyle: fixture.documentStyle,
        ...(fixture.conflictResolution ? { conflictResolution: fixture.conflictResolution } : {}),
      };
      const doneJson = JSON.stringify(donePayload);
      logger.info(`[Generation] Demo done event JSON: jsonLen=${doneJson.length}`);
      res.write(`event: done\ndata: ${doneJson}\n\n`);
      setTimeout(() => {
        res.end();
        logger.info(`[Generation] Demo done event sent & stream ended`);
      }, 500);
      return;
    }

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
        writeSSE("section-start", { type: 'section-start', index: sectionIndex, total: totalSections, title: section.title, chapter: section.title });
        logger.info(`[Generation] SSE 推送: section-start [${sectionIndex + 1}/${totalSections}] ${section.title}`);
      } else {
        // 章节完成 — 推送章节内容（类型断言：done 阶段 section 是完整对象）
        const doneSection = section as GenerateDocResult["sections"][number];
        writeSSE("section", {
          type: 'section',
          index: sectionIndex,
          chapter: doneSection.title,
          section: {
            title: doneSection.title,
            content: doneSection.content,
            groundingScore: doneSection.groundingScore,
            sources: doneSection.sources.map((s) => ({ chunkId: s.chunkId, score: s.score, sourceId: s.sourceId, sourceName: s.sourceName, sourceUrl: s.sourceUrl })),
            webCitations: doneSection.webCitations,
            pythonScript: (doneSection as any).pythonScript,
            chartSpecsRaw: (doneSection as any).chartSpecsRaw,
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
        sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score, sourceId: src.sourceId, sourceName: src.sourceName, sourceUrl: src.sourceUrl })),
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
    // 注意：content 字段只传 runId，由客户端从 DB 拉取完整 HTML，
    // 避免巨大的 HTML 字符串嵌入 JSON 导致 SSE 解析失败（裸换行符问题）
    const donePayload = {
      type: 'done',
      ok: true,
      runId,
      title: docTitle,
      content: "",  // 客户端通过 runId 从 DB 获取完整内容
      sections: result.sections.map((s) => ({ title: s.title, content: s.content, groundingScore: s.groundingScore })),
      trustScore: result.trustScore,
      documentStyle: result.documentStyle,
      ...(result.conflictResolution ? { conflictResolution: result.conflictResolution } : {}),
    };
    const doneJson = JSON.stringify(donePayload);
    logger.info(`[Generation] done event JSON: jsonLen=${doneJson.length} contentLen=${htmlContent.length} sections=${result.sections.length} conflictRes=${!!result.conflictResolution}`);

    res.write(`event: done\ndata: ${doneJson}\n\n`);
    setTimeout(() => {
      res.end();
      logger.info(`[Generation] done event sent & stream ended, total=${13 + doneJson.length + 2} bytes`);
    }, 500);
    return;

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

/** POST /api/generation/generate/excel-stream — 流式生成 Excel 文档（SSE，章节级推送，done 事件返回 ExcelWritePayload） */
generationRouter.post("/generate/excel-stream", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // ── 并发去重（与 stream 版本相同） ──
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating'",
      [title],
    );

    if (existing) {
      const STALE_THRESHOLD_SECONDS = 3 * 60;
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
    const effectiveFormat = format ?? "excel";
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), effectiveFormat, "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: effectiveFormat, status: "generating" } });

    // ── 设置 SSE headers ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // ── 客户端断开时清理 generation run（React StrictMode 双重挂载会触发） ──
    let clientDisconnected = false;
    req.on("close", () => {
      if (!clientDisconnected) {
        clientDisconnected = true;
        logger.info(`[Generation] Excel 客户端连接关闭: runId=${runId}`);
        // 如果 generation 还在进行中，标记为 aborted，避免阻塞后续请求
        const run = dbGet<{ status: string }>("SELECT status FROM generation_runs WHERE id = ?", [runId]);
        if (run && run.status === "generating") {
          dbRun(`UPDATE generation_runs SET status = 'aborted' WHERE id = ?`, [runId],
            { table: "generation_runs", recordId: runId, source: "generation" });
          logger.info(`[Generation] Excel generation run 标记为 aborted: runId=${runId}`);
        }
      }
    });

    // SSE 推送助手
    const writeSSE = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeSSE("start", { ok: true, runId });
    writeSSE("progress", { phase: "retrieving", message: "正在检索知识库并检测冲突..." });
    logger.info(`[Generation] Excel 流式生成开始: ${title}, runId=${runId}, 章节数=${outline.length}`);

    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // ── Stub mode（不调任何外部 API，用 DB 真实数据验证数据通路）──
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    if (isStubMode) {
      const dbCase = readCaseFromDb();
      if (!dbCase) {
        // Fallback: 无 DB 数据时返回错误
        writeSSE("error", { type: "error", message: "Stub mode: DB 中未找到真实 case 数据" });
        setTimeout(() => res.end(), 200);
        return;
      }

      logger.info(`[Generation] Excel Stub mode (DB): ${dbCase.sections.length} sections, title=${dbCase.title}, charts=${dbCase.sections.reduce((n, s) => n + (s.chartSpecsRaw?.length || 0), 0)}`);

      for (let i = 0; i < dbCase.sections.length; i++) {
        const sec = dbCase.sections[i];
        writeSSE("section-start", { type: 'section-start', index: i, total: dbCase.sections.length, title: sec.title, chapter: sec.title });
        logger.info(`[Generation] Excel Stub SSE: section-start [${i + 1}/${dbCase.sections.length}] ${sec.title}`);
        await new Promise(resolve => setTimeout(resolve, 300));

        writeSSE("section", {
          type: 'section',
          index: i,
          chapter: sec.title,
          section: {
            title: sec.title,
            content: sec.content,
            groundingScore: sec.groundingScore,
            sources: sec.sources,
            webCitations: undefined,
          },
        });
        logger.info(`[Generation] Excel Stub SSE: section [${i + 1}/${dbCase.sections.length}] ${sec.title} (content=${sec.content?.length || 0} chars, charts=${sec.chartSpecsRaw?.length || 0})`);
      }

      // 生成 HTML 和 Excel payload
      // 直接使用原始 case 的 content（包含 citations footer），而不是 toHtml 重新生成
      // 这样 provenanceTree 的 enrichProvenanceNodes 能从 footer 解析出真实来源标题和 URL
      const htmlContent = dbCase.content;
      const excelPayload = toExcelPayload(dbCase, {
        citations: dbCase.citations,
        provenanceNodes: dbCase.provenanceNodes,
      });

      const docTitle = dbCase.title;
      dbRun(`UPDATE generation_runs SET title = ?, content = ?, excel_payload = ?, status = 'done', trust_score = ?, document_style = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [docTitle, htmlContent, JSON.stringify(excelPayload), dbCase.trustScore, dbCase.documentStyle, runId],
        { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: dbCase.trustScore, documentStyle: dbCase.documentStyle } });

      // 复制原始 run 的 provenance_nodes 到新 runId（供 add-in ResultsPanel 来源树使用）
      if (dbCase.sourceRunId) {
        try {
          dbRun(
            `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
             SELECT ?, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, datetime('now','localtime')
             FROM provenance_nodes WHERE run_id = ?`,
            [runId, dbCase.sourceRunId],
            { table: "provenance_nodes", recordId: runId, source: "generation-stub" },
          );
          logger.info(`[Generation] Excel stream 复制 provenance_nodes: ${dbCase.sourceRunId} → ${runId}`);
        } catch (provErr) {
          logger.warn(`[Generation] Excel stream 复制 provenance_nodes 失败: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
        }

        // 复制原始 run 的 trust_evaluations 到新 runId（供 add-in ResultsPanel 评估结果显示）
        try {
          const sourceEval = dbGet<{ metrics: string }>(
            "SELECT metrics FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
            [dbCase.sourceRunId],
          );
          if (sourceEval?.metrics) {
            const evalId = crypto.randomUUID();
            dbRun(
              `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
              [evalId, runId, sourceEval.metrics],
              { table: "trust_evaluations", recordId: evalId, source: "generation-stub" },
            );
            logger.info(`[Generation] Excel stream 复制 trust_evaluations: ${dbCase.sourceRunId} → ${runId}`);
          }
        } catch (evalErr) {
          logger.warn(`[Generation] Excel stream 复制 trust_evaluations 失败: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`);
        }
      }

      const donePayload = {
        type: 'done',
        ok: true,
        runId,
        title: docTitle,
        excelPayload,
        sections: dbCase.sections.map(s => ({ title: s.title, content: s.content, groundingScore: s.groundingScore })),
        trustScore: dbCase.trustScore,
        documentStyle: dbCase.documentStyle,
      };
      const doneJson = JSON.stringify(donePayload);
      logger.info(`[Generation] Excel Stub done event JSON: jsonLen=${doneJson.length}, sheets=${excelPayload.sheets.length}, charts=${excelPayload.sheets.reduce((n: number, s: { charts?: unknown[] }) => n + (s.charts?.length || 0), 0)}`);
      // 写入 done event 并延迟关闭
      res.write(`event: done\ndata: ${doneJson}\n\n`);
      setTimeout(() => {
        res.end();
        logger.info(`[Generation] Excel Stub done event sent & stream ended`);
      }, 500);
      return;
    }

    // ── 流式生成：每个章节生成后立即推送 SSE ──
    const totalSections = outline.length;
    let sectionIndex = 0;
    const result = await generateDocument({
      title,
      outline: outline as OutlineSection[],
      format: effectiveFormat,
      providerPreference,
      modelId,
      apiKey,
      providerBaseUrls,
      userRequest,
    }, (section, phase) => {
      if (phase === "start") {
        writeSSE("section-start", { type: 'section-start', index: sectionIndex, total: totalSections, title: section.title, chapter: section.title });
        logger.info(`[Generation] Excel SSE 推送: section-start [${sectionIndex + 1}/${totalSections}] ${section.title}`);
      } else {
        const doneSection = section as GenerateDocResult["sections"][number];
        writeSSE("section", {
          type: 'section',
          index: sectionIndex,
          chapter: doneSection.title,
          section: {
            title: doneSection.title,
            content: doneSection.content,
            groundingScore: doneSection.groundingScore,
            sources: doneSection.sources.map((s) => ({ chunkId: s.chunkId, score: s.score, sourceId: s.sourceId, sourceName: s.sourceName, sourceUrl: s.sourceUrl })),
            webCitations: doneSection.webCitations,
            pythonScript: (doneSection as any).pythonScript,
            chartSpecsRaw: (doneSection as any).chartSpecsRaw,
          },
        });
        logger.info(`[Generation] Excel SSE 推送: section [${sectionIndex + 1}/${totalSections}] ${doneSection.title} (content=${doneSection.content?.length || 0} chars)`);
        sectionIndex++;
      }
    });

    // ── 生成完成：更新 DB 记录，构建 provenance tree ──
    const htmlContent = toHtml(result, baseUrl);
    const docTitle = result.title;
    const excelPayload = toExcelPayload(result);

    dbRun(`UPDATE generation_runs SET title = ?, content = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [docTitle, htmlContent, result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, runId],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done", trustScore: result.trustScore, documentStyle: result.documentStyle } });

    try {
      const paragraphs = result.sections.map((s, sIdx) => ({
        idx: sIdx,
        title: s.title,
        groundingScore: s.groundingScore,
        sources: s.sources.map((src) => ({ chunkId: src.chunkId, score: src.score, sourceId: src.sourceId, sourceName: src.sourceName, sourceUrl: src.sourceUrl })),
        webCitations: s.webCitations?.length ? s.webCitations : undefined,
      }));
      if (paragraphs.length > 0) {
        buildProvenanceTree(runId, paragraphs);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] Excel 生成树构建失败（不影响生成）: ${treeErr}`);
    }

    logger.info(`[Generation] Excel 流式文档生成完成: ${docTitle}`);

    // ── 推送最终结果（done event），使用 excelPayload 替代 content ──
    const donePayload = {
      type: 'done',
      ok: true,
      runId,
      title: docTitle,
      excelPayload,
      sections: result.sections.map((s) => ({ title: s.title, content: s.content, groundingScore: s.groundingScore })),
      trustScore: result.trustScore,
      documentStyle: result.documentStyle,
      ...(result.conflictResolution ? { conflictResolution: result.conflictResolution } : {}),
    };
    const doneJson = JSON.stringify(donePayload);
    logger.info(`[Generation] Excel done event JSON: jsonLen=${doneJson.length} sections=${result.sections.length} sheets=${excelPayload.sheets.length}`);

    // 写入 done event（不关闭连接，让客户端 reader 自然消费）
    res.write(`event: done\ndata: ${doneJson}\n\n`);
    // 延迟后关闭连接，确保客户端有足够时间读取 done event
    setTimeout(() => {
      res.end();
      logger.info(`[Generation] Excel done event sent & stream ended`);
    }, 500);
    return;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] Excel 流式生成失败: ${msg}`);
    try {
      dbRun(`UPDATE generation_runs SET status = 'crashed', updated_at = datetime('now','localtime') WHERE id = ?`,
        [runId], { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "crashed" } });
    } catch {}
    if (!res.writableEnded) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ ok: false, error: msg })}\n\n`);
      res.end();
    }
  }
});

// ════════════════════════════════════════════════════════════════
// Excel Add-in 专用：POST 触发 + GET 轮询（无 SSE）
// ════════════════════════════════════════════════════════════════

/** POST /api/generation/excel — 触发 Excel 生成，立即返回 runId */
generationRouter.post("/excel", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // 并发去重
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating'",
      [title],
    );
    if (existing) {
      const STALE_THRESHOLD_SECONDS = 10 * 60; // 10 分钟（LLM 可能需要较长时间）
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else if (isStubMode) {
        // Stub mode 下不返回 409，直接返回已有记录的 runId（避免 StrictMode 双重挂载导致 409）
        logger.info(`[Generation] Excel POST stub mode: 检测到同名 generating 记录 ${existing.id}，直接返回`);
        res.json({ ok: true, runId: existing.id });
        return;
      } else {
        res.status(409).json({ ok: false, error: "同名文档正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    runId = crypto.randomUUID();
    const effectiveFormat = format ?? "excel";
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), effectiveFormat, "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: effectiveFormat, status: "generating" } });

    logger.info(`[Generation] Excel POST 触发生成: ${title}, runId=${runId}, 章节数=${outline.length}`);

    // 立即返回 runId
    res.json({ ok: true, runId });

    // 后台异步执行生成（不阻塞响应）
    setImmediate(async () => {
      try {
        const protocol = req.protocol || "http";
        const host = req.get("host") || "localhost:3000";
        const baseUrl = `${protocol}://${host}`;

        const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
        let result: GenerateDocResult;

        if (isStubMode) {
          const dbCase = readCaseFromDb();
          if (dbCase) {
            logger.info(`[Generation] Excel POST stub mode (DB): ${dbCase.sections.length} sections, title=${dbCase.title}, charts=${dbCase.sections.reduce((n, s) => n + (s.chartSpecsRaw?.length || 0), 0)}`);
            await new Promise(r => setTimeout(r, 500));
            result = dbCase;
          } else {
            // Fallback: fixture
            const fixture = CASE_1782966166476;
            logger.info(`[Generation] Excel POST stub mode (fixture fallback): ${fixture.sections.length} sections, case ${fixture.caseId}`);
            await new Promise(r => setTimeout(r, 500));
            result = {
              content: fixture.htmlContent,
              sections: fixture.sections.map(s => ({
                title: s.title, content: s.content,
                sources: s.sources.map(src => ({ chunkId: src.chunkId, content: "", score: src.score, sourceId: src.chunkId, sourceName: src.sourceName })),
                webCitations: [], groundingScore: s.groundingScore, citationLinks: [],
              })),
              trustScore: fixture.trustScore, documentStyle: fixture.documentStyle, title: fixture.title,
            };
          }
        } else {
          // 真实 LLM 生成
          let sectionIndex = 0;
          const totalSections = outline.length;
          result = await generateDocument({
            title, outline, userRequest,
            format: effectiveFormat,
            modelId, apiKey,
            providerPreference: providerPreference ?? [],
            providerBaseUrls,
          }, (section, phase) => {
            if (phase === "start") {
              // 更新进度到 DB（用 progress_json 字段存当前章节）
              const progressJson = JSON.stringify({ currentChapter: section.title, index: sectionIndex, total: totalSections });
              dbRun(`UPDATE generation_runs SET progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
                [progressJson, runId]);
              logger.info(`[Generation] Excel POST 进度: [${sectionIndex + 1}/${totalSections}] ${section.title}`);
            } else {
              sectionIndex++;
            }
          });
        }

        // 提取 stub mode 的来源数据（如果 result 来自 readCaseFromDb）
        const stubExtra = result as GenerateDocResult & { citations?: CitationItem[]; provenanceNodes?: ProvenanceNodeRow[]; sourceRunId?: string };

        // 生成完成
        // Stub mode：直接使用原始 case 的 content（包含 citations footer），让 provenanceTree 的 enrichProvenanceNodes 能解析真实来源
        // Non-stub mode：使用 toHtml 重新生成
        const htmlContent = stubExtra.sourceRunId && stubExtra.content && stubExtra.content.length > 0
          ? stubExtra.content
          : toHtml(result, baseUrl);
        const excelPayload = toExcelPayload(result, {
          citations: stubExtra.citations,
          provenanceNodes: stubExtra.provenanceNodes,
        });

        dbRun(`UPDATE generation_runs SET title = ?, content = ?, excel_payload = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [result.title, htmlContent, JSON.stringify(excelPayload), result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, JSON.stringify({ currentChapter: '', index: result.sections.length, total: result.sections.length }), runId],
          { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done" } });

        // 复制原始 run 的 provenance_nodes 到新 runId（供 add-in ResultsPanel 来源树使用）
        if (stubExtra.sourceRunId) {
          try {
            dbRun(
              `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
               SELECT ?, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, datetime('now','localtime')
               FROM provenance_nodes WHERE run_id = ?`,
              [runId, stubExtra.sourceRunId],
              { table: "provenance_nodes", recordId: runId, source: "generation-stub" },
            );
            logger.info(`[Generation] Excel POST 复制 provenance_nodes: ${stubExtra.sourceRunId} → ${runId}`);
          } catch (provErr) {
            logger.warn(`[Generation] Excel POST 复制 provenance_nodes 失败: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
          }

          // 复制原始 run 的 trust_evaluations 到新 runId（供 add-in ResultsPanel 评估结果显示）
          try {
            const sourceEval = dbGet<{ metrics: string }>(
              "SELECT metrics FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
              [stubExtra.sourceRunId],
            );
            if (sourceEval?.metrics) {
              const evalId = crypto.randomUUID();
              dbRun(
                `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
                [evalId, runId, sourceEval.metrics],
                { table: "trust_evaluations", recordId: evalId, source: "generation-stub" },
              );
              logger.info(`[Generation] Excel POST 复制 trust_evaluations: ${stubExtra.sourceRunId} → ${runId}`);
            }
          } catch (evalErr) {
            logger.warn(`[Generation] Excel POST 复制 trust_evaluations 失败: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`);
          }
        }

        logger.info(`[Generation] Excel POST 生成完成: ${result.title}, sheets=${excelPayload.sheets.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Generation] Excel POST 生成失败: ${msg}`);
        dbRun(`UPDATE generation_runs SET status = 'crashed', progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [JSON.stringify({ error: msg }), runId],
          { table: "generation_runs", recordId: runId, source: "generation" });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] Excel POST 触发失败: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

/** POST /api/generation/word — 触发 Word 生成，立即返回 runId */
generationRouter.post("/word", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // 并发去重
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating'",
      [title],
    );
    if (existing) {
      const STALE_THRESHOLD_SECONDS = 10 * 60;
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else if (isStubMode) {
        logger.info(`[Generation] Word POST stub mode: 检测到同名 generating 记录 ${existing.id}，直接返回`);
        res.json({ ok: true, runId: existing.id });
        return;
      } else {
        res.status(409).json({ ok: false, error: "同名文档正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    runId = crypto.randomUUID();
    const effectiveFormat = format ?? "word";
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), effectiveFormat, "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: effectiveFormat, status: "generating" } });

    logger.info(`[Generation] Word POST 触发生成: ${title}, runId=${runId}, 章节数=${outline.length}`);

    // 立即返回 runId
    res.json({ ok: true, runId });

    // 后台异步执行生成
    setImmediate(async () => {
      try {
        const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
        let result: GenerateDocResult;

        if (isStubMode) {
          const dbCase = readWordCaseFromDb();
          if (dbCase) {
            logger.info(`[Generation] Word POST stub mode (DB case 1782961869584): ${dbCase.sections.length} sections, title=${dbCase.title}`);
            await new Promise(r => setTimeout(r, 500));
            result = dbCase;
          } else {
            throw new Error("Word demo case 1782961869584 在数据库中未找到或数据不完整，请确认该记录存在且 status='done'");
          }
        } else {
          let sectionIndex = 0;
          const totalSections = outline.length;
          result = await generateDocument({
            title, outline, userRequest,
            format: effectiveFormat,
            modelId, apiKey,
            providerPreference: providerPreference ?? [],
            providerBaseUrls,
          }, (section, phase) => {
            if (phase === "start") {
              const progressJson = JSON.stringify({ currentChapter: section.title, index: sectionIndex, total: totalSections });
              dbRun(`UPDATE generation_runs SET progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
                [progressJson, runId]);
              logger.info(`[Generation] Word POST 进度: [${sectionIndex + 1}/${totalSections}] ${section.title}`);
            } else {
              sectionIndex++;
            }
          });
        }

        const stubExtra = result as GenerateDocResult & { citations?: CitationItem[]; provenanceNodes?: ProvenanceNodeRow[]; sourceRunId?: string };

        const htmlContent = stubExtra.sourceRunId && stubExtra.content && stubExtra.content.length > 0
          ? stubExtra.content
          : toHtml(result, `${req.protocol || "http"}://${req.get("host") || "localhost:3000"}`);
        const wordPayload = toWordPayload(result, {
          citations: stubExtra.citations,
          provenanceNodes: stubExtra.provenanceNodes,
        });

        dbRun(`UPDATE generation_runs SET title = ?, content = ?, word_payload = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [result.title, htmlContent, JSON.stringify(wordPayload), result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, JSON.stringify({ currentChapter: '', index: result.sections.length, total: result.sections.length }), runId],
          { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done" } });

        // 复制原始 run 的 provenance_nodes 到新 runId
        if (stubExtra.sourceRunId) {
          try {
            dbRun(
              `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
               SELECT ?, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, datetime('now','localtime')
               FROM provenance_nodes WHERE run_id = ?`,
              [runId, stubExtra.sourceRunId],
              { table: "provenance_nodes", recordId: runId, source: "generation-word-stub" },
            );
            logger.info(`[Generation] Word POST 复制 provenance_nodes: ${stubExtra.sourceRunId} → ${runId}`);
          } catch (provErr) {
            logger.warn(`[Generation] Word POST 复制 provenance_nodes 失败: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
          }

          // 复制原始 run 的 trust_evaluations 到新 runId
          try {
            const sourceEval = dbGet<{ metrics: string }>(
              "SELECT metrics FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
              [stubExtra.sourceRunId],
            );
            if (sourceEval?.metrics) {
              const evalId = crypto.randomUUID();
              dbRun(
                `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
                [evalId, runId, sourceEval.metrics],
                { table: "trust_evaluations", recordId: evalId, source: "generation-word-stub" },
              );
              logger.info(`[Generation] Word POST 复制 trust_evaluations: ${stubExtra.sourceRunId} → ${runId}`);
            }
          } catch (evalErr) {
            logger.warn(`[Generation] Word POST 复制 trust_evaluations 失败: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`);
          }
        }

        logger.info(`[Generation] Word POST 生成完成: ${result.title}, sections=${wordPayload.sections.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Generation] Word POST 生成失败: ${msg}`);
        dbRun(`UPDATE generation_runs SET status = 'crashed', progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [JSON.stringify({ error: msg }), runId],
          { table: "generation_runs", recordId: runId, source: "generation" });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] Word POST 触发失败: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

/** POST /api/generation/ppt — 触发 PPT 生成，立即返回 runId */
generationRouter.post("/ppt", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // 并发去重
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating' AND format = 'ppt'",
      [title],
    );
    if (existing) {
      const STALE_THRESHOLD_SECONDS = 10 * 60;
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else if (isStubMode) {
        logger.info(`[Generation] PPT POST stub mode: 检测到同名 generating 记录 ${existing.id}，直接返回`);
        res.json({ ok: true, runId: existing.id });
        return;
      } else {
        res.status(409).json({ ok: false, error: "同名文档正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    runId = crypto.randomUUID();
    const effectiveFormat = format ?? "ppt";
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), effectiveFormat, "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: effectiveFormat, status: "generating" } });

    logger.info(`[Generation] PPT POST 触发生成: ${title}, runId=${runId}, 章节数=${outline.length}`);

    // 立即返回 runId
    res.json({ ok: true, runId });

    // 后台异步执行生成
    setImmediate(async () => {
      try {
        const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
        let result: GenerateDocResult;

        if (isStubMode) {
          // PPT stub 模式：直接使用 case-1783257530743 fixture 数据
          const fixture = CASE_1783257530743;
          logger.info(`[Generation] PPT POST stub mode (case ${fixture.caseId}): ${fixture.sections.length} sections, title=${fixture.title}`);
          await new Promise(r => setTimeout(r, 500));

          // 构建全局 citationLinks：按 URL/文件名去重，分配连续编号 [1], [2], [3]...
          // 这与 toHtml() 中的去重逻辑一致，确保正文中的 [N] 引用标记不被清除
          const citeSourceKey = (src: { sourceName?: string; sourceUrl?: string; sourceId?: string }) => {
            if (src.sourceUrl && src.sourceUrl.trim()) return `url:${src.sourceUrl.trim()}`;
            if (src.sourceId && src.sourceId.trim()) return `sid:${src.sourceId.trim()}`;
            return `name:${src.sourceName || ""}`;
          };
          const buildCiteUrl = (src: { sourceUrl?: string; sourceId?: string }): string => {
            if (src.sourceUrl && src.sourceUrl.trim()) return src.sourceUrl.trim();
            if (src.sourceId && src.sourceId.trim()) return `http://localhost:3000/api/knowledge/sources/${src.sourceId.trim()}/file`;
            return "";
          };
          const citeSeen = new Map<string, number>();
          const citationLinksList: CitationLink[] = [];
          let citeNextIdx = 1;
          for (const s of fixture.sections) {
            for (const src of (s.sources ?? [])) {
              if (!src.sourceName) continue;
              const key = citeSourceKey(src as { sourceName?: string; sourceUrl?: string; sourceId?: string });
              if (!citeSeen.has(key)) {
                citeSeen.set(key, citeNextIdx);
                citationLinksList.push({
                  index: citeNextIdx,
                  title: src.sourceName,
                  url: buildCiteUrl(src as { sourceUrl?: string; sourceId?: string }),
                  sourceId: (src.sourceId as string) ?? "",
                });
                citeNextIdx++;
              }
            }
          }

          result = {
            content: fixture.htmlContent,
            sections: fixture.sections.map(s => ({
              title: s.title,
              content: s.content,
              sources: (s.sources ?? []).map((src: Record<string, unknown>) => ({
                chunkId: src.chunkId as string,
                content: (src.content as string) ?? '',
                score: src.score as number,
                sourceId: src.sourceId as string,
                sourceName: src.sourceName as string | undefined,
                sourceUrl: src.sourceUrl as string | undefined,
              })),
              webCitations: [],
              groundingScore: s.groundingScore ?? 0,
              citationLinks: citationLinksList, // 提供正确的 citationLinks，防止 toHtml() 清除 [N] 标记
            })),
            trustScore: fixture.trustScore ?? 0.5,
            documentStyle: fixture.documentStyle ?? "presentation",
            title: fixture.title,
            conflictResolution: fixture.conflictResolution,
            sourceRunId: fixture.caseId, // 标记为 fixture 数据，用于后续判断
            provenanceNodes: fixture.provenanceNodes ?? [],
          } as GenerateDocResult & { sourceRunId: string; provenanceNodes: Record<string, unknown>[] };
        } else {
          let sectionIndex = 0;
          const totalSections = outline.length;
          result = await generateDocument({
            title, outline, userRequest,
            format: effectiveFormat,
            modelId, apiKey,
            providerPreference: providerPreference ?? [],
            providerBaseUrls,
          }, (section, phase) => {
            if (phase === "start") {
              const progressJson = JSON.stringify({ currentChapter: section.title, index: sectionIndex, total: totalSections });
              dbRun(`UPDATE generation_runs SET progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
                [progressJson, runId]);
              logger.info(`[Generation] PPT POST 进度: [${sectionIndex + 1}/${totalSections}] ${section.title}`);
            } else {
              sectionIndex++;
            }
          });
        }

        const stubExtra = result as GenerateDocResult & { citations?: CitationItem[]; provenanceNodes?: ProvenanceNodeRow[]; sourceRunId?: string };

        const htmlContent = stubExtra.sourceRunId && stubExtra.content && stubExtra.content.length > 0
          ? stubExtra.content
          : toHtml(result, `${req.protocol || "http"}://${req.get("host") || "localhost:3000"}`);

        // 构建 PPT 专用 payload
        const pptPayload = toPptPayload(result);

        dbRun(`UPDATE generation_runs SET title = ?, content = ?, ppt_payload = ?, status = 'done', trust_score = ?, document_style = ?, conflict_resolution = ?, progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [result.title, htmlContent, JSON.stringify(pptPayload), result.trustScore, result.documentStyle, result.conflictResolution ? JSON.stringify(result.conflictResolution) : null, JSON.stringify({ currentChapter: '', index: result.sections.length, total: result.sections.length }), runId],
          { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done" } });

        // 复制/插入 provenance_nodes
        if (stubExtra.sourceRunId) {
          const isFixtureData = stubExtra.sourceRunId.startsWith("case-");
          const fixtureData = isStubMode ? CASE_1783257530743 : null;

          try {
            if (isFixtureData && stubExtra.provenanceNodes && stubExtra.provenanceNodes.length > 0) {
              // 直接从 fixture 的 provenanceNodes 插入（fixture 用 camelCase，DB 用 snake_case）
              for (const node of stubExtra.provenanceNodes) {
                const n = node as unknown as Record<string, unknown>;
                dbRun(
                  `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
                  [
                    runId,
                    (n.paragraphIdx as number) ?? 0,
                    (n.paragraphTitle as string) ?? "",
                    (n.chunkId as string) ?? null,
                    (n.webUrl as string) ?? null,
                    (n.webTitle as string) ?? null,
                    (n.score as number) ?? 0,
                    (n.groundingScore as number) ?? 0,
                    0,
                  ],
                  { table: "provenance_nodes", recordId: runId, source: "generation-ppt-stub" },
                );
              }
              logger.info(`[Generation] PPT POST 插入 fixture provenance_nodes: ${stubExtra.provenanceNodes.length} 条 → ${runId}`);
            } else {
              // 从 DB 中已有的 sourceRunId 复制
              dbRun(
                `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
                 SELECT ?, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, datetime('now','localtime')
                 FROM provenance_nodes WHERE run_id = ?`,
                [runId, stubExtra.sourceRunId],
                { table: "provenance_nodes", recordId: runId, source: "generation-ppt-stub" },
              );
              logger.info(`[Generation] PPT POST 复制 provenance_nodes: ${stubExtra.sourceRunId} → ${runId}`);
            }
          } catch (provErr) {
            logger.warn(`[Generation] PPT POST provenance_nodes 插入失败: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
          }

          // 插入 trust_evaluations
          try {
            if (isFixtureData && fixtureData && (fixtureData as Record<string, unknown>).trustMetrics) {
              // 从 fixture 的 trustMetrics 直接插入
              const evalId = crypto.randomUUID();
              dbRun(
                `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
                [evalId, runId, JSON.stringify((fixtureData as Record<string, unknown>).trustMetrics)],
                { table: "trust_evaluations", recordId: evalId, source: "generation-ppt-stub" },
              );
              logger.info(`[Generation] PPT POST 插入 fixture trust_evaluations → ${runId}`);
            } else {
              // 从 DB 中已有的 sourceRunId 复制
              const sourceEval = dbGet<{ metrics: string }>(
                "SELECT metrics FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
                [stubExtra.sourceRunId],
              );
              if (sourceEval?.metrics) {
                const evalId = crypto.randomUUID();
                dbRun(
                  `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
                  [evalId, runId, sourceEval.metrics],
                  { table: "trust_evaluations", recordId: evalId, source: "generation-ppt-stub" },
                );
                logger.info(`[Generation] PPT POST 复制 trust_evaluations: ${stubExtra.sourceRunId} → ${runId}`);
              }
            }
          } catch (evalErr) {
            logger.warn(`[Generation] PPT POST trust_evaluations 插入失败: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`);
          }
        }

        logger.info(`[Generation] PPT POST 生成完成: ${result.title}, slides=${pptPayload.slides.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Generation] PPT POST 生成失败: ${msg}`);
        dbRun(`UPDATE generation_runs SET status = 'crashed', progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [JSON.stringify({ error: msg }), runId],
          { table: "generation_runs", recordId: runId, source: "generation" });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] PPT POST 触发失败: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

/** POST /api/generation/email — 触发 Outlook 邮件草稿生成，立即返回 runId */
generationRouter.post("/email", async (req, res) => {
  let runId = "";
  try {
    const { title, outline, format, providerPreference, modelId, apiKey, providerBaseUrls, userRequest } = req.body;

    if (!title || !outline) {
      res.status(400).json({ ok: false, error: "title and outline are required" });
      return;
    }

    // 1. 并发去重（同 word 模式）
    const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
    const existing = dbGet<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM generation_runs WHERE title = ? AND status = 'generating' AND format = 'email'",
      [title],
    );
    if (existing) {
      const STALE_THRESHOLD_SECONDS = 10 * 60;
      const staleCheck = dbGet<{ stale: number }>(
        `SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) > ${STALE_THRESHOLD_SECONDS} AS stale`,
        [existing.created_at],
      );
      if (staleCheck?.stale === 1) {
        dbRun(`UPDATE generation_runs SET status = 'crashed' WHERE id = ?`, [existing.id],
          { table: "generation_runs", recordId: existing.id, source: "generation" });
      } else if (isStubMode) {
        logger.info(`[Generation] Email POST stub mode: 检测到同名 generating 记录 ${existing.id}，直接返回`);
        res.json({ ok: true, runId: existing.id });
        return;
      } else {
        res.status(409).json({ ok: false, error: "同名邮件正在生成中，请等待完成", existingRunId: existing.id });
        return;
      }
    }

    // 2. 插入 generating 记录
    runId = crypto.randomUUID();
    const effectiveFormat = format ?? "email";
    dbRun(`INSERT INTO generation_runs (id, title, outline, format, status) VALUES (?, ?, ?, ?, ?)`,
      [runId, title, JSON.stringify(outline), effectiveFormat, "generating"],
      { table: "generation_runs", recordId: runId, source: "generation", newData: { title, format: effectiveFormat, status: "generating" } });

    logger.info(`[Generation] Email POST 触发生成: ${title}, runId=${runId}, 章节数=${outline.length}`);

    // 3. 立即返回 runId
    res.json({ ok: true, runId });

    // 4. 后台异步执行
    setImmediate(async () => {
      try {
        const isStubMode = providerPreference?.includes("stub") || providerPreference?.length === 0 || !providerPreference;
        let result: GenerateDocResult;

        if (isStubMode) {
          // Email stub 模式：从 DB 读 case-1782296242386
          const dbCase = readOutlookCaseFromDb();
          await new Promise(r => setTimeout(r, 500));

          if (!dbCase) {
            logger.warn(`[Generation] Email POST stub mode: case-1782296242386 未在 DB 中找到，使用 fallback 构造`);
            // Fallback：构造空邮件草稿
            result = {
              content: "",
              sections: [{
                title: "邮件正文",
                content: "<p>（未找到 case-1782296242386 数据）</p>",
                sources: [],
                webCitations: [],
                groundingScore: 0,
                citationLinks: [],
              }],
              trustScore: 0.3,
              documentStyle: "email",
              title: title,
            } as GenerateDocResult;
          } else {
            logger.info(`[Generation] Email POST stub mode: 从 DB 读 case-1782296242386, sections=${dbCase.sections.length}`);
            // 构造 GenerateDocResult 复用 toEmailPayload
            const allCitations: Array<{ index: number; title: string; url: string; sourceId?: string }> = [];
            const seenCiteKeys = new Set<string>();
            let citeIdx = 1;
            for (const sec of dbCase.sections) {
              for (const src of sec.sources ?? []) {
                const key = (src.sourceUrl || src.sourceId || src.sourceName || "").trim();
                if (!key || seenCiteKeys.has(key)) continue;
                seenCiteKeys.add(key);
                allCitations.push({
                  index: citeIdx++,
                  title: src.sourceName || `来源 ${citeIdx - 1}`,
                  url: src.sourceUrl || "",
                  sourceId: src.sourceId,
                });
              }
            }

            result = {
              content: dbCase.content,
              sections: dbCase.sections.map(s => ({
                title: s.title,
                content: s.content,
                sources: s.sources ?? [],
                webCitations: [],
                groundingScore: 0,
                citationLinks: allCitations.map(c => ({ index: c.index, title: c.title, url: c.url, sourceId: c.sourceId ?? "" })),
              })),
              trustScore: dbCase.trustScore ?? 0.93,
              documentStyle: "email",
              title: dbCase.title,
              provenanceNodes: dbCase.provenanceNodes,
              sourceRunId: dbCase.sourceRunId, // 用于 provenance 复制
            } as unknown as GenerateDocResult;
          }
        } else {
          // 真实 LLM 模式（与 word/ppt 一致）
          result = await generateDocument({
            title, outline, userRequest,
            format: effectiveFormat,
            modelId, apiKey,
            providerPreference: providerPreference ?? [],
            providerBaseUrls,
          });
        }

        // 5. 构造 email_payload
        const stubExtra = result as GenerateDocResult & { citations?: CitationItem[]; provenanceNodes?: ProvenanceNodeRow[]; sourceRunId?: string };
        const emailCitations: CitationItem[] = (stubExtra.citations ?? []).map((c) => ({
          index: c.index,
          title: c.title,
          url: c.url,
        }));
        // 如果 result 没有 citations，从 result.sections[].sources 推
        if (emailCitations.length === 0) {
          const seenKeys = new Set<string>();
          let idx = 1;
          for (const sec of result.sections) {
            for (const src of sec.sources ?? []) {
              const key = (src.sourceUrl || src.sourceId || src.sourceName || "").trim();
              if (!key || seenKeys.has(key)) continue;
              seenKeys.add(key);
              emailCitations.push({
                index: idx++,
                title: src.sourceName || `来源 ${idx - 1}`,
                url: src.sourceUrl || (src.sourceId ? `/api/knowledge/sources/${src.sourceId}/file` : ""),
              });
            }
          }
        }

        const emailPayload = toEmailPayload(result, {
          citations: emailCitations,
        });

        // 6. 写回 DB
        const htmlContent = stubExtra.sourceRunId && stubExtra.content && stubExtra.content.length > 0
          ? stubExtra.content
          : toHtml(result, `${req.protocol || "http"}://${req.get("host") || "localhost:3000"}`);

        dbRun(`UPDATE generation_runs SET title = ?, content = ?, email_payload = ?, status = 'done', trust_score = ?, document_style = ?, progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [result.title, htmlContent, JSON.stringify(emailPayload), result.trustScore, result.documentStyle, JSON.stringify({ currentChapter: '', index: result.sections.length, total: result.sections.length }), runId],
          { table: "generation_runs", recordId: runId, source: "generation", newData: { status: "done" } });

        // 7. 复制 provenance_nodes（与 ppt 模式一致）
        if (stubExtra.sourceRunId) {
          try {
            dbRun(
              `INSERT INTO provenance_nodes (run_id, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, created_at)
               SELECT ?, paragraph_idx, paragraph_title, chunk_id, web_url, web_title, score, grounding_score, is_manual, datetime('now','localtime')
               FROM provenance_nodes WHERE run_id = ?`,
              [runId, stubExtra.sourceRunId],
              { table: "provenance_nodes", recordId: runId, source: "generation-email-stub" },
            );
            logger.info(`[Generation] Email POST 复制 provenance_nodes: ${stubExtra.sourceRunId} → ${runId}`);
          } catch (provErr) {
            logger.warn(`[Generation] Email POST provenance_nodes 复制失败: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
          }

          // 8. 复制 trust_evaluations
          try {
            const sourceEval = dbGet<{ metrics: string }>(
              "SELECT metrics FROM trust_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
              [stubExtra.sourceRunId],
            );
            if (sourceEval?.metrics) {
              const evalId = crypto.randomUUID();
              dbRun(
                `INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
                [evalId, runId, sourceEval.metrics],
                { table: "trust_evaluations", recordId: evalId, source: "generation-email-stub" },
              );
              logger.info(`[Generation] Email POST 复制 trust_evaluations: ${stubExtra.sourceRunId} → ${runId}`);
            }
          } catch (evalErr) {
            logger.warn(`[Generation] Email POST trust_evaluations 复制失败: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`);
          }
        }

        logger.info(
          `[Generation] Email POST 生成完成: ${result.title}, sections=${result.sections.length}, ` +
          `bodyLen=${emailPayload.bodyCharCount}, subject="${emailPayload.subject}"`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Generation] Email POST 生成失败: ${msg}`);
        dbRun(`UPDATE generation_runs SET status = 'crashed', progress_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
          [JSON.stringify({ error: msg }), runId],
          { table: "generation_runs", recordId: runId, source: "generation" });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] Email POST 触发失败: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

/** GET /api/generation/status/:runId — 轮询生成状态 */
generationRouter.get("/status/:runId", (req, res) => {
  try {
    const { runId } = req.params;
    const run = dbGet<{ id: string; title: string; status: string; content: string; excel_payload: string | null; word_payload: string | null; ppt_payload: string | null; email_payload: string | null; progress_json: string | null; trust_score: number | null; document_style: string | null; outline: string; format: string }>(
      "SELECT id, title, status, content, excel_payload, word_payload, ppt_payload, email_payload, progress_json, trust_score, document_style, outline, format FROM generation_runs WHERE id = ?",
      [runId],
    );

    if (!run) {
      res.status(404).json({ ok: false, error: "Run not found" });
      return;
    }

    const progress = run.progress_json ? JSON.parse(run.progress_json) : { currentChapter: '', index: 0, total: 0 };
    const outline: Array<{ title: string }> = run.outline ? JSON.parse(run.outline) : [];

    if (run.status === "done") {
      const excelPayload = run.excel_payload ? JSON.parse(run.excel_payload) : null;
      const wordPayload = run.word_payload ? JSON.parse(run.word_payload) : null;
      const pptPayload = run.ppt_payload ? JSON.parse(run.ppt_payload) : null;
      const emailPayload = run.email_payload ? JSON.parse(run.email_payload) : null;
      res.json({
        ok: true,
        status: "done",
        runId: run.id,
        title: run.title,
        progress: { currentChapter: '', index: outline.length, total: outline.length },
        excelPayload,
        wordPayload,
        pptPayload,
        emailPayload,
        trustScore: run.trust_score,
        documentStyle: run.document_style,
      });
    } else if (run.status === "crashed" || run.status === "aborted") {
      res.json({
        ok: true,
        status: "error",
        runId: run.id,
        error: progress?.error ?? `生成${run.status === 'crashed' ? '失败' : '已中止'}`,
        progress,
      });
    } else {
      // generating
      res.json({
        ok: true,
        status: "generating",
        runId: run.id,
        title: run.title,
        progress,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] Status 查询失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
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
    // ── 优先级修复：强格式信号优先（与 detectStyle 保持一致）──
    if (/xlsx|\.xlsx|excel/i.test(text)) return "table";
    if (/pptx|\.pptx?|演示|slides|幻灯片/i.test(text)) return "ppt";
    if (/markdown|\.md/i.test(text)) return "code";
    if (/邮件|email|mail|写信|致函/.test(text)) return "email";
    if (/表格|table|数据表/i.test(text)) return "table";
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
    // 清理 LLM 生成的破损 <sup><a> 标签，防止破损 HTML 损坏客户端 DOM
    if (run.content) {
      run.content = sanitizeCitationHtml(run.content);
    }
    res.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** 判断纯文本行是否为小节标题（用于导出时区分正文和子标题） */
function isSubHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return false;
  // 排除纯引用标记行（如 "[1]"）
  if (/^\[\d+\]$/.test(trimmed)) return false;
  // 排除含引用标记的行（子标题不应该有引用）
  if (/\[\d+\]/.test(trimmed)) return false;
  // 排除以标点或小写字母开头的续行
  if (/^[，。、；：）\)\/\s<]/.test(trimmed)) return false;
  // 中文字符占比高（≥50%且≥4个中文字符）且行较短 → 很可能是子标题
  const cjkChars = (trimmed.match(/[一-鿿㐀-䶿]/g) || []).length;
  if (cjkChars >= 4 && cjkChars / trimmed.length >= 0.5) return true;
  // 英文标题：以大写字母开头，较短的句子
  if (/^[A-Z]/.test(trimmed) && trimmed.length <= 60 && !/[。！？]$/.test(trimmed)) return true;
  return false;
}

/** 将 ExportSection 的 tables + chartSpecs 追加为文本，供完整度/相关度 LLM 检查使用 */
/**
 * 构建完整度检查用的 requirement 文本
 * Bug4 fix: 如果有 Query Analysis 结果，只用内容要点；否则 fallback 到原始 requirement
 */
function buildContentRequirement(originalRequirement: string, analysis: QueryAnalysis | null): string {
  if (!analysis || analysis.contentPoints.length === 0) {
    return originalRequirement;
  }
  // 用内容要点构建简洁的 requirement，去掉格式要求
  return `请生成一份文档，需要覆盖以下内容要点：\n${analysis.contentPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}

function sectionsWithExtras(sections: ExportSection[]): Array<{ title: string; content: string }> {
  return sections.map((s) => {
    const parts: string[] = [s.content];

    // 表格内容
    if (s.tables && s.tables.length > 0) {
      const tableText = s.tables
        .map((rows) => rows.map((cells) => cells.join(" | ")).join("\n"))
        .join("\n\n");
      parts.push(`[表格数据]\n${tableText}`);
    }

    // 图表内容
    if (s.chartSpecs && s.chartSpecs.length > 0) {
      const chartText = s.chartSpecs.map((c: any) => {
        if (c.type === "gantt") {
          const tasks = c.tasks ?? [];
          return `[甘特图: ${c.title}]\n${tasks.map((t: any) => `${t.task} | ${t.start}~${t.end} | ${t.assignee ?? ""}`).join("\n")}`;
        }
        if (c.type === "scatter") {
          const data = c.data ?? [];
          return `[散点图: ${c.title}]\n${data.map((d: any) => `${d.name} (x=${d.x}, y=${d.y})`).join("\n")}`;
        }
        // 标准 chart: categories + series
        const cats = c.categories ?? [];
        const series = c.series ?? [];
        return `[${c.type}图: ${c.title}]\n类别: ${cats.join(" | ")}\n${series.map((s2: any) => `${s2.name}: ${s2.values.join(", ")}`).join("\n")}`;
      }).join("\n\n");
      parts.push(`[图表数据]\n${chartText}`);
    }

    return { title: s.title, content: parts.join("\n\n") };
  });
}

/** 从 HTML 内容中解析章节 */
function parseHtmlSections(html: string, title: string): ExportSection[] {
  const sections: ExportSection[] = [];
  // 子标题标记：导出器使用此前缀识别子标题行并应用加粗+大字号格式
  const SUB_MARKER = "H";

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

  // ── 辅助：从 rawContent 中提取 <script> 标签（pythonScript & chartSpec） ──
  function extractScriptTags(rawContent: string): {
    cleanedContent: string;
    pythonScript?: string;
    chartSpecs?: ChartSpec[];
  } {
    let cleaned = rawContent;
    let pythonScript: string | undefined;
    let chartSpecs: ChartSpec[] | undefined;

    // 提取 xlsx-script
    const pyRegex = /<script\s+type="application\/x-python"\s+class="xlsx-script">([\s\S]*?)<\/script>/gi;
    const pyMatch = pyRegex.exec(cleaned);
    if (pyMatch?.[1]) {
      pythonScript = pyMatch[1].trim();
      cleaned = cleaned.replace(pyRegex, "");
    }

    // 提取 chart-spec（存储格式：JSON.stringify(chartSpecsRaw) → JSON 字符串数组）
    const chartRegex = /<script\s+type="application\/json"\s+class="chart-spec">([\s\S]*?)<\/script>/gi;
    const chartMatch = chartRegex.exec(cleaned);
    if (chartMatch?.[1]) {
      const raw = chartMatch[1].trim();
      if (raw) {
        try {
          // chartSpecsRaw 是 string[]（每个元素是一个 chart spec 的 JSON 字符串 或 JSON 数组字符串）
          const rawSpecs: string[] = JSON.parse(raw);
          if (Array.isArray(rawSpecs)) {
            const parsed: ChartSpec[] = [];
            for (const s of rawSpecs) {
              try {
                const obj = JSON.parse(s);
                // LLM 可能输出单个对象或对象数组（如 [{"type":"column",...}, {"type":"pie",...}]）
                const items = Array.isArray(obj) ? obj : [obj];
                for (const item of items) {
                  // 接受所有图表类型：column/bar/pie/line/doughnut（有 categories+series）
                  // 以及 gantt（有 tasks）、scatter（有 data）等非标准格式
                  if (item && typeof item === "object" && item.type && item.title) {
                    parsed.push(item as ChartSpec);
                  }
                }
              } catch { /* skip malformed JSON */ }
            }
            if (parsed.length > 0) chartSpecs = parsed;
          }
        } catch {
          // 如果解析失败，尝试用 extractChartSpecs 作为 fallback
          chartSpecs = extractChartSpecs(cleaned);
        }
      }
      cleaned = cleaned.replace(chartRegex, "");
    }

    return { cleanedContent: cleaned, pythonScript, chartSpecs };
  }

  // 尝试从 <section><h2>...</h2>...</section> 结构提取
  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = sectionRegex.exec(processedHtml)) !== null) {
    const sectionTitle = match[1].replace(/<[^>]+>/g, "").trim();
    let rawContent = match[2];

    // 移除内联 SVG 图表（包括内部文本），防止图表标签文本被提取为 content
    rawContent = rawContent.replace(/<svg[\s\S]*?<\/svg>/gi, "");

    // ── 提取 script 标签（pythonScript & chartSpec） ──
    const { cleanedContent, pythonScript, chartSpecs } = extractScriptTags(rawContent);
    rawContent = cleanedContent;

    // ── 提取 HTML 表格（在去标签之前提取，避免丢失结构） ──
    const extractedTables: Array<string[][]> = [];
    const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table\b[^>]*>/gi;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(rawContent)) !== null) {
      const tableHtml = tableMatch[1];
      const rows: string[][] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr\b[^>]*>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[1];
        const cells: string[] = [];
        const cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\b[^>]*>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) extractedTables.push(rows);
    }
    // 从 rawContent 中移除表格，避免干扰后续 <p> 匹配
    rawContent = rawContent.replace(tableRegex, "");

    // ── 子标题检测：在去 HTML 标签之前，按 <p> 边界分段 ──
    // 将 section 内容按 <p>...</p> 或 <p>...</p（broken closing）分段落
    const paraRegex = /<p\b[^>]*>([\s\S]*?)<\/p\b[^>]*>/gi;
    const processedLines: string[] = [];
    let paraMatch;
    let prevEnd = 0;

    while ((paraMatch = paraRegex.exec(rawContent)) !== null) {
      // 捕获 </p> 和 <p> 之间的间隙文本（Post-filter 句子删除可能导致裸文本节点，以及 <h3> 等非 <p> 标签）
      const gapRaw = rawContent.slice(prevEnd, paraMatch.index);
      const gapText = gapRaw.replace(/<[^>]+>/g, "").trim();
      if (gapText) {
        const gapLines = gapText.split("\n").filter((l) => l.trim());
        for (const line of gapLines) {
          if (isSubHeadingLine(line)) {
            processedLines.push(`${SUB_MARKER}${line.trim()}`);
          } else {
            processedLines.push(line.trim());
          }
        }
      }

      const paraText = paraMatch[1].replace(/<[^>]+>/g, "").trim();
      if (paraText) {
        if (isSubHeadingLine(paraText)) {
          processedLines.push(`${SUB_MARKER}${paraText}`);
        } else {
          processedLines.push(paraText);
        }
      }
      prevEnd = paraMatch.index + paraMatch[0].length;
    }

    // 处理最后一个 <p> 之后未被包裹的残留文本（如 <ul>/<li>/<h3>）
    const remaining = rawContent.slice(prevEnd).replace(/<[^>]+>/g, "").trim();
    if (remaining) {
      const lines = remaining.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        if (isSubHeadingLine(line)) {
          processedLines.push(`${SUB_MARKER}${line.trim()}`);
        } else {
          processedLines.push(line.trim());
        }
      }
    }

    if (processedLines.length > 0) {
      sections.push({
        title: sectionTitle, content: processedLines.join("\n"), level: 1,
        ...(pythonScript && { pythonScript }),
        ...(chartSpecs && chartSpecs.length > 0 && { chartSpecs }),
        ...(extractedTables.length > 0 && { tables: extractedTables }),
      });
    } else {
      // 回退：整体去 HTML 标签
      const text = rawContent.replace(/<[^>]+>/g, "").trim();
      if (text) {
        sections.push({
          title: sectionTitle, content: text, level: 1,
          ...(pythonScript && { pythonScript }),
          ...(chartSpecs && chartSpecs.length > 0 && { chartSpecs }),
          ...(extractedTables.length > 0 && { tables: extractedTables }),
        });
      }
    }
  }

  // 如果没有 section 标签（如邮件格式），整体作为一个章节
  if (sections.length === 0) {
    // 先提取 script 标签
    const { cleanedContent, pythonScript, chartSpecs } = extractScriptTags(processedHtml);

    const text = cleanedContent
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")  // 去 footer（参考来源列表单独处理）
      .replace(/<[^>]+>/g, "")  // 去 HTML 标签
      .trim();
    if (text) {
      sections.push({
        title, content: text, level: 1,
        ...(pythonScript && { pythonScript }),
        ...(chartSpecs && chartSpecs.length > 0 && { chartSpecs }),
      });
    }
  }

  return sections;
}

/**
 * 从 HTML 内容中解析章节（PPT 专用）。
 * 与 parseHtmlSections 不同：保留内层 HTML 给 slideLayoutEngine 解析。
 * 仅移除 script 标签和 SVG 图表，保留 <h3>/<p>/<ul>/<table> 等结构标签。
 */
export function parseHtmlSectionsForPPT(html: string, title: string): ExportSection[] {
  const sections: ExportSection[] = [];

  // citation 转纯文本 [N]
  let processedHtml = html
    .replace(/<sup>\s*<(?:a|span)[^>]*?>\[(\d+)\]<\/(?:a|span)>\s*<\/sup>/gi, '[$1]')
    .replace(/<sup[^>]*?>\s*\[(\d+)\]\s*<\/sup>/gi, '[$1]')
    .replace(/<a[^>]*?>\s*\[(\d+)\]\s*<\/a>/gi, '[$1]');

  // 按 <section> 分割
  const sectionRegex = /<section>\s*<h2>(.*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(processedHtml)) !== null) {
    const sectionTitle = match[1]!.replace(/<[^>]+>/g, "").trim();
    let innerHtml = match[2]!;

    // 提取 chart spec
    let chartSpecs: ChartSpec[] | undefined;
    const chartRegex = /<script\s+type="application\/json"\s+class="chart-spec">([\s\S]*?)<\/script>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = chartRegex.exec(innerHtml)) !== null) {
      try {
        const raw = cm[1]!.trim();
        const rawSpecs: string[] = JSON.parse(raw);
        const parsed: ChartSpec[] = [];
        for (const s of rawSpecs) {
          try {
            const obj = JSON.parse(s);
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
              if (item && item.type && item.categories && item.series && Array.isArray(item.series)) {
                const validSeries = item.series.filter((s: any) => s && Array.isArray(s.values) && s.values.length > 0);
                if (validSeries.length > 0) {
                  parsed.push({ ...item, series: validSeries } as ChartSpec);
                }
              }
            }
          } catch { /* skip */ }
        }
        if (parsed.length > 0) chartSpecs = parsed;
      } catch { /* skip */ }
    }
    innerHtml = innerHtml.replace(chartRegex, "");

    // 移除 SVG 图表
    innerHtml = innerHtml.replace(/<div class="charts">[\s\S]*?<\/div>/gi, "");
    // 移除 xlsx-script
    innerHtml = innerHtml.replace(/<script\s+type="application\/x-python"[\s\S]*?<\/script>/gi, "");

    // 预处理：拆分"段落。表格行"复合 <p>
    // LLM 有时将段落文本和表格行写在同一行（如"说明文字。列1 | 列2 | 列3"），
    // markdownToHtml 将其转为单个 <p>。这会导致：
    // 1. 表头吞没段落文字（段落成为表头的一部分）
    // 2. 相邻表格合并（段落中的 | 使 buffer 连续）
    // 在此拆分为两个独立 <p>，让后续 extractMarkdownTables 正确识别表格边界。
    innerHtml = splitParagraphAndTableRows(innerHtml);

    // 提取 HTML 表格（与 parseHtmlSections 逻辑相同）
    const extractedTables: Array<string[][]> = [];
    const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table\b[^>]*>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tableRegex.exec(innerHtml)) !== null) {
      const rows: string[][] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr\b[^>]*>/gi;
      let trm: RegExpExecArray | null;
      while ((trm = trRegex.exec(tm[1]!)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\b[^>]*>/gi;
        let cellm: RegExpExecArray | null;
        while ((cellm = cellRegex.exec(trm[1]!)) !== null) {
          cells.push(cellm[1]!.replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) extractedTables.push(rows);
    }

    // 从 content 中移除已提取的 HTML 表格（防止 PPTX 导出时表格 HTML 被当作文本处理，导致文字与表格重叠）
    if (extractedTables.length > 0) {
      innerHtml = innerHtml.replace(/<table\b[^>]*>[\s\S]*?<\/table\b[^>]*>/gi, "");
    }

    // Fallback: 如果没提取到 HTML 表格，尝试从 <p> 中解析 markdown 表格
    // LLM 有时输出不带前导 | 的表格行（如 "风险项 | 发生概率 | 影响程度"），
    // markdownToHtml 不会将其转为 <table>，而是留作 <p>。
    // 提取为表格的同时，把对应的 <p> 源文本从内容中移除，
    // 否则会出现"markdown 表格文字 + 渲染表格"同时显示、互相挤压的问题。
    if (extractedTables.length === 0) {
      const { tables: mdTables, cleanedHtml } = extractMarkdownTables(innerHtml);
      if (mdTables.length > 0) {
        extractedTables.push(...mdTables);
        innerHtml = cleanedHtml;
      }
    }

    // 保留内层 HTML（去除 script/svg/footer 但保留结构和表格）
    let content = innerHtml
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .trim();

    if (content) {
      sections.push({
        title: sectionTitle,
        content,
        level: 1,
        ...(chartSpecs && chartSpecs.length > 0 && { chartSpecs }),
        ...(extractedTables.length > 0 && { tables: extractedTables }),
      });
    }
  }

  // 回退：没有 <section> 标签
  if (sections.length === 0) {
    const text = processedHtml.replace(/<footer[\s\S]*?<\/footer>/gi, "").trim();
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

    // 从生成的 HTML 内容中解析章节（PPT 格式保留 HTML 结构给 layout engine）
    const isPpt = format === "pptx";
    const sections = run.content
      ? (isPpt ? parseHtmlSectionsForPPT(run.content, run.title) : parseHtmlSections(run.content, run.title))
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

/** GET /api/generation/:id/pptx-base64 — 生成 PPTX 并返回 base64（供 PowerPoint Add-in insertSlidesFromBase64 使用） */
generationRouter.get("/:id/pptx-base64", async (req, res) => {
  try {
    const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
    if (!run) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    const sections = run.content
      ? parseHtmlSectionsForPPT(run.content, run.title)
      : [];

    const citations = run.content ? parseCitations(run.content) : [];

    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    const resolvedCitations = citations.map((c) => {
      if (c.url && c.url.startsWith("/")) {
        return { ...c, url: `${baseUrl}${c.url}` };
      }
      return c;
    });

    const result = await exportDocument("pptx", run.title, sections, resolvedCitations);
    const base64 = result.buffer.toString("base64");

    logger.info(`[Generation] PPTX base64 生成成功: ${run.title}, size=${result.buffer.length} bytes`);
    res.json({ ok: true, base64, title: run.title, slideCount: sections.length + 2 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Generation] PPTX base64 生成失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * 拆分"段落。表格行"复合 <p>
 *
 * LLM 有时将段落和表格行写在同一行，例如：
 *   <p>Q3 完成了多项演进。变更项 | 类型 | 影响范围 | 上线时间</p>
 *
 * 拆分为：
 *   <p>Q3 完成了多项演进。</p>
 *   <p>变更项 | 类型 | 影响范围 | 上线时间</p>
 *
 * 拆分条件：
 * - <p> 内同时包含 CJK 句末标点（。！？；）和至少 2 个 |（表格行特征）
 * - 标点后的部分不含 <（纯文本表格行）
 * - 使用 tempered greedy token ((?!<\/p>)[\s\S]) 确保不跨 <p> 边界匹配
 * - 使用贪婪匹配在最后一个标点处拆分（避免在段落中间误拆）
 *
 * 只使用 CJK 标点（不使用 ASCII . ! ;）以避免在数字（如 "v1.0 | v2.0"）上误拆。
 */
function splitParagraphAndTableRows(html: string): string {
  return html.replace(
    /<p\b[^>]*>((?:(?!<\/p>)[\s\S])*[。！？；])\s*([^<]*\|[^<]*\|[^<]*)<\/p>/g,
    (_m, p1: string, p2: string) => `<p>${p1}</p>\n<p>${p2}</p>`
  );
}

/**
 * 从 HTML 内容中提取 markdown 格式的表格（如 | col1 | col2 | 或 col1 | col2 |）
 * 作为 HTML <table> 提取失败时的 fallback
 */
function extractMarkdownTables(html: string): { tables: Array<string[][]>; cleanedHtml: string } {
  const tables: Array<string[][]> = [];
  const consumedRaw: string[] = [];

  // 提取所有 <p> 标签中的文本，同时保留原始 <p>...</p> 串，便于后续从内容中移除
  const pRegex = /<p>([^<]*)<\/p>/gi;
  const entries: { raw: string; text: string }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pRegex.exec(html)) !== null) {
    entries.push({ raw: pm[0]!, text: pm[1]!.trim() });
  }

  // 也提取裸文本行（不在 <p> 标签中但包含 | 的行）
  // 裸文本不被 parseContentHtml 渲染（它只读 <p>/<h3>），因此无需移除，仅用于表格识别
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const bareLines = textOnly.split("\n").map(l => l.trim()).filter(Boolean);
  for (const bl of bareLines) {
    if (!entries.some(e => e.text === bl) && bl.includes("|")) {
      entries.push({ raw: "", text: bl });
    }
  }

  // 在 entries 中查找连续的表格行组
  let buffer: { raw: string; text: string }[] = [];
  const flush = () => {
    if (buffer.length < 2) { buffer = []; return; }
    // 查找分隔行（|---|:---:| 或 ---|:---:|---）
    const sepIdx = buffer.findIndex((e) => {
      return /^[\s\-:|]+$/.test(e.text) && e.text.includes("-") && e.text.includes("|");
    });
    if (sepIdx < 0) { buffer = []; return; }

    const headerRows = buffer.slice(0, sepIdx);
    const dataRows = buffer.slice(sepIdx + 1);
    const allRows = [...headerRows, ...dataRows];
    const parsedRows: string[][] = [];

    for (const e of allRows) {
      const cells = e.text.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) parsedRows.push(cells);
    }

    if (parsedRows.length > 0) {
      // 补齐缺列行：LLM 有时输出 "指标名 | 数值" 遗漏其他列，补空串保持列数一致
      const maxCols = Math.max(...parsedRows.map(r => r.length));
      for (const row of parsedRows) {
        while (row.length < maxCols) row.push("");
      }
      tables.push(parsedRows);
      // 标记被消费的 <p> 源标签，便于从内容中移除，避免"表格文字 + 渲染表格"重复
      for (const e of buffer) {
        if (e.raw) consumedRaw.push(e.raw);
      }
    }
    buffer = [];
  };

  for (const e of entries) {
    // 表格行：以 | 开头 或 包含至少 2 个 |
    const verticalCount = (e.text.match(/\|/g) || []).length;
    if (verticalCount >= 2) {
      buffer.push(e);
    } else if (verticalCount === 1 && buffer.length >= 2) {
      // 1 竖行：可能是缺列的表格数据行（LLM 有时输出 "指标名 | 数值" 遗漏其他列）
      // 仅当 buffer 已有分隔行（处于表格上下文）时纳入，避免误吞普通段落
      const hasSep = buffer.some(b => /^[\s\-:|]+$/.test(b.text) && b.text.includes("-") && b.text.includes("|"));
      if (hasSep) {
        buffer.push(e);
      } else {
        flush();
      }
    } else {
      flush();
    }
  }
  flush();

  // 从原 HTML 中移除已被提取为表格的 <p> 源文本（按字面量移除，避免正则转义问题）
  let cleanedHtml = html;
  for (const raw of consumedRaw) {
    cleanedHtml = cleanedHtml.split(raw).join("");
  }
  return { tables, cleanedHtml };
}

// ── 纯 LLM 编辑章节内容（不走 RAG/检索/评估管道） ──
async function editSectionContent(params: {
  runId: string;
  sectionIdx: number;
  section: OutlineSection;
  originalContent: string;
  editInstruction: string;
  apiKey?: string;
  providerPreference?: string[];
  modelId?: string;
  providerBaseUrls?: Record<string, string>;
}): Promise<{ title: string; content: string; wordCount: number; charCount: number; sources: any[]; webCitations: any[]; groundingScore: number }> {
  const { section, originalContent, editInstruction, apiKey, providerPreference, modelId, providerBaseUrls } = params;
  const { registry } = await import("../providers/registry.js");
  const { getApiKey } = await import("../security/keyStore.js");
  const { readSettingsFromDb } = await import("../lib/settingsReader.js");

  const dbSettings = readSettingsFromDb();
  const defaultProviders = dbSettings.providerPreference?.length ? dbSettings.providerPreference : ["mimo"];
  const providers = providerPreference ?? defaultProviders;

  const providerApiKeys: Record<string, string> = {};
  for (const pid of providers) {
    const key = apiKey ?? getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const systemPrompt = `你是一个文档编辑助手。用户要求对已生成的文档章节进行修改。

【重要规则】
1. 只修改用户要求改动的部分，其他内容保持不变
2. 不要添加称呼语（如"各位同事，你好："）
3. 不要添加总结性或过渡性语言
4. 保持原文的结构、格式和引用标记
5. 直接输出修改后的完整章节内容，不要解释修改了什么`;

  const userPrompt = `修改指令：${editInstruction}

章节标题：${section.title}
${section.description ? `章节主题：${section.description}` : ""}

原文内容：
${originalContent}

请按照修改指令对原文进行修改，输出修改后的完整章节内容。`;

  logger.info(`[EditSection] 开始纯 LLM 编辑: section="${section.title}", instruction="${editInstruction}"`);

  const { response } = await registry.runWithFallback(
    providers,
    {
      modelId: modelId ?? dbSettings.modelId ?? "mimo-v2-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      apiKey: "",
      temperature: 0.3,
      timeoutMs: 90_000,
    },
    undefined, undefined,
    providerApiKeys,
    providerBaseUrls,
  );

  if (response.error) {
    throw new Error(`Edit LLM error: ${response.error.message}`);
  }

  const newContent = response.text.trim();
  logger.info(`[EditSection] 编辑完成: ${newContent.length} chars`);

  // 统计字数
  const wordCount = newContent.replace(/\s+/g, "").length;
  const charCount = newContent.length;

  return {
    title: section.title,
    content: newContent,
    wordCount,
    charCount,
    sources: [],  // 纯编辑不引入新来源
    webCitations: [],
    groundingScore: 0,
  };
}

/** POST /api/generation/:runId/regenerate-section — 重新生成单个章节 */
generationRouter.post("/:runId/regenerate-section", async (req, res) => {
  try {
    const { sectionIdx, section, outline, apiKey, editInstruction, originalContent } = req.body;
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

    // ── 编辑模式：跳过完整生成管道，纯 LLM 编辑 ──
    if (editInstruction != null && originalContent != null) {
      const editResult = await editSectionContent({
        runId: req.params.runId,
        sectionIdx,
        section,
        originalContent,
        editInstruction,
        apiKey,
        providerPreference: req.body.providerPreference,
        modelId: req.body.modelId,
        providerBaseUrls: req.body.providerBaseUrls,
      });

      // ── Phase 3: Downstream 智能触发 ──
      let significanceResult: { significance: string; reason: string; triggers: string[] } | undefined;
      const { analyzeSignificance } = await import("../lib/editImpactAnalyzer.js");
      const impact = await analyzeSignificance(
        originalContent,
        editResult.content,
        editInstruction,
        { apiKey, providerPreference: req.body.providerPreference, modelId: req.body.modelId, providerBaseUrls: req.body.providerBaseUrls },
      );
      significanceResult = { significance: impact.significance, reason: impact.reason, triggers: impact.triggers };
      logger.info(`[Generation] 章节 ${sectionIdx} edit significance=${impact.significance}, triggers=[${impact.triggers.join(",")}]`);

      logger.info(`[Generation] 章节 ${sectionIdx} 重新生成完成`);

      res.json({
        ok: true,
        section: editResult,
        significance: significanceResult,
      });
      return;
    }

    // 用单章节大纲调用 generateDocument（非编辑模式）
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
          sources: newSectionData.sources.map((src) => ({ chunkId: src.chunkId, score: src.score, sourceId: src.sourceId, sourceName: src.sourceName, sourceUrl: src.sourceUrl })),
          webCitations: hasWebCitations ? newSectionData.webCitations : undefined,
        }]);
      }
    } catch (treeErr) {
      logger.warn(`[Generation] 章节生成树更新失败: ${treeErr}`);
    }

    // ── Phase 3: Downstream 智能触发 ──
    let significanceResult: { significance: string; reason: string; triggers: string[] } | undefined;
    if (editInstruction) {
      const { analyzeSignificance } = await import("../lib/editImpactAnalyzer.js");
      const impact = await analyzeSignificance(
        originalContent ?? "",
        newSectionData.content ?? "",
        editInstruction,
        { apiKey, providerPreference: req.body.providerPreference, modelId: req.body.modelId, providerBaseUrls: req.body.providerBaseUrls },
      );
      significanceResult = { significance: impact.significance, reason: impact.reason, triggers: impact.triggers };
      logger.info(`[Generation] 章节 ${sectionIdx} edit significance=${impact.significance}, triggers=[${impact.triggers.join(",")}]`);
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
      significance: significanceResult,
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

    // ── Demo replay mode: return saved evaluation metrics, no external API calls ──
    // 必须在 apiKey 检查之前，demo 模式不需要 apiKey
    if (providerId === "demo" || (req.body.providerPreference?.includes("demo"))) {
      const fixture = CASE_1783257530743;
      const tm = fixture.trustMetrics;
      logger.info(`[Generation] Demo evaluate (non-stream): replaying from case ${fixture.caseId}`);

      const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
      if (!run) {
        res.status(404).json({ ok: false, error: "Run not found" });
        return;
      }

      try {
        const evalId = crypto.randomUUID();
        dbRun(`INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
          [evalId, req.params.id, JSON.stringify({
            faithfulness: tm?.faithfulness ?? 0.5, groundedness: tm?.groundedness ?? 0.5,
            relevance: tm?.relevance ?? 1, completeness: tm?.completeness ?? 1,
            conflictRate: tm?.conflictRate ?? 0, hasConflicts: tm?.hasConflicts ?? false,
            irrelevantSentences: tm?.irrelevantSentences ?? [], coveredPoints: tm?.coveredPoints ?? [],
            missingPoints: tm?.missingPoints ?? [], lackSourcePoints: tm?.lackSourcePoints ?? [],
            conflictItems: tm?.conflictItems ?? [],
          })],
          { table: "trust_evaluations", recordId: evalId, source: "generation" });
      } catch (e) { logger.warn(`[Generation] Demo eval save failed: ${e}`); }

      res.json({
        ok: true, runId: req.params.id,
        metrics: {
          faithfulness: { score: tm?.faithfulness ?? 0.5, label: "事实忠实度", description: "文档内容是否忠实于参考来源" },
          groundedness: { score: tm?.groundedness ?? 0.5, label: "有据可查度", description: "内容是否有来源支撑" },
          relevance: { score: tm?.relevance ?? 1, label: "内容相关度", description: "内容是否与需求相关", irrelevantSentences: tm?.irrelevantSentences ?? [] },
          completeness: { score: tm?.completeness ?? 1, label: "内容完整度", description: "是否覆盖需求的所有要点", coveredPoints: tm?.coveredPoints ?? [], missingPoints: tm?.missingPoints ?? [], lackSourcePoints: tm?.lackSourcePoints ?? [] },
          conflicts: { hasConflicts: tm?.hasConflicts ?? false, conflictRate: tm?.conflictRate ?? 0, items: tm?.conflictItems ?? [], label: "内容冲突", description: "不同来源之间的矛盾信息" },
        },
      });
      return;
    }

    // ── 以下为正常评估流程，需要 apiKey ──

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

    // parseHtmlSections 会把 <table> 和 chartSpecs 从 content 中移除并存储到各自字段
    // 完整度检查需要看到表格和图表内容，否则会误判已覆盖的内容为 missing
    // 但相关度检查只需要叙事文本，表格行和图表数据不是"声明"，不应作为 claim 判定
    const evalSectionsForCompleteness = sectionsWithExtras(sections);
    const evalSectionsForRelevance = sections.map(s => ({ title: s.title, content: s.content }));

    // Bug4 fix: 用 Query Analysis 的内容要点替代原始 requirement
    // 只检查内容要点是否覆盖，不检查格式要求（如"标题区分隔线页码统一风格"）
    const queryAnalysis = getQueryAnalysis();
    const contentRequirement = buildContentRequirement(requirement, queryAnalysis);
    if (queryAnalysis) {
      logger.info(`[Generation] 完整度检查使用 contentPoints (${queryAnalysis.contentPoints.length} 个) 替代原始 requirement`);
    }

    const relevanceResult = await tryWithFallback(
      (model) => checkDocumentRelevance(evalSectionsForRelevance, contentRequirement, apiKey, effectiveProvider, model),
      "内容相关度评估"
    );
    const completenessResult = await tryWithFallback(
      (model) => checkDocumentCompleteness(evalSectionsForCompleteness, contentRequirement, apiKey, effectiveProvider, model),
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
          lackSourcePoints: completenessResult.lackSourcePoints ?? [],
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
          lackSourcePoints: completenessResult.lackSourcePoints,
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

    // ── Demo replay mode: replay saved evaluation metrics, no external API calls ──
    // 必须在 apiKey 检查之前，demo 模式不需要 apiKey
    if (providerId === "demo" || (req.body.providerPreference?.includes("demo"))) {
      const fixture = CASE_1783257530743;
      const tm = fixture.trustMetrics;
      logger.info(`[Generation] Demo evaluate (stream): replaying saved metrics from case ${fixture.caseId}`);
      logger.info(`[Generation] Demo evaluate (stream): trustMetrics=${tm ? JSON.stringify(tm).substring(0, 300) : "NULL"}`);

      const run = dbGet<any>("SELECT * FROM generation_runs WHERE id = ?", [req.params.id]);
      if (!run) {
        writeSSE("error", { ok: false, error: "Run not found" });
        res.end();
        return;
      }

      const sections = run.content ? parseHtmlSections(run.content, run.title) : [];
      writeSSE("evaluate-start", { ok: true, runId: req.params.id, sectionCount: sections.length });

      // Simulate progress for each evaluation task
      writeSSE("evaluate-progress", { task: "relevance", taskIndex: 0, taskLabel: "内容相关度", status: "running" });
      await new Promise(r => setTimeout(r, 500));
      writeSSE("evaluate-progress", { task: "relevance", taskIndex: 0, taskLabel: "内容相关度", status: "done", result: { score: tm?.relevance ?? 1, irrelevantSentences: tm?.irrelevantSentences ?? [] } });

      writeSSE("evaluate-progress", { task: "completeness", taskIndex: 1, taskLabel: "内容完整度", status: "running" });
      await new Promise(r => setTimeout(r, 500));
      writeSSE("evaluate-progress", { task: "completeness", taskIndex: 1, taskLabel: "内容完整度", status: "done", result: { score: tm?.completeness ?? 1, coveredPoints: tm?.coveredPoints ?? [], missingPoints: tm?.missingPoints ?? [], lackSourcePoints: tm?.lackSourcePoints ?? [] } });

      writeSSE("evaluate-progress", { task: "conflicts", taskIndex: 2, taskLabel: "内容冲突检测", status: "running" });
      await new Promise(r => setTimeout(r, 500));
      writeSSE("evaluate-progress", { task: "conflicts", taskIndex: 2, taskLabel: "内容冲突检测", status: "done", result: { hasConflicts: tm?.hasConflicts ?? false, conflictRate: tm?.conflictRate ?? 0, conflicts: tm?.conflictItems ?? [] } });

      // Save evaluation to DB
      try {
        const evalId = crypto.randomUUID();
        dbRun(`INSERT INTO trust_evaluations (id, run_id, metrics, created_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
          [evalId, req.params.id, JSON.stringify({
            faithfulness: tm?.faithfulness ?? 0.5,
            groundedness: tm?.groundedness ?? 0.5,
            relevance: tm?.relevance ?? 1,
            completeness: tm?.completeness ?? 1,
            conflictRate: tm?.conflictRate ?? 0,
            hasConflicts: tm?.hasConflicts ?? false,
            irrelevantSentences: tm?.irrelevantSentences ?? [],
            coveredPoints: tm?.coveredPoints ?? [],
            missingPoints: tm?.missingPoints ?? [],
            lackSourcePoints: tm?.lackSourcePoints ?? [],
            conflictItems: tm?.conflictItems ?? [],
          })],
          { table: "trust_evaluations", recordId: evalId, source: "generation" });
      } catch (e) { logger.warn(`[Generation] Demo eval save failed: ${e}`); }

      writeSSE("evaluate-done", {
        ok: true,
        runId: req.params.id,
        metrics: {
          faithfulness: { score: tm?.faithfulness ?? 0.5, label: "事实忠实度", description: "文档内容是否忠实于参考来源" },
          groundedness: { score: tm?.groundedness ?? 0.5, label: "有据可查度", description: "内容是否有来源支撑" },
          relevance: { score: tm?.relevance ?? 1, label: "内容相关度", description: "内容是否与需求相关", irrelevantSentences: tm?.irrelevantSentences ?? [] },
          completeness: { score: tm?.completeness ?? 1, label: "内容完整度", description: "是否覆盖需求的所有要点", coveredPoints: tm?.coveredPoints ?? [], missingPoints: tm?.missingPoints ?? [], lackSourcePoints: tm?.lackSourcePoints ?? [] },
          conflicts: { hasConflicts: tm?.hasConflicts ?? false, conflictRate: tm?.conflictRate ?? 0, items: tm?.conflictItems ?? [], label: "内容冲突", description: "不同来源之间的矛盾信息" },
        },
      });
      res.end();
      logger.info(`[Generation] Demo evaluate (stream) done`);
      return;
    }

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
    // 相关度检查只需要叙事文本；完整度检查需要表格和图表内容
    const evalSectionsForRelevance = sections.map(s => ({ title: s.title, content: s.content }));
    const evalSectionsForCompleteness = sectionsWithExtras(sections);

    // Bug4 fix: 用 Query Analysis 的内容要点替代原始 requirement
    const queryAnalysis = getQueryAnalysis();
    const contentRequirement = buildContentRequirement(requirement, queryAnalysis);
    if (queryAnalysis) {
      logger.info(`[Generation] 流式评估使用 contentPoints (${queryAnalysis.contentPoints.length} 个) 替代原始 requirement`);
    }

    const relevanceResult = await tryWithFallback(
      (model) => checkDocumentRelevance(evalSectionsForRelevance, contentRequirement, apiKey, effectiveProvider, model),
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
      (model) => checkDocumentCompleteness(evalSectionsForCompleteness, contentRequirement, apiKey, effectiveProvider, model),
      "内容完整度评估"
    );
    writeSSE("evaluate-progress", {
      task: "completeness", taskIndex: 1, taskLabel: "内容完整度", status: "done",
      score: completenessResult.score,
      coveredPoints: completenessResult.coveredPoints,
      missingPoints: completenessResult.missingPoints,
      lackSourcePoints: completenessResult.lackSourcePoints,
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
          lackSourcePoints: completenessResult.lackSourcePoints ?? [],
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
        completeness: { score: completenessResult.score, label: "内容完整度", description: "是否覆盖需求的所有要点", coveredPoints: completenessResult.coveredPoints, missingPoints: completenessResult.missingPoints, lackSourcePoints: completenessResult.lackSourcePoints },
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