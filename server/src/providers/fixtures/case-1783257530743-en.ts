/**
 * case-1783257530743 的英文侧（Demo replay 用）
 *
 * 背景：`case-1783257530743.ts` 是真实中文 case 的完整数据回放，正文/表格/图表
 * 都是**内容**而非 UI 文案，体积约 200KB。
 *
 * 本模块不手写第二份 fixture，而是：
 *   1. 提供结构标签（标题 / 大纲 / 章节标题）的英文映射
 *   2. 提供一份**精确匹配**的中英词表 `ZH_EN`
 *   3. `buildCaseEn()` 深拷贝中文 fixture 并按词表派生英文版
 *
 * 这样中英两侧的数值、图表、结构天然一致，且只维护一份数据。
 * 词表按「原子单元」组织：HTML 文本节点、`title="..."` 属性、
 * chart-spec JSON 字符串值、以及非 HTML 字段字符串。
 */

// ── 结构标签 ────────────────────────────────────────────────

/** 英文文档标题（与 fixture.title 对应） */
export const CASE_1783257530743_TITLE_EN = "Q3 Engineering Team Summary & Business Review";

/** 英文章节标题映射（key 为 fixture 里的中文标题） */
export const CASE_1783257530743_SECTION_TITLES_EN: Record<string, string> = {
  "团队概览": "Team Overview",
  "Q3 关键成果与KPI达成": "Q3 Key Results & KPI Achievement",
  "团队效能与协作分析": "Team Productivity & Collaboration Analysis",
  "技术架构演进与创新": "Architecture Evolution & Innovation",
  "Q4 规划与资源需求": "Q4 Planning & Resource Requirements",
};

/** 英文大纲（与 fixture.outline 一一对应） */
export const CASE_1783257530743_OUTLINE_EN = [
  {
    id: "s1",
    title: "Team Overview",
    level: 1,
    children: [],
    description: "Covers team size and structure, department distribution and reporting lines. Each point includes explanatory text, a data table and a chart.",
  },
  {
    id: "s2",
    title: "Q3 Key Results & KPI Achievement",
    level: 1,
    children: [],
    description: "Covers feature delivery, code productivity and quality metrics, presented with text, tables and charts.",
  },
  {
    id: "s3",
    title: "Team Productivity & Collaboration Analysis",
    level: 1,
    children: [],
    description: "Presents individual contribution ranking, cross-team collaboration and response efficiency with charts.",
  },
  {
    id: "s4",
    title: "Architecture Evolution & Innovation",
    level: 1,
    children: [],
    description: "Introduces the architecture change overview, performance comparison and technical debt, with charts.",
  },
  {
    id: "s5",
    title: "Q4 Planning & Resource Requirements",
    level: 1,
    children: [],
    description: "Plans Q4 key tasks, resource requirements plus risks and mitigations, supported by charts.",
  },
];

// ── 中英词表 ────────────────────────────────────────────────
// 精确匹配（trim 后）。命中优先级：整条 → 冒号拆分 → 括号拆分 → 数值+单位 → 原文

