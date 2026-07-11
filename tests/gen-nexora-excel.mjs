/**
 * gen-nexora-excel.mjs — 生成真实 Excel 文件，调用后端隔离 server
 *
 * 使用隔离 server + demo provider，通过 SSE 流获取 excelPayload，
 * 然后用 exceljs 生成 .xlsx 文件。
 */
import { spawn } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PORT_RANGE_START = 16000;
const PORT_RANGE_SIZE = 5000;
const HEALTH_CHECK_MAX_ATTEMPTS = 30;
const HEALTH_CHECK_INTERVAL_MS = 500;

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer() {
  const tmpDir = mkdtempSync(join(tmpdir(), "i-write-excel-"));
  const dataDir = join(tmpDir, "data");
  mkdirSync(dataDir, { recursive: true });
  const port = PORT_RANGE_START + Math.floor(Math.random() * PORT_RANGE_SIZE);
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
  for (let i = 0; i < HEALTH_CHECK_MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { return { port, baseUrl, child, tmpDir }; }
    } catch {}
    await sleep(HEALTH_CHECK_INTERVAL_MS);
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
  console.log(`隔离服务器: ${baseUrl}`);

  try {
    // 用用户的实际需求
    const payload = {
      title: "Nexora Tech 项目周报",
      userRequest: "帮我生成一份给陈宇、王琳、赵军的 Nexora Tech 2026年6月第4周（6/16-6/20）项目综合汇报 Excel 文件，格式为 xlsx，包含 3个 sheet： 【Sheet 1 - 本周项目进度看板】 - 顶部有 2-3 行说明文字，概述本周整体交付情况 - 下方是一个项目进度表，列出本周所有项目/任务的完成状态、完成度百分比、负责人、周期、备注 - 在表格下方，嵌入一个按部门统计的\"任务完成率柱状图\"（技术部、产品部、设计部、QA），以及一个按负责人统计的\"工时分布饼图\" - 底部附一个\"风险项一览表\"，列出延期风险任务及其影响评估 【Sheet 2 - Bug 质量分析】 - 顶部说明文字，总结本周 Bug 的发现/修复趋势 - 一个 Bug 明细表（ID、标题、优先级、状态、负责人、创建/修复日期、所属模块） - 下方嵌入\"Bug 优先级分布饼图\"（高/中/低）和\"各模块 Bug 数量柱状图\"（前端/后端） - 底部附一个\"Bug 修复周期分析表\"，统计每种优先级的平均修复天数 【Sheet 3 - 团队协作与沟通分析】 - 顶部说明文字，概述本周团队沟通密度和协作亮点 - 一个\"跨部门协作矩阵表\"，行=部门，列=协作类型（reporting/collaboration），单元格=协作次数，基于 People Graph 中的协作关系数据 - 下方嵌入\"部门人员分布柱状图\"（7个部门各多少人），以及\"沟通风格分布饼图\"（formal/casual/technical） - 底部附一个\"关键邮件/会议决策摘要表\"，列出本周重要邮件主题、发件人、决策要点、影响范围",
      outline: [
        { title: "Sheet 1 - 本周项目进度看板", description: "顶部说明文字 + 项目进度表 + 两张图表 + 风险项一览表", children: [] },
        { title: "Sheet 2 - Bug 质量分析", description: "顶部说明 + Bug 明细表 + 两张图表 + Bug 修复周期分析表", children: [] },
        { title: "Sheet 3 - 团队协作与沟通分析", description: "顶部说明 + 跨部门协作矩阵 + 两张图表 + 决策摘要表", children: [] },
      ],
      format: "excel",
      providerPreference: ["demo"],
    };

    const resp = await fetch(`${baseUrl}/api/generation/generate/excel-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      console.error(`HTTP ${resp.status}: ${await resp.text()}`);
      process.exit(1);
    }

    const ct = resp.headers.get("content-type") ?? "";
    console.log(`响应: HTTP ${resp.status}, Content-Type: ${ct}`);

    // 消费 SSE 流，收集 done event 的 excelPayload
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let excelPayload = null;
    let runId = "";
    let title = "";

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
            if (currentEvent === "done") {
              excelPayload = data.excelPayload;
              runId = data.runId ?? "";
              title = data.title ?? "";
              console.log(`收到 done event: runId=${runId}, title="${title}", sheets=${excelPayload?.sheets?.length ?? 0}`);
            }
          } catch {}
          currentEvent = null;
        }
      }
    }

    if (!excelPayload) {
      console.error("FAIL: 未收到 done event");
      process.exit(1);
    }

    // 用 exceljs 生成 .xlsx 文件
    const ExcelJSMod = await import("exceljs");
    const ExcelJS = ExcelJSMod.default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "i-Write";
    wb.created = new Date();

    for (const sheet of excelPayload.sheets) {
      const ws = wb.addWorksheet(sheet.name);
      if (!sheet.paragraphs || sheet.paragraphs.length === 0) continue;

      for (const para of sheet.paragraphs) {
        // paragraph: { type, content, style, table, chart }
        if (para.type === "text" || para.type === "heading") {
          const row = ws.addRow([para.content ?? ""]);
          if (para.style?.bold) {
            row.font = { bold: true, size: para.style.fontSize ?? 11 };
          }
          if (para.style?.alignment) {
            row.alignment = para.style.alignment;
          }
        } else if (para.type === "table" && para.table) {
          ws.addRow([]); // blank line before table
          const headerRow = ws.addRow(para.table.headers ?? []);
          headerRow.font = { bold: true };
          (para.table.rows ?? []).forEach((r) => ws.addRow(r));
          // 设置列宽
          const colCount = (para.table.headers ?? []).length;
          for (let i = 1; i <= colCount; i++) {
            ws.getColumn(i).width = 18;
          }
        } else if (para.type === "chart") {
          const chartTitle = para.chart?.title ?? para.content ?? "图表";
          ws.addRow([`[${chartTitle}]`]);
          // 图表元数据，实际 Excel 嵌入需要 Office.js
          if (para.chart?.data) {
            const data = para.chart.data;
            if (data.labels) {
              ws.addRow(["类别", "值"]);
              data.labels.forEach((label, i) => {
                ws.addRow([label, data.values?.[i] ?? 0]);
              });
            }
          }
        } else if (para.type === "empty") {
          ws.addRow([]);
        }
      }

      // 设置列宽
      ws.getColumn(1).width = 25;
      ws.getColumn(2).width = 20;
      ws.getColumn(3).width = 18;
      ws.getColumn(4).width = 18;
      ws.getColumn(5).width = 15;
    }

    const outputPath = resolve(PROJECT_ROOT, "nexora-weekly-report.xlsx");
    await wb.xlsx.writeFile(outputPath);
    console.log(`\n✅ Excel 文件已生成: ${outputPath}`);
    console.log(`   文件大小: ${readFileSync(outputPath).length} bytes`);
    console.log(`   Sheets: ${excelPayload.sheets.map(s => s.name).join(", ")}`);

  } finally {
    await cleanup(child, tmpDir);
  }
}

main().catch((e) => {
  console.error("错误:", e.message);
  process.exit(1);
});