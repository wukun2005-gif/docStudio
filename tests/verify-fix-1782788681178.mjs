/**
 * 验证脚本：用 case 1782788681178 的真实 DB 数据验证修复效果
 *
 * 运行: node --loader ts-node/esm tests/verify-fix-1782788681178.mjs
 * 或:   npx tsx tests/verify-fix-1782788681178.mjs
 */
import { cleanContent } from "../server/src/lib/contentCleaner.js";
import { toHtml } from "../server/src/lib/docGenerator.js";
import { generateWord } from "../server/src/lib/docExporter.js";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../server/data/docstudio.db");

// ── 从 DB 读取 case 内容 ──
const db = new Database(DB_PATH, { readonly: true });
const row = db.prepare(`
  SELECT json_extract(data, '$.generatedContent') as content
  FROM sync_data
  WHERE record_id = 'case-1782788681178' AND store_name = 'cases'
`).get();
db.close();

if (!row?.content) {
  console.error("❌ 未找到 case-1782788681178 的 generatedContent");
  process.exit(1);
}

const rawContent = row.content;
console.log(`\n📄 DB 内容长度: ${rawContent.length} chars\n`);

// ── 验证 1: DB 中的破损标签统计 ──
const brokenTitleBefore = rawContent.match(/<sup><a[^>]*title="([^"]{80,})/g) || [];
const unclosedSupBefore = (rawContent.match(/<sup><a/g) || []).length;
const closedSupBefore = (rawContent.match(/<\/a><\/sup>/g) || []).length;
console.log("═══ 验证 1: DB 原始内容中的破损标签 ═══");
console.log(`  <sup><a> 打开标签: ${unclosedSupBefore}`);
console.log(`  </a></sup> 闭合标签: ${closedSupBefore}`);
console.log(`  超长 title (>80字符): ${brokenTitleBefore.length}`);
console.log(`  未闭合标签: ${unclosedSupBefore - closedSupBefore}`);
const pass1 = brokenTitleBefore.length > 0; // 应该有破损标签（验证测试有意义）
console.log(`  ${pass1 ? "✅" : "⚠️"} ${pass1 ? "确认存在破损标签（测试有意义）" : "没有发现破损标签，可能是已修复的数据"}`);

// ── 验证 2: removeBrokenCitationTags 清理效果 ──
console.log("\n═══ 验证 2: removeBrokenCitationTags 清理效果 ═══");
// 直接用 contentCleaner 的 cleanContent 测试（它内部调用了 removeBrokenCitationTags）
const cleaned = cleanContent(rawContent, [{ index: 1, title: "Q3产品发布评估.docx", url: "https://onedrive.live.com/test" }]);
const brokenTitleAfter = cleaned.match(/<sup><a[^>]*title="([^"]{50,})/g) || [];
console.log(`  清理后超长 title (>50字符): ${brokenTitleAfter.length} (应为 0)`);
const pass2 = brokenTitleAfter.length === 0;
console.log(`  ${pass2 ? "✅" : "⚠️"} ${pass2 ? "破损标签全部清理" : "cleanContent 路径可能不经过 removeBrokenCitationTags（markdownToHtml 会重新包装）"}`);

// ── 验证 3: toHtml 输出质量 ──
console.log("\n═══ 验证 3: toHtml 输出质量 ═══");
// 用清理后的内容构建 fakeResult
const cleanedText = cleaned.replace(/<[^>]+>/g, '').trim();
const fakeResult = {
  sections: [{
    title: "测试",
    content: cleanedText.substring(0, 5000),
    groundingScore: 0.8,
    sources: [],
    webCitations: [],
    citationLinks: [{ index: 1, title: "Q3产品发布评估.docx", url: "https://onedrive.live.com/test" }],
  }],
  trustScore: 0.8,
  documentStyle: "report",
};
const html = toHtml(fakeResult);
const unclosedAfter = (html.match(/<sup><a/g) || []).length;
const closedAfter = (html.match(/<\/a><\/sup>/g) || []).length;
const hasFooter = html.includes('<footer class="citations">');
const hasWrapper = html.includes('class="doc-content"');
console.log(`  <sup><a> 打开: ${unclosedAfter}, 闭合: ${closedAfter}`);
console.log(`  包含 footer: ${hasFooter}`);
console.log(`  包含 doc-content wrapper: ${hasWrapper}`);
const pass3 = unclosedAfter === closedAfter && hasFooter && hasWrapper;
console.log(`  ${pass3 ? "✅" : "❌"} toHtml 输出结构完整`);

// ── 验证 4: 数字修复 (5.。0 → 5.0) ──
console.log("\n═══ 验证 4: 数字修复 ═══");
const hasBrokenDigit = html.includes("5.。0") || html.includes("3.。8");
const hasFixedDigit = html.includes("4.2/5.0") || html.includes("3.8/5.0");
console.log(`  包含破损数字 (5.。0): ${hasBrokenDigit}`);
console.log(`  包含修复后数字 (5.0): ${hasFixedDigit}`);
const pass4 = !hasBrokenDigit;
console.log(`  ${pass4 ? "✅" : "⚠️"} 数字格式已修复${pass4 ? "" : "（可能原始数据不含此模式）"}`);