const ZH_EN: Record<string, string> = {
  // —— 人员（英文化，与来源文件名保持一致）——
  "刘伟": "Liu Wei",
  "陈强": "Chen Qiang",
  "赵丽": "Zhao Li",
  "杨飞": "Yang Fei",
  "王超": "Wang Chao",
  "孙娜": "Sun Na",
  "黄薇": "Huang Wei",
  "周敏": "Zhou Min",
  "徐骏": "Xu Jun",
  "罗茜": "Luo Xi",
  "赵军": "Zhao Jun",

  // —— 部门 / 角色 ——
  "管理层": "Management",
  "技术部": "Engineering",
  "产品部": "Product",
  "设计部": "Design",
  "市场部": "Marketing",
  "销售部": "Sales",
  "法务": "Legal",
  "客户成功": "Customer Success",
  "技术负责人": "Head of Engineering",
  "产品负责人": "Head of Product",
  "设计负责人": "Head of Design",
  "市场负责人": "Head of Marketing",
  "法务负责人": "Head of Legal",
  "客户成功负责人": "Head of Customer Success",
  "管理者": "Manager",
  "部门": "Department",
  "核心职能": "Core responsibilities",
  "职级": "Level",

  // —— 来源文档（英文文件名，与正文引用一致）——
  "产品路线图-Q3-2026.pptx": "Product-Roadmap-Q3-2026.pptx",
  "Q3-技术架构演进报告.docx": "Q3-Architecture-Evolution-Report.docx",
  "Q4-重点项目规划.docx": "Q4-Key-Initiatives-Plan.docx",
  "Q3-GitHub开发活跃度报告.docx": "Q3-GitHub-Activity-Report.docx",
  "Q3-团队效能月报-2026-09.pptx": "Q3-Team-Productivity-Monthly-2026-09.pptx",
  "Q3-协作效能分析报告.docx": "Q3-Collaboration-Efficiency-Report.docx",
  "14-陈强-团队-Q3代码生产力周报.eml": "14-Chen-Qiang-Team-Q3-Code-Productivity-Weekly.eml",
  "15-赵丽-团队-Q3协作效率分析.eml": "15-Zhao-Li-Team-Q3-Collaboration-Efficiency.eml",
  "16-赵军-管理层-Q4资源审批.eml": "16-Zhao-Jun-Management-Q4-Resource-Approval.eml",
  "10-陈强-团队-本周总结.eml": "10-Chen-Qiang-Team-Weekly-Summary.eml",
  "Nexora Tech 主仓库": "Nexora Tech main repository",

  // —— 表头 / 指标 ——
  "人数": "Headcount",
  "占比": "Share",
  "功能模块": "Feature module",
  "目标完成": "Target",
  "实际完成": "Actual",
  "达成率": "Achievement",
  "仓库": "Repository",
  "提交数": "Commits",
  "PR合并数": "PRs merged",
  "代码行变更": "Lines changed",
  "指标": "Metric",
  "Q3目标": "Q3 target",
  "Q3实际": "Q3 actual",
  "环比变化": "QoQ change",
  "成员": "Member",
  "综合评分": "Overall score",
  "排名": "Rank",
  "姓名": "Name",
  "审查": "Reviews",
  "次数": "Count",
  "类型": "Type",
  "协作方向": "Collaboration pair",
  "协作对": "Collaboration pair",
  "消息数": "Messages",
  "会议数": "Meetings",
  "邮件数": "Emails",
  "协作密度": "Collaboration density",
  "本月": "This month",
  "上月": "Last month",
  "行业基准": "Industry benchmark",
  "响应时长": "Response time",
  "响应时长(小时)": "Response time (hours)",
  "响应效率": "Response efficiency",
  "变更项": "Change",
  "影响范围": "Scope",
  "上线时间": "Go-live date",
  "提升幅度": "Improvement",
  "债务类型": "Debt type",
  "存量": "Backlog",
  "已清理": "Cleared",
  "清理率": "Clearance rate",
  "技术债务": "Technical debt",
  "代码重复": "Code duplication",
  "过时依赖": "Outdated dependencies",
  "硬编码配置": "Hard-coded config",
  "缺乏单元测试": "Missing unit tests",
  "单元测试缺失": "Missing unit tests",
  "合计": "Total",
  "任务编号": "Task ID",
  "任务名称": "Task name",
  "优先级": "Priority",
  "负责人": "Owner",
  "预计工时": "Estimated effort",
  "预计工时（人天）": "Estimated effort (person-days)",
  "主要依赖": "Key dependency",
  "依赖": "Dependency",
  "资源类型": "Resource type",
  "Q3用量": "Q3 usage",
  "Q3 实际用量": "Q3 actual usage",
  "Q4需求": "Q4 requirement",
  "Q4 需求": "Q4 requirement",
  "增量": "Increase",
  "主要用途": "Primary use",
  "风险项": "Risk",
  "概率": "Probability",
  "影响": "Impact",
  "应对措施": "Mitigation",
  "参考来源": "References",
  "Q2 存量": "Q2 backlog",
  "Q3 清理": "Q3 cleared",
  "Q3 剩余": "Q3 remaining",
  "Q2 实际": "Q2 actual",
  "Q3 实际": "Q3 actual",
  "Q2旧架构": "Q2 legacy",
  "Q3新架构": "Q3 new architecture",
  "旧架构 Q2": "Legacy Q2",
  "新架构 Q3": "New architecture Q3",
  "认证接口响应时间": "Auth API response time",
  "认证错误率": "Auth error rate",
  "支付 P99 响应时间": "Payment P99 response time",
  "支付峰值吞吐量": "Peak payment throughput",
  "向量检索延迟": "Vector search latency",
  "向量并发检索量": "Concurrent vector throughput",
  "认证响应": "Auth response",
  "向量延迟": "Vector latency",
  "支付P99": "Payment P99",
  "支付吞吐量": "Payment throughput",
  "向量QPS": "Vector QPS",
  "缺陷密度（个/千行）": "Defect density (per KLOC)",
  "代码审查覆盖率": "Code review coverage",
  "单元测试覆盖率": "Unit test coverage",
  "PR 审查时长": "PR review duration",
  "PR 审查中位数时长": "Median PR review duration",
  "问题响应时长": "Issue response time",
  "问题响应中位数时长": "Median issue response time",
  "工单流转次数": "Ticket handoffs",
  "SLA 达成率": "SLA attainment",
  "审查覆盖": "Review coverage",
  "缺陷控制": "Defect control",
  "测试覆盖": "Test coverage",
  "综合得分": "Overall score",
  "协作次数": "Collaborations",
  "变更数量": "Change count",
  "直接下属数": "Direct reports",
  "跨团队协作人数": "Cross-team collaborators",
  "风险分布": "Risk distribution",
  "工程师人天": "Engineering person-days",
  "云资源费用": "Cloud spend",
  "第三方服务": "Third-party services",
  "安全认证": "Security certification",

  // —— 枚举值 ——
  "高": "High",
  "中": "Medium",
  "低": "Low",
  "是": "Yes",
  "否": "No",
  "重构": "Refactor",
  "替换": "Replace",
  "新增": "Add",

  // —— 月份 ——
  "6月": "Jun",
  "7月": "Jul",
  "8月": "Aug",
  "9月": "Sep",

  // —— 模块 / 协作对 ——
  "用户认证模块": "User authentication",
  "RAG引擎": "RAG engine",
  "RAG 引擎 v2 升级": "RAG engine v2 upgrade",
  "RAG 引擎端到端打通": "RAG engine end-to-end",
  "多设备管理": "Multi-device management",
  "多设备管理功能": "Multi-device management",
  "支付系统": "Payment system",
  "支付系统技术方案": "Payment system technical design",
  "支付接口重构": "Payment API refactor",
  "安全渗透": "Security penetration",
  "安全渗透测试": "Security penetration testing",
  "工作流引擎重构": "Workflow engine refactor",
  "SSO 单点登录集成": "SSO integration",
  "SOC2 合规建设": "SOC2 compliance",
  "SOC2 Type I 审计与渗透测试": "SOC2 Type I audit and penetration testing",
  "移动端原生 App": "Native mobile app",
  "集成市场（Marketplace）": "Integration marketplace",
  "设计系统 v1.0 上线": "Design system v1.0 launch",
  "实时监控告警系统新增": "Real-time monitoring and alerting",
  "GitHub OAuth 认证升级": "GitHub OAuth upgrade",
  "API Key 认证体系重构": "API Key authentication refactor",
  "向量数据库迁移（pgvector → Milvus）": "Vector database migration (pgvector → Milvus)",
  "AI 写作 v3 前后端开发": "AI writing v3 front-end and back-end",
  "向量数据库、AI 推理实例扩容": "Vector database and AI inference capacity",
  "API 网关、监控告警 SaaS 订阅": "API gateway and monitoring/alerting SaaS",
  "后端支付服务、前端订单模块": "Backend payment service, frontend orders module",
  "用户登录、SSO 单点登录模块": "User login and SSO module",
  "开发者平台、第三方集成服务": "Developer platform and third-party integrations",
  "AI 写作引擎、智能摘要模块": "AI writing engine and smart summarisation",
  "DevOps、SRE 团队": "DevOps and SRE",
  "研发、架构、运维、质量保障": "R&D, architecture, operations, QA",
  "需求定义、PRD 输出、路线图规划": "Requirements, PRD, roadmap planning",
  "UI/UX 设计、原型验证、设计系统维护": "UI/UX design, prototyping, design system",
  "内容营销、品牌传播、社交媒体运营": "Content marketing, brand, social media",
  "上线支持、续费跟进、NPS 管理": "Onboarding, renewals, NPS",
  "合同审核、合规审查、知识产权": "Contract review, compliance, IP",
  "—（暂由管理层代管）": "— (currently covered by Management)",
  "后端↔DevOps": "Backend↔DevOps",
  "产品↔技术": "Product↔Engineering",
  "后端↔前端": "Backend↔Frontend",
  "技术↔设计": "Engineering↔Design",
  "技术↔QA": "Engineering↔QA",
  "产品↔设计": "Product↔Design",
  "设计↔市场": "Design↔Marketing",
  "产品↔客户成功": "Product↔Customer Success",
  "QA↔客户成功": "QA↔Customer Success",
  "后端↔Dev…": "Backend↔Dev…",
  "产品↔客户成…": "Product↔Cust…",
  "QA↔客户成…": "QA↔Cust…",
  "PR 审查时…": "PR review…",
  "SLA 达成…": "SLA attain…",
  "客户成功负责…": "Head of Customer…",
  "2.1 次/单": "2.1 per ticket",
  "2.8 次/单": "2.8 per ticket",
  "3.2 次/单": "3.2 per ticket",
  "¥128 万元": "CNY 1.28M",
  "¥185 万元": "CNY 1.85M",
  "¥22 万元": "CNY 0.22M",
  "¥44 万元": "CNY 0.44M",
  "¥65 万元": "CNY 0.65M",
  "¥85 万元": "CNY 0.85M",
  "+¥57 万": "+CNY 0.57M",
  "+¥22 万": "+CNY 0.22M",
  "+¥20 万": "+CNY 0.20M",

  // —— 图表标题 ——
  "团队职级分布": "Team level distribution",
  "各部门人数对比": "Headcount by department",
  "管理者直接下属数与协作人数": "Direct reports and collaborators per manager",
  "Q3功能交付达成率对比": "Q3 feature delivery achievement",
  "Q3月度代码提交趋势": "Q3 monthly commit trend",
  "Q3质量指标达成分布": "Q3 quality metric achievement",
  "Q3 TOP5 成员综合贡献得分": "Q3 Top 5 contributors by overall score",
  "Q3 跨团队协作频次与响应时长": "Q3 cross-team collaboration and response time",
  "Q2→Q3 响应效率趋势对比": "Q2→Q3 response efficiency trend",
  "Q3 架构变更类型分布": "Q3 architecture change types",
  "核心性能指标对比（Q2 vs Q3）": "Core performance metrics (Q2 vs Q3)",
  "技术债务趋势变化（Q2–Q3）": "Technical debt trend (Q2–Q3)",
  "Q4 重点任务工时分布（人天）": "Q4 key task effort distribution (person-days)",
  "Q3 vs Q4 资源需求对比": "Q3 vs Q4 resource requirements",
  "Q4 关键风险热力矩阵（概率×影响）": "Q4 key risk matrix (probability × impact)",
  "新旧架构核心性能指标对比": "Core performance metrics: old vs new architecture",

  // —— 页面结构（h1/h2/h3 与章节名）——
  "Q3技术团队工作总结与业务汇报": "Q3 Engineering Team Summary & Business Review",
  "团队规模与结构": "Team size and structure",
  "部门分布": "Department distribution",
  "汇报关系": "Reporting lines",
  "功能交付达成": "Feature delivery",
  "代码生产力": "Code productivity",
  "质量指标": "Quality metrics",
  "个人贡献排名": "Individual contribution ranking",
  "跨团队协作": "Cross-team collaboration",
  "架构变更总览": "Architecture change overview",
  "性能对比": "Performance comparison",
  "Q4 重点任务": "Q4 key tasks",
  "资源需求": "Resource requirements",
  "风险与预案": "Risks and mitigations",
  "任务": "Task",

  // —— 大纲描述（case 元信息，用于 provenance 段落标题）——
  "包含团队规模与结构、部门分布、汇报关系三个信息点，每项包括说明文字、数据表格和可视化图表":
    "Covers team size and structure, department distribution and reporting lines, each with text, a table and a chart",
  "涵盖功能交付达成、代码生产力、质量指标等内容，结合文字、表格与图表形式呈现":
    "Covers feature delivery, code productivity and quality metrics, presented with text, tables and charts",
  "展示个人贡献排名、跨团队协作、响应效率等方面的数据与图形化表达":
    "Presents individual contribution ranking, cross-team collaboration and response efficiency with charts",
  "介绍架构变更总览、性能对比和技术债务的详细情况及图表展示":
    "Introduces the architecture change overview, performance comparison and technical debt, with charts",
  "规划Q4重点任务、资源需求以及风险与预案，并辅以相应图表":
    "Plans Q4 key tasks, resource requirements plus risks and mitigations, supported by charts",
  "团队成员总数、各职级分布概述（从People Graph获取）":
    "Total headcount and level distribution (from People Graph)",
  "跨部门协作团队构成说明（从People Graph获取）":
    "Composition of cross-department delivery teams (from People Graph)",
  "管理层级与汇报线概述（从People Graph获取）":
    "Management hierarchy and reporting lines (from People Graph)",
  "Q3核心功能交付情况总结（从本地项目文档获取）":
    "Summary of Q3 feature delivery (from local project documents)",
  "GitHub仓库开发活跃度概述（从GitHub仓库获取）":
    "Overview of GitHub development activity (from GitHub repositories)",
  "代码审查覆盖率与缺陷率说明（从GitHub仓库获取）":
    "Code review coverage and defect rate (from GitHub repositories)",
  "团队成员贡献度分析（从GitHub仓库+People Graph获取）":
    "Contribution analysis per member (from GitHub + People Graph)",
  "Teams Chat与Outlook Email协作频次分析（从远程文档获取）":
    "Teams Chat and Outlook Email collaboration volume (from remote documents)",
  "PR审查周期与问题响应时效（从GitHub仓库获取）":
    "PR review cycle and issue response time (from GitHub repositories)",
  "Q3架构演进关键变更点（从本地技术文档+GitHub仓库获取）":
    "Key Q3 architecture changes (from local technical docs + GitHub)",
  "新旧架构核心性能指标对比（从本地文档获取）":
    "Core performance metrics, old vs new architecture (from local documents)",
  "技术债务削减与代码健康度（从GitHub仓库获取）":
    "Technical debt reduction and code health (from GitHub repositories)",
  "Q4核心任务路线图概述（综合所有知识源）":
    "Q4 key task roadmap (all knowledge sources)",
  "Q4人力与资源需求分析": "Q4 staffing and resource requirements",
  "Q4关键风险与应对措施": "Q4 key risks and mitigations",

  "团队概览": "Team Overview",
  "Q3 关键成果与KPI达成": "Q3 Key Results & KPI Achievement",
  "团队效能与协作分析": "Team Productivity & Collaboration Analysis",
  "技术架构演进与创新": "Architecture Evolution & Innovation",
  "Q4 规划与资源需求": "Q4 Planning & Resource Requirements",
  "Bug修复": "Bug fixes",
  "成员贡献排名": "Contributor ranking",
  // —— 生成阶段提示 ——
  "生成阶段未能自动解决": "Could not be auto-resolved during generation",
  "管理阶段未能自动解决": "Could not be auto-resolved during generation",
  "非 high 严重度冲突，保留所有来源供用户判断":
    "Non-high-severity conflict: all sources kept for the user to judge",

  // —— 正文段落（被引用角标切成碎片，故按片段翻译）——
  "当前团队总人数为 18 人，其中技术部占比最高，达 44.4%（8/18），产品、设计、市场各 2 人，法务、客户成功部各 1 人，管理层 3 人（含 CEO/COO/CTO）":
    "The team currently has 18 people. Engineering is the largest group at 44.4% (8/18); Product, Design and Marketing have 2 each, Legal and Customer Success 1 each, and Management 3 (including CEO/COO/CTO)",
  "。Q3 末计划扩展至 25 人，新增岗位集中于工程、销售与客户成功方向，以支撑企业客户签约目标（10 家）":
    ". By the end of Q3 the plan is to grow to 25, with new roles concentrated in Engineering, Sales and Customer Success to support the goal of signing 10 enterprise customers",
  "。整体结构呈现“技术驱动、轻产品、重交付”的特征，符合 PLG（Product-Led Growth）阶段的组织演进规律":
    ". The overall shape is engineering-driven, lean-product and delivery-heavy — consistent with the organisational evolution expected at the PLG (Product-Led Growth) stage",
  "跨部门协作以技术部为核心，与产品、设计形成“铁三角”交付单元；市场与销售暂未合并，处于独立运作阶段；客户成功部与法务为支持型职能，人员精简":
    "Cross-department collaboration centres on Engineering, which forms an \"iron triangle\" delivery unit with Product and Design. Marketing and Sales have not merged and still operate independently; Customer Success and Legal are lean supporting functions",
  "。从协作密度看，技术部与产品部、设计部的沟通频次最高，符合 GitHub 与 Teams 数据交叉验证结果":
    ". By collaboration density, Engineering communicates most frequently with Product and Design, matching the cross-validated GitHub and Teams data",
  "。当前组织架构已覆盖产品全生命周期关键节点，但销售与市场协同效率仍有提升空间。":
    ". The current organisation covers the key stages of the product lifecycle, but Sales–Marketing coordination still has room to improve.",
  "管理层共 3 人，均直接向 CEO 汇报；技术部负责人管理 8 名工程师，为最大管理单元；产品、设计、市场负责人各带 2 人，管理幅度适中；客户成功与法务为单人岗，暂无下属":
    "There are 3 people in Management, all reporting directly to the CEO. The Head of Engineering manages 8 engineers — the largest span of control; the Heads of Product, Design and Marketing each lead 2 people; Customer Success and Legal are single-person functions with no direct reports",
  "。建议 Q4 探索“项目制”虚拟汇报机制，以增强跨职能响应速度。":
    ". For Q4 we suggest piloting a project-based virtual reporting mechanism to speed up cross-functional response.",

  "Q3 团队共完成 4 个核心功能模块交付，目标计划 5 项，达成率 80%；其中用户认证模块、RAG 引擎端到端打通、支付系统技术方案初稿三项均达成关键里程碑，仅多设备管理功能因技术依赖延迟至 Q4":
    "In Q3 the team delivered 4 of the 5 planned core feature modules — an achievement rate of 80%. User authentication, the end-to-end RAG engine and the payment system technical design all hit key milestones; only multi-device management slipped to Q4 on technical dependencies",
  "。未完成任务集中于安全与性能验证环节，包括 GitHub OAuth 回调超时、API Key 认证、性能测试及安全渗透测试":
    ". The outstanding work sits in security and performance validation: the GitHub OAuth callback timeout, API Key authentication, performance testing and security penetration testing",
  "。整体交付质量稳定，Sprint 3 单周任务完成率达 89%（42/47），未完成项已移入后续迭代":
    ". Delivery quality held steady, with a single-sprint task completion rate of 89% (42/47) in Sprint 3; unfinished items moved to later iterations",
  "Q3 全季度团队代码提交总量达 2,553 次，环比 Q2（2,108 次）提升 21.1%；PR 提交 612 个（+15.9%），代码审查 1,189 次（+16.2%），人均周提交频率 14.5 次/人/周，超出 12 次目标 20.8%":
    "Total commits for Q3 reached 2,553, up 21.1% QoQ from Q2 (2,108). PRs opened: 612 (+15.9%); code reviews: 1,189 (+16.2%); average commit frequency was 14.5 per person per week, 20.8% above the target of 12",
  "。开发节奏持续加快，6–9 月提交量呈稳步上升趋势，9 月单月提交达 821 次，为季度峰值":
    ". The cadence kept accelerating: monthly commits rose steadily from June to September, peaking at 821 in September",
  "Q3 代码审查覆盖率达 98.2%，目标 95%，环比提升 2.1 个百分点；缺陷密度为 0.72 个/千行代码，较 Q2（0.85）下降 15.3%，表明代码健康度持续改善":
    "Q3 code review coverage reached 98.2% against a 95% target, up 2.1 points QoQ. Defect density was 0.72 per thousand lines, down 15.3% from Q2 (0.85), indicating steadily improving code health",
  "。单元测试覆盖率提升至 85%，其中用户认证模块 E2E 测试用例达 28 个，覆盖核心路径":
    ". Unit test coverage rose to 85%, with 28 end-to-end test cases covering the core paths of user authentication",
  "。RAG 引擎 Groundedness Check 准确率达 92%，端到端延迟 P95 < 3 秒，满足性能基线":
    ". The RAG engine's groundedness check reaches 92% accuracy, with an end-to-end P95 latency under 3 seconds — meeting the performance baseline",
  "。RAG 引擎 Groundedness Check 准确率达 92%，端到端延迟 P95":
    ". The RAG engine's groundedness check reaches 92% accuracy, with an end-to-end P95 latency",

  "Q3 团队成员整体贡献活跃度显著提升，TOP5 成员以代码提交、PR 合并、代码审查与缺陷修复四维指标综合评分，刘伟以 397 分位居榜首，其 Commit（312）、PR（74）、审查（128）与 Bug 修复（45）均居前列；陈强（377 分）与赵丽（355 分）紧随其后，二人在缺陷修复与审查环节表现突出；杨飞与王超虽 Commit 数偏低，但凭借高比例的 Bug 修复（52 与 36）进入前五":
    "Overall contribution activity rose markedly in Q3. The Top 5 were scored across four dimensions — commits, PRs merged, code reviews and bug fixes. Liu Wei leads with 397 points and ranks near the top on every axis (commits 312, PRs 74, reviews 128, bug fixes 45); Chen Qiang (377) and Zhao Li (355) follow, both standing out on bug fixes and reviews; Yang Fei and Wang Chao have lower commit counts but made the Top 5 on the strength of their bug fixes (52 and 36)",
  "。综合得分公式为 Commit×0.3 + PR×1.5 + 审查×0.8 + Bug修复×2.0，体现团队对质量保障与协作审查的权重倾斜":
    ". The score is Commit×0.3 + PR×1.5 + Reviews×0.8 + Bug fixes×2.0, reflecting the team's weighting towards quality assurance and collaborative review",
  "Q3 跨团队协作频次达 854 次，环比增长 18.1%，其中产品↔技术（186 次）、后端↔前端（152 次）为高频协作对，响应时效最快达 1.9 小时；技术↔设计（3.5 小时）与产品↔客户成功（4.8 小时）响应周期较长，存在优化空间":
    "Cross-team collaboration reached 854 interactions, up 18.1% QoQ. Product↔Engineering (186) and Backend↔Frontend (152) were the most frequent pairs, responding in as little as 1.9 hours; Engineering↔Design (3.5 h) and Product↔Customer Success (4.8 h) were slower, leaving room to improve",
  "。GitHub 与 Microsoft Graph 数据显示，跨团队协作主要通过 PR 审查（技术-产品）、文档共享（设计-市场）实现，汇报线清晰但协作路径略显线性":
    ". GitHub and Microsoft Graph data show collaboration happens mainly through PR review (Engineering–Product) and document sharing (Design–Marketing); reporting lines are clear but collaboration paths are somewhat linear",
  "。协作密度热力图显示，绿色区域（≥40 次）集中于核心开发链路，而设计↔市场（18 次）协作频次最低，响应长达 6.2 小时，反映跨职能协同尚未形成标准化流程":
    ". The collaboration-density heatmap shows the green zone (≥40) concentrated on the core development path, while Design↔Marketing (18) is the least active pair at 6.2 hours — cross-functional collaboration is not yet a standardised process",
  "。尽管 Q3 协作次数环比 +18%，人均响应时长却下降，说明“审查看板”与“on-call 轮值”双机制有效提升了协作质量与效率":
    ". Although collaboration volume grew 18% QoQ, per-person response time fell, showing that the review dashboard and on-call rotation together raised both quality and efficiency",
  "Q3 协作效率显著提升：首次响应时间下降 25%，高优工单响应下降 44%，SLA 达成率突破 95%；工单流转次数下降 25%，表明问题首次定位准确率同步提升":
    "Collaboration efficiency improved markedly in Q3: first-response time fell 25%, high-priority ticket response fell 44% and SLA attainment passed 95%; ticket handoffs fell 25%, indicating better first-time issue localisation",
  "。PR 合并时长由 Q2 的 12.3 小时缩短至 8.6 小时（-30.1%），审查响应时长由 4.8 小时降至 3.2 小时（-33.3%），流程效率显著提升":
    ". PR merge time fell from 12.3 hours in Q2 to 8.6 hours (-30.1%), and review response time from 4.8 to 3.2 hours (-33.3%) — a marked gain in process efficiency",
  "。PR 审查周期中位数为 1.8 小时（上月 2.4 小时），行业基准为 3.5 小时；问题响应时效中位数为 2.1 小时（上月 2.8 小时），较行业基准快 39%":
    ". Median PR review time was 1.8 hours (2.4 last month) against an industry benchmark of 3.5 hours; median issue response time was 2.1 hours (2.8 last month), 39% faster than the benchmark",
  "。SLA 达成率目标 ≥97%，跨团队协作平均响应时长控制在 ≤2.2h":
    ". The SLA target is ≥97%, with average cross-team response time held at ≤2.2 h",
  "。协作改进建议已纳入执行计划：推广 API 契约模板以降低联调阻塞 40%，设立设计↔市场固定窗口（响应 ≤3h），并试点工单 SWAT 小组（高优问题 MTTR ≤15min）":
    ". Collaboration improvements are in the execution plan: rolling out API contract templates to cut integration blockers by 40%, creating a fixed Design↔Marketing window (response ≤3 h), and piloting a ticket SWAT squad (MTTR ≤15 min for high-priority issues)",

  "Q3 共完成 5 项关键架构演进，涵盖认证体系、支付链路、AI 引擎与数据库迁移，其中支付接口重构与 Milvus 向量库迁移为高优先级升级，均于 9 月 10 日前上线并完成灰度验证":
    "Five key architecture changes landed in Q3, spanning authentication, the payment path, the AI engine and database migration. The payment API refactor and the Milvus vector store migration were high-priority upgrades; both went live before 10 September and passed canary validation",
  "。变更类型包括重构（2 项）、替换（2 项）、新增（1 项），影响范围覆盖后端核心服务、前端认证模块及 AI 写作引擎，均未引发线上事故":
    ". The changes comprise 2 refactors, 2 replacements and 1 addition, affecting core backend services, the frontend auth module and the AI writing engine — none caused a production incident",
  "Q3 架构升级带来显著性能提升：认证接口响应时间由 45ms 缩短至 18ms（-60%），认证错误率由 0.12% 降至 0.02%（-83%）；支付 P99 响应时间从 8.2 秒降至 320ms，峰值吞吐量从 120 TPS 提升至 850 TPS；向量检索延迟由 520ms 降至 45ms，支持并发检索量从 50 QPS 提升至 400 QPS":
    "The Q3 upgrade delivered clear gains: auth response time fell from 45 ms to 18 ms (-60%) and the auth error rate from 0.12% to 0.02% (-83%); payment P99 dropped from 8.2 s to 320 ms and peak throughput rose from 120 to 850 TPS; vector search latency fell from 520 ms to 45 ms with concurrency up from 50 to 400 QPS",
  "。整体系统稳定性同步增强，为 Q4 高并发场景（如企业客户批量签约）奠定技术基础":
    ". System stability improved in step, laying the groundwork for Q4's high-concurrency scenarios such as bulk enterprise onboarding",
  "Q3 共清理技术债务 14 项（含 Q2 遗留 8 项 + Q3 新增 6 项），重点清理包括前端组件库代码重复率从 18% 降至 9%，重构 23 个重复组件；后端核心服务移除 4 个过时依赖（lodash 3.x、moment 2.x 等），减少包体积 2.3MB":
    "14 technical debt items were cleared in Q3 (8 carried over from Q2 plus 6 new). Highlights: frontend component-library duplication fell from 18% to 9% with 23 duplicate components refactored, and 4 outdated backend dependencies (lodash 3.x, moment 2.x and others) were removed, cutting bundle size by 2.3 MB",
  "。Q3 剩余债务总量 17 项，较 Q2 的 31 项下降 45%；剩余债务集中于缺乏单元测试（3 项）与部分模块重构延迟":
    ". Remaining debt stands at 17 items, down 45% from 31 in Q2; what remains is concentrated in missing unit tests (3) and delayed module refactors",

  "Q4 将围绕「AI 能力深化、企业级安全合规、生态扩展」三大战略方向推进 8 项重点任务，预计总投入 3,860 人天，新增预算 186 万元":
    "Q4 advances 8 key initiatives across three strategic directions — deepening AI capability, enterprise security and compliance, and ecosystem expansion — with an estimated 3,860 person-days and CNY 1.86M of new budget",
  "。任务覆盖 RAG 引擎升级、工作流引擎重构、SSO 单点登录集成、SOC2 合规建设、移动端原生 App 开发等关键领域，其中 T1（RAG）、T4（工作流引擎）、T7（SOC2）被列为最高优先级":
    ". The work spans the RAG engine upgrade, workflow engine refactor, SSO integration, SOC2 compliance and native mobile app development; T1 (RAG), T4 (workflow engine) and T7 (SOC2) are the top priorities",
  "。任务负责人覆盖技术、产品、设计、QA 全职能团队，确保端到端交付能力":
    ". Task owners span Engineering, Product, Design and QA, ensuring end-to-end delivery capability",
  "Q4 人力投入较 Q3 增长 38.9%（18 人 → 25 人），新增岗位集中于工程（3 人）、销售（2 人）、客户成功（2 人），以支撑企业客户签约目标（10 家）":
    "Q4 headcount grows 38.9% over Q3 (18 → 25). New roles concentrate in Engineering (3), Sales (2) and Customer Success (2), supporting the goal of signing 10 enterprise customers",
  "。核心工程师平均投入占比达 85%~95%，其中孙娜、周敏、徐骏、杨飞等关键成员满负荷运转":
    ". Core engineers run at 85%–95% utilisation, with key members such as Sun Na, Zhou Min, Xu Jun and Yang Fei at full capacity",
  "。预算增量 186 万元主要用于云资源扩容（+45%）、第三方服务采购（+30%）及安全认证支出（+100%）":
    ". The extra CNY 1.86M goes mainly to cloud capacity expansion (+45%), third-party services (+30%) and security certification (+100%)",
  "Q4 最高风险为「跨团队联调阻塞」与「SOC2 合规延期」，概率均 ≥70%，影响等级为高（业务中断或客户流失）":
    "The top Q4 risks are cross-team integration blockers and SOC2 compliance slippage, both with probability ≥70% and high impact (business interruption or customer churn)",

  // —— 风险 / 缓解措施 / 依赖 ——
  "跨模块联调阻塞": "Cross-module integration blockers",
  "AI 写作 v3 性能不达标": "AI writing v3 misses performance targets",
  "SOC2 合规审计未通过": "SOC2 compliance audit not passed",
  "移动端 App 上架审核延迟": "Mobile app store review delay",
  "全面推广 API 契约模板；每日站会同步依赖项":
    "Roll out API contract templates across the board; sync dependencies at the daily stand-up",
  "预留 20% 工时用于模型蒸馏与缓存优化；建立 A/B 测试机制":
    "Reserve 20% of effort for model distillation and cache optimisation; set up A/B testing",
  "提前与 App Store/华为应用市场沟通；准备双版本（轻量版+完整版）":
    "Engage the App Store and Huawei AppGallery early; prepare two variants (lite + full)",
  "提前 6 周启动预审；预留 2 名外部顾问支持":
    "Start pre-audit 6 weeks early; budget for 2 external consultants",
  "向量库迁移完成": "Vector store migration complete",
  "OAuth2.0 契约落地": "OAuth 2.0 contract agreed",
  "前端框架统一": "Frontend framework unified",
  "T1 完成": "T1 complete",
  "T6 设计需求对齐": "T6 design requirements aligned",
  "产品需求冻结": "Product requirements frozen",
  "UI 设计系统就绪": "UI design system ready",
  "基础设施加固": "Infrastructure hardening",
  "8 项重点任务交付": "Delivery of 8 key initiatives",

  // —— 冲突详情（claim 文本 / 判定理由）——
  "Q3 团队规模目标与实际人数": "Q3 team size: target vs. actual",
  "当前团队:18人；Q3末目标:25人": "Current team: 18; end-of-Q3 target: 25",
  "人数:18-19人": "Headcount: 18–19",
  "Beta版本发布时间": "Beta release date",
  "7月:Beta版本发布": "July: Beta release",
  "7月:Beta版本发布 + Landing page上线": "July: Beta release + landing page launch",
  "Sprint 3未完成Beta前置条件": "Sprint 3 did not complete the Beta prerequisites",
  "Q3技术债务清理数量": "Number of technical debt items cleared in Q3",
  "Q3共完成技术债务清理14项": "14 technical debt items cleared in Q3",
  "Q3共清理14项（分类统计）": "14 cleared in Q3 (categorised)",
  "支付接口重构上线时间": "Payment API refactor go-live date",
  "上线时间2026年9月10日": "Go-live 10 September 2026",
  "Sprint 3仅完成方案初稿": "Sprint 3 only produced a draft design",
  "Q3团队总Commit数": "Total Q3 commits",
  "Q3总Commit数:2,553次": "Q3 total commits: 2,553",
  "Q3合计提交1,096次": "Q3 total commits: 1,096",
  "Q3总Commit数:2,553次（Q2为2,108次，环比+21.1%）": "Q3 total commits: 2,553 (Q2: 2,108, +21.1% QoQ)",
  "Q3合计提交1,096次（Q2为978次，增长12.1%）": "Q3 total commits: 1,096 (Q2: 978, +12.1%)",
  "当前团队:18人；Q3末目标:25人(+3工程师、+2销售、+2CS)": "Current team: 18; end-of-Q3 target: 25 (+3 engineers, +2 sales, +2 CS)",
  "Q3共完成技术债务清理14项（含Q2遗留8项 + Q3新增6项）": "14 technical debt items cleared in Q3 (8 carried over from Q2 + 6 new)",
  "Q3共清理：代码重复5项 + 过时依赖4项 + 硬编码配置3项 + 缺乏单元测试2项 = 14项":
    "Q3 clearance: code duplication 5 + outdated dependencies 4 + hard-coded config 3 + missing unit tests 2 = 14 items",
  "上线时间为2026年9月10日，由王超主导": "Go-live 10 September 2026, led by Wang Chao",
  "两数据差异显著（2,553 vs 1,096），前者来自团队周报，统计口径为‘核心8人’Commit总和（见其明细表），后者为GitHub仓库总提交数（含非核心成员/自动化提交）；团队周报明确限定‘技术部核心8人’，与团队概览中‘技术8人’一致，且含PR/审查等关联指标，数据更聚焦、可解释性强，可信度更高":
    "The two figures differ materially (2,553 vs 1,096). The first comes from the team weekly report and counts commits by the 8 core members (see its detail table); the second is the GitHub repository total including non-core members and automated commits. The weekly report explicitly scopes to the 8 core engineers, consistent with \"8 in Engineering\" in the team overview, and includes related PR/review metrics — it is more focused, more explainable and more credible",
  "该周报为一线技术负责人实绩反馈，明确指出Sprint 3（8月中旬）仍未完成性能/安全测试等Beta关键前置条件；而PPT为早期规划，未考虑技术风险，实际执行中Beta推迟更可信":
    "The weekly report is first-hand feedback from the technical lead and states that Sprint 3 (mid-August) had still not completed the key Beta prerequisites such as performance and security testing. The deck is an early plan that did not account for technical risk, so in practice a Beta delay is the more credible reading",
  "技术报告明确记录上线时间、负责人及性能指标提升（P99从8.2s→320ms），属已完成事实；周报为8月中旬状态，早于9月10日上线，二者不矛盾但报告更完整，且含量化结果":
    "The technical report records the go-live date, the owner and the performance improvement (P99 from 8.2 s to 320 ms) — a completed fact. The weekly report reflects mid-August, before the 10 September go-live; the two are not contradictory, but the report is more complete and carries quantified results",
  "该PPT为正式Q3规划文档，明确区分当前与目标人数，且含具体招聘计划；PRD中‘18-19人’为统计口径模糊的当前快照，未体现Q3增长目标，权威性与目标导向性较弱":
    "The deck is a formal Q3 planning document that separates current from target headcount and includes a concrete hiring plan. The PRD's \"18–19 people\" is a loosely scoped current snapshot that does not reflect the Q3 growth target, so it is less authoritative and less goal-oriented",
  "Sprint 3（8月中旬）完成用户认证模块、RAG引擎打通等关键功能，但未明确Beta发布；未完成项含性能测试、安全渗透测试等Beta上线前关键项":
    "Sprint 3 (mid-August) completed key work such as user authentication and the RAG engine, but did not confirm a Beta release; outstanding items include performance testing and security penetration testing — both prerequisites for Beta",
  "Sprint 3（8月中旬）完成支付系统技术方案初稿（Stripe集成方案、订阅模式、Webhook设计），但未提及已上线":
    "Sprint 3 (mid-August) produced a first draft of the payment system technical design (Stripe integration, subscription model, webhook design) but does not mention a go-live",
  "两处内容实为同一文档内不同段落，非冲突；但为避免误判，保留该条说明数据一致性高，无真实冲突":
    "The two passages are in fact different paragraphs of the same document, not a conflict. Kept for transparency: consistency is high and there is no real conflict",

  // —— 冲突主题（评估卡）——
  "Q3 代码提交总量与 PR 总量比例": "Ratio of total commits to total PRs in Q3",
  "Q3 代码提交环比增长率": "QoQ commit growth rate in Q3",
  "Q3 代码提交频率目标达成率": "Achievement rate of the commit-frequency target in Q3",
  "Q3 人均周提交频率目标达成率": "Achievement rate of the per-person weekly commit target in Q3",
  "Q3 代码审查覆盖率": "Q3 code review coverage",
  "Q3 代码审查平均响应时长": "Q3 average code review response time",
  "Q3 代码审查平均响应时长与审查周期": "Q3 average code review response time and review cycle",
  "Q3 代码审查平均响应时长 vs PR 合并时长": "Q3 average code review response time vs PR merge time",
  "Q3 技术债务清理数量": "Number of technical debt items cleared in Q3",
  "Q3 技术债务清理中‘缺乏单元测试’清理数量": "Number of \"missing unit tests\" cleared in Q3",
  "Q3 协作效率改进成效": "Impact of the Q3 collaboration efficiency improvements",
  "Q3 协作效率提升是否导致人均响应时长下降": "Did the Q3 efficiency gains reduce per-person response time",
  "Q3 邮件总量": "Total Q3 email volume",
  "Q3 PR 合并率": "Q3 PR merge rate",
  "Q3 代码提交总量": "Total Q3 commits",
};

