/**
 * Prompt Template 注册表 — Composable Prompt Layers
 *
 * 5 层架构：Style + Format + Audience + Rules + Context
 * 内置模板硬编码，用户自定义模板存 sync_data 表
 */
import { dbRun, dbGet, dbAll } from "./dbQuery.js";
import { logger } from "./logger.js";
import type { StyleTemplate, FormatTemplate, AudienceProfile } from "../../../shared/src/types/generation.js";

// ── 内置 Style 模板 ──────────────────────────────────────

const BUILTIN_STYLES: StyleTemplate[] = [
  {
    id: "email",
    name: "邮件",
    description: "正式的电子邮件，包含称呼、正文、结尾问候和署名",
    promptFragment: `这是一封邮件。请按邮件格式输出：
- 第一行写主题/标题
- 开头写称呼（如"XXX，你好："）
- 正文分段落，每段一个要点
- 结尾写问候语（如"此致"、"祝好"、"Best regards"）
- 最后署名
不要使用 markdown 格式（不要 # 标题、**粗体**、- 列表），用纯文本段落。`,
    isBuiltin: true,
  },
  {
    id: "report",
    name: "报告",
    description: "正式的分析报告或汇报文档，适合管理层阅读",
    promptFragment: `这是一份正式报告。请按报告格式输出：
- 有清晰的标题和章节结构
- 每个章节有小标题
- 内容分段落，逻辑清晰，段落之间有过渡
- 重要结论和数据用粗体标注
- 表格数据用 markdown 表格呈现
- 语言正式、客观、专业，避免口语化表达`,
    isBuiltin: true,
  },
  {
    id: "presentation",
    name: "演示文稿",
    description: "PPT 幻灯片风格，结构化信息呈现",
    promptFragment: `这是一份演示文稿。请按 PPT 格式输出：
- 每个章节对应一页幻灯片
- 用子标题(h3)区分信息点，每个信息点按"说明文字 → 数据表格 → 图表"结构组织
- 说明文字简洁有力，2-3句话概括核心结论
- 数据必须用 markdown 表格呈现（| 列1 | 列2 | ... |），不要只写文字描述
- 需要可视化对比的数据，用 /chart 代码块提供图表规格（格式见输出格式要求）
- 信息点之间用空行分隔，保持幻灯片可读性`,
    isBuiltin: true,
  },
  {
    id: "technical",
    name: "技术文档",
    description: "API 文档、技术规范、README 等技术类文档",
    promptFragment: `这是一份技术文档。请按技术文档格式输出：
- 包含清晰的标题层级（一级标题、二级标题、三级标题）
- 代码用代码块包裹，并标注语言
- 参数说明用列表呈现
- 包含代码示例
- 术语准确，表述精确`,
    isBuiltin: true,
  },
  {
    id: "table",
    name: "数据表格",
    description: "以表格数据为主的文档，如清单、对比表、报表",
    promptFragment: `这是一个表格/数据文档。请按表格格式输出：
- 用 markdown 表格格式（| 列1 | 列2 | ... |）
- 表头清晰，列名简洁
- 数据对齐，内容精炼
- 必要时在表格前后加简要说明`,
    isBuiltin: true,
  },
  {
    id: "memo",
    name: "备忘录",
    description: "内部沟通用的简短备忘录或纪要",
    promptFragment: `这是一份备忘录。请按备忘录格式输出：
- 开头标明：致（收件人）、自（发件人）、日期、主题
- 正文简洁，分条目陈述
- 结尾明确下一步行动项
- 语言简洁，避免冗余`,
    isBuiltin: true,
  },
  {
    id: "general",
    name: "通用文档",
    description: "通用正式文档，适用于未明确指定类型的场景",
    promptFragment: `请按正式文档格式输出：
- 语言专业流畅，结构清晰
- 有明确的段落划分
- 重要信息适当突出
- 适合正式场合阅读和传阅`,
    isBuiltin: true,
  },
];

