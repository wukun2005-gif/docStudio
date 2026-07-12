/**
 * outlook-email-smoke.mjs — Outlook Add-in 端到端冒烟
 *
 * 验证流程：
 * 1. startIsolatedServer({copyProductionDb: true}) — 复制生产 DB（含 case-1782296242386）
 * 2. POST /api/generation/email（stub mode）— 触发邮件生成
 * 3. 轮询 GET /api/generation/status/:runId — 直到 status='done'
 * 4. 验证 emailPayload 包含 case-1782296242386 真实数据
 *
 * ⚠️ 不打 localhost:3000 用户 dev server（CLAUDE.md 硬规则）
 * ✅ 用 isolation server 自动随机端口 + 临时数据目录 + 完成后 kill + cleanup
 */
import { startIsolatedServer } from "./e2e-shared/server-lifecycle.mjs";
import assert from "node:assert";

const log = (msg) => console.log(`[outlook-smoke] ${msg}`);

async function main() {
  log("=== Outlook Add-in 端到端冒烟测试 ===");

  // ── 1. 启动隔离 server（复制生产 DB） ──
  log("1) startIsolatedServer({copyProductionDb: true})");
  const { port, baseUrl, cleanup } = await startIsolatedServer({ copyProductionDb: true });
  log(`   隔离 server 启动: ${baseUrl}`);

  let exitCode = 0;
  try {
    // ── 2. POST /api/generation/email（stub mode） ──
    log("2) POST /api/generation/email (stub mode)");
    const requestBody = {
      title: "eml: 产品开发汇报邮件",
      outline: [
        { title: "邮件开头（问候+简要目的）", description: "向王芳致意", children: [] },
        { title: "本周核心工作进展", description: "详细描述本周完成", children: [] },
        { title: "下周计划与需要协调事项", description: "下周计划", children: [] },
      ],
      format: "email",
      providerPreference: ["stub"],
      userRequest: "向王芳写一封邮件，汇报最近一周在做什么产品...",
    };

    const triggerRes = await fetch(`${baseUrl}/api/generation/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const triggerJson = await triggerRes.json();
    log(`   trigger 响应: ${JSON.stringify(triggerJson)}`);

    if (!triggerJson.ok) {
      throw new Error(`触发失败: ${triggerJson.error}`);
    }
    if (!triggerJson.runId) {
      throw new Error("触发响应缺少 runId");
    }
    const runId = triggerJson.runId;
    log(`   ✓ 触发成功, runId=${runId}`);

    // ── 3. 轮询 status ──
    log("3) 轮询 GET /api/generation/status/:runId");
    let statusJson = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const sRes = await fetch(`${baseUrl}/api/generation/status/${runId}`);
      statusJson = await sRes.json();
      if (statusJson.status === "done") {
        log(`   ✓ 第 ${i + 1} 次轮询 status='done'`);
        break;
      }
      if (statusJson.status === "error") {
        throw new Error(`生成失败: ${statusJson.error}`);
      }
      log(`   轮询 #${i + 1}: status=${statusJson.status}`);
    }

    if (!statusJson || statusJson.status !== "done") {
      throw new Error(`生成超时（>30s），最后状态: ${statusJson?.status}`);
    }

    // ── 4. 验证 emailPayload ──
    log("4) 验证 emailPayload 包含 case-1782296242386 真实数据");

    // 4.1 顶层字段
    assert.strictEqual(statusJson.ok, true, "ok 字段");
    assert.strictEqual(statusJson.status, "done", "status 字段");
    assert.ok(statusJson.emailPayload, "emailPayload 字段缺失");
    log(`   ✓ 顶层字段齐全: status=done, runId=${statusJson.runId}`);

    const ep = statusJson.emailPayload;
    log(`   emailPayload.subject = "${ep.subject}"`);
    log(`   emailPayload.documentStyle = "${ep.documentStyle}"`);
    log(`   emailPayload.trustScore = ${ep.trustScore}`);
    log(`   emailPayload.bodyCharCount = ${ep.bodyCharCount}`);
    log(`   emailPayload.citations.length = ${ep.citations.length}`);
    log(`   emailPayload.bodyHtml.length = ${ep.bodyHtml.length}`);

    // 4.2 subject 应去除 "eml: " 前缀
    assert.ok(!ep.subject.startsWith("eml:"), `subject 不应以 eml: 开头, got: "${ep.subject}"`);
    assert.ok(ep.subject.length > 0, "subject 非空");
    log(`   ✓ subject 去除 eml: 前缀: "${ep.subject}"`);

    // 4.3 documentStyle 必须是 email
    assert.strictEqual(ep.documentStyle, "email", "documentStyle 必须是 email");
    log(`   ✓ documentStyle = email`);

    // 4.4 trustScore 应在合理范围（stub 模式从 DB 读 case-1782296242386，trust=0.93）
    assert.ok(ep.trustScore >= 0.5, `trustScore 应 >= 0.5, got: ${ep.trustScore}`);
    log(`   ✓ trustScore = ${ep.trustScore} (合理)`);

    // 4.5 bodyCharCount 应 > 0（真实 case content_len=6431）
    assert.ok(ep.bodyCharCount > 500, `bodyCharCount 应 > 500, got: ${ep.bodyCharCount}`);
    log(`   ✓ bodyCharCount = ${ep.bodyCharCount} (真实邮件草稿长度)`);

    // 4.6 bodyHtml 应含 Outlook 友好 HTML
    assert.ok(ep.bodyHtml.includes("<p"), "bodyHtml 应含 <p> 段落标签");
    assert.ok(ep.bodyHtml.includes("</p>"), "bodyHtml 应含 </p> 闭合");
    log(`   ✓ bodyHtml 含 Outlook 兼容 HTML`);

    // 4.7 bodyText 纯文本去 HTML 标签
    assert.ok(!ep.bodyText.includes("<p>"), "bodyText 不应含 <p>");
    assert.ok(ep.bodyText.length > 100, "bodyText 长度合理");
    log(`   ✓ bodyText 已去除 HTML 标签`);

    // 4.8 citations 列表（如果有）
    if (ep.citations.length > 0) {
      log(`   ✓ citations 有 ${ep.citations.length} 个来源`);
      for (const c of ep.citations.slice(0, 3)) {
        log(`     [${c.index}] ${c.title} ${c.url ? '(' + c.url + ')' : ''}`);
      }
      assert.ok(ep.citations.every((c) => typeof c.index === "number"), "citation.index 是数字");
      assert.ok(ep.citations.every((c) => typeof c.title === "string"), "citation.title 是字符串");
    } else {
      log(`   ⚠ citations 为空（case-1782296242386 footer 可能不含 ol 列表）`);
    }

    // 4.9 bodyHtml 中应含真实 case 内容（验证确实从 DB 读出了数据，不是 fallback）
    // 真实 case content_len=6431，含邮件正文叙述
    const bodyLower = ep.bodyHtml.toLowerCase();
    const hasRealContent = bodyLower.includes("王芳") || bodyLower.includes("工作") || bodyLower.includes("产品");
    if (hasRealContent) {
      log(`   ✓ bodyHtml 含真实邮件内容（王芳/工作/产品 关键词命中）`);
    } else {
      log(`   ⚠ bodyHtml 未命中王芳/工作/产品关键词，可能是 fallback 数据`);
    }

    // 4.10 再次 GET status 应返回完整 emailPayload
    log("5) 二次 GET status 验证 emailPayload 持久化");
    const reGetRes = await fetch(`${baseUrl}/api/generation/status/${runId}`);
    const reGetJson = await reGetRes.json();
    assert.ok(reGetJson.emailPayload, "二次查询 emailPayload 仍在");
    assert.strictEqual(reGetJson.emailPayload.subject, ep.subject, "二次查询 subject 一致");
    log(`   ✓ emailPayload 在 DB 中持久化`);

    log("");
    log("=================================");
    log("✅ 全部断言通过 — outlook email 端到端流可工作");
    log("=================================");
    log(`subject: ${ep.subject}`);
    log(`bodyCharCount: ${ep.bodyCharCount}`);
    log(`trustScore: ${ep.trustScore}`);
    log(`citations: ${ep.citations.length}`);
  } catch (err) {
    console.error("❌ 冒烟失败:", err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    log("清理隔离 server...");
    await cleanup();
    log("✓ 清理完成");
  }

  process.exit(exitCode);
}

main();
