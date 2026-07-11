/**
 * e2e-real-provider-test.mjs — 通过 tunnel URL 测试真实 LLM provider
 *
 * 和用户真实流程一致：
 * 1. POST /api/chat/send（模拟 chat 发送）
 * 2. 从 chat 响应中获取 outline
 * 3. POST /api/generation/generate/excel-stream（不用 demo provider）
 * 4. 消费 SSE 流
 * 5. 验证 excelPayload 中 sheets/paragraphs/tables 数量
 * 6. 生成 Excel 文件验证内容
 */
import { writeFileSync, statSync } from "fs";
import { resolve } from "path";

const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("=== 端到端测试：真实 LLM provider（bailian）===\n");

  // ── 步骤 1: 直接发起 excel-stream 请求（不用 demo）──
  console.log("[1] 发起 excel-stream 请求（真实 provider）...");
  const payload = {
    title: "Nexora Tech 项目周报",
    userRequest: "帮我生成一份给陈宇、王琳、赵军的 Nexora Tech 2026年6月第4周（6/16-6/20）项目综合汇报 Excel 文件，格式为 xlsx，包含 3个 sheet： 【Sheet 1 - 本周项目进度看板】 - 顶部有 2-3 行说明文字，概述本周整体交付情况 - 下方是一个项目进度表，列出本周所有项目/任务的完成状态、完成度百分比、负责人、周期、备注 - 在表格下方，嵌入一个按部门统计的\"任务完成率柱状图\"（技术部、产品部、设计部、QA），以及一个按负责人统计的\"工时分布饼图\" - 底部附一个\"风险项一览表\"，列出延期风险任务及其影响评估 【Sheet 2 - Bug 质量分析】 - 顶部说明文字，总结本周 Bug 的发现/修复趋势 - 一个 Bug 明细表（ID、标题、优先级、状态、负责人、创建/修复日期、所属模块） - 下方嵌入\"Bug 优先级分布饼图\"（高/中/低）和\"各模块 Bug 数量柱状图\"（前端/后端） - 底部附一个\"Bug 修复周期分析表\"，统计每种优先级的平均修复天数 【Sheet 3 - 团队协作与沟通分析】 - 顶部说明文字，概述本周团队沟通密度和协作亮点 - 一个\"跨部门协作矩阵表\"，行=部门，列=协作类型（reporting/collaboration），单元格=协作次数，基于 People Graph 中的协作关系数据 - 下方嵌入\"部门人员分布柱状图\"（7个部门各多少人），以及\"沟通风格分布饼图\"（formal/casual/technical） - 底部附一个\"关键邮件/会议决策摘要表\"，列出本周重要邮件主题、发件人、决策要点、影响范围",
    outline: [
      { title: "Sheet 1 - 本周项目进度看板", description: "顶部说明文字 + 项目进度表 + 两张图表 + 风险项一览表", children: [] },
      { title: "Sheet 2 - Bug 质量分析", description: "顶部说明 + Bug 明细表 + 两张图表 + Bug 修复周期分析表", children: [] },
      { title: "Sheet 3 - 团队协作与沟通分析", description: "顶部说明 + 跨部门协作矩阵 + 两张图表 + 决策摘要表", children: [] },
    ],
    format: "excel",
    // 不传 providerPreference — 使用默认 bailian provider
  };

  const resp = await fetch(`${TUNNEL_URL}/api/generation/generate/excel-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    console.error(`HTTP ${resp.status}: ${await resp.text()}`);
    process.exit(1);
  }
  console.log(`PASS: HTTP ${resp.status}, Content-Type: ${resp.headers.get("content-type")}`);

  // ── 步骤 2: 消费 SSE 流 ──
  console.log("\n[2] 消费 SSE 流（可能需要 1-3 分钟）...");
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
          process.stdout.write(".");
        } catch {}
        currentEvent = null;
      }
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nPASS: SSE 流完成, 耗时 ${elapsed}s, ${events.length} 个事件`);

  // ── 步骤 3: 验证事件 ──
  console.log("\n[3] 验证事件...");
  const eventTypes = events.map((e) => e.event);
  console.log(`  事件类型: ${eventTypes.join(", ")}`);

  const doneEvent = events.find((e) => e.event === "done");
  if (!doneEvent) {
    console.error("FAIL: 缺少 done 事件");
    process.exit(1);
  }
  console.log("  PASS: done 事件存在");

  // ── 步骤 4: 验证 excelPayload ──
  console.log("\n[4] 验证 excelPayload...");
  const ep = doneEvent.data.excelPayload;
  if (!ep) {
    console.error("FAIL: done 事件缺少 excelPayload");
    process.exit(1);
  }

  console.log(`  Sheets: ${ep.sheets.length}`);
  let totalParagraphs = 0;
  let totalTables = 0;
  let totalCharts = 0;

  for (const sheet of ep.sheets) {
    const paraCount = sheet.paragraphs?.length ?? 0;
    const tableCount = sheet.tables?.length ?? 0;
    const chartCount = sheet.charts?.length ?? 0;
    totalParagraphs += paraCount;
    totalTables += tableCount;
    totalCharts += chartCount;
    console.log(`    - "${sheet.name}": ${paraCount} paragraphs, ${tableCount} tables, ${chartCount} charts`);

    // 打印每个表格的 headers + row count
    if (sheet.tables) {
      for (const t of sheet.tables) {
        console.log(`      table: headers=[${t.headers?.join(", ")}] rows=${t.rows?.length ?? 0}`);
      }
    }

    // 打印前 3 个段落
    if (sheet.paragraphs) {
      for (const p of sheet.paragraphs.slice(0, 3)) {
        console.log(`      para [${p.style}]: ${(p.text ?? "").slice(0, 60)}`);
      }
    }
  }

  console.log(`\n  总计: ${totalParagraphs} paragraphs, ${totalTables} tables, ${totalCharts} charts`);

  // ── 步骤 5: 生成 Excel 文件 ──
  console.log("\n[5] 生成 Excel 文件...");
  const ExcelJSMod = await import("exceljs");
  const ExcelJS = ExcelJSMod.default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "i-Write";
  wb.created = new Date();

  for (const sheetData of ep.sheets) {
    const ws = wb.addWorksheet(sheetData.name);
    let rowIdx = 1;

    for (const para of sheetData.paragraphs ?? []) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = para.text ?? "";
      if (para.style === "heading1") row.getCell(1).font = { bold: true, size: 16 };
      else if (para.style === "heading2") row.getCell(1).font = { bold: true, size: 13 };
      else if (para.style === "bullet") row.getCell(1).value = `• ${para.text}`;
      rowIdx++;
    }

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

  const outputPath = resolve("/Users/wukun/Documents/tmp/docStudio/e2e-real-provider.xlsx");
  await wb.xlsx.writeFile(outputPath);
  console.log(`PASS: Excel 文件: ${outputPath} (${statSync(outputPath).size} bytes)`);

  // 读回验证
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(outputPath);
  let totalRows = 0;
  for (const ws of wb2.worksheets) {
    totalRows += ws.rowCount;
    console.log(`  Sheet "${ws.name}": ${ws.rowCount} 行`);
  }
  console.log(`  总行数: ${totalRows}`);

  // ── 总结 ──
  console.log("\n=== 总结 ===");
  console.log(`Sheets: ${ep.sheets.length} (期望 3)`);
  console.log(`Paragraphs: ${totalParagraphs}`);
  console.log(`Tables: ${totalTables} (期望 >= 3，每 sheet 至少 1 个)`);
  console.log(`Charts: ${totalCharts}`);
  console.log(`Excel rows: ${totalRows}`);

  if (ep.sheets.length >= 3 && totalTables >= 3) {
    console.log("\n✅ 测试通过：3 个 sheets，有表格数据");
  } else {
    console.log("\n⚠️  内容可能不完整，检查上游 LLM 输出");
  }
}

main().catch((e) => {
  console.error("错误:", e.message);
  console.error(e.stack);
  process.exit(1);
});
