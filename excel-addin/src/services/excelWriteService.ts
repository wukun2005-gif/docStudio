/**
 * excelWriteService.ts — Excel.run() 封装
 *
 * 使用 Office.js 官方推荐的布局模式：
 * - `worksheet.getUsedRange()` 自动追踪内容边界（不手动计算行号）
 * - `chart.setPosition(startCell, endCell)` 锚定图表到指定单元格区域
 * - 每次写入后 sync → getUsedRange → 获取下一个空闲行
 *
 * 参考：
 * - https://learn.microsoft.com/zh-cn/office/dev/add-ins/excel/excel-add-ins-ranges-unbounded
 * - https://learn.microsoft.com/zh-cn/javascript/api/excel/excel.chart#excel-excel-chart-setposition-member(1)
 *
 * Excel JS API 1.10 兼容（getUsedRange / setPosition 自 1.1 起可用）
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
    citations?: Array<{ index: number; title: string; url: string }>;
    conditionalFormats?: Array<{
      range: string;
      type: 'colorScale' | 'dataBar';
    }>;
  }>;
}

// ── 布局常量 ──────────────────────────────────────────────────
/** 图表可视区域占用的行数 */
const CHART_HEIGHT_ROWS = 15;
/** 图表之间的间隔行数 */
const CHART_SPACING = 2;
/** 图表源数据写入的起始列（K 列，0-based = 10），避免与正文混排 */
const CHART_DATA_COL = 10;
/** 图表可视区域占用的列数（A-H，8 列） */
const CHART_WIDTH_COLS = 8;

