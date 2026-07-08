/**
 * contextReader.ts — 读取当前工作簿上下文
 *
 * 获取当前工作簿的选中区域或已用区域内容，
 * 作为生成上下文传递给服务端。
 */

/**
 * 读取当前工作簿已用区域内容
 * @returns 文本形式的上下文
 */
export async function readWorkbookContext(maxLength = 4000): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (Excel as any).run(async (context: any) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getUsedRange();
      range.load('values');
      await context.sync();

      const values = range.values as string[][];
      return JSON.stringify(values).slice(0, maxLength);
    });
    return '';
  } catch {
    return '';
  }
}