// ── 派生 ────────────────────────────────────────────────────

const CJK = /[\u4e00-\u9fff]/;

/** 数值 + 中文单位的规则化（如 "2.8 小时" → "2.8 h"） */
const UNIT_EN: Record<string, string> = {
  "小时": "h",
  "人天": "person-days",
  "次": "times",
  "万元": "×10k CNY",
};

/** 单条字符串翻译：整条 → 冒号拆分 → 括号拆分 → 数值+单位 */
export function translateUnit(raw: string): string {
  const key = raw.trim();
  if (!key || !CJK.test(key)) return raw;
  const hit = ZH_EN[key];
  if (hit) return raw.replace(key, hit);

  // "A - B"（provenance 的「章节 - 来源文件」拼接）
  if (key.includes(" - ")) {
    const parts = key.split(" - ");
    if (parts.length === 2) {
      const l = ZH_EN[parts[0].trim()];
      const r = ZH_EN[parts[1].trim()];
      if (l || r) return raw.replace(key, `${l ?? parts[0].trim()} - ${r ?? parts[1].trim()}`);
    }
  }

  // "标签: 值" / "标签：值"
  const m1 = key.match(/^(.+?)[：:]\s*(.+)$/);
  if (m1 && ZH_EN[m1[1].trim()]) return raw.replace(key, `${ZH_EN[m1[1].trim()]}: ${m1[2]}`);

  // "标签 (值)" / "标签（值）"
  const m2 = key.match(/^(.+?)\s*[（(](.+?)[)）]$/);
  if (m2 && ZH_EN[m2[1].trim()]) return raw.replace(key, `${ZH_EN[m2[1].trim()]} (${m2[2]})`);

  // "数值 单位"
  const m3 = key.match(/^([\d.,+\-–~]+)\s*(.+)$/);
  if (m3 && UNIT_EN[m3[2].trim()]) return raw.replace(key, `${m3[1]} ${UNIT_EN[m3[2].trim()]}`);

  return raw;
}

