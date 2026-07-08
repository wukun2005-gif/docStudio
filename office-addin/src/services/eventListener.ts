/**
 * eventListener.ts — Excel 事件监听
 *
 * 监听选择变更和内容变更，实现上下文感知联动。
 */

let selectionHandler: OfficeExtension.EventHandlerResult<unknown> | null = null;

/**
 * 注册 Excel 选择变更监听器
 * @param onSelectionChanged 选择变更回调（接收选中区域 A1 格式地址）
 */
export async function registerSelectionChangeListener(
  onSelectionChanged: (address: string, sheetName: string) => void
): Promise<void> {
  try {
    await Excel.run(async (context) => {
      const worksheet = context.workbook.worksheets.getActiveWorksheet();
      selectionHandler = worksheet.onSelectionChanged.add(async () => {
        await Excel.run(async (ctx) => {
          const range = ctx.workbook.getSelectedRange();
          range.load('address');
          await ctx.sync();
          // address 格式: "Sheet1!A1:B2"
          const address = range.address as string;
          const parts = address.split('!');
          const sheetName = parts[0] ?? '';
          const cellAddress = parts[1] ?? address;
          onSelectionChanged(cellAddress, sheetName);
        });
      });
      await context.sync();
    });
  } catch (err) {
    console.warn('[eventListener] 注册选择监听失败:', err);
  }
}

/**
 * 注销所有事件监听器
 */
export async function unregisterEventListeners(): Promise<void> {
  try {
    if (selectionHandler) {
      await Excel.run(async (context) => {
        selectionHandler?.remove();
        await context.sync();
      });
      selectionHandler = null;
    }
  } catch (err) {
    console.warn('[eventListener] 注销监听失败:', err);
  }
}
