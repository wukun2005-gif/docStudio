/**
 * e2e-polling-test.mjs — 验证 POST 触发 + GET 轮询方案
 * 通过 tunnel URL 测试，模拟 Excel Add-in 真实环境
 */
const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("=== POST 触发 + GET 轮询方案验证 ===\n");

  // 1. POST 触发生成
  console.log("[1] POST /api/generation/excel ...");
  const postResp = await fetch(`${TUNNEL_URL}/api/generation/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Nexora Tech 项目周报",
      userRequest: "测试 stub 模式",
      outline: [
        { title: "Sheet 1 - 本周项目进度看板", description: "", children: [] },
        { title: "Sheet 2 - Bug 质量分析", description: "", children: [] },
        { title: "Sheet 3 - 团队协作与沟通分析", description: "", children: [] },
      ],
      format: "excel",
    }),
  });

  if (!postResp.ok) {
    console.error(`POST failed: HTTP ${postResp.status}: ${await postResp.text()}`);
    process.exit(1);
  }

  const { runId } = await postResp.json();
  console.log(`PASS: runId=${runId}\n`);

  // 2. 轮询状态
  console.log("[2] 轮询 GET /api/generation/status/:runId ...");
  let pollCount = 0;
  let done = false;
  let finalData = null;

  while (!done) {
    pollCount++;
    const statusResp = await fetch(`${TUNNEL_URL}/api/generation/status/${runId}`);
    const data = await statusResp.json();

    if (data.status === "done") {
      console.log(`  poll #${pollCount}: done ✅`);
      finalData = data;
      done = true;
    } else if (data.status === "error") {
      console.error(`  poll #${pollCount}: error: ${data.error}`);
      process.exit(1);
    } else {
      console.log(`  poll #${pollCount}: generating, progress=${JSON.stringify(data.progress)}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 3. 验证 excelPayload
  console.log("\n[3] 验证 excelPayload ...");
  const ep = finalData.excelPayload;
  if (!ep) {
    console.error("FAIL: excelPayload 缺失");
    process.exit(1);
  }

  console.log(`Sheets: ${ep.sheets.length}`);
  for (const sheet of ep.sheets) {
    const paraCount = sheet.paragraphs?.length ?? 0;
    const tableCount = sheet.tables?.length ?? 0;
    const chartCount = sheet.charts?.length ?? 0;
    console.log(`  "${sheet.name}": ${paraCount} paragraphs, ${tableCount} tables, ${chartCount} charts`);
    if (sheet.tables) {
      for (const t of sheet.tables) {
        console.log(`    table: headers=[${t.headers?.join(", ")}] rows=${t.rows?.length}`);
      }
    }
  }

  // 4. 生成 Excel 文件验证
  console.log("\n[4] 生成 Excel 文件 ...");
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
  const outputPath = "/Users/wukun/Documents/tmp/docStudio/polling-test-output.xlsx";
  await wb.xlsx.writeFile(outputPath);
  const { statSync } = await import("fs");
  console.log(`PASS: ${outputPath} (${statSync(outputPath).size} bytes)`);

  const totalTables = ep.sheets.reduce((s, sh) => s + (sh.tables?.length ?? 0), 0);
  console.log(`\n=== 总结: ${ep.sheets.length} sheets, ${totalTables} tables, ${pollCount} 次轮询 ===`);
  if (ep.sheets.length === 3 && totalTables >= 5) {
    console.log("✅ 方案验证通过");
  } else {
    console.log("❌ 数据不完整");
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
