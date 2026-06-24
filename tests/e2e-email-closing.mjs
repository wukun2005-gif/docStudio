/**
 * E2E 测试：验证邮件文档生成 — 结尾位置和滚动上下文
 *
 * 测试内容：
 * 1. 邮件结尾（祝好、署名）应在最后一个章节，不在中间
 * 2. 后续章节应包含前文上下文（承上启下）
 */
import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { startIsolatedServer, dumpServerLog } from "./e2e-shared/server-lifecycle.mjs";

loadEnvFile();

const outline = [
  { id: "s1", title: "问候与近况", level: 1, children: [], description: "收件人近况问候" },
  { id: "s2", title: "本周产品工作概述", level: 1, children: [], description: "本周主要做了哪些产品工作" },
  { id: "s3", title: "产品开发原因", level: 1, children: [], description: "为什么要做这个产品" },
  { id: "s4", title: "当前进展", level: 1, children: [], description: "现在做到了什么程度" },
  { id: "s5", title: "竞品分析", level: 1, children: [], description: "2026年全球最火的3个竞品简介" },
];

async function main() {
  console.log("=== E2E 测试：邮件文档生成 ===\n");

  // 启动隔离服务器（复制生产 DB 以获取 provider 配置和 API key）
  console.log("1. 启动隔离服务器...");
  const { baseUrl, cleanup } = await startIsolatedServer({ copyProductionDb: true });
  console.log(`   服务器地址: ${baseUrl}\n`);

  try {
    // 准备请求
    const apiKey = getApiKey("mimo");
    if (!apiKey) {
      console.error("ERROR: 未找到 MiMo_KEY，请检查 .env 文件");
      process.exit(1);
    }

    const userRequest = "向王芳写一封邮件，汇报最近一周在做什么产品，为啥要做，现在做到了什么程度。还有附上从2026年到今天为止全球最火的3个竞品的简介。";

    console.log("2. 调用文档生成 API...");
    console.log(`   用户需求: ${userRequest}\n`);

    const resp = await fetch(`${baseUrl}/api/generation/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "工作汇报邮件",
        outline,
        format: "html",
        apiKey,
        providerPreference: ["mimo"],
        userRequest,
      }),
      signal: AbortSignal.timeout(300_000), // 5 分钟超时
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`API 错误 ${resp.status}: ${errText}`);
      dumpServerLog();
      process.exit(1);
    }

    const result = await resp.json();
    const html = result.html || result.content || "";

    console.log("3. 生成结果分析：\n");
    console.log(`   HTML 长度: ${html.length} 字符`);
    console.log(`   信任度: ${result.trustScore ?? "N/A"}\n`);

    // ── 测试 1：邮件结尾位置 ──
    console.log("━━━ 测试 1：邮件结尾位置 ━━━");

    // 找到"祝好"的位置
    const closingPatterns = ["祝好", "此致", "Best regards", "best regards", "敬上"];
    let closingPos = -1;
    let closingWord = "";
    for (const word of closingPatterns) {
      const pos = html.lastIndexOf(word);
      if (pos > closingPos) {
        closingPos = pos;
        closingWord = word;
      }
    }

    if (closingPos === -1) {
      console.log("   ❌ FAIL: 未找到邮件结尾（祝好/此致/Best regards 等）");
    } else {
      console.log(`   找到结尾 "${closingWord}" 在位置 ${closingPos}/${html.length}`);

      // 找到最后一个章节内容的起始位置
      // 竞品分析应该是最后一个章节
      const lastSectionTitle = "竞品分析";
      const lastSectionPos = html.lastIndexOf(lastSectionTitle);

      if (lastSectionPos === -1) {
        console.log('   ⚠️ 未找到"竞品分析"章节标题，尝试其他判断...');
        // 检查结尾是否在文档的后 1/3
        const isInLastThird = closingPos > html.length * 0.66;
        console.log(`   结尾在文档后 1/3: ${isInLastThird ? "✅ YES" : "❌ NO"}`);
      } else {
        const isAfterLastSection = closingPos > lastSectionPos;
        console.log(`   结尾在最后一个章节之后: ${isAfterLastSection ? "✅ YES" : "❌ NO"}`);

        // 检查结尾是否在中间章节之后（不应该出现）
        const midSectionTitles = ["本周产品工作概述", "产品开发原因", "当前进展"];
        let closingInMiddle = false;
        for (const title of midSectionTitles) {
          const pos = html.indexOf(title);
          if (pos !== -1 && closingPos > pos && closingPos < lastSectionPos) {
            console.log(`   ❌ FAIL: 结尾 "${closingWord}" 出现在 "${title}" 和 "${lastSectionTitle}" 之间！`);
            closingInMiddle = true;
          }
        }
        if (!closingInMiddle && isAfterLastSection) {
          console.log("   ✅ PASS: 邮件结尾在正确位置（最后一个章节之后）");
        }
      }
    }

    // ── 测试 2：滚动上下文（承上启下） ──
    console.log("\n━━━ 测试 2：检查各章节内容 ━━━");

    // 打印各章节的内容片段
    for (const section of outline) {
      const sectionPos = html.indexOf(section.title);
      if (sectionPos !== -1) {
        // 提取该章节后的内容（截取 150 字）
        const afterTitle = html.slice(sectionPos + section.title.length, sectionPos + section.title.length + 200);
        const cleanText = afterTitle.replace(/<[^>]+>/g, "").trim();
        console.log(`\n   【${section.title}】`);
        console.log(`   ${cleanText.slice(0, 150)}...`);
      }
    }

    // ── 测试 3：输出完整 HTML 供人工检查 ──
    console.log("\n━━━ 完整 HTML 输出 ━━━\n");
    console.log(html);

    console.log("\n=== 测试完成 ===");

  } finally {
    console.log("\n4. 清理...");
    await cleanup();
    console.log("   Done.");
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  dumpServerLog();
  process.exit(1);
});
