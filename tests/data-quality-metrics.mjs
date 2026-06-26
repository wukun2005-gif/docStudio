/**
 * 合成数据质量指标计算
 * 基于 docs/sample-data-upgrade-plan.md 4.2 节定义的指标
 */
import { readdirSync, readFileSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SAMPLES_DIR = join(PROJECT_ROOT, "samples");

// 加载 .env
loadEnvFile();

// ── 工具函数 ──────────────────────────────────────────

/** 简单分词（按空格和标点） */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s一-鿿]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** 生成 n-gram */
function ngrams(tokens, n) {
  const result = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(" "));
  }
  return result;
}

/** 计算两个集合的 Jaccard 相似度 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/** 计算 BLEU 分数（简化版） */
function computeBLEU(reference, candidate) {
  const refTokens = tokenize(reference);
  const candTokens = tokenize(candidate);

  if (candTokens.length === 0) return 0;

  // 计算 1-gram 到 4-gram 的精确度
  let totalPrecision = 0;
  let weights = 0;

  for (let n = 1; n <= 4; n++) {
    const refNgrams = new Set(ngrams(refTokens, n));
    const candNgrams = ngrams(candTokens, n);

    if (candNgrams.length === 0) continue;

    let matches = 0;
    for (const ng of candNgrams) {
      if (refNgrams.has(ng)) matches++;
    }

    const precision = matches / candNgrams.length;
    if (precision > 0) {
      totalPrecision += Math.log(precision);
      weights++;
    }
  }

  if (weights === 0) return 0;

  // 简化的 BLEU（不包含 brevity penalty）
  return Math.exp(totalPrecision / weights);
}

// ── 收集文件内容 ──────────────────────────────────────────

function collectFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if ([".docx", ".eml", ".json", ".xlsx", ".pptx"].includes(ext)) {
          files.push({ path: fullPath, name: entry.name, ext });
        }
      }
    }
  }
  walk(SAMPLES_DIR);
  return files;
}

// ── 提取文本内容（简化版，只取可读文本） ──────────────────────────────────────────

function extractText(filePath, ext) {
  try {
    // 对于 .eml 和 .json，直接读取文本
    if (ext === ".eml" || ext === ".json") {
      const content = readFileSync(filePath, "utf-8");
      // 简单清理：去掉 HTML 标签和多余空白
      return content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000); // 限制长度
    }
    // 对于其他格式，返回文件名作为占位符
    return filePath.split("/").pop().replace(/\.\w+$/, "");
  } catch {
    return "";
  }
}

// ── LLM Fluency 评分 ──────────────────────────────────────────

