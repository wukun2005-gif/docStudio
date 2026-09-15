/**
 * 知识库「真实数据」的英文术语表。
 *
 * 为什么单独一个模块、而不是塞进 i18n 字典：
 *   people.name / people.title / people.department / kb_sources.name 全部来自
 *   Microsoft Entra ID、磁盘和 OneDrive，属于**数据**，不是 UI 文案。
 *   它们的翻译不是「查字典」而是「术语表（glossary）映射」——
 *   枚举值（职位/部门）可确定性映射，人名只能罗马化，文件名只能在展示层处理。
 *
 * 铁律：**只做展示层派生**。
 *   translate*() 系列全部是纯函数，不写数据库、不改文件系统、不改 Graph 返回值。
 *   language 非 en 时一律原样返回，因此中文模式下输出与改动前逐字节一致。
 */

import { isEnLanguage } from "./serverI18n.js";

/** 人名 → 拼音罗马化。来源：people 表的邮箱前缀（权威，非猜测）。 */
export const PERSON_EN: Record<string, string> = {
  陈宇: "Chen Yu",
  王莉: "Wang Li",
  王琳: "Wang Lin",
  赵军: "Zhao Jun",
  张伟: "Zhang Wei",
  苏楠: "Su Nan",
  李鑫: "Li Xin",
  唐敏: "Tang Min",
  徐骏: "Xu Jun",
  陈强: "Chen Qiang",
  黄薇: "Huang Wei",
  刘伟: "Liu Wei",
  周敏: "Zhou Min",
  孙娜: "Sun Na",
  杨飞: "Yang Fei",
  赵丽: "Zhao Li",
  罗茜: "Luo Xi",
  何成: "He Cheng",
  王超: "Wang Chao",
};

/** 部门 → 英文。含「法务 / 法务部」「客户成功 / 客户成功部」两种写法。 */
export const DEPT_EN: Record<string, string> = {
  管理层: "Management",
  技术部: "Engineering",
  产品部: "Product",
  设计部: "Design",
  市场部: "Marketing",
  销售部: "Sales",
  法务部: "Legal",
  客户成功部: "Customer Success",
  法务: "Legal",
  客户成功: "Customer Success",
};

/** 职位 → 英文。CEO / COO / VP Engineering 本身已是英文，原样保留。 */
export const TITLE_EN: Record<string, string> = {
  技术负责人: "Head of Engineering",
  市场总监: "Marketing Director",
  产品总监: "Product Director",
  高级产品经理: "Senior Product Manager",
  高级后端工程师: "Senior Backend Engineer",
  后端工程师: "Backend Engineer",
  高级前端工程师: "Senior Frontend Engineer",
  前端工程师: "Frontend Engineer",
  "DevOps 工程师": "DevOps Engineer",
  数据科学家: "Data Scientist",
  "QA 负责人": "QA Lead",
  客户成功经理: "Customer Success Manager",
  企业销售经理: "Enterprise Sales Manager",
  法务顾问: "Legal Counsel",
  "UI 设计师": "UI Designer",
  "UX 设计主管": "UX Design Lead",
  产品负责人: "Head of Product",
  设计负责人: "Head of Design",
  市场负责人: "Head of Marketing",
  法务负责人: "Head of Legal",
  客户成功负责人: "Head of Customer Success",
};

/**
 * 文件名整体替换（无法按构件拆分的）。
 * 文件名里一律用连字符分词，与既有演示数据风格保持一致。
 */