/** 翻译一段「文本片段」（标签之间的内容） */
function translateTextSegment(inner: string): string {
  if (!CJK.test(inner)) return inner;
  const trimmed = inner.trim();
  if (!trimmed) return inner;

  if (trimmed.includes('\\"')) {
    // chart-spec JSON：被转义的字符串值逐个翻译（键名无中文，天然不动）
    const replaced = trimmed.replace(/\\"([^"\\]*)\\"/g, (m, v: string) => {
      const t = translateUnit(v);
      return t === v ? m : '\\"' + t + '\\"';
    });
    return inner.replace(trimmed, replaced);
  }
  const t = translateUnit(trimmed);
  return t === trimmed ? inner : inner.replace(trimmed, t);
}

/**
 * 翻译一段 HTML：标签之间的文本、`title="..."` 属性、
 * 以及内嵌 chart-spec 里的 JSON 字符串值。
 *
 * 实现要点：**按标签切分**而不是用 `>([^<>]+)<` 取文本。
 * 正文里存在字面量 `<`（例如「端到端延迟 P95 < 3 秒，满足性能基线」），
 * 用 `<` 当分隔符会把文本截断，导致后半句漏翻。
 */
export function translateHtml(html: string): string {
  const TAG = /<[a-zA-Z/!][^>]*>/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG.exec(html))) {
    if (m.index > last) out += translateTextSegment(html.slice(last, m.index));
    out += m[0].replace(/title="([^"]*)"/g, (full, v: string) => {
      const t = translateUnit(v);
      return t === v ? full : `title="${t}"`;
    });
    last = m.index + m[0].length;
  }
  if (last < html.length) out += translateTextSegment(html.slice(last));

  return out;
}