// ── 内置 Format 模板 ──────────────────────────────────────

const BUILTIN_FORMATS: FormatTemplate[] = [
  {
    id: "word",
    name: "Word 文档",
    constraints: `输出格式要求（Word 文档）：
- 使用纯文本格式，不要使用任何 Markdown 语法
- 标题不要加 # 号，直接写标题文字
- 粗体不要用 ** 包裹，用文字强调（如"重点是..."）
- 列表不要用 - 号，用数字编号（1. 2. 3.）
- 表格不要用 | 管道符，用文字描述或对齐空格
- 中文与英文、数字之间加空格（如：基于 TypeScript 构建）
- 标点符号规范，不要连续使用两个标点
- 段落之间空一行`,
  },
  {
    id: "ppt",
    name: "PPT 演示",
    constraints: `输出格式要求（PPT 演示文稿）：
- 每个章节是一个独立的幻灯片
- 用 ### 标记每个信息点的标题（markdown 三级标题）
- 数据用 markdown 表格格式（| 列1 | 列2 | ... |），表头行和数据行之间用 |---| 分隔
- 如果文档大纲中指定了图表，必须在 \`\`\`chart 代码块中附 JSON 数据（每个信息点最多一个图表）：
\`\`\`chart
[{"type": "column", "title": "图表标题", "categories": ["类别1", "类别2"], "series": [{"name": "系列名", "values": [10, 20]}]}]
\`\`\`
- chart type 支持: bar / column / pie / doughnut / line / scatter
- 文字简洁但信息完整，不要用空洞的 bullet points 代替具体数据
- 表格和图表基于参考信息，如果数据不足可基于参考信息进行合理估算，但必须生成`,
  },
  {
    id: "excel",
    name: "Excel 表格",
    constraints: `输出格式要求（Excel 工作簿）：
- 每个章节包含说明文字+具体数据
- 表格用 markdown 格式（| 列1 | 列2 | ... |）
- 数据要具体（数字、百分比、日期），基于知识库的真实信息
- 图表需求先写文字描述，再在 \`\`\`chart 代码块中附 JSON 数据：
\`\`\`chart
[{"type": "column", "title": "图表标题", "categories": ["类别1", "类别2"], "series": [{"name": "系列名", "values": [10, 20]}]}]
\`\`\`
- chart type 支持: bar / column / pie / doughnut / line / scatter
- 不要输出 Python 脚本——只需输出 JSON chart spec`,
  },
  {
    id: "markdown",
    name: "Markdown",
    constraints: `输出格式要求（Markdown）：
- 使用标准 Markdown 语法
- 标题用 # 号标记层级
- 重点内容用 **粗体** 标注
- 列表用 - 或数字编号
- 表格用 | 管道符格式
- 代码用反引号包裹`,
  },
  {
    id: "html",
    name: "HTML",
    constraints: `输出格式要求（HTML）：
- 可以使用 HTML 标签组织内容
- 标题用 h2/h3 标签
- 列表用 ul/ol 标签
- 表格用 table 标签
- 语义化标签优先`,
  },
];

// ── 内置 Audience 模板 ──────────────────────────────────────

