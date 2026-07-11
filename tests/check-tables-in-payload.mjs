/**
 * check-tables-in-payload.mjs — 检查真实 LLM payload 中 tables 字段
 */
const TUNNEL_URL = "https://g5jbt6lx-3001.use.devtunnels.ms";

async function main() {
  console.log("发起 excel-stream 请求（真实 provider）...\n");

  const payload = {
    title: "Nexora Tech 项目周报",
    userRequest: "帮我生成一份给陈宇、王琳、赵军的 Nexora Tech 2026年6月第4周（6/16-6/20）项目综合汇报 Excel 文件，格式为 xlsx，包含 3个 sheet： 【Sheet 1 - 本周项目进度看板】 - 顶部有 2-3 行说明文字，概述本周整体交付情况 - 下方是一个项目进度表，列出本周所有项目/任务的完成状态、完成度百分比、负责人、周期、备注 - 在表格下方，嵌入一个按部门统计的\"任务完成率柱状图\"（技术部、产品部、设计部、QA），以及一个按负责人统计的\"工时分布饼图\" - 底部附一个\"风险项一览表\"，列出延期风险任务及其影响评估 【Sheet 2 - Bug 质量分析】 - 顶部说明文字，总结本周 Bug 的发现/修复趋势 - 一个 Bug 明细表（ID、标题、优先级、状态、负责人、创建/修复日期、所属模块） - 下方嵌入\"Bug 优先级分布饼图\"（高/中/低）和\"各模块 Bug 数量柱状图\"（前端/后端） - 底部附一个\"Bug 修复周期分析表\"，统计每种优先级的平均修复天数 【Sheet 3 - 团队协作与沟通分析】 - 顶部说明文字，概述本周团队沟通密度和协作亮点 - 一个\"跨部门协作矩阵表\"，行=部门，列=协作类型（reporting/collaboration），单元格=协作次数，基于 People Graph 中的协作关系数据 - 下方嵌入\"部门人员分布柱状图\"（7个部门各多少人），以及\"沟通风格分布饼图\"（formal/casual/technical） - 底部附一个\"关键邮件/会议决策摘要表\"，列出本周重要邮件主题、发件人、决策要点、影响范围",
    outline: [
      { title: "Sheet 1 - 本周项目进度看板", description: "顶部说明文字 + 项目进度表 + 两张图表 + 风险项一览表", children: [] },
      { title: "Sheet 2 - Bug 质量分析", description: "顶部说明 + Bug 明细表 + 两张图表 + Bug 修复周期分析表", children: [] },
      { title: "Sheet 3 - 团队协作与沟通分析", description: "顶部说明 + 跨部门协作矩阵 + 两张图表 + 决策摘要表", children: [] },
    ],
    format: "excel",
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
  let doneData = null;

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
          if (currentEvent === "done") doneData = data;
          process.stdout.write(".");
        } catch {}
        currentEvent = null;
      }
    }
  }

  console.log("\n\n=== Done event 收到 ===");
  if (!doneData?.excelPayload) {
    console.error("缺少 excelPayload");
    process.exit(1);
  }

  const ep = doneData.excelPayload;
  console.log(`Sheets: ${ep.sheets.length}\n`);

  for (const sheet of ep.sheets) {
    console.log(`=== Sheet: "${sheet.name}" ===`);
    console.log(`  paragraphs: ${sheet.paragraphs?.length ?? 0}`);
    console.log(`  tables: ${sheet.tables?.length ?? 0}`);
    console.log(`  charts: ${sheet.charts?.length ?? 0}`);

    // 打印所有段落
    if (sheet.paragraphs) {
      console.log(`\n  --- 段落内容 ---`);
      for (const p of sheet.paragraphs) {
        console.log(`  [${p.style}] ${(p.text ?? "").slice(0, 100)}`);
      }
    }

    // 打印所有表格
    if (sheet.tables && sheet.tables.length > 0) {
      console.log(`\n  --- 表格内容 ---`);
      for (const t of sheet.tables) {
        console.log(`  table: title="${t.title}" headers=[${t.headers?.join(", ")}] rows=${t.rows?.length ?? 0}`);
        if (t.rows) {
          for (const r of t.rows.slice(0, 3)) {
            console.log(`    ${r.join(" | ")}`);
          }
          if (t.rows.length > 3) console.log(`    ... (${t.rows.length - 3} more rows)`);
        }
      }
    } else {
      console.log(`\n  ⚠️ 没有表格！`);
    }

    console.log("");
  }

  // 保存完整 payload 供分析
  const { writeFileSync } = await import("fs");
  writeFileSync("/tmp/excel-payload-debug.json", JSON.stringify(ep, null, 2));
  console.log("完整 payload 已保存到 /tmp/excel-payload-debug.json");
}

main().catch((e) => {
  console.error("错误:", e.message);
  process.exit(1);
});