// ── Sheet 名称清理 ────────────────────────────────────────────
function sanitizeSheetName(name: string): string {
  return name
    .replace(/[\\/*?:\[\]]/g, '')
    .slice(0, 31)
    .trim();
}

// ── 工具：获取 usedRange 的最后一行（0-based） ────────────────
/**
 * 调用 sheet.getUsedRange() 获取当前工作表中已使用的区域，
 * 返回其 rowCount（即内容占据的行数）。
 *
 * 必须在 context.sync() 之后调用，因为需要 load 属性。
 */
async function getUsedRowCount(context: Excel.RequestContext, sheet: Excel.Worksheet): Promise<number> {
  const usedRange = sheet.getUsedRange();
  usedRange.load('rowCount');
  await context.sync();
  return usedRange.rowCount;
}

// ── 段落写入 ──────────────────────────────────────────────────
/**
 * 从指定行开始写入段落，返回写入的段落数。
 * 调用方应在 sync 后用 getUsedRange 获取实际边界。
 */
function writeParagraphsAt(
  sheet: Excel.Worksheet,
  paragraphs: ExcelWritePayload['sheets'][number]['paragraphs'],
  startRow: number  // 0-based
): number {
  let row = startRow;

  for (const para of paragraphs) {
    const cell = sheet.getRangeByIndexes(row, 0, 1, 1);
    cell.values = [[para.text ?? '']];

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
        cell.values = [[`• ${para.text ?? ''}`]];
        cell.format.font.size = 11;
        break;
      case 'citation':
        cell.format.font.italic = true;
        cell.format.font.size = 10;
        cell.format.font.color = '#808080';
        break;
    }

    row++;
  }

  return paragraphs.length;
}

// ── 表格写入 ──────────────────────────────────────────────────
/**
 * 从指定行开始写入表格，返回占用的总行数。
 */
function writeTablesAt(
  sheet: Excel.Worksheet,
  tables: ExcelWritePayload['sheets'][number]['tables'],
  startRow: number  // 0-based
): number {
  if (!tables || tables.length === 0) return 0;

  let row = startRow;
  let totalRows = 0;

  for (const table of tables) {
    // 标题行
    if (table.title) {
      const titleCell = sheet.getRangeByIndexes(row, 0, 1, 1);
      titleCell.values = [[table.title]];
      titleCell.format.font.bold = true;
      titleCell.format.font.size = 12;
      row++;
      totalRows++;
    }

    const headerCount = table.headers.length;
    const rowCount = table.rows.length;

    // 表头
    const headerRow = sheet.getRangeByIndexes(row, 0, 1, headerCount);
    headerRow.values = [table.headers];
    headerRow.format.fill.color = '#4472C4';
    headerRow.format.font.bold = true;
    headerRow.format.font.color = '#FFFFFF';

    // 数据行
    if (rowCount > 0) {
      const dataRange = sheet.getRangeByIndexes(row + 1, 0, rowCount, headerCount);
      const rows2d = table.rows.map(r => {
        const padded = [...r];
        while (padded.length < headerCount) padded.push('');
        return padded.slice(0, headerCount);
      });
      dataRange.values = rows2d;
    }

    const tableRows = (table.title ? 1 : 0) + 1 + rowCount + 1; // title + header + data + spacing
    row += tableRows;
    totalRows += tableRows;
  }

  return totalRows;
}

// ── 图表写入（使用 setPosition 锚定） ────────────────────────
/**
 * 从指定行开始写入图表。
 *
 * 布局策略：
 * 1. 图表源数据写入 K 列（CHART_DATA_COL）起的侧栏区域，不与正文混排
 * 2. 用 chart.setPosition("A{row}", "H{row+15}") 锚定图表到正文区域
 * 3. 每个图表占 CHART_HEIGHT_ROWS 行 + CHART_SPACING 行间隔
 *
 * 返回占用的总行数（用于后续 getUsedRange 校准）。
 */
function writeChartsAt(
  sheet: Excel.Worksheet,
  charts: ExcelWritePayload['sheets'][number]['charts'],
  startRow: number  // 0-based
): number {
  if (!charts || charts.length === 0) return 0;

  const chartTypeMap: Record<string, Excel.ChartType> = {
    bar: Excel.ChartType.barClustered,
    column: Excel.ChartType.columnClustered,
    pie: Excel.ChartType.pie,
    line: Excel.ChartType.line,
    doughnut: Excel.ChartType.doughnut,
    scatter: Excel.ChartType.xyscatter,
  };

  let row = startRow;
  let totalRows = 0;

  for (const chart of charts) {
    // guard：空数据跳过
    if (!chart.series || chart.series.length === 0 || !chart.categories || chart.categories.length === 0) {
      console.warn(`[excelWriteService] 图表 "${chart.title}" 数据为空，跳过`);
      continue;
    }

    const chartType = chartTypeMap[chart.type] ?? Excel.ChartType.columnClustered;
    const seriesCount = chart.series.length;
    const categoryCount = chart.categories.length;

    // 1. 图表源数据写入侧栏列（K 列起）
    const dataRange = sheet.getRangeByIndexes(
      row,
      CHART_DATA_COL,
      categoryCount + 1,  // +1 for header row
      seriesCount + 1     // +1 for category column
    );

    const dataMatrix: (string | number)[][] = [];
    dataMatrix.push(['', ...chart.series.map(s => s.name)]);
    for (let i = 0; i < categoryCount; i++) {
      const dataRow: (string | number)[] = [chart.categories[i]];
      for (const s of chart.series) {
        dataRow.push(s.values?.[i] ?? 0);
      }
      dataMatrix.push(dataRow);
    }
    dataRange.values = dataMatrix;

    // 2. 创建图表
    const chartObj = sheet.charts.add(chartType, dataRange, Excel.ChartSeriesBy.columns);
    chartObj.title.text = chart.title;

    // 3. 用 setPosition 锚定图表到正文区域 A{row+1}:H{row+CHART_HEIGHT_ROWS}
    //    setPosition 自 ExcelApi 1.1 起可用，按单元格锚定
    const startCell = `A${row + 1}`;
    const endCell = `${getColumnLetter(CHART_WIDTH_COLS)}${row + CHART_HEIGHT_ROWS}`;
    try {
      chartObj.setPosition(startCell, endCell);
    } catch {
      // Fallback: left/top (points)
      try {
        chartObj.left = 0;
        chartObj.top = row * 15;
        chartObj.width = 400;
        chartObj.height = 220;
      } catch {
        console.warn(`[excelWriteService] 图表 "${chart.title}" 定位失败，使用默认位置`);
      }
    }

    const chartRows = CHART_HEIGHT_ROWS + CHART_SPACING;
    row += chartRows;
    totalRows += chartRows;
  }

  return totalRows;
}

/** 将 0-based 列号转换为 Excel 字母（0=A, 7=H, 25=Z） */
function getColumnLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

// ── 参考来源写入（带 HYPERLINK 公式，兼容 Excel Online） ──────────
function writeCitationsAt(
  sheet: Excel.Worksheet,
  citations: ExcelWritePayload['sheets'][number]['citations'],
  startRow: number  // 0-based
): number {
  if (!citations || citations.length === 0) return 0;

  let row = startRow;

  // 标题
  const titleCell = sheet.getRangeByIndexes(row, 0, 1, 3);
  titleCell.values = [['参考来源', '', '']];
  titleCell.format.font.bold = true;
  titleCell.format.font.size = 12;
  titleCell.format.fill.color = '#E2EFDA';
  row++;

  // 表头
  const headerRow = sheet.getRangeByIndexes(row, 0, 1, 3);
  headerRow.values = [['编号', '标题', '链接']];
  headerRow.format.font.bold = true;
  headerRow.format.fill.color = '#4472C4';
  headerRow.format.font.color = '#FFFFFF';
  row++;

  // 数据行（用 HYPERLINK 公式实现可点击链接，兼容 Excel Online）
  for (const cit of citations) {
    const dataRow = sheet.getRangeByIndexes(row, 0, 1, 3);
    dataRow.values = [[`[${cit.index}]`, cit.title, '']];
    dataRow.format.font.size = 10;

    // 标题列：HYPERLINK 公式
    if (cit.url) {
      const titleCell2 = sheet.getRangeByIndexes(row, 1, 1, 1);
      const safeTitle = cit.title.replace(/"/g, '""');
      titleCell2.formulas = [[`=HYPERLINK("${cit.url}","${safeTitle}")`]];
      titleCell2.format.font.color = '#0563C1';
      titleCell2.format.font.underline = 'Single';

      // 链接列：也显示为可点击 URL
      const linkCell = sheet.getRangeByIndexes(row, 2, 1, 1);
      linkCell.formulas = [[`=HYPERLINK("${cit.url}","${cit.url}")`]];
      linkCell.format.font.color = '#0563C1';
      linkCell.format.font.underline = 'Single';
    }

    row++;
  }

  return citations.length + 2 + 1; // citations + title + header + spacing
}

// ── 主入口 ────────────────────────────────────────────────────
export async function writeToWorkbook(payload: ExcelWritePayload): Promise<void> {
  await Excel.run(async (context) => {
    const workbook = context.workbook;

    for (let i = 0; i < payload.sheets.length; i++) {
      const sheetData = payload.sheets[i];
      const safeName = sanitizeSheetName(sheetData.name);

      try {
        // 创建 Sheet
        let sheet: Excel.Worksheet;
        try {
          sheet = workbook.worksheets.add(safeName);
          await context.sync();
        } catch {
          sheet = workbook.worksheets.add(`${safeName.slice(0, 27)}_${i + 1}`);
          await context.sync();
        }

        // ── 1. 写入段落 ──
        writeParagraphsAt(sheet, sheetData.paragraphs, 0);
        await context.sync();

        // 用 getUsedRange 获取实际内容边界
        let usedRows = await getUsedRowCount(context, sheet);

        // ── 2. 写入表格 ──
        if (sheetData.tables && sheetData.tables.length > 0) {
          writeTablesAt(sheet, sheetData.tables, usedRows + 1);
          await context.sync();
          usedRows = await getUsedRowCount(context, sheet);
        }

        // ── 3. 写入图表（用 setPosition 锚定） ──
        if (sheetData.charts && sheetData.charts.length > 0) {
          try {
            writeChartsAt(sheet, sheetData.charts, usedRows + CHART_SPACING);
            await context.sync();
            usedRows = await getUsedRowCount(context, sheet);
          } catch (chartErr) {
            console.error(`[excelWriteService] Sheet "${safeName}" 图表写入失败:`, chartErr);
          }
        }

        // ── 4. 写入参考来源 ──
        if (sheetData.citations && sheetData.citations.length > 0) {
          try {
            writeCitationsAt(sheet, sheetData.citations, usedRows + CHART_SPACING);
            await context.sync();
          } catch (citErr) {
            console.error(`[excelWriteService] Sheet "${safeName}" 参考来源写入失败:`, citErr);
          }
        }

      } catch (err) {
        console.error(`[excelWriteService] Sheet "${safeName}" 写入失败:`, err);
      }
    }
  });
}
