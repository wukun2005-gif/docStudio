/**
 * wordWriteService.ts — Word.run() 封装
 *
 * 使用 Word JS API 将结构化内容写入 Word 文档。
 * 核心策略：将每个 section 转为 HTML 片段，用 insertHtml 一次性插入。
 * 这比逐个 insertParagraph 更可靠，尤其适合 Word Online。
 */

export interface WordWritePayload {
  sections: Array<{
    title: string;
    paragraphs: Array<{
      text: string;
      style: 'heading1' | 'heading2' | 'body' | 'bullet' | 'citation';
      sourceChunkId?: string;
      sourceName?: string;
      groundingScore?: number;
    }>;
    tables?: Array<{
      title?: string;
      headers: string[];
      rows: string[][];
    }>;
    citations?: Array<{ index: number; title: string; url: string }>;
  }>;
}

/**
 * 将一个 section 转为 HTML 片段
 */
function sectionToHtml(section: WordWritePayload['sections'][number]): string {
  const parts: string[] = [];

  for (const para of section.paragraphs) {
    const text = (para.text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    switch (para.style) {
      case 'heading1':
        parts.push(`<h1>${text}</h1>`);
        break;
      case 'heading2':
        parts.push(`<h2>${text}</h2>`);
        break;
      case 'bullet':
        parts.push(`<p style="margin-left:24px">• ${text}</p>`);
        break;
      case 'citation':
        parts.push(`<p style="color:#808080;font-style:italic;font-size:9pt">${text}</p>`);
        break;
      default:
        parts.push(`<p style="font-size:11pt">${text}</p>`);
    }
  }

  // 表格
  if (section.tables) {
    for (const table of section.tables) {
      if (table.title) {
        parts.push(`<h3>${table.title}</h3>`);
      }
      parts.push('<table style="border-collapse:collapse;width:100%">');
      // 表头
      parts.push('<tr>');
      for (const h of table.headers) {
        parts.push(`<th style="border:1px solid #4472C4;background:#4472C4;color:#fff;padding:4px 8px;font-size:10pt">${h}</th>`);
      }
      parts.push('</tr>');
      // 数据行
      for (const row of table.rows) {
        parts.push('<tr>');
        for (const cell of row) {
          parts.push(`<td style="border:1px solid #D9E2F3;padding:4px 8px;font-size:10pt">${cell ?? ''}</td>`);
        }
        parts.push('</tr>');
      }
      parts.push('</table>');
    }
  }

  return parts.join('\n');
}

/**
 * 将参考来源转为 HTML
 */
function citationsToHtml(citations: Array<{ index: number; title: string; url: string }>): string {
  const parts: string[] = ['<h1>参考来源</h1>'];
  for (const cit of citations) {
    const text = `[${cit.index}] ${cit.title}`;
    if (cit.url) {
      parts.push(`<p><a href="${cit.url}">${text}</a></p>`);
    } else {
      parts.push(`<p style="color:#0563C1">${text}</p>`);
    }
  }
  return parts.join('\n');
}

// ── 主入口 ──────────────────────────────────────────

export async function writeToDocument(payload: WordWritePayload): Promise<void> {
  await Word.run(async (context) => {
    const body = context.document.body;

    // 找到 citations 所在的 section（通常是最后一个）
    const citSection = payload.sections.find(s => s.citations && s.citations.length > 0);

    for (let i = 0; i < payload.sections.length; i++) {
      const section = payload.sections[i];

      try {
        // 参考来源章节用专用 HTML
        if (section === citSection && section.citations && section.citations.length > 0 && section.paragraphs.length === 0) {
          const citHtml = citationsToHtml(section.citations);
          body.insertHtml(citHtml, 'End');
          await context.sync();
          continue;
        }

        // 将整个 section 转为 HTML 一次性插入
        const html = sectionToHtml(section);
        body.insertHtml(html, 'End');
        await context.sync();

        // 章节间加分隔
        body.insertParagraph('', 'End');
        await context.sync();
      } catch (err) {
        console.error(`[wordWriteService] Section "${section.title}" 写入失败:`, err);
      }
    }
  });
}