const Database = require("better-sqlite3");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = "/Users/wukun/Documents/tmp/docStudio/server/data/docstudio.db";
const db = new Database(DB_PATH);

// Read .env for siliconflow key
const envContent = fs.readFileSync("/Users/wukun/Documents/tmp/docStudio/.env", "utf-8");
const siliconflowKey = envContent.match(/siliconflow_Key=(.+)/)?.[1]?.trim();
if (!siliconflowKey) {
  console.log("No siliconflow_Key found in .env!");
  process.exit(1);
}

const embedConfig = {
  baseUrl: "https://api.siliconflow.cn/v1",
  apiKey: siliconflowKey,
  modelId: "BAAI/bge-m3",
};
console.log(`Embedding config: ${embedConfig.baseUrl}, model=${embedConfig.modelId}`);

function chunkText(text, maxChars = 600) {
  const sentences = text.split(/(?<=[。！？.!?]\s*)/);
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

function computeHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

async function getEmbedding(text) {
  const resp = await fetch(`${embedConfig.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${embedConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: embedConfig.modelId,
      input: text,
      encoding_format: "float",
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Embedding API error: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  return data.data[0].embedding;
}

const files = [
  {
    path: "/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-技术架构演进报告.docx",
    name: "Q3-技术架构演进报告.docx",
  },
  {
    path: "/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-GitHub开发活跃度报告.docx",
    name: "Q3-GitHub开发活跃度报告.docx",
  },
  {
    path: "/Users/wukun/Documents/tmp/docStudio/samples/q3-report/Q3-协作效能分析报告.docx",
    name: "Q3-协作效能分析报告.docx",
  },
];

(async () => {
  for (const f of files) {
    const { execSync } = require("child_process");
    let text;
    try {
      text = execSync(`pandoc "${f.path}" -t plain 2>/dev/null`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      console.log(`Failed to extract ${f.name}: ${e.message}`);
      continue;
    }

    const sourceId = crypto.randomUUID();
    const contentHash = computeHash(text);

    db.prepare(`
      INSERT OR REPLACE INTO kb_sources (id, name, type, file_path, content_hash, chunk_count, status, created_at, updated_at)
      VALUES (?, ?, 'docx', ?, ?, 0, 'ready', datetime('now'), datetime('now'))
    `).run(sourceId, f.name, f.path, contentHash);

    const chunks = chunkText(text, 600);
    let chunkIdx = 0;
    for (const chunk of chunks) {
      const chunkId = crypto.randomUUID();
      const textHash = computeHash(chunk);

      let embedding = null;
      try {
        const vec = await getEmbedding(chunk);
        embedding = Buffer.from(new Float64Array(vec).buffer);
      } catch (e) {
        console.log(`  Embedding failed for chunk ${chunkIdx}: ${e.message}`);
      }

      db.prepare(`
        INSERT INTO kb_chunks (id, source_id, content, chunk_index, token_count, metadata, embedded, text_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chunkId, sourceId, chunk, chunkIdx, Math.ceil(chunk.length / 4), JSON.stringify({}), embedding ? 1 : 0, textHash);

      if (embedding) {
        db.prepare(`
          INSERT INTO kb_vectors (chunk_id, embedding, model_id)
          VALUES (?, ?, ?)
        `).run(chunkId, embedding, embedConfig.modelId);
      }

      chunkIdx++;
    }

    db.prepare(`UPDATE kb_sources SET chunk_count = ? WHERE id = ?`).run(chunks.length, sourceId);

    console.log(`Imported: ${f.name} → ${chunks.length} chunks${chunkIdx > 0 ? ' (with embeddings)' : ''}`);
  }

  db.close();
  console.log("Done!");
})();
