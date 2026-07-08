/**
 * excelWriteService.ts — Excel.run() 封装
 *
 * 核心：将服务端返回的结构化数据（ExcelWritePayload）
 * 通过 Excel JS API 写入当前工作簿。
 *
 * Phase 2 实现完整写入逻辑（Sheet 创建、段落、表格、图表、条件格式）。
 */

export interface ExcelWritePayload {
  sheets: Array<{
    name: string;
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
      startRow?: number;
    }>;
    charts?: Array<{
      type: 'bar' | 'column' | 'pie' | 'line' | 'doughnut' | 'scatter';
      title: string;
      categories: string[];
      series: Array<{ name: string; values: number[] }>;
      afterRow?: number;
    }>;
    conditionalFormats?: Array<{
      range: string;
      type: 'colorScale' | 'dataBar';
    }>;
  }>;
}

/**
 * 将 ExcelWritePayload 写入当前工作簿
 * TODO: Phase 2 实现
 */
export async function writeToWorkbook(payload: ExcelWritePayload): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Excel as any).run(async (context: any) => {
    console.log('[excelWriteService] Payload received:', payload.sheets.length, 'sheets');
    await context.sync();
  });
}
