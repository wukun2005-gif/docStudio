/**
 * 生成 3 个 DEMO 知识源的 .docx 文件
 * 从 DB chunks 还原内容，写入 samples/documents/
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dbPath = path.resolve("server/data/docstudio.db");
const samplesDir = path.resolve("samples/documents");

const db = new Database(dbPath, { readonly: true });

const SOURCES = [
  { id: "7a64d646-8a81-44e6-81d5-0ff239cfeb60", fileName: "产品规划文档-Q3-2026.docx" },
  { id: "bf0c6b6f-6243-4246-bb02-d9b9fb5247bc", fileName: "i-Write技术团队周报-2026-W24.docx" },
  { id: "e26d8ec8-ece0-42f7-8388-1b27979798e4", fileName: "i-Write技术团队周报-2026-W23.docx" },
];

/** 简易 markdown → docx 段落转换 */
function mdToParagraphs(md) {
  const lines = md.split("\n");
  const paragraphs = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 标题
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
      paragraphs.push(new Paragraph({
        heading: headingMap[level],
        children: [new TextRun({ text: headingMatch[2], bold: true })],
      }));
      continue;
    }

    // 列表项
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      // 解析内联粗体
      const children = parseInline(listMatch[1]);
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children,
      }));
      continue;
    }

    // 有序列表
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      const children = parseInline(olMatch[1]);
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children,
      }));
      continue;
    }

    // 普通段落
    paragraphs.push(new Paragraph({
      children: parseInline(trimmed),
      spacing: { after: 120 },
    }));
  }

  return paragraphs;
}

/** 解析行内 markdown（粗体） */
function parseInline(text) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      runs.push(new TextRun({ text: boldMatch[1], bold: true }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

async function main() {
  for (const src of SOURCES) {
    const rows = db.prepare("SELECT content FROM kb_chunks WHERE source_id = ? ORDER BY chunk_index").all(src.id);
    const fullMd = rows.map(r => r.content).join("\n\n");
    const paragraphs = mdToParagraphs(fullMd);

    const doc = new Document({
      sections: [{ children: paragraphs }],
      title: src.fileName.replace(".docx", ""),
    });

    const buffer = await Packer.toBuffer(doc);
    const outPath = path.join(samplesDir, src.fileName);
    fs.writeFileSync(outPath, buffer);
    console.log(`✅ ${src.fileName} (${buffer.length} bytes)`);
  }

  // 清理旧的 .md 文件
  for (const name of ["产品规划文档-Q3-2026.md", "i-Write技术团队周报-2026-W24.md", "i-Write技术团队周报-2026-W23.md"]) {
    const p = path.join(samplesDir, name);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`🗑  deleted ${name}`); }
  }

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
