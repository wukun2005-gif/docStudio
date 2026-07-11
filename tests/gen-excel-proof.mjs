/**
 * gen-excel-proof.mjs — 用真实 excelPayload 生成有内容的 Excel 文件
 */
import { spawn } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer() {
  const tmpDir = mkdtempSync(join(tmpdir(), "i-write-proof-"));
  const dataDir = join(tmpDir, "data");
  mkdirSync(dataDir, { recursive: true });
  const port = 18000 + Math.floor(Math.random() * 1000);
  const dbPath = join(dataDir, "docstudio.db");
  const prodDb = join(PROJECT_ROOT, "server", "data", "docstudio.db");
  if (existsSync(prodDb)) {
    const { execSync } = await import("child_process");
    execSync(`sqlite3 "${prodDb}" ".backup '${dbPath}'"`);
  }
  const tsxPath = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const serverEntry = join(PROJECT_ROOT, "server", "src", "index.ts");
  const child = spawn(process.execPath, [tsxPath, serverEntry], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DB_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: PROJECT_ROOT,
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const baseUrl = `http://localhost:${port}`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { port, baseUrl, child, tmpDir };
    } catch {}
    await sleep(500);
  }
  child.kill("SIGKILL");
  rmSync(tmpDir, { recursive: true, force: true });
  throw new Error("Server 启动失败");
}

async function cleanup(child, tmpDir) {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => { child.kill("SIGKILL"); r(); }, 3000);
      child.on("exit", () => { clearTimeout(t); r(); });
    });
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  const { baseUrl, child, tmpDir } = await startServer();

  try {
    const resp = await fetch(`${baseUrl}/api/generation/generate/excel-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Nexora Tech 项目周报",
        userRequest: "帮我生成一份给陈宇、王琳、赵军的 Nexora Tech 2026年6月第4周（6/16-6/20）项目综合汇报 Excel 文件",
        outline: [
          { title: "Sheet 1 - 本周项目进度看板", description: "项目进度表、图表、风险项", children: [] },
          { title: "Sheet 2 - Bug 质量分析", description: "Bug 明细、图表、修复周期", children: [] },
          { title: "Sheet 3 - 团队协作与沟通分析", description: "协作矩阵、图表、决策摘要", children: [] },
        ],
        format: "excel",
        providerPreference: ["demo"],
      }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let excelPayload = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); }
        else if (line.startsWith("data: ") && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === "done") excelPayload = data.excelPayload;
          } catch {}
          currentEvent = null;
        }
      }
    }

    if (!excelPayload) {
      console.error("未收到 excelPayload");
      process.exit(1);
    }

    // 用 exceljs 生成 .xlsx（正确解析 ExcelWritePayload 结构）
    const ExcelJSMod = await import("exceljs");
    const ExcelJS = ExcelJSMod.default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "i-Write";
    wb.created = new Date();

    for (const sheetData of excelPayload.sheets) {
      const ws = wb.addWorksheet(sheetData.name);

      // 写入 paragraphs
      let rowIdx = 1;
      for (const para of sheetData.paragraphs ?? []) {
        const row = ws.getRow(rowIdx);
        row.getCell(1).value = para.text ?? "";
        if (para.style === "heading1") {
          row.getCell(1).font = { bold: true, size: 16 };
        } else if (para.style === "heading2") {
          row.getCell(1).font = { bold: true, size: 13 };
        } else if (para.style === "bullet") {
          row.getCell(1).value = `• ${para.text}`;
        } else if (para.style === "citation") {
          row.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
        }
        rowIdx++;
      }

      // 写入 tables
      for (const table of sheetData.tables ?? []) {
        rowIdx++; // blank line
        if (table.title) {
          const titleRow = ws.getRow(rowIdx++);
          titleRow.getCell(1).value = table.title;
          titleRow.getCell(1).font = { bold: true, size: 12 };
        }
        // headers
        const headerRow = ws.getRow(rowIdx++);
        (table.headers ?? []).forEach((h, i) => {
          headerRow.getCell(i + 1).value = h;
          headerRow.getCell(i + 1).font = { bold: true };
          headerRow.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
          headerRow.getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        });
        // rows
        for (const r of table.rows ?? []) {
          const dataRow = ws.getRow(rowIdx++);
          r.forEach((cell, i) => { dataRow.getCell(i + 1).value = cell; });
        }
      }

      // 设置列宽
      for (let i = 1; i <= 5; i++) {
        ws.getColumn(i).width = 20;
      }
    }

    const outputPath = resolve(PROJECT_ROOT, "nexora-weekly-proof.xlsx");
    await wb.xlsx.writeFile(outputPath);

    // 验证内容
    const stats = await wb.xlsx.readFile(outputPath);
    console.log(`\n✅ Excel 文件已生成: ${outputPath}`);
    console.log(`   大小: ${existsSync(outputPath) ? statSync(outputPath).size : 0} bytes`);
    console.log(`   Sheets:`);
    for (const ws of stats.worksheets) {
      console.log(`   - "${ws.name}": ${ws.rowCount} 行`);
    }

    // 详细打印第一页前10行
    const ws1 = stats.worksheets[0];
    console.log(`\n   Sheet "${ws1.name}" 前 10 行:`);
    for (let r = 1; r <= Math.min(10, ws1.rowCount); r++) {
      const row = ws1.getRow(r);
      const vals = [];
      for (let c = 1; c <= 3; c++) {
        const v = row.getCell(c).value;
        vals.push(v ? String(v).slice(0, 40) : "");
      }
      console.log(`   Row ${r}: ${vals.join(" | ")}`);
    }

  } finally {
    await cleanup(child, tmpDir);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
