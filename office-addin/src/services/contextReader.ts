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
    const result = await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getUsedRange();
      range.load('values');
      await context.sync();

      const values = range.values as string[][];
      return JSON.stringify(values).slice(0, maxLength);
    });
    return result ?? '';
  } catch {
    return '';
  }
}

/**
 * 读取当前选中区域的值
 * @returns 选中区域的文本表示
 */
export async function readSelectedRange(): Promise<string> {
  try {
    const result = await Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load('values, address');
      await context.sync();

      const values = range.values as string[][];
      return {
        address: range.address as string,
        text: values.map(row => row.join('\t')).join('\n'),
      };
    });
    return result?.text ?? '';
  } catch {
    return '';
  }
}