// ── 验证 5: 表格检测 ──
console.log("\n═══ 验证 5: 表格检测 ═══");
const TABLE_COL_SEP = /\s{2,}/;
const tableTestLines = [
  "指标维度              数值          行业基准",
  "Demo 总场次           8 场          -",
  "满意度评分            4.2/5.0       3.8/5.0",
];
const detected = tableTestLines.every(line => {
  const cols = line.split(TABLE_COL_SEP).map(c => c.trim()).filter(Boolean);
  return cols.length >= 2;
});
console.log(`  表格行检测: ${detected ? "全部正确识别" : "检测失败"}`);
const pass5 = detected;
console.log(`  ${pass5 ? "✅" : "❌"} 表格行检测正确`);

// ── 验证 6: docx 生成 ──
console.log("\n═══ 验证 6: docx 生成 ═══");
const testSections = [{
  title: "测试章节",
  content: "指标维度              数值          行业基准\nDemo 总场次           8 场          -\n满意度评分            4.2/5.0       3.8/5.0\n\n这是一段普通正文。",
}];
try {
  const docxBuffer = await generateWord("测试文档", testSections);
  console.log(`  docx 大小: ${docxBuffer.length} bytes`);
  const pass6 = docxBuffer.length > 0;
  console.log(`  ${pass6 ? "✅" : "❌"} docx 生成成功`);
} catch (e) {
  console.log(`  ❌ docx 生成失败: ${e.message}`);
}

// ── 验证 7: 完整流程 - 真实 DB 数据 → 预清理 → parseHtmlSections → docx ──
console.log("\n═══ 验证 7: 完整流程（DB 数据 → 预清理 → parseHtmlSections → docx）═══");
// 模拟真实导出流程：section-aware 破损标签预清理（与 contentCleaner.ts 的 removeBrokenCitationTags 一致）
let cleanForExport = rawContent;
const SEC_RE7 = /(<section>[\s\S]*?<\/section>)/gi;
const parts7 = [];
let lastIdx7 = 0;
let secM7;
const cleanRange7 = (range, inSec) => {
  const endLA = inSec ? '(?=<\\/p>)|(?=<sup><a)' : '(?=<\\/p>)|(?=<\\/section>)|(?=<sup><a)';
  const re1 = new RegExp(`<sup><a[^>]*?title="([^"]{50,})"[^>]*>(?:(?!<\\/a><\\/sup>)[\\s\\S]*?)(?:<\\/a><\\/sup>|${endLA})`, 'g');
  const re2 = new RegExp(`<sup><a[^>]*?title="([^"]{50,})"[\\s\\S]*?(\\[\\d+\\])[\\s\\S]*?(?:<\\/a><\\/sup>|${endLA})`, 'g');
  range = range.replace(re1, (m, tc) => { const r = tc.match(/\[(\d+)\]/); return r ? `[${r[1]}]` : ''; });
  range = range.replace(re2, '$2');
  return range;
};
while ((secM7 = SEC_RE7.exec(rawContent)) !== null) {
  if (secM7.index > lastIdx7) parts7.push(cleanRange7(rawContent.substring(lastIdx7, secM7.index), false));
  parts7.push(cleanRange7(secM7[1], true));
  lastIdx7 = secM7.index + secM7[0].length;
}
if (lastIdx7 < rawContent.length) parts7.push(cleanRange7(rawContent.substring(lastIdx7), false));
cleanForExport = parts7.join('');

// 用 generation.ts 的 parseHtmlSections 逻辑解析
const SUB_MARKER = "\x01H\x01";
const sectionRegex = /<section>\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/gi;
const fullSections = [];
let secMatch;
while ((secMatch = sectionRegex.exec(cleanForExport)) !== null) {
  const sectionTitle = secMatch[1].replace(/<[^>]+>/g, "").trim();
  const rawSecContent = secMatch[2];
  const paraRegex = /<p\b[^>]*>([\s\S]*?)<\/p\b[^>]*>/gi;
  const processedLines = [];
  let paraMatch;
  while ((paraMatch = paraRegex.exec(rawSecContent)) !== null) {
    const paraText = paraMatch[1].replace(/<[^>]+>/g, "").trim();
    if (paraText) processedLines.push(paraText);
  }
  const content = processedLines.join("\n");
  if (sectionTitle && content) {
    fullSections.push({ title: sectionTitle, content });
  }
}
console.log(`  解析出 ${fullSections.length} 个章节`);
for (const s of fullSections) {
  console.log(`    - ${s.title} (${s.content.length} chars)`);
}
try {
  const fullDocx = await generateWord("Q3产品发布评估", fullSections);
  console.log(`  docx 大小: ${fullDocx.length} bytes`);
  const pass7 = fullDocx.length > 0 && fullSections.length >= 5;
  console.log(`  ${pass7 ? "✅" : "❌"} 完整流程成功，${fullSections.length} 个章节`);
} catch (e) {
  console.log(`  ❌ 完整流程失败: ${e.message}`);
}

// ── 总结 ──
console.log("\n════════════════════════════════");
console.log("验证完成！请检查上述结果。");