/** 递归翻译对象里所有字符串字段（HTML 走 translateHtml） */
function translateDeep<T>(value: T): T {
  if (typeof value === "string") {
    const s = value as unknown as string;
    return (s.includes("<") ? translateHtml(s) : translateUnit(s)) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => translateDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = translateDeep(v);
    return out as unknown as T;
  }
  return value;
}

/**
 * 由中文 fixture 派生英文 fixture。
 *
 * 结构标签（title / outline / 章节标题）走显式映射，
 * 其余字符串统一走词表。数值、图表、来源结构保持不变。
 */
export function buildCaseEn<T extends Record<string, any>>(zhCase: T): T {
  const en = translateDeep(zhCase) as Record<string, any>;
  en.title = CASE_1783257530743_TITLE_EN;
  en.outline = CASE_1783257530743_OUTLINE_EN;
  if (Array.isArray(en.sections)) {
    en.sections = en.sections.map((s: any) => ({
      ...s,
      title: CASE_1783257530743_SECTION_TITLES_EN[s.title] ?? s.title,
    }));
  }
  // userRequest 未被任何回放路径使用，保留英文摘要即可
  en.userRequest = "Generate a \"Q3 Engineering Team Summary & Business Review\" PowerPoint deck, 5 slides, pptx format.";
  return en as T;
}

