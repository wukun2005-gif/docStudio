/**
 * excelWriteService.ts — Excel.run() 封装
 *
 * 核心：将服务端返回的结构化数据（ExcelWritePayload）
 * 通过 Excel JS API 写入当前工作簿。
 *
 * 使用 Excel JS API 1.10 子集：
 * - Sheet 创建 / Range 写入
 * - Table 对象
 * - ChartCollection.add()
 * - ConditionalFormatCollection
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

// ── Sheet 名称清理 ────────────────────────────────────────────
function sanitizeSheetName(name: string): string {
  // Excel Sheet 名称限制：最多 31 字符，不能包含 \ / * ? : [ ]
  return name
    .replace(/[\\/*?:\[\]]/g, '')
    .slice(0, 31)
    .trim();
}

// ── 段落写入 ──────────────────────────────────────────────────
function writeParagraphs(
  sheet: Excel.Worksheet,
  paragraphs: ExcelWritePayload['sheets'][number]['paragraphs']
): number {
  let currentRow = 2; // 从第 2 行开始（第 1 行留给可能的标题）

  for (const para of paragraphs) {
    const cell = sheet.getRangeByIndexes(currentRow - 1, 0, 1, 1);
    cell.values = [[para.text]];

    // 根据样式设置格式
    switch (para.style) {
      case 'heading1':
        cell.format.font.bold = true;
        cell.format.font.size = 14;
        break;
      case 'heading2':
        cell.format.font.bold = true;
        cell.format.font.size = 12;
        break;
      case 'body':
        cell.format.font.size = 11;
        break;
      case 'bullet':
        cell.values = [[`• ${para.text}`]];
        cell.format.font.size = 11;
        break;
      case 'citation':
        cell.format.font.italic = true;
        cell.format.font.size = 10;
        cell.format.font.color = 'rgb(128,128,128)';
        break;
    }

    // 自动调整列宽
    sheet.getUsedRange().format.autofitColumns();

    currentRow++;
  }

  return currentRow;
}

// ── 表格写入 ──────────────────────────────────────────────────
function writeTables(
  sheet: Excel.Worksheet,
  tables: ExcelWritePayload['sheets'][number]['tables'],
  startRow: number
): number {
  if (!tables || tables.length === 0) return startRow;

  let currentRow = startRow;

  for (const table of tables) {
    if (table.title) {
      const titleCell = sheet.getRangeByIndexes(currentRow - 1, 0, 1, 1);
      titleCell.values = [[table.title]];
      titleCell.format.font.bold = true;
      titleCell.format.font.size = 12;
      currentRow++;
    }

    const headerCount = table.headers.length;
    const rowCount = table.rows.length;
    const tableRange = sheet.getRangeByIndexes(
      currentRow - 1,
      0,
      rowCount + 1,
      headerCount
    );

    // 写入表头
    const headerRow = sheet.getRangeByIndexes(currentRow - 1, 0, 1, headerCount);
    headerRow.values = [table.headers];
    headerRow.format.fill.color = 'rgb(68,114,196)';
    headerRow.format.font.bold = true;
    headerRow.format.font.color = 'rgb(255,255,255)';

    // 写入数据行
    if (rowCount > 0) {
      const dataRange = sheet.getRangeByIndexes(currentRow, 0, rowCount, headerCount);
      dataRange.values = table.rows;
    }

    // 创建 Excel Table 对象
    sheet.tables.add(tableRange, true);

    // 自动调整列宽
    sheet.getUsedRange().format.autofitColumns();

    currentRow += rowCount + 2; // +1 for header, +1 for spacing
  }

  return currentRow;
}

// ── 图表写入 ──────────────────────────────────────────────────
function writeCharts(
  sheet: Excel.Worksheet,
  charts: ExcelWritePayload['sheets'][number]['charts'],
  afterRow: number
): void {
  if (!charts || charts.length === 0) return;

  // Excel JS API 1.10 支持的图表类型映射（驼峰命名）
  const chartTypeMap: Record<string, Excel.ChartType> = {
    bar: Excel.ChartType.barClustered,
    column: Excel.ChartType.columnClustered,
    pie: Excel.ChartType.pie,
    line: Excel.ChartType.line,
    doughnut: Excel.ChartType.doughnut,
    scatter: Excel.ChartType.xyscatter,
  };

  for (const chart of charts) {
    const chartType = chartTypeMap[chart.type] ?? Excel.ChartType.columnClustered;

    // 构建图表数据范围
    const seriesCount = chart.series.length;
    const categoryCount = chart.categories.length;

    // 在工作簿中预留数据区域
    const dataStartRow = afterRow + 1;
    const dataRange = sheet.getRangeByIndexes(
      dataStartRow - 1,
      0,
      categoryCount + 1,
      seriesCount + 1
    );

    // 构建数据矩阵
    const dataMatrix: (string | number)[][] = [];
    // 第一行：系列名称
    dataMatrix.push(['', ...chart.series.map(s => s.name)]);
    // 数据行
    for (let i = 0; i < categoryCount; i++) {
      const row: (string | number)[] = [chart.categories[i]];
      for (const s of chart.series) {
        row.push(s.values[i] ?? 0);
      }
      dataMatrix.push(row);
    }

    dataRange.values = dataMatrix;

    // 创建图表
    const chartObj = sheet.charts.add(
      chartType,
      dataRange,
      Excel.ChartSeriesBy.columns
    );
    chartObj.title.text = chart.title;

    // 移动图表位置（在数据区域右侧）
    chartObj.setPosition(
      sheet.getRangeByIndexes(dataStartRow - 1, seriesCount + 2, 1, 1)
    );

    afterRow += categoryCount + 3;
  }
}

// ── 条件格式 ──────────────────────────────────────────────────
function writeConditionalFormats(
  sheet: Excel.Worksheet,
  formats: ExcelWritePayload['sheets'][number]['conditionalFormats']
): void {
  if (!formats || formats.length === 0) return;

  for (const cf of formats) {
    const range = sheet.getRange(cf.range);

    if (cf.type === 'colorScale') {
      const cfObj = range.conditionalFormats.add(Excel.ConditionalFormatType.colorScale);
      // 默认三色阶：红-黄-绿
      cfObj.colorScale.criteria = {
        minimum: {
          type: Excel.ConditionalFormatColorCriterionType.lowestValue,
          color: 'rgb(248,105,107)',
        },
        midpoint: {
          type: Excel.ConditionalFormatColorCriterionType.percentile,
          color: 'rgb(255,235,132)',
          formula: '50',
        },
        maximum: {
          type: Excel.ConditionalFormatColorCriterionType.highestValue,
          color: 'rgb(99,190,123)',
        },
      };
    } else if (cf.type === 'dataBar') {
      const cfObj = range.conditionalFormats.add(Excel.ConditionalFormatType.dataBar);
      cfObj.dataBar.barDirection = Excel.ConditionalDataBarDirection.leftToRight;
    }
  }
}

// ── 来源批注 ──────────────────────────────────────────────────
// Note: Range.comments 需要 ExcelApi 1.12+，当前声明 1.10
// 使用 try-catch 降级，不支持时静默跳过
function writeSourceComments(
  sheet: Excel.Worksheet,
  paragraphs: ExcelWritePayload['sheets'][number]['paragraphs']
): void {
  let row = 2; // 从第 2 行开始
  for (const para of paragraphs) {
    if (para.sourceName || para.sourceChunkId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cell = (sheet as any).getRangeByIndexes(row - 1, 0, 1, 1);
        const commentText = `来源: ${para.sourceName ?? para.sourceChunkId}\n可信度: ${(para.groundingScore ?? 0).toFixed(2)}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cell as any).comments.add(commentText);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cell as any).comments.visible = false;
      } catch {
        // 静默跳过（ExcelApi < 1.12 不支持批注）
      }
    }
    row++;
  }
}

// ── 主入口 ────────────────────────────────────────────────────
export async function writeToWorkbook(payload: ExcelWritePayload): Promise<void> {
  await Excel.run(async (context) => {
    const workbook = context.workbook;

    for (const sheetData of payload.sheets) {
      // 创建 Sheet（名称清理）
      const safeName = sanitizeSheetName(sheetData.name);
      let sheet: Excel.Worksheet;
      try {
        sheet = workbook.worksheets.add(safeName);
      } catch {
        // 名称冲突时追加序号
        sheet = workbook.worksheets.add(`${safeName}_${Date.now()}`);
      }

      // 写入段落
      const paragraphEndRow = writeParagraphs(sheet, sheetData.paragraphs);

      // 写入表格
      const tableEndRow = writeTables(sheet, sheetData.tables, paragraphEndRow + 1);

      // 写入图表
      writeCharts(sheet, sheetData.charts, tableEndRow);

      // 条件格式
      writeConditionalFormats(sheet, sheetData.conditionalFormats);

      // 来源批注（降级处理）
      writeSourceComments(sheet, sheetData.paragraphs);
    }

    await context.sync();
  });
}
