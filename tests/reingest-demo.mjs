/**
 * 直接对生产 DB 执行完整的入库流程：文本提取 → 分块 → embedding → 向量入库
 * 用于重新入库 3 个 DEMO 知识源
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnvFile } from "./e2e-shared/env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

loadEnvFile();

// 动态导入项目模块（需要 tsx 支持）
const { getDb } = await import(path.join(PROJECT_ROOT, "server/src/lib/db.ts"));
const { addSource, addChunks, addVectors, updateSourceStatus, computeTextHash } = await import(path.join(PROJECT_ROOT, "server/src/lib/knowledgeDb.ts"));
const { preprocessText } = await import(path.join(PROJECT_ROOT, "server/src/lib/textPreprocess.ts"));
const { chunkText, isNoise, isGarbled } = await import(path.join(PROJECT_ROOT, "server/src/lib/textChunker.ts"));

const FILES = [
  { path: "samples/documents/产品规划文档-Q3-2026.docx", name: "产品规划文档 - Q3 2026" },
  { path: "samples/documents/i-Write技术团队周报-2026-W24.docx", name: "i-Write 技术团队周报 - 2026-W24" },
  { path: "samples/documents/i-Write技术团队周报-2026-W23.docx", name: "i-Write 技术团队周报 - 2026-W23" },
];

// Embedding 配置
const EMB_BASE_URL = "https://api.siliconflow.cn/v1";
const EMB_MODEL_ID = "BAAI/bge-m3";
const EMB_API_KEY = process.env.siliconflow_Key;

async function embedBatch(texts) {
  const resp = await fetch(`${EMB_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMB_API_KEY}` },
    body: JSON.stringify({ model: EMB_MODEL_ID, input: texts.map(t => t.slice(0, 500)) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Embedding API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.data.map(d => d.embedding);
}

// docx 文本提取 — 在段落边界插入换行
async function extractDocxText(buffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("text");
  if (!docXml) return "";

  // 按 <w:p> 分段，在段落间插入换行
  const paragraphs = [];
  const paraRegex = /<w:p[\s>]([\s\S]*?)<\/w:p>/g;
  let paraMatch;
  while ((paraMatch = paraRegex.exec(docXml)) !== null) {
    const paraXml = paraMatch[1];
    const texts = [];
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(paraXml)) !== null) {
      texts.push(tMatch[1]);
    }
    const paraText = texts.join("").trim();
    if (paraText) paragraphs.push(paraText);
  }

  // 提取表格
  const rows = [];
  const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(docXml)) !== null) {
    const cells = [];
    const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const cellTexts = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(cellMatch[1])) !== null) {
        cellTexts.push(tMatch[1]);
      }
      cells.push(cellTexts.join(""));
    }
    if (cells.length > 0) rows.push(cells.join(" | "));
  }

  let text = paragraphs.join("\n\n");
  if (rows.length > 0) text += "\n\n" + rows.join("\n");
  return text;
}

async function main() {
  if (!EMB_API_KEY) {
    console.error("ERROR: 未找到 siliconflow_Key");
    process.exit(1);
  }

  console.log("=== 重新入库 DEMO 知识源 ===\n");

  for (const file of FILES) {
    const absPath = path.join(PROJECT_ROOT, file.path);
    const buffer = fs.readFileSync(absPath);
    const fileName = path.basename(file.path);

    console.log(`📄 处理: ${fileName}`);

    // Step 1: 提取文本
    const rawText = await extractDocxText(buffer);
    console.log(`   提取文本: ${rawText.length} 字符`);

    // Step 2: 预处理
    const cleanText = preprocessText(rawText);
    console.log(`   预处理后: ${cleanText.length} 字符`);

    // Step 3: 分块
    const chunks = chunkText(cleanText, fileName);
    console.log(`   分块: ${chunks.length} 块`);

    // Step 4: 去噪
    const validChunks = chunks.filter(c => !isNoise(c.text) && !isGarbled(c.text));
    console.log(`   有效块: ${validChunks.length} 块`);

    if (validChunks.length === 0) {
      console.log(`   ⚠️ 无有效内容，跳过`);
      continue;
    }

    // Step 5: 入库
    const sourceId = crypto.randomUUID();
    const rawHash = computeTextHash(rawText);

    addSource({
      id: sourceId,
      name: file.name,
      type: "docx",
      filePath: fileName,
      contentHash: rawHash,
      chunkCount: validChunks.length,
      status: "processing",
    });

    const chunkRecords = validChunks.map(c => ({
      id: `${sourceId}-c${c.idx}`,
      sourceId,
      content: c.text,
      chunkIndex: c.idx,
      tokenCount: c.text.length,
      metadata: c.metadata,
    }));
    addChunks(chunkRecords);
    console.log(`   入库: source + ${chunkRecords.length} chunks`);

    // Step 6: Embedding
    try {
      const texts = chunkRecords.map(c => c.content);
      const vectors = await embedBatch(texts);
      const vectorRecords = chunkRecords.map((c, i) => ({
        chunkId: c.id,
        embedding: vectors[i],
        modelId: EMB_MODEL_ID,
      }));
      addVectors(vectorRecords);
      updateSourceStatus(sourceId, "ready");
      console.log(`   ✅ 向量化: ${vectors.length} 个向量`);
    } catch (err) {
      console.error(`   ❌ Embedding 失败: ${err.message}`);
      updateSourceStatus(sourceId, "ready");
    }
  }

  // 验证
  console.log("\n=== 验证 ===");
  const db = getDb();
  const sources = db.prepare("SELECT name, type, file_path, chunk_count, status FROM kb_sources WHERE type = 'docx' AND (name LIKE '%周报%' OR name LIKE '%产品规划%')").all();
  for (const s of sources) {
    console.log(`  📄 ${s.name} — ${s.chunk_count} 块, file: ${s.file_path}, status: ${s.status}`);
  }
  const totalChunks = db.prepare("SELECT COUNT(*) as c FROM kb_chunks").get();
  const totalVectors = db.prepare("SELECT COUNT(*) as c FROM kb_vectors").get();
  console.log(`\n总计: ${sources.length} 新知识源, ${totalChunks.c} 总块数, ${totalVectors.c} 总向量数`);
}

main().catch(e => { console.error(e); process.exit(1); });