export const FILE_EN: Record<string, string> = {
  "产品路线图-Q3-2026.pptx": "Product-Roadmap-Q3-2026.pptx",
  "Q3-技术架构演进报告.docx": "Q3-Architecture-Evolution-Report.docx",
  "Q3-协作效能分析报告.docx": "Q3-Collaboration-Efficiency-Report.docx",
  "Q3-GitHub开发活跃度报告.docx": "Q3-GitHub-Activity-Report.docx",
  "Q3-团队效能月报-2026-09.pptx": "Q3-Team-Productivity-Monthly-2026-09.pptx",
  "Q4-重点项目规划.docx": "Q4-Key-Initiatives-Plan.docx",
  "14-陈强-团队-Q3代码生产力周报.eml": "14-Chen-Qiang-Team-Q3-Code-Productivity-Weekly.eml",
  "15-赵丽-团队-Q3协作效率分析.eml": "15-Zhao-Li-Team-Q3-Collaboration-Efficiency.eml",
  "16-赵军-管理层-Q4资源审批.eml": "16-Zhao-Jun-Management-Q4-Resource-Approval.eml",
  "10-陈强-团队-本周总结.eml": "10-Chen-Qiang-Team-Weekly-Summary.eml",
  // —— 系统邮件（非团队成员往来）——
  "Microsoft 帐户安全信息验证.eml": "Microsoft-account-security-info-verification.eml",
  "已添加 Microsoft 帐户安全信息.eml": "Microsoft-account-security-info-added.eml",
  "欢迎使用你的新 Outlook.com 帐户.eml": "Welcome-to-your-new-Outlook.com-account.eml",
  "连接到 Microsoft 帐户的新应用.eml": "New-app-connected-to-Microsoft-account.eml",
  "New recommendation available for 默认目录.eml": "New-recommendation-available-for-Default-Directory.eml",
  "了解您的 OneDrive - 如何为您的电脑和移动设备做备份.eml":
    "Get-to-know-OneDrive-back-up-your-PC-and-mobile-devices.eml",
  "致王芳-本周产品工作概述 产品开.eml": "To-Wang-Fang-Weekly-Product-Work-Overview.eml",
};

/**
 * 文件名构件词表：按「最长优先」做整词替换。
 * 覆盖 people.name / 邮件主题 / 会议类 / 报告类 / 表格类。
 */
export const FILE_WORD_EN: Record<string, string> = {
  // 时间（周历）
  周一: "Mon",
  周二: "Tue",
  周三: "Wed",
  周四: "Thu",
  周五: "Fri",
  周六: "Sat",
  周日: "Sun",
  // 会议类
  认证模块需求评审: "Auth-Module-Requirements-Review",
  认证模块联调会议: "Auth-Module-Integration-Meeting",
  支付系统设计评审: "Payment-System-Design-Review",
  GoToMarket策略会议: "GoToMarket-Strategy-Meeting",
  法务合规评审: "Legal-Compliance-Review",
  设计评审会议: "Design-Review-Meeting",
  Retro会议: "Retro-Meeting",
  会议纪要: "Meeting-Notes",
  // 报告 / 文档类
  GitHub开发活跃度报告: "GitHub-Activity-Report",
  协作效能分析报告: "Collaboration-Efficiency-Report",
  技术架构演进报告: "Architecture-Evolution-Report",
  团队效能月报: "Team-Productivity-Monthly",
  质量指标报告: "Quality-Metrics-Report",
  项目进度表: "Project-Schedule",
  项目周报: "Project-Weekly-Report",
  投资人更新: "Investor-Update",
  产品路线图: "Product-Roadmap",
  重点项目规划: "Key-Initiatives-Plan",
  功能交付看板: "Feature-Delivery-Board",
  RAG引擎参数配置: "RAG-Engine-Parameters",
  客户案例研究: "Customer-Case-Study",
  性能测试报告: "Performance-Test-Report",
  支付系统技术方案: "Payment-System-Technical-Plan",
  数据安全合规方案: "Data-Security-Compliance-Plan",
  认证模块技术方案: "Auth-Module-Technical-Plan",
  "i-Write系统架构": "i-Write-System-Architecture",
  架构设计: "Architecture-Design",
  部署指南: "Deployment-Guide",
  GoToMarket策略文档: "GoToMarket-Strategy-Doc",
  // 表格类
  Bug统计表: "Bug-Statistics",
  个人贡献排名: "Individual-Contribution-Ranking",
  Sprint燃尽图数据: "Sprint-Burndown-Data",
  客户反馈跟踪表: "Customer-Feedback-Tracker",
  // 杂项
  聊天记录: "Chat-History",
  API文档: "API-Docs",
  认证接口: "Auth-API",
  // 邮件主题
  认证模块需求确认: "Auth-Module-Requirements-Confirmation",
  "redirect-uri问题": "redirect-uri-Issue",
  "redirect-uri回复": "redirect-uri-Reply",
  BUG201已修复: "BUG201-Fixed",
  E2E测试进展: "E2E-Test-Progress",
  产品演示确认: "Product-Demo-Confirmation",
  支付系统方案讨论: "Payment-System-Plan-Discussion",
  Token刷新竞态修复: "Token-Refresh-Race-Fix",
  企业客户需求: "Enterprise-Customer-Requirements",
  数据合规要求: "Data-Compliance-Requirements",
  GoToMarket时间线: "GoToMarket-Timeline",
  客户反馈汇总: "Customer-Feedback-Summary",
  Q3代码生产力周报: "Q3-Code-Productivity-Weekly",
  "CI-CD优化": "CI-CD-Optimization",
  Q3协作效率分析: "Q3-Collaboration-Efficiency",
  Q4资源审批: "Q4-Resource-Approval",
  本周总结: "Weekly-Summary",
  本周目标: "Weekly-Goals",
  本周产品工作概述: "Weekly-Product-Work-Overview",
  // 通用词（放最后，最长优先保证不误伤长词）
  团队: "Team",
  客户: "Customer",
  管理层: "Management",
};

