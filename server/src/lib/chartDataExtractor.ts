/**
 * Chart Data Extractor — 规则引擎兜底
 *
 * 当 LLM 既没输出 Python 脚本也没输出 chart JSON 时，
 * 用正则从纯文本中提取可图表化的数字数据。
 *
 * 三层提取策略：
 * 1. 结构化行解析（每行多列 → 找到数值列 → 用第一列做 label）
 * 2. "标签 + 数值 + 单位" 模式匹配（人/个/次/条/%）
 * 3. 去噪 + 去重 + 推断图表类型
 */
import type { ChartSpec } from "./docExporter.js";
import { logger } from "./logger.js";

// ── 工具函数 ────────────────────────────────────────────

/** 清理标签：去掉前导标点、括号内容、多余空格 */
function cleanLabel(raw: string): string {
  let s = raw
    .replace(/^[、，,，。；;：:\s]+/, "")   // 去前导标点
    .replace(/[（(][^)）]*[)）]/g, "")       // 去括号内容
    .replace(/[：:占比完成率分布数量达到约]/g, "") // 去统计关键词
    .trim();
  // 截断过长标签
  if (s.length > 12) s = s.slice(0, 10) + "…";
  return s || raw.trim().slice(0, 8);
}

/** 判断是否为有效的中文标签（至少含一个中文，不含纯数字/标点） */
function isValidLabel(s: string): boolean {
  return /[一-鿿]/.test(s) && s.length >= 2 && !/^\d+$/.test(s);
}

/** 非图表标签黑名单：动词/时间词/量词等不适合做图表 category 的词 */
const LABEL_BLACKLIST = /^(?:增长|下降|提升|减少|消息|数据|统计|总计|合计|平均|小计|环比|同比|上周|本周|下周|本月|上月|目前|当前|其中|其他|其它|备注|说明|来源)$/;

/** 标签包含这些模式 → 拒绝（较上周/同比增长等短语） */
const LABEL_REJECT_PATTERNS = /(?:较[上下去来今明前后]|增长|下降了?|提升了?|减少了?|同比|环比)/;

/** 最终标签校验：长度合理、非黑名单、不含时间/动词模式 */
function isValidChartLabel(s: string): boolean {
  if (!isValidLabel(s)) return false;
  if (LABEL_BLACKLIST.test(s)) return false;
  if (LABEL_REJECT_PATTERNS.test(s)) return false;
  if (s.length > 15) return false;
  return true;
}

// ── 结构化行解析 ────────────────────────────────────────

interface NumericGroup {
  label: string;
  value: number;
}

/**
 * 策略1：将文本按行拆分，检测"表格式"行（多列空白分隔，其中至少一列是纯数字）。
 * 取第一列非数字列为 label，第一个数值列为 value。
 */
function extractFromTableRows(text: string): NumericGroup[] {
  const groups: NumericGroup[] = [];
  const lines = text.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // 跳过 markdown 表格分隔行
    if (/^\|?\s*[-:| ]{3,}\s*\|?$/.test(line)) continue;

    // 按 | 分隔或 2+ 空白分隔
    const cols = line.includes("|")
      ? line.split("|").map((c) => c.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);

    if (cols.length < 2) continue;

    // 找到第一个数值列
    let numColIdx = -1;
    let numValue = NaN;
    for (let i = 0; i < cols.length; i++) {
      const m = cols[i]!.match(/^(\d+(?:\.\d+)?)\s*%?$/);
      if (m) {
        numColIdx = i;
        numValue = parseFloat(m[1]!);
        break;
      }
    }
    if (numColIdx < 0 || isNaN(numValue)) continue;

    // 取数值列之前的第一个有效列作为 label
    let labelColIdx = numColIdx - 1;
    while (labelColIdx >= 0) {
      const candidate = cols[labelColIdx]!;
      if (candidate && !/^\d+(?:\.\d+)?%?$/.test(candidate) && candidate.length >= 2) {
        const label = cleanLabel(candidate);
        if (isValidChartLabel(label)) {
          groups.push({ label, value: numValue });
          break;
        }
      }
      labelColIdx--;
    }
  }

  return groups;
}

/**
 * 策略2：正则匹配 "标签 + 数值 + 单位" 模式
 */
