/**
 * Office.js TypeScript 类型声明
 *
 * 扩展全局 Window 对象以包含 Office 命名空间。
 */

declare namespace Office {
  function onReady(callback: () => void): void;

  interface Context {
    host?: {
      hostType: string;
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Excel {
  function run<T>(callback: (context: Excel.RequestContext) => Promise<T>): Promise<T>;

  class RequestContext {
    workbook: Workbook;
    sync(): Promise<void>;
  }

  class Workbook {
    worksheets: WorksheetCollection;
  }

  class WorksheetCollection {
    getActiveWorksheet(): Worksheet;
    add(name: string): Worksheet;
  }

  class Worksheet {
    getUsedRange(): Range;
    getRangeByAddress(address: string): Range;
  }

  class Range {
    values: unknown[][];
    load(property: string): Range;
    rowCount: number;
    columnCount: number;
  }
}