/**
 * 供演示 fixture 复用的人名 / 部门 / 职位 / 文件名映射。
 * 演示正文与知识库界面必须用同一套罗马化，否则同一个演示里
 * 组织架构显示 "Luo Xi"、正文却写 "Luo Qian"。
 */
export const SHARED_ZH_EN: Record<string, string> = {
  ...PERSON_EN,
  ...DEPT_EN,
  ...TITLE_EN,
  ...FILE_EN,
};

/** 构件词表按长度降序排列，保证「最长优先」匹配 */
const FILE_WORD_KEYS: string[] = Object.keys(FILE_WORD_EN).sort((a, b) => b.length - a.length);
const PERSON_NAME_KEYS: string[] = Object.keys(PERSON_EN).sort((a, b) => b.length - a.length);

/** 人名罗马化（非 en 原样返回） */
export function localizePersonName(name: string | undefined | null, language?: string): string | undefined {
  if (!name) return name ?? undefined;
  if (!isEnLanguage(language)) return name;
  const hit = PERSON_EN[name.trim()];
  return hit ?? name;
}

/** 职位英文化 */
export function localizeJobTitle(title: string | undefined | null, language?: string): string | undefined {
  if (!title) return title ?? undefined;
  if (!isEnLanguage(language)) return title;
  return TITLE_EN[title.trim()] ?? title;
}

/** 部门英文化 */
export function localizeDepartment(dept: string | undefined | null, language?: string): string | undefined {
  if (!dept) return dept ?? undefined;
  if (!isEnLanguage(language)) return dept;
  return DEPT_EN[dept.trim()] ?? dept;
}

/** 文件名英文化：先整体匹配，再按构件整词替换。扩展名与已拉丁化的部分保持不变。 */
export function localizeFileName(name: string | undefined | null, language?: string): string | undefined {
  if (!name) return name ?? undefined;
  if (!isEnLanguage(language)) return name;

  const exact = FILE_EN[name];
  if (exact) return exact;
  // 邮件主题与 .eml 文件名同形（主题不带后缀），命中 .eml 条目时回退时要去掉后缀，
  // 否则会给主题凭空加上一个它本来没有的扩展名。
  const viaEml = FILE_EN[`${name}.eml`];
  if (viaEml) return viaEml.replace(/\.eml$/i, "");

  let out = name;
  for (const zh of FILE_WORD_KEYS) {
    if (out.includes(zh)) out = out.split(zh).join(FILE_WORD_EN[zh]);
  }
  // 人名单独处理：文件名里用连字符分词（陈强 → Chen-Qiang）
  for (const [zh, en] of Object.entries(PERSON_EN)) {
    if (out.includes(zh)) out = out.split(zh).join(en.replace(/ /g, "-"));
  }
  return out;
}