const BUILTIN_AUDIENCES: AudienceProfile[] = [
  {
    id: "executive",
    name: "企业高管",
    guidance: `读者画像：企业高管（CEO/COO/VP）
- 优先呈现结论和决策建议，细节放附录或折叠
- 使用商业语言，避免技术术语；如必须用技术术语，附带简要解释
- 数据和结论要有明确的来源支撑
- 关注 ROI、风险、时间线等管理层关心的维度
- 段落简洁，每段一个核心观点
- 适当使用表格呈现对比数据`,
  },
  {
    id: "engineer",
    name: "工程师",
    guidance: `读者画像：工程师/技术人员
- 可以使用专业术语和技术概念
- 代码示例和 API 说明要精确
- 关注实现细节、性能指标、技术选型理由
- 可以使用代码块和表格
- 逻辑清晰，因果关系明确`,
  },
  {
    id: "legal",
    name: "法务/合规",
    guidance: `读者画像：法务顾问/合规团队
- 语言严谨，表述精确，避免歧义
- 引用法规条款时要准确（如 GDPR 第 X 条）
- 关注合规状态、风险等级、时间节点
- 使用表格呈现合规检查清单
- 明确区分"已完成"、"进行中"、"待启动"等状态`,
  },
  {
    id: "customer",
    name: "客户/合作伙伴",
    guidance: `读者画像：外部客户或合作伙伴
- 语言友好、专业，避免内部术语和缩写
- 关注客户价值和利益点
- 功能说明要结合客户使用场景
- 避免暴露内部技术细节或架构信息
- 结尾明确下一步行动和联系方式`,
  },
  {
    id: "general",
    name: "通用读者",
    guidance: `读者画像：通用读者
- 语言通俗易懂，专业术语附带解释
- 结构清晰，有引言和总结
- 适当使用标题和列表提升可读性
- 避免过于技术化或过于简化`,
  },
];

// ── 风格检测 ──────────────────────────────────────────────

/** 从用户请求中自动推断文档风格 */
export function detectStyle(userRequest: string): StyleTemplate {
  const req = userRequest.toLowerCase();

  // ── 优先级修复：强格式信号优先 ──
  // "邮件"/"email" 可能出现在用户描述的内容需求中（如"列出邮件主题"），
  // 而不一定表示用户想要邮件格式。因此提升 xlsx/ppt/md 等强格式信号的优先级。

  // 强格式信号：xlsx/excel/sheet → 用户明确要电子表格
  if (/\bxlsx\b|\.xlsx|excel/.test(req)) return getStyle("table");
  // 强格式信号：pptx/ppt → 用户明确要演示文稿
  if (/\.pptx?\b|演示|slides|幻灯片|presentation/.test(req)) return getStyle("presentation");
  // markdown → 用户明确要 markdown
  if (/\bmarkdown\b|\.md\b/.test(req)) return getStyle("technical");

  // 内容语义信号：邮件
  if (/邮件|email|mail|写信|致函/.test(req)) return getStyle("email");
  // 内容语义信号：表格/报表
  if (/表格|数据表|报表|清单|\bsheet\b/i.test(req)) return getStyle("table");
  // 代码/技术文档
  if (/代码|code|api|sdk|技术文档|readme|接口/.test(req)) return getStyle("technical");
  // 备忘录/会议记录
  if (/备忘录|memo|纪要|会议记录/.test(req)) return getStyle("memo");
  // 报告/汇报
  if (/报告|汇报|report|总结|分析|评估/.test(req)) return getStyle("report");

  return getStyle("general");
}

/** 从用户请求中自动推断输出格式 */
export function detectFormat(userRequest: string): FormatTemplate {
  const req = userRequest.toLowerCase();

  if (/word|docx|\.doc|文档文件/.test(req)) return getFormat("word");
  if (/ppt|pptx|\.ppt|演示|slides/.test(req)) return getFormat("ppt");
  if (/excel|xlsx|\.xls|表格|报表/.test(req)) return getFormat("excel");
  if (/markdown|md/.test(req)) return getFormat("markdown");

  // 默认 Word（最通用的正式文档格式）
  return getFormat("word");
}

/** 从用户请求中自动推断目标读者 */
export function detectAudience(userRequest: string): AudienceProfile {
  const req = userRequest.toLowerCase();

  if (/ceo|coo|cto|vp|高管|管理层|总裁|总经理|领导|董事会/.test(req)) return getAudience("executive");
  if (/工程师|developer|程序员|技术团队|后端|前端/.test(req)) return getAudience("engineer");
  if (/法务|合规|legal|compliance|gdpr|soc\s*2/.test(req)) return getAudience("legal");
  if (/客户|customer|用户|合作伙伴|partner|甲方/.test(req)) return getAudience("customer");

  return getAudience("general");
}

// ── 查询函数（内置 + 自定义）──────────────────────────────────

