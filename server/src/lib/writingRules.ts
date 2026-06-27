/**
 * 全局写作规范 — Composable Prompt Layers 的 Rules Layer
 *
 * 定义可复用的写作规则，根据 style + format 组合返回适用的规则集
 */

export interface WritingRule {
  id: string;
  name: string;
  rule: string;
}

// ── 规则定义 ──────────────────────────────────────────────

export const RULES: Record<string, WritingRule> = {
  noRepeatTitle: {
    id: "no-repeat-title",
    name: "标题不重复",
    rule: "每个标题在全文中只能出现一次，禁止重复使用相同或高度相似的标题。如果需要引用前文内容，用概述而非重复标题。",
  },
  cjkSpacing: {
    id: "cjk-spacing",
    name: "中英文空格",
    rule: "中文与英文、数字之间必须加空格。例如：基于 TypeScript 构建、共 42 项任务、评分 85/100。",
  },
  punctuation: {
    id: "punctuation",
    name: "标点规范",
    rule: "标点符号规范：禁止连续使用两个标点（如。。、！！、，，）；每个句子结尾只用一个句号；省略号用……（六个点）。",
  },
  citationFormat: {
    id: "citation-format",
    name: "引用格式",
    rule: "引用参考信息时，用 [N] 标记来源编号。编号与前文文字之间加空格（如：评分 85/100 [3]）。引用编号不要紧跟在标点后面。",
  },
  listFormat: {
    id: "list-format",
    name: "列表格式",
    rule: "列表编号格式统一为 '1. '（数字+点+空格），不要用 '1.。'、'1、' 等格式。子列表缩进并用 a. b. c. 编号。",
  },
  paragraphLength: {
    id: "paragraph-length",
    name: "段落长度",
    rule: "每个段落不超过 5 句话。长段落应拆分为多个段落，每段一个核心观点。段落之间用空行分隔。",
  },
  tableConsistency: {
    id: "table-consistency",
    name: "表格一致性",
    rule: "表格的列数必须一致，每行的列数与表头相同。表格内容简洁，避免在单元格中写长段落。",
  },
  noLlmMeta: {
    id: "no-llm-meta",
    name: "禁止 LLM 元信息",
    rule: "不要写「以下是...」「根据参考文档...」「作为 AI 助手...」「需要注意的是...」等元信息或引导语，直接输出内容。",
  },
  noMarkdown: {
    id: "no-markdown",
    name: "禁止 Markdown",
    rule: "不要使用 Markdown 语法。不要用 # 标记标题，不要用 ** 标记粗体，不要用 - 标记列表，不要用 | 构建表格。用纯文本格式输出。",
  },
  markdownAllowed: {
    id: "markdown-allowed",
    name: "允许 Markdown",
    rule: "可以使用 Markdown 语法组织内容：# 标记标题层级，** 标记粗体，- 或数字标记列表，| 构建表格。",
  },
  businessTone: {
    id: "business-tone",
    name: "商务语气",
    rule: "使用正式的商务语言。避免口语化表达、网络用语和情绪化措辞。措辞客观、严谨、专业。",
  },
  logicalFlow: {
    id: "logical-flow",
    name: "逻辑连贯",
    rule: "段落之间要有过渡句，确保逻辑连贯。每个章节结尾要有小结或过渡到下一章节的衔接。",
  },
  dataCitation: {
    id: "data-citation",
    name: "数据引用",
    rule: "引用数据时必须注明来源。百分比、金额、时间线等关键数据必须有参考支撑，不要编造数据。",
  },
};

// ── 规则组合 ──────────────────────────────────────────────

/**
 * 根据 style + format 组合返回适用的写作规则
 * 规则顺序：通用规则 → 风格规则 → 格式规则
 */
export function getRulesForContext(styleId: string, formatId: string): WritingRule[] {
  const rules: WritingRule[] = [];

  // 通用规则（所有场景适用）
  rules.push(
    RULES.noRepeatTitle,
    RULES.cjkSpacing,
    RULES.punctuation,
    RULES.citationFormat,
    RULES.listFormat,
    RULES.paragraphLength,
    RULES.noLlmMeta,
    RULES.logicalFlow,
  );

  // 风格特有规则
  switch (styleId) {
    case "email":
      rules.push(RULES.noMarkdown, RULES.businessTone);
      break;
    case "report":
      rules.push(RULES.businessTone, RULES.dataCitation, RULES.tableConsistency);
      break;
    case "technical":
      // 技术文档允许 markdown
      break;
    case "presentation":
      rules.push(RULES.noMarkdown);
      break;
    case "table":
      rules.push(RULES.tableConsistency);
      break;
    case "memo":
      rules.push(RULES.noMarkdown, RULES.businessTone);
      break;
    default:
      break;
  }

  // 格式特有规则
  switch (formatId) {
    case "word":
      if (!rules.some((r) => r.id === "no-markdown")) {
        rules.push(RULES.noMarkdown);
      }
      break;
    case "ppt":
      if (!rules.some((r) => r.id === "no-markdown")) {
        rules.push(RULES.noMarkdown);
      }
      break;
    case "markdown":
      rules.push(RULES.markdownAllowed);
      break;
    case "excel":
      rules.push(RULES.tableConsistency);
      break;
    case "html":
      rules.push(RULES.markdownAllowed);
      break;
    default:
      break;
  }

  return rules;
}
