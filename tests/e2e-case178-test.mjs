/**
 * e2e-case178-test.mjs — 验证 case 1782966166476 真实数据的完整数据通路
 * 检查表格和图表是否都正确
 */
const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("=== Case 1782966166476 数据验证 ===\n");

  // 1. POST 触发生成
  console.log("[1] POST /api/generation/excel ...");
  const postResp = await fetch(`${TUNNEL_URL}/api/generation/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Nexora Tech项目综合汇报",
      userRequest: "测试",
      outline: [
        { title: "Sheet 1 - 本周项目进度看板", description: "", children: [] },
        { title: "Sheet 2 - Bug 质量分析", description: "", children: [] },
        { title: "Sheet 3 - 团队协作与沟通分析", description: "", children: [] },
      ],
      format: "excel",
    }),
  });

  if (!postResp.ok) {
    console.error(`POST failed: ${postResp.status}: ${await postResp.text()}`);
    process.exit(1);
  }
  const { runId } = await postResp.json();
  console.log(`runId=${runId}\n`);

  // 2. 轮询
  let pollCount = 0;
  let finalData = null;
  while (!finalData) {
    pollCount++;
    const r = await fetch(`${TUNNEL_URL}/api/generation/status/${runId}`);
    const d = await r.json();
    if (d.status === "done") { finalData = d; console.log(`poll #${pollCount}: done`); }
    else if (d.status === "error") { console.error(`error: ${d.error}`); process.exit(1); }
    else { console.log(`poll #${pollCount}: generating...`); await new Promise(r => setTimeout(r, 500)); }
  }

  // 3. 验证 excelPayload
  const ep = finalData.excelPayload;
  console.log(`\nSheets: ${ep.sheets.length}`);

  let totalTables = 0, totalCharts = 0, totalParagraphs = 0;
  for (const sheet of ep.sheets) {
    const p = sheet.paragraphs?.length ?? 0;
    const t = sheet.tables?.length ?? 0;
    const c = sheet.charts?.length ?? 0;
    totalParagraphs += p; totalTables += t; totalCharts += c;
    console.log(`\n  "${sheet.name}": ${p} paragraphs, ${t} tables, ${c} charts`);

    for (const table of sheet.tables ?? []) {
      console.log(`    table: headers=[${table.headers?.join(", ")}] rows=${table.rows?.length}`);
      for (const row of (table.rows ?? []).slice(0, 2)) {
        console.log(`      ${row.join(" | ")}`);
      }
      if ((table.rows?.length ?? 0) > 2) console.log(`      ... +${(table.rows?.length ?? 0) - 2} more`);
    }

    for (const chart of sheet.charts ?? []) {
      console.log(`    chart: type=${chart.type} title="${chart.title}"`);
      console.log(`      categories=[${chart.categories?.join(", ")}]`);
      for (const s of chart.series ?? []) {
        console.log(`      series "${s.name}": [${(s.values ?? s.data ?? []).join(", ")}]`);
      }
    }
  }

  console.log(`\n=== 总计: ${ep.sheets.length} sheets, ${totalParagraphs} paragraphs, ${totalTables} tables, ${totalCharts} charts ===`);

  // 4. 生成 Excel 文件
  const ExcelJSMod = await import("exceljs");
  const ExcelJS = ExcelJSMod.default;
  const wb = new ExcelJS.Workbook();
  for (const sheetData of ep.sheets) {
    const ws = wb.addWorksheet(sheetData.name);
    let rowIdx = 1;
    for (const para of sheetData.paragraphs ?? []) {
      const row = ws.getRow(rowIdx++);
      row.getCell(1).value = para.text ?? "";
      if (para.style === "heading1" || para.style === "heading2") row.getCell(1).font = { bold: true };
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
    for (let i = 1; i <= 8; i++) ws.getColumn(i).width = 20;
  }
  const outputPath = "/Users/wukun/Documents/tmp/docStudio/case178-test-output.xlsx";
  await wb.xlsx.writeFile(outputPath);
  const { statSync } = await import("fs");
  console.log(`\nExcel: ${outputPath} (${statSync(outputPath).size} bytes)`);

  // 期望：3 sheets, 5 tables, 6 charts
  if (ep.sheets.length === 3 && totalTables === 5 && totalCharts === 6) {
    console.log("\n✅ 验证通过：3 sheets, 5 tables, 6 charts");
  } else {
    console.log(`\n⚠️ 期望 3 sheets/5 tables/6 charts，实际 ${ep.sheets.length}/${totalTables}/${totalCharts}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
