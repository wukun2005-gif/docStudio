/**
 * e2e-tunnel-test.mjs — 完整端到端测试
 *
 * 通过 tunnel URL（模拟 Excel Online 环境）测试 SSE 流：
 * 1. POST /api/generation/generate/excel-stream
 * 2. 验证 SSE 事件序列：start → section-start → section → done
 * 3. 验证每个事件 JSON 中 type/chapter 字段
 * 4. 验证 done event 中的 excelPayload
 * 5. 用 excelPayload 生成真实 Excel 文件
 */
import { writeFileSync, statSync, existsSync } from "fs";
import { resolve } from "path";

// tunnel URL — 这就是 Excel Online 中 task pane 访问的地址
const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("=== 端到端测试：通过 tunnel URL ===");
  console.log(`URL: ${TUNNEL_URL}\n`);

  // ── 步骤 0: health check ──
  console.log("[0] Health check...");
  const healthResp = await fetch(`${TUNNEL_URL}/api/health`);
  if (!healthResp.ok) {
    console.error(`FAIL: health check HTTP ${healthResp.status}`);
    process.exit(1);
  }
  console.log(`PASS: health check OK\n`);

  // ── 步骤 1: 发起 SSE 请求 ──
  console.log("[1] 发起 excel-stream 请求...");
  const payload = {
    title: "Nexora Tech 项目周报",
    userRequest: "帮我生成一份 Nexora Tech 2026年6月第4周项目综合汇报 Excel 文件",
    outline: [
      { title: "Sheet 1 - 本周项目进度看板", description: "项目进度表、图表、风险项", children: [] },
      { title: "Sheet 2 - Bug 质量分析", description: "Bug 明细、图表、修复周期", children: [] },
      { title: "Sheet 3 - 团队协作与沟通分析", description: "协作矩阵、图表、决策摘要", children: [] },
    ],
    format: "excel",
    providerPreference: ["demo"],
  };

  const resp = await fetch(`${TUNNEL_URL}/api/generation/generate/excel-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // 验证 Content-Type
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    console.error(`FAIL: Content-Type = ${ct}, 期望 text/event-stream`);
    const body = await resp.text();
    console.error(`Body: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`PASS: Content-Type = ${ct}`);

  if (!resp.ok) {
    console.error(`FAIL: HTTP ${resp.status}`);
    process.exit(1);
  }
  console.log(`PASS: HTTP ${resp.status}\n`);

  // ── 步骤 2: 消费 SSE 流 ──
  console.log("[2] 消费 SSE 流...");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  const events = [];
  const startTime = Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          events.push({ event: currentEvent, data });
        } catch (e) {
          console.error(`JSON 解析失败 [${currentEvent}]: ${line.slice(6).slice(0, 200)}`);
        }
        currentEvent = null;
      }
    }
  }

  const elapsed = Date.now() - startTime;
  const eventTypes = events.map((e) => e.event);
  console.log(`PASS: SSE 流完成, 耗时 ${elapsed}ms, ${events.length} 个事件`);
  console.log(`事件类型: ${eventTypes.join(", ")}\n`);

  // ── 步骤 3: 验证事件字段 ──
  console.log("[3] 验证事件字段...");
  let passed = 0;
  let failed = 0;

  // start 事件
  const startEvent = events.find((e) => e.event === "start");
  if (startEvent) { console.log("  PASS: start 事件存在"); passed++; }
  else { console.error("  FAIL: 缺少 start 事件"); failed++; }

  // section-start 事件
  const sectionStarts = events.filter((e) => e.event === "section-start");
  if (sectionStarts.length >= 3) { console.log(`  PASS: ${sectionStarts.length} 个 section-start`); passed++; }
  else { console.error(`  FAIL: section-start = ${sectionStarts.length}, 期望 >= 3`); failed++; }

  // 验证 section-start 有 type 和 chapter
  let allSectionStartOk = true;
  for (const ss of sectionStarts) {
    if (!ss.data.type) { console.error(`  FAIL: section-start 缺少 type 字段: ${JSON.stringify(ss.data).slice(0, 100)}`); allSectionStartOk = false; }
    if (!ss.data.chapter) { console.error(`  FAIL: section-start 缺少 chapter 字段: ${JSON.stringify(ss.data).slice(0, 100)}`); allSectionStartOk = false; }
  }
  if (allSectionStartOk && sectionStarts.length > 0) { console.log("  PASS: 所有 section-start 含 type + chapter"); passed++; }
  else failed++;

  // section 事件
  const sections = events.filter((e) => e.event === "section");
  if (sections.length >= 3) { console.log(`  PASS: ${sections.length} 个 section`); passed++; }
  else { console.error(`  FAIL: section = ${sections.length}, 期望 >= 3`); failed++; }

  // 验证 section 有 type 和 chapter
  let allSectionOk = true;
  for (const s of sections) {
    if (!s.data.type) { console.error(`  FAIL: section 缺少 type 字段`); allSectionOk = false; }
    if (!s.data.chapter) { console.error(`  FAIL: section 缺少 chapter 字段`); allSectionOk = false; }
    if (!s.data.section?.content) { console.error(`  FAIL: section 缺少 section.content`); allSectionOk = false; }
  }
  if (allSectionOk && sections.length > 0) { console.log("  PASS: 所有 section 含 type + chapter + content"); passed++; }
  else failed++;

  // done 事件
  const doneEvent = events.find((e) => e.event === "done");
  if (!doneEvent) {
    console.error("  FAIL: 缺少 done 事件");
    failed++;
    console.error("\n=== 测试失败：缺少 done 事件 ===");
    process.exit(1);
  }
  console.log("  PASS: done 事件存在"); passed++;

  // 验证 done 事件 type 字段
  if (doneEvent.data.type === "done") { console.log("  PASS: done.type = 'done'"); passed++; }
  else { console.error(`  FAIL: done.type = '${doneEvent.data.type}', 期望 'done'`); failed++; }

  // ── 步骤 4: 验证 excelPayload ──
  console.log("\n[4] 验证 excelPayload...");
  const ep = doneEvent.data.excelPayload;
  if (!ep) {
    console.error("  FAIL: done 事件缺少 excelPayload");
    failed++;
    process.exit(1);
  }

  if (ep.sheets && ep.sheets.length > 0) {
    console.log(`  PASS: ${ep.sheets.length} 个 sheets`); passed++;
    for (const s of ep.sheets) {
      const paraCount = s.paragraphs?.length ?? 0;
      const tableCount = s.tables?.length ?? 0;
      console.log(`    - "${s.name}": ${paraCount} paragraphs, ${tableCount} tables`);
      if (paraCount === 0 && tableCount === 0) {
        console.error(`  FAIL: sheet "${s.name}" 没有任何内容`);
        failed++;
      }
    }
  } else {
    console.error("  FAIL: excelPayload.sheets 为空");
    failed++;
  }

  if (doneEvent.data.runId) { console.log(`  PASS: runId = ${doneEvent.data.runId}`); passed++; }
  else { console.error("  FAIL: 缺少 runId"); failed++; }

  if (doneEvent.data.title) { console.log(`  PASS: title = "${doneEvent.data.title}"`); passed++; }
  else { console.error("  FAIL: 缺少 title"); failed++; }

  console.log(`\n=== 字段验证: ${passed} passed, ${failed} failed ===\n`);

  // ── 步骤 5: 生成 Excel 文件 ──
  console.log("[5] 生成 Excel 文件...");
  const ExcelJSMod = await import("exceljs");
  const ExcelJS = ExcelJSMod.default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "i-Write";
  wb.created = new Date();

  for (const sheetData of ep.sheets) {
    const ws = wb.addWorksheet(sheetData.name);
    let rowIdx = 1;

    // paragraphs
    for (const para of sheetData.paragraphs ?? []) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = para.text ?? "";
      if (para.style === "heading1") row.getCell(1).font = { bold: true, size: 16 };
      else if (para.style === "heading2") row.getCell(1).font = { bold: true, size: 13 };
      else if (para.style === "bullet") row.getCell(1).value = `• ${para.text}`;
      else if (para.style === "citation") row.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
      rowIdx++;
    }

    // tables
    for (const table of sheetData.tables ?? []) {
      rowIdx++;
      if (table.title) {
        const titleRow = ws.getRow(rowIdx++);
        titleRow.getCell(1).value = table.title;
        titleRow.getCell(1).font = { bold: true, size: 12 };
      }
      const headerRow = ws.getRow(rowIdx++);
      (table.headers ?? []).forEach((h, i) => {
        headerRow.getCell(i + 1).value = h;
        headerRow.getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
      });
      for (const r of table.rows ?? []) {
        const dataRow = ws.getRow(rowIdx++);
        r.forEach((cell, i) => { dataRow.getCell(i + 1).value = cell; });
      }
    }

    for (let i = 1; i <= 5; i++) ws.getColumn(i).width = 20;
  }

  const outputPath = resolve("/Users/wukun/Documents/tmp/docStudio/e2e-tunnel-proof.xlsx");
  await wb.xlsx.writeFile(outputPath);

  // 验证文件
  const stats = statSync(outputPath);
  console.log(`PASS: Excel 文件已生成: ${outputPath}`);
  console.log(`  大小: ${stats.size} bytes`);

  // 读回验证内容
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(outputPath);
  let totalRows = 0;
  for (const ws of wb2.worksheets) {
    totalRows += ws.rowCount;
    console.log(`  Sheet "${ws.name}": ${ws.rowCount} 行`);
    // 打印前 3 行
    for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
      const row = ws2GetRow(ws, r);
      console.log(`    Row ${r}: ${row.join(" | ")}`);
    }
  }
  console.log(`  总行数: ${totalRows}`);

  if (totalRows === 0) {
    console.error("FAIL: Excel 文件没有任何内容！");
    process.exit(1);
  }

  console.log(`\n=== 最终结果: ${passed + (totalRows > 0 ? 1 : 0)}/${passed + failed + 1} 通过 ===`);
  if (failed > 0 || totalRows === 0) {
    console.error("存在失败项！");
    process.exit(1);
  }

  console.log("\n✅ 全部通过，Excel 文件有内容。");
}

function ws2GetRow(ws, r) {
  const row = ws.getRow(r);
  const vals = [];
  for (let c = 1; c <= 3; c++) {
    const v = row.getCell(c).value;
    vals.push(v ? String(v).slice(0, 50) : "");
  }
  return vals;
}

main().catch((e) => {
  console.error("错误:", e.message);
  console.error(e.stack);
  process.exit(1);
});