/** 获取 Style 模板（精确匹配 → 内置兜底 general） */
export function getStyle(id: string): StyleTemplate {
  const builtin = BUILTIN_STYLES.find((s) => s.id === id);
  if (builtin) return builtin;

  // 查自定义模板
  const custom = getCustomTemplate("prompt_styles", id);
  if (custom) return custom as unknown as StyleTemplate;

  // 兜底
  return BUILTIN_STYLES.find((s) => s.id === "general")!;
}

/** 获取 Format 模板 */
export function getFormat(id: string): FormatTemplate {
  return BUILTIN_FORMATS.find((f) => f.id === id) ?? BUILTIN_FORMATS.find((f) => f.id === "html")!;
}

/** 获取 Audience 模板 */
export function getAudience(id: string): AudienceProfile {
  const builtin = BUILTIN_AUDIENCES.find((a) => a.id === id);
  if (builtin) return builtin;

  const custom = getCustomTemplate("prompt_audiences", id);
  if (custom) return custom as unknown as AudienceProfile;

  return BUILTIN_AUDIENCES.find((a) => a.id === "general")!;
}

/** 获取所有 Style 模板（内置 + 自定义） */
export function getAllStyles(): StyleTemplate[] {
  const customs = getAllCustomTemplates("prompt_styles") as unknown as StyleTemplate[];
  return [...BUILTIN_STYLES, ...customs];
}

/** 获取所有 Format 模板 */
export function getAllFormats(): FormatTemplate[] {
  return [...BUILTIN_FORMATS];
}

/** 获取所有 Audience 模板（内置 + 自定义） */
export function getAllAudiences(): AudienceProfile[] {
  const customs = getAllCustomTemplates("prompt_audiences") as unknown as AudienceProfile[];
  return [...BUILTIN_AUDIENCES, ...customs];
}

// ── 自定义模板 CRUD（sync_data 表）──────────────────────────────

function getCustomTemplate(storeName: string, id: string): Record<string, unknown> | null {
  try {
    const row = dbGet<{ data: string }>(
      "SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?",
      [storeName, id],
    );
    if (!row) return null;
    return JSON.parse(row.data);
  } catch (err) {
    logger.warn(`[PromptTemplates] Failed to get custom template ${storeName}/${id}: ${err}`);
    return null;
  }
}

function getAllCustomTemplates(storeName: string): Record<string, unknown>[] {
  try {
    const rows = dbAll<{ record_id: string; data: string }>(
      "SELECT record_id, data FROM sync_data WHERE store_name = ?",
      [storeName],
    );
    return rows.map((row) => ({ id: row.record_id, ...JSON.parse(row.data) }));
  } catch (err) {
    logger.warn(`[PromptTemplates] Failed to list custom templates ${storeName}: ${err}`);
    return [];
  }
}

/** 创建或更新自定义模板 */
export function saveCustomTemplate(storeName: string, id: string, data: Record<string, unknown>): void {
  try {
    const dataJson = JSON.stringify(data);
    dbRun(
      "INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))",
      [storeName, id, dataJson],
      { table: "sync_data", recordId: id, source: "prompt_templates", newData: data },
    );
  } catch (err) {
    logger.error(`[PromptTemplates] Failed to save custom template ${storeName}/${id}: ${err}`);
    throw err;
  }
}

/** 删除自定义模板 */
export function deleteCustomTemplate(storeName: string, id: string): boolean {
  try {
    const existing = dbGet<{ data: string }>(
      "SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?",
      [storeName, id],
    );
    if (!existing) return false;

    dbRun(
      "DELETE FROM sync_data WHERE store_name = ? AND record_id = ?",
      [storeName, id],
      { table: "sync_data", recordId: id, source: "prompt_templates", operation: "DELETE" },
    );

    return true;
  } catch (err) {
    logger.error(`[PromptTemplates] Failed to delete custom template ${storeName}/${id}: ${err}`);
    throw err;
  }
}