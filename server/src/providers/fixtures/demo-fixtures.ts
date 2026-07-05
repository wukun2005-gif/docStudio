/** Demo fixtures — 基于真实 case 1783039193175 的数据 */
import { CASE178 } from "./case178.js";

export const DEMO_FIXTURES = {
  /** analyzeIntent: 意图分析 → document */
  intentAnalysis: JSON.stringify({
    intent: "document",
    outlineRequested: false,
    hasUserOutline: false,
    extractedOutline: [],
  }),

  /** generateOutline: 大纲生成 — 匹配 case178 的 5 页 PPT */
  outline: JSON.stringify({ outline: CASE178.outline }),

  /** generateTitle: 标题生成 */
  title: JSON.stringify({
    title: "Q3技术团队工作总结",
    readers: [
      { name: "黄薇", title: "技术总监", role: "primary" },
      { name: "苏楠", title: "产品总监", role: "primary" },
    ],
  }),

  /** generateSectionContent: 章节内容 — 直接使用 case178 的真实 HTML（含 SVG chart） */
  sectionContent(sectionIndex: number): string {
    return CASE178.sectionContent(sectionIndex);
  },

  /** groundednessCheck */
  groundedness: JSON.stringify({
    verdict: "pass" as const,
    groundedRatio: 0.97,
    sentenceResults: [
      { sentence: "团队规模与结构：团队成员总数、各职级分布概述。", grounded: true, confidence: 0.98 },
      { sentence: "部门分布：跨部门协作团队构成说明。", grounded: true, confidence: 0.96 },
      { sentence: "功能交付达成：Q3核心功能交付情况总结。", grounded: true, confidence: 0.95 },
    ],
  }),

  /** fidelityCheck */
  fidelity: JSON.stringify({
    per_document: [
      { doc_index: 0, relevant: true, reason: "与章节主题高度相关" },
      { doc_index: 1, relevant: true, reason: "提供关键技术细节" },
    ],
    fidelity_score: 0.96,
  }),

  /** reranker: 重排序 */
  rerankerScores: [0.97, 0.95, 0.92, 0.88, 0.85],

  /** conflictDetection: 冲突检测 */
  conflictDetection: JSON.stringify({
    hasConflicts: true,
    conflictRate: 0.18,
    conflicts: [],
  }),

  /** trustReport: 信任度报告 — 匹配 case178 的真实评估数据 */
  trustReport: JSON.stringify(CASE178.trustReport),

  /** documentStyle */
  documentStyle: "presentation",

  /** peopleContext */
  peopleContext: "黄薇（技术总监，技术部）\n苏楠（产品总监，产品部）",

  /** webSearchCitations */
  webSearchCitations: [] as string[],

  /** relevanceCheck */
  relevanceCheck: JSON.stringify({
    verdicts: [
      { text: "团队规模与结构：团队成员总数、各职级分布概述。", relevant: true, reason: "与用户需求直接相关" },
      { text: "功能交付达成：Q3核心功能交付情况总结。", relevant: true, reason: "属于Q3工作总结范围" },
    ],
    irrelevant_sentences: [] as string[],
    relevance_ratio: 0.87,
  }),

  /** completenessCheck */
  completenessCheck: JSON.stringify({
    covered_points: [
      "团队规模与结构",
      "Q3关键成果与KPI达成",
      "团队效能与协作分析",
      "技术架构演进与创新",
      "Q4规划与资源需求",
    ],
    missing_points: [] as string[],
    completeness_ratio: 0.97,
  }),

  /** demoSources: 知识库来源（provenance tree + heatmap 展示用）
   *  sourceId 分布策略：
   *    s0: 5 sources, 5 unique IDs → 绿色（多源交叉验证）
   *    s1: 3 sources, 1 unique ID  → 黄色（单源支撑）
   *    s2: 2 sources, 2 unique IDs → 绿色（多源）
   *    s3: 4 sources, 1 unique ID  → 黄色（单源支撑）
   *    s4: 3 sources, 3 unique IDs → 绿色（多源交叉验证）
   */
  demoSources: [
    // s0: 5 unique sources → 绿色
    [
      { chunkId: "cs0-1", content: "技术团队规模：15人，其中高级工程师6人（40%）、工程师7人（47%）、实习生2人（13%）", sourceId: "people", sourceName: "People Graph", score: 0.98 },
      { chunkId: "cs0-2", content: "部门分布：技术部8人负责核心开发，产品部4人负责需求与设计，测试部3人负责质量保障", sourceId: "org", sourceName: "组织架构.xlsx", score: 0.95 },
      { chunkId: "cs0-3", content: "管理层级：技术总监→3位团队负责人→工程师，每人管理幅度3-5人", sourceId: "mgmt", sourceName: "管理层级.md", score: 0.92 },
      { chunkId: "cs0-4", content: "团队成员名单：黄薇（技术总监）、李明（团队负责人）、张伟（高级工程师）" + "、王芳（产品经理）", sourceId: "hr", sourceName: "HR系统导出.csv", score: 0.88 },
      { chunkId: "cs0-5", content: "汇报关系：技术总监→3位团队负责人→每人带3-5名工程师，产品总监→2位产品经理", sourceId: "report", sourceName: "汇报线图.png", score: 0.85 },
    ],
    // s1: 3 sources but all share 1 sourceId → 黄色
    [
      { chunkId: "cs1-1", content: "Q3关键成果：认证模块100%完成，支付系统100%完成，CI管线95%完成，整体达成率98.3%", sourceId: "kpi", sourceName: "Q3 KPI 追踪.xlsx", score: 0.97 },
      { chunkId: "cs1-2", content: "GitHub活跃度：Q3总提交830次（+22%）、PR合并率92%（+5%）、代码行变更+12,450行", sourceId: "kpi", sourceName: "Q3 KPI 追踪.xlsx", score: 0.94 },
      { chunkId: "cs1-3", content: "质量指标：测试覆盖率78%→目标75%、缺陷修复率95%、代码审查覆盖率100%", sourceId: "kpi", sourceName: "Q3 KPI 追踪.xlsx", score: 0.91 },
    ],
    // s2: 3 unique sources → 绿色
    [
      { chunkId: "cs2-1", content: "个人贡献TOP5：张三120 commits/30 reviews、李四95/28、王五80/25、赵六60/20、孙七45/35", sourceId: "contrib", sourceName: "贡献度排名.xlsx", score: 0.96 },
      { chunkId: "cs2-2", content: "跨团队协作数据：技术→产品1250条消息/15次会议、产品→测试890条/12次", sourceId: "teams", sourceName: "Teams 统计", score: 0.93 },
      { chunkId: "cs2-3", content: "效率指标：PR审查平均4.2小时（优于行业基准8h）、问题响应2.1小时", sourceId: "efficiency", sourceName: "效率报告.xlsx", score: 0.90 },
    ],
    // s3: 4 sources but all share 1 sourceId → 黄色
    [
      { chunkId: "cs3-1", content: "架构变更里程碑：8/15微服务拆分启动 → 8/22认证模块上线 → 9/5支付系统上线 → 9/18完成全部迁移", sourceId: "arch", sourceName: "架构变更记录.md", score: 0.95 },
      { chunkId: "cs3-2", content: "性能对比：平均响应时间280ms→168ms（-40%）、峰值并发2000→3200（+60%）、错误率2.5%→1.2%（-52%）", sourceId: "arch", sourceName: "架构变更记录.md", score: 0.93 },
      { chunkId: "cs3-3", content: "技术架构决策：采用Kubernetes+Istio方案替代Spring Cloud，兼容性评分9.2/10", sourceId: "arch", sourceName: "架构变更记录.md", score: 0.88 },
      { chunkId: "cs3-4", content: "部署效率：单服务部署时间从45分钟降至8分钟（-82%）、自动化部署覆盖率从40%提升至95%", sourceId: "arch", sourceName: "架构变更记录.md", score: 0.85 },
    ],
    // s4: 3 unique sources → 绿色
    [
      { chunkId: "cs4-1", content: "Q4重点任务：RAG引擎优化（120h/P0）、企业定制方案（80h/P1）、知识库接入（100h/P0）", sourceId: "q4plan", sourceName: "Q4技术规划.docx", score: 0.94 },
      { chunkId: "cs4-2", content: "资源需求评估：技术人员8→11人（+38%）、新增销售2人、客户服务3人，总预算增加15%", sourceId: "resource", sourceName: "资源需求.xlsx", score: 0.91 },
      { chunkId: "cs4-3", content: "风险矩阵：技术风险（高概率/中影响）→灰度发布控制 | 资源风险（中/高）→提前招聘 | 时间风险（低/中）→buffer预留", sourceId: "risk", sourceName: "风险评估.md", score: 0.89 },
    ],
  ],

  /** OneDrive PPTX 链接 */
  pptxUrl: CASE178.pptxUrl,
};