function extractFromPatterns(text: string): NumericGroup[] {
  const groups: NumericGroup[] = [];

  // ── "XX部 N 人" — 部门人员分布（允许 ASCII+中文混合，如 QA部）──
  const deptRegex = /([A-Za-z一-鿿]{2,10}(?:部|组|团队|中心))\s*(\d+(?:\.\d+)?)\s*(?:人|个|名)/g;
  let match;
  while ((match = deptRegex.exec(text)) !== null) {
    const label = cleanLabel(match[1]!);
    if (isValidChartLabel(label)) {
      groups.push({ label, value: parseFloat(match[2]!) });
    }
  }

  // ── "XX风格/类型/状态 占比/value N%" — 分布比例/完成度 ──
  // 匹配更宽泛：中文标签 + 百分比值。label 可以是"正式风格"或"已完成"等。
  const pctRegex = /([一-鿿A-Za-z]{2,10}(?:风格|类型|优先级|等级|状态)?)\s*(?:占比|占|比例为?|约为?|达到|完成)?\s*(\d+(?:\.\d+)?)\s*%/g;
  while ((match = pctRegex.exec(text)) !== null) {
    const label = cleanLabel(match[1]!);
    if (isValidChartLabel(label) && label.length <= 10) {
      groups.push({ label, value: parseFloat(match[2]!) });
    }
  }

  // ── "XX N 次/项/条" — 计数统计 ──
  const countRegex = /([A-Za-z一-鿿]{2,10}(?:部|组|团队)?)\s*(\d+(?:\.\d+)?)\s*(?:次|项|条|封|篇|个)/g;
  while ((match = countRegex.exec(text)) !== null) {
    const label = cleanLabel(match[1]!);
    if (isValidChartLabel(label) && label.length <= 10) {
      groups.push({ label, value: parseFloat(match[2]!) });
    }
  }

  // ── "高/中/低 优先级 平均 N 天" — 修复周期 ──
  const avgRegex = /([高中低])\s*(?:优(?:先级)?|严重)?\s*.*?(?:平均)\s*(\d+(?:\.\d+)?)\s*(?:天|日|小时)/g;
  while ((match = avgRegex.exec(text)) !== null) {
    const label = match[1]! + "优先级";
    if (isValidChartLabel(label)) {
      groups.push({ label, value: parseFloat(match[2]!) });
    }
  }

  return groups;
}

// ── 图表类型推断 ────────────────────────────────────────

function inferChartType(groups: NumericGroup[]): ChartSpec["type"] {
  if (groups.length === 0) return "column";

  const allSmallValues = groups.every((g) => g.value <= 100);
  const looksLikeProportion = allSmallValues && groups.length <= 6;

  // Pie: ≤6 个类别且值 ≤100 → 可能是分布/比例
  if (looksLikeProportion && groups.every((g) => g.value >= 0 && g.value <= 100)) {
    return "pie";
  }

  return "column";
}

// ── 主入口 ────────────────────────────────────────────────

/**
 * 从纯文本内容中尝试提取图表数据。
 * 策略1（表格行）→ 策略2（模式匹配）→ 去重 → 推断类型。
 * 返回 ChartSpec[] 供 Tier 2 模板使用，无法提取时返回 []。
 */
export function extractChartDataFromText(
  content: string,
  sectionTitle: string,
): ChartSpec[] {
  if (!content) return [];

  const plainText = content
    .replace(/<[^>]+>/g, "")   // 去 HTML 标签
    .replace(/\[(\d+)\]/g, "")  // 去引用标记
    .trim();

  // 策略1 + 策略2 并行提取
  const tableGroups = extractFromTableRows(plainText);
  const patternGroups = extractFromPatterns(plainText);

  // 合并：表格提取优先（更准确），模式匹配补充
  const allGroups = [...tableGroups];
  const seenLabels = new Set(tableGroups.map((g) => g.label));
  for (const g of patternGroups) {
    if (!seenLabels.has(g.label)) {
      allGroups.push(g);
      seenLabels.add(g.label);
    }
  }

  if (allGroups.length < 2) return [];

  // 按 sectionTitle 关键词分类：如果标题含"Bug"/"修复" → 只取 Bug 相关数据
  // 否则全部保留
  let filtered = allGroups;
  if (/bug|缺陷|修复/i.test(sectionTitle)) {
    filtered = allGroups.filter((g) => /bug|修复|高|中|低/.test(g.label));
    if (filtered.length < 2) filtered = allGroups; // 回退
  }

  if (filtered.length < 2) return [];

  const chartType = inferChartType(filtered);

  const spec: ChartSpec = {
    type: chartType,
    title: sectionTitle.slice(0, 30),
    categories: filtered.map((g) => g.label),
    series: [
      {
        name: sectionTitle.slice(0, 20),
        values: filtered.map((g) => g.value),
      },
    ],
  };

  logger.info(`[ChartDataExtractor] 规则引擎提取: ${filtered.length} 个数据点 → ${chartType} chart (表格=${tableGroups.length}, 模式=${patternGroups.length})`);
  return [spec];
}
