/**
 * e2e-stub-test.mjs — 通过 tunnel URL 测试 stub 模式（无外部 API）
 * 验证完整数据通路：server stub → SSE → excelPayload → 表格数据
 */
const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("=== Stub 模式端到端测试 ===\n");

  const payload = {
    title: "Nexora Tech 项目周报",
    userRequest: "测试 stub 模式",
    outline: [
      { title: "Sheet 1 - 本周项目进度看板", description: "", children: [] },
      { title: "Sheet 2 - Bug 质量分析", description: "", children: [] },
      { title: "Sheet 3 - 团队协作与沟通分析", description: "", children: [] },
    ],
    format: "excel",
    // 不传 providerPreference — 默认走 stub
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

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  const events = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
      else if (line.startsWith("data: ") && currentEvent) {
        try { events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) }); } catch {}
        currentEvent = null;
      }
    }
  }

  console.log(`收到 ${events.length} 个事件\n`);

  const doneEvent = events.find(e => e.event === "done");
  if (!doneEvent) { console.error("缺少 done 事件"); process.exit(1); }

  const ep = doneEvent.data.excelPayload;
  console.log(`Sheets: ${ep.sheets.length}\n`);

  for (const sheet of ep.sheets) {
    const paraCount = sheet.paragraphs?.length ?? 0;
    const tableCount = sheet.tables?.length ?? 0;
    const chartCount = sheet.charts?.length ?? 0;
    console.log(`Sheet: "${sheet.name}"`);
    console.log(`  paragraphs: ${paraCount}, tables: ${tableCount}, charts: ${chartCount}`);
    
    if (sheet.tables) {
      for (const t of sheet.tables) {
        console.log(`  table: headers=[${t.headers?.join(", ")}] rows=${t.rows?.length}`);
        if (t.rows) {
          for (const r of t.rows.slice(0, 2)) console.log(`    ${r.join(" | ")}`);
          if (t.rows.length > 2) console.log(`    ... +${t.rows.length - 2} more`);
        }
      }
    }
    console.log();
  }

  // 用 exceljs 生成文件验证
  const ExcelJSMod = await import("exceljs");
  const ExcelJS = ExcelJSMod.default;
  const wb = new ExcelJS.Workbook();
  for (const sheetData of ep.sheets) {
    const ws = wb.addWorksheet(sheetData.name);
    let rowIdx = 1;
    for (const para of sheetData.paragraphs ?? []) {
      ws.getRow(rowIdx++).getCell(1).value = para.text ?? "";
    }
    for (const table of sheetData.tables ?? []) {
      rowIdx++;
      const hr = ws.getRow(rowIdx++);
      (table.headers ?? []).forEach((h, i) => hr.getCell(i + 1).value = h);
      for (const r of table.rows ?? []) {
        const dr = ws.getRow(rowIdx++);
        r.forEach((c, i) => dr.getCell(i + 1).value = c);
      }
    }
  }
  const outputPath = "/Users/wukun/Documents/tmp/docStudio/stub-test-output.xlsx";
  await wb.xlsx.writeFile(outputPath);
  const { statSync } = await import("fs");
  console.log(`Excel 文件: ${outputPath} (${statSync(outputPath).size} bytes)\n`);

  const totalTables = ep.sheets.reduce((s, sh) => s + (sh.tables?.length ?? 0), 0);
  console.log(`总计: ${ep.sheets.length} sheets, ${totalTables} tables`);
  
  if (ep.sheets.length === 3 && totalTables >= 5) {
    console.log("\n✅ Stub 数据通路验证通过");
  } else {
    console.log("\n❌ 数据不完整");
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