export interface LocalizablePerson {
  name?: string;
  title?: string;
  department?: string;
}

/** 人员对象本地化：只改展示字段，其余字段（id / email / attributes）原样透传 */
export function localizePerson<T extends LocalizablePerson>(person: T, language?: string): T {
  if (!isEnLanguage(language)) return person;
  return {
    ...person,
    name: localizePersonName(person.name, language),
    title: localizeJobTitle(person.title, language),
    department: localizeDepartment(person.department, language),
  } as T;
}

/**
 * 人名出现在长文本中时（如 "苏楠 <sunan@..." 或 "苏楠、陈强"）的整词替换。
 * 与 localizePersonName 的区别：后者只做整体精确匹配，本函数允许子串替换。
 */
export function localizePersonText(text: string | undefined | null, language?: string): string | undefined {
  if (!text) return text ?? undefined;
  if (!isEnLanguage(language)) return text;
  const trimmed = text.trim();
  if (PERSON_EN[trimmed]) return PERSON_EN[trimmed];
  let out = text;
  for (const zh of PERSON_NAME_KEYS) {
    if (out.includes(zh)) out = out.split(zh).join(PERSON_EN[zh]);
  }
  return out;
}

/** 组织架构树节点（getOrgHierarchy 的返回结构 + 本地标记） */
export interface OrgNodeLike {
  id?: string;
  name?: string;
  title?: string;
  department?: string;
  isCurrentUser?: boolean;
  children?: OrgNodeLike[];
}

/**
 * 递归本地化组织架构树，并按 id 标注 isCurrentUser。
 *
 * 标注 isCurrentUser 是为了让前端不必再拿「人名」做等值比较来判断「我」——
 * 那种写法在任何本地化改动下都会静默失效（同 Bug #71 / #72）。
 */
export function localizeOrgTree<T extends OrgNodeLike>(
  nodes: T[],
  language?: string,
  currentUserIds?: Set<string>,
): T[] {
  const en = isEnLanguage(language);
  return nodes.map((node) => {
    const next: any = { ...node };
    if (Array.isArray(node.children)) {
      next.children = localizeOrgTree(node.children as T[], language, currentUserIds);
    }
    if (en) {
      next.name = localizePersonName(node.name, language);
      next.title = localizeJobTitle(node.title, language);
      next.department = localizeDepartment(node.department, language);
    }
    if (currentUserIds) {
      next.isCurrentUser = node.id ? currentUserIds.has(node.id) : false;
    }
    return next as T;
  });
}

/**
 * 知识源本地化：只翻 name（展示用文件名）。
 * 注意 github_file 是代码路径，**不翻**。
 * id / url / file_path / content_hash / chunk_count 全部保持原值，
 * 因此下载（按 id）、引用、去重逻辑都不受影响。
 */
export function localizeKnowledgeSource<T extends { name?: string; type?: string }>(
  source: T,
  language?: string,
): T {
  if (!isEnLanguage(language)) return source;
  if (source.type === "github_file") return source;
  return { ...source, name: localizeFileName(source.name, language) };
}

/**
 * 开发期校验：把一批真实数据里出现的、仍未被术语表覆盖的中文挑出来。
 * 用于新增数据（新同事 / 新文档）后快速发现词表缺口，避免静默漏翻。
 */
export function findUncoveredTerms(values: Array<string | undefined | null>): string[] {
  const missing = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    if (!/[\u4e00-\u9fff]/.test(v)) continue;
    const translated = localizeFileName(v, "en");
    if (/[\u4e00-\u9fff]/.test(translated ?? "")) missing.add(v);
  }
  return [...missing];
}