async function scoreFluency(text, apiKey) {
  const prompt = `请评估以下文本的语言流畅度，评分 1-5 分：

1分 - 完全不可读，语法错误严重
2分 - 大量语法错误，理解困难
3分 - 基本可读，但有明显语法或表达问题
4分 - 流畅自然，偶有小瑕疵
5分 - 非常流畅，表达自然专业

请只返回一个数字（1-5），不要其他内容。

文本：
${text.slice(0, 1500)}`;

  try {
    const res = await fetch("https://token-plan-cn.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mimo-v2-pro",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    // MiMo 是推理模型，内容可能在 reasoning_content 或 content 中
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const reasoning = data.choices?.[0]?.message?.reasoning_content?.trim() || "";

    // 从 content 中提取数字
    let score = parseInt(content.match(/\d/)?.[0] || "0");

    // 如果 content 没有数字，从 reasoning 中提取
    if (score === 0 && reasoning) {
      // 查找所有 "评分 X" 或 "给 X 分" 或末尾数字
      const patterns = [
        /评分[：:]?\s*(\d)/,
        /给[予]?\s*(\d)\s*分/,
        /打[分]?\s*(\d)/,
        /(\d)\s*分[钟]?$/,
        /(\d)$/,
      ];
      for (const p of patterns) {
        const m = reasoning.match(p);
        if (m) {
          score = parseInt(m[1]);
          break;
        }
      }
    }

    return score >= 1 && score <= 5 ? score : 0;
  } catch {
    return 0;
  }
}

// ── 指标计算 ──────────────────────────────────────────

async function main() {
console.log("╔══════════════════════════════════════════╗");
console.log("║     合成数据质量指标 (4.2 节)            ║");
console.log("╚══════════════════════════════════════════╝\n");

const files = collectFiles();
console.log(`📁 文件总数: ${files.length}\n`);

// 1. Self-BLEU（文档间相似度）
console.log("━━━ 1. Self-BLEU（文档间相似度）━━━");
console.log("定义: 每个文档与其他文档的 BLEU 分数平均值，越低表示越多样\n");

// 只对 .eml 和 .json 文件计算（可以提取文本）
const textFiles = files.filter((f) => [".eml", ".json"].includes(f.ext));
const contents = textFiles.map((f) => ({
  name: f.name,
  text: extractText(f.path, f.ext),
}));

// 采样计算（避免 O(n²) 太慢）
const sampleSize = Math.min(contents.length, 20);
const sampled = contents.slice(0, sampleSize);

let selfBleuTotal = 0;
let selfBleuCount = 0;

for (let i = 0; i < sampled.length; i++) {
  for (let j = 0; j < sampled.length; j++) {
    if (i === j) continue;
    const bleu = computeBLEU(sampled[i].text, sampled[j].text);
    selfBleuTotal += bleu;
    selfBleuCount++;
  }
}

const selfBleu = selfBleuCount > 0 ? selfBleuTotal / selfBleuCount : 0;
console.log(`  Self-BLEU: ${selfBleu.toFixed(4)}`);
console.log(`  阈值: < 0.50 (可接受)`);
console.log(`  评价: ${selfBleu < 0.3 ? "✅ 优秀" : selfBleu < 0.5 ? "✅ 可接受" : "❌ 需改进"}\n`);

// 2. Uniqueness（非近重复文档比例）
console.log("━━━ 2. Uniqueness（非近重复文档比例）━━━");
console.log("定义: 非近重复文档占总文档的比例\n");

const SIMILARITY_THRESHOLD = 0.85; // 超过此值视为近重复
let nearDuplicates = 0;
let totalPairs = 0;

for (let i = 0; i < sampled.length; i++) {
  for (let j = i + 1; j < sampled.length; j++) {
    const tokens1 = new Set(tokenize(sampled[i].text));
    const tokens2 = new Set(tokenize(sampled[j].text));
    const sim = jaccardSimilarity(tokens1, tokens2);
    if (sim > SIMILARITY_THRESHOLD) {
      nearDuplicates++;
      console.log(`  ⚠️  近重复: ${sampled[i].name} ↔ ${sampled[j].name} (${sim.toFixed(2)})`);
    }
    totalPairs++;
  }
}

const uniqueness = totalPairs > 0 ? (totalPairs - nearDuplicates) / totalPairs : 1;
console.log(`\n  Uniqueness: ${uniqueness.toFixed(4)} (${nearDuplicates} 对近重复 / ${totalPairs} 总对数)`);
console.log(`  阈值: >= 0.90`);
console.log(`  评价: ${uniqueness >= 0.95 ? "✅ 优秀" : uniqueness >= 0.90 ? "✅ 可接受" : "❌ 需改进"}\n`);

// 3. Type Coverage（类型覆盖度）
console.log("━━━ 3. Type Coverage（类型覆盖度）━━━");
console.log("定义: 目标文档类型覆盖率\n");

const typeMap = {
  ".docx": "docx",
  ".eml": "email",
  ".json": "json",
  ".xlsx": "excel",
  ".pptx": "ppt",
};
const targetTypes = new Set(Object.values(typeMap));
const actualTypes = new Set(files.map((f) => typeMap[f.ext]).filter(Boolean));
const typeCoverage = [...targetTypes].filter((t) => actualTypes.has(t)).length / targetTypes.size;

console.log(`  目标类型: ${[...targetTypes].join(", ")}`);
console.log(`  实际类型: ${[...actualTypes].join(", ")}`);
console.log(`  覆盖率: ${(typeCoverage * 100).toFixed(0)}%`);
console.log(`  阈值: 100%`);
console.log(`  评价: ${typeCoverage >= 1.0 ? "✅ 达标" : "❌ 需改进"}\n`);

// 4. Structural Conformance（结构符合度）
console.log("━━━ 4. Structural Conformance（结构符合度）━━━");
console.log("定义: 文档结构符合其类型模板的比例\n");

// 检查各类文档的结构要素
const structuralChecks = {
  email: { required: ["subject:", "from:", "to:"], found: 0, total: 0 },
  json: { required: ["{", "}"], found: 0, total: 0 },
};

for (const file of files) {
  const type = typeMap[file.ext];
  if (!structuralChecks[type]) continue;

  const text = readFileSync(file.path, "utf-8").slice(0, 2000);
  structuralChecks[type].total++;

  const hasAll = structuralChecks[type].required.every((r) =>
    text.toLowerCase().includes(r.toLowerCase())
  );
  if (hasAll) structuralChecks[type].found++;
}

let totalConformance = 0;
let conformanceCount = 0;

for (const [type, check] of Object.entries(structuralChecks)) {
  if (check.total === 0) continue;
  const rate = check.found / check.total;
  console.log(`  ${type}: ${check.found}/${check.total} (${(rate * 100).toFixed(0)}%)`);
  totalConformance += rate;
  conformanceCount++;
}

const avgConformance = conformanceCount > 0 ? totalConformance / conformanceCount : 0;
console.log(`\n  平均符合度: ${(avgConformance * 100).toFixed(0)}%`);
console.log(`  阈值: >= 80%`);
console.log(`  评价: ${avgConformance >= 0.8 ? "✅ 达标" : "❌ 需改进"}\n`);

// 5. Fluency（流畅度）- LLM-as-judge
console.log("━━━ 5. Fluency（流畅度）━━━");
console.log("定义: 语言流畅度（LLM-as-judge 评分 1-5）\n");

const mimoKey = getApiKey("mimo");
let fluencyScore = 0;
let fluencyCount = 0;

if (!mimoKey) {
  console.log(`  ⚠️  无 MiMo API key，跳过 Fluency 评分\n`);
} else {
  // 采样 5 个文件评分
  const fluencySamples = contents.slice(0, 5);
  const scores = [];

  for (const file of fluencySamples) {
    const text = file.text;
    if (!text || text.length < 100) continue; // 跳过太短的文本

    const score = await scoreFluency(text, mimoKey);
    if (score > 0) {
      scores.push(score);
      console.log(`  ${file.name}: ${score}/5`);
    }
  }

  if (scores.length > 0) {
    fluencyScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    fluencyCount = scores.length;
    console.log(`\n  平均分: ${fluencyScore.toFixed(2)}/5 (${fluencyCount} 个样本)`);
    console.log(`  阈值: >= 3.5/5`);
    console.log(`  评价: ${fluencyScore >= 4.0 ? "✅ 优秀" : fluencyScore >= 3.5 ? "✅ 可接受" : "❌ 需改进"}\n`);
  } else {
    console.log(`  ⚠️  无有效评分结果\n`);
  }
}

// ── 汇总报告 ──────────────────────────────────────────

console.log("╔══════════════════════════════════════════╗");
console.log("║         合成数据质量指标汇总             ║");
console.log("╠══════════════════════════════════════════╣");

const metrics = [
  { name: "Self-BLEU", value: selfBleu.toFixed(4), threshold: "< 0.50", pass: selfBleu < 0.5 },
  { name: "Uniqueness", value: uniqueness.toFixed(4), threshold: ">= 0.90", pass: uniqueness >= 0.90 },
  { name: "Type Coverage", value: `${(typeCoverage * 100).toFixed(0)}%`, threshold: "100%", pass: typeCoverage >= 1.0 },
  { name: "Structural Conformance", value: `${(avgConformance * 100).toFixed(0)}%`, threshold: ">= 80%", pass: avgConformance >= 0.8 },
  { name: "Fluency", value: fluencyCount > 0 ? `${fluencyScore.toFixed(2)}/5` : "N/A", threshold: ">= 3.5/5", pass: fluencyCount > 0 ? fluencyScore >= 3.5 : null },
];

for (const m of metrics) {
  const status = m.pass === null ? "⏭️" : m.pass ? "✅" : "❌";
  console.log(`║ ${status} ${m.name.padEnd(25)} ${m.value.padStart(8)} (阈值: ${m.threshold.padEnd(10)}) ║`);
}

console.log("╚══════════════════════════════════════════╝");

} // end main

main().catch(console.error);