/** 英文 fixture 惰性构建并缓存（派生一次，避免每次回放都深拷贝） */
let cachedEnCase: Record<string, any> | null = null;

/**
 * 按语言取 Demo 回放数据。
 * zh → 原始中文 case；en → 由词表派生的英文 case（结构/数值一致，仅文案不同）。
 */
export function getDemoCase<T extends Record<string, any>>(zhCase: T, language?: string): T {
  if (language !== "en") return zhCase;
  if (!cachedEnCase) cachedEnCase = buildCaseEn(zhCase);
  return cachedEnCase as T;
}

/** 查出仍未翻译的中文单元（开发期校验用，便于补齐词表） */
export function findUntranslatedUnits(zhCase: Record<string, any>): string[] {
  const left = new Set<string>();
  const visit = (v: any) => {
    if (typeof v === "string") {
      if (v.includes("<")) {
        for (const m of v.matchAll(/>([^<>]+)</g)) {
          const t = m[1].trim();
          if (CJK.test(t) && translateUnit(t) === t) left.add(t);
        }
        for (const m of v.matchAll(/title="([^"]*)"/g)) {
          const t = m[1].trim();
          if (CJK.test(t) && translateUnit(t) === t) left.add(t);
        }
      } else if (CJK.test(v) && translateUnit(v) === v) {
        left.add(v);
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(zhCase);
  return [...left];
}

