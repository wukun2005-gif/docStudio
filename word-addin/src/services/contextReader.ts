/**
 * contextReader.ts — 读取当前 Word 文档上下文
 *
 * 获取当前文档已选区域或全文内容，
 * 作为生成上下文传递给服务端。
 */

/**
 * 读取当前文档全文内容
 * @returns 文本形式的上下文
 */
export async function readDocumentContext(maxLength = 4000): Promise<string> {
  try {
    const result = await Word.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();

      return (body.text ?? '').slice(0, maxLength);
    });
    return result ?? '';
  } catch {
    return '';
  }
}

/**
 * 读取当前选中区域的文本
 * @returns 选中区域的文本
 */
export async function readSelectedText(): Promise<string> {
  try {
    const result = await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.load('text');
      await context.sync();

      return range.text ?? '';
    });
    return result ?? '';
  } catch {
    return '';
  }
}