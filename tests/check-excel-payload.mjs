/**
 * check-excel-payload.mjs — 检查 toExcelPayload 对 fixture 数据的输出
 */
import { spawn } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer() {
  const tmpDir = mkdtempSync(join(tmpdir(), "i-write-check-"));
  const dataDir = join(tmpDir, "data");
  mkdirSync(dataDir, { recursive: true });
  const port = 17000 + Math.floor(Math.random() * 1000);
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
        title: "测试",
        userRequest: "测试",
        outline: [
          { title: "A", description: "a", children: [] },
          { title: "B", description: "b", children: [] },
          { title: "C", description: "c", children: [] },
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

    console.log(`Sheets: ${excelPayload.sheets.length}`);
    for (const sheet of excelPayload.sheets) {
      console.log(`\nSheet: "${sheet.name}"`);
      console.log(`  paragraphs: ${sheet.paragraphs?.length ?? 0}`);
      if (sheet.paragraphs?.length > 0) {
        for (const p of sheet.paragraphs.slice(0, 3)) {
          console.log(`    - [${p.style}] ${p.text?.slice(0, 60)}...`);
        }
        if (sheet.paragraphs.length > 3) console.log(`    ... (${sheet.paragraphs.length - 3} more)`);
      }
      console.log(`  tables: ${sheet.tables?.length ?? 0}`);
      if (sheet.tables?.length > 0) {
        for (const t of sheet.tables) {
          console.log(`    - "${t.title}" headers:[${t.headers?.join(", ")}] rows:${t.rows?.length ?? 0}`);
        }
      }
      console.log(`  charts: ${sheet.charts?.length ?? 0}`);
    }

  } finally {
    await cleanup(child, tmpDir);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
