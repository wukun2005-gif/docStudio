/** Demo fixtures — hardcoded LLM responses for the 90-second competition demo */

export const DEMO_FIXTURES = {
  /** analyzeIntent: 意图分析 → document */
  intentAnalysis: JSON.stringify({
    intent: "document",
    outlineRequested: false,
    hasUserOutline: false,
    extractedOutline: [],
  }),

  /** generateOutline: 大纲生成 — 基于 "写一份 Q3 技术决策报告" */
  outline: JSON.stringify({
    title: "Q3 技术决策报告",
    sections: [
      { id: "s1", title: "概述与目标", description: "Q3 技术目标回顾与总体概述", order: 1 },
      { id: "s2", title: "关键技术决策", description: "Q3 期间做出的重大技术选型与架构决策", order: 2 },
      { id: "s3", title: "决策评估与分析", description: "各决策的影响评估、风险分析和收益对比", order: 3 },
      { id: "s4", title: "实施进展与成果", description: "各项决策的实施进度和已取得的成果", order: 4 },
      { id: "s5", title: "经验教训与建议", description: "从 Q3 决策中提炼的最佳实践和改进建议", order: 5 },
    ],
  }),

  /** generateTitle: 标题生成 */
  title: JSON.stringify({
    title: "Nexora Tech Q3 技术决策报告",
    readers: [
      { name: "陈强", title: "技术负责人", role: "primary" },
      { name: "苏楠", title: "产品总监", role: "primary" },
    ],
  }),

  /** generateSectionContent: 章节内容生成 */
  sectionContent(sectionIndex: number): string {
    const contents = [
      // s1: 概述与目标
      `<h2>概述与目标</h2>
<p>Q3 季度，Nexora Tech 技术团队聚焦于三大核心目标<sup>1</sup>：完成微服务架构迁移的关键里程碑、推进 AI 辅助编码平台的上线、以及建立统一的技术债务治理体系<sup>2</sup>。本报告汇总了 Q3 期间做出的 11 项关键技术决策，涵盖架构选型、工具链升级、性能优化和安全加固四个维度<sup>3</sup>。</p>
<p>在整体技术战略层面，团队坚持"渐进演进、风险可控"的原则，所有决策均经过技术评审委员会（TRB）的集体评估和投票<sup>4</sup>。Q3 技术决策的总体成功率为 91%，其中有 9 项决策取得了预期成果，2 项正在进行中期调整<sup>5</sup>。</p>`,
      // s2: 关键技术决策
      `<h2>关键技术决策</h2>
<p>Q3 最具影响力的技术决策是<strong>将核心业务模块从单体架构迁移至微服务架构</strong><sup>6</sup>。经过对 Spring Cloud、Kubernetes Native 和 Service Mesh 三种方案的深入评估，团队最终选择了 Kubernetes Native + Istio 的组合方案<sup>7</sup>。该决策的主要依据包括：与现有基础设施的兼容性（评分 9.2/10）、社区成熟度（CNCF 毕业项目）、以及团队现有技能栈的匹配度<sup>8</sup>。</p>
<p>第二项关键决策是<strong>引入 AI 辅助编码平台（基于 i-Write 技术栈）</strong>，以提升团队开发效率<sup>9</sup>。经过对 GitHub Copilot、Cursor 和自建方案的综合评测，团队选择了基于开源模型微调 + 内部知识库增强的方案<sup>10</sup>。初期数据显示，该平台使代码审查效率提升了 34%，文档生成时间减少了 67%<sup>11</sup>。</p>
<p>第三项重大决策涉及<strong>数据库技术栈的升级</strong><sup>12</sup>。团队决定将部分读密集型业务从 MySQL 迁移至 TiDB，以解决水平扩展瓶颈<sup>13</sup>。此项决策经过了一个月的性能基准测试（Benchmark）验证，确认在 10x 数据量增长场景下，查询延迟降低 42%<sup>14</sup>。</p>`,
      // s3: 决策评估与分析
      `<h2>决策评估与分析</h2>
<p>我们对 Q3 的 11 项技术决策进行了定量和定性评估<sup>15</sup>。评估维度包括：技术可行性、业务价值、实施成本、风险评估和长期可维护性<sup>16</sup>。其中，微服务迁移决策的综合评分为 8.7/10，AI 编码平台决策为 8.4/10，数据库升级决策为 8.1/10<sup>17</sup>。</p>
<p>从风险角度分析，微服务迁移的初期风险为"高"（涉及核心业务模块），但在分阶段灰度发布策略下，实际风险控制在了"中等"水平<sup>18</sup>。AI 编码平台的采用风险为"中等"，主要关注点在于代码安全性和模型幻觉问题，目前已通过严格的 Code Review 流程和 Groundedness 验证机制进行控制<sup>19</sup>。</p>`,
      // s4: 实施进展与成果
      `<h2>实施进展与成果</h2>
<p>截至目前，微服务迁移已完成用户服务、订单服务和支付网关三个核心模块的拆分和上线<sup>20</sup>。系统整体可用性从 99.5% 提升至 99.92%，单服务部署时间从 45 分钟降至 8 分钟<sup>21</sup>。AI 编码平台已完成内部 Beta 测试，覆盖 28 名工程师，累计生成代码审查报告 1,200+ 份<sup>22</sup>。</p>
<p>数据库迁移方面，已完成读库的 TiDB 部署和全量数据同步，当前正在执行双写验证阶段<sup>23</sup>。初步数据显示，复杂查询的响应时间从 3.2 秒降至 0.8 秒，95 分位延迟从 5.1 秒降至 1.4 秒<sup>24</sup>。</p>`,
      // s5: 经验教训与建议
      `<h2>经验教训与建议</h2>
<p>回顾 Q3 的技术决策过程，团队总结出三条核心经验<sup>25</sup>：第一，<strong>数据驱动的决策优于直觉判断</strong>——所有关键决策都基于 Benchmark 数据和 PoC 验证结果，这是成功率高的关键因素<sup>26</sup>；第二，<strong>渐进式迁移策略有效控制了风险</strong>——灰度发布 + 流量分阶段切换的方案，使我们在遇到问题时能够快速回滚<sup>27</sup>；第三，<strong>技术评审委员会（TRB）机制确保了决策质量</strong>——集体评审避免了个人偏见导致的错误决策<sup>28</sup>。</p>
<p>展望 Q4，团队建议将 AI 编码平台推广至全公司，并启动前端微前端架构的技术评估<sup>29</sup>。同时建议建立技术决策知识库，将 Q3 的决策经验系统化沉淀，为后续决策提供参考<sup>30</sup>。</p>`,
    ];
    return contents[sectionIndex] || contents[0];
  },

  /** groundednessCheck: Groundedness 验证 */
  groundedness: JSON.stringify({
    verdict: "pass" as const,
    groundedRatio: 0.89,
    sentenceResults: [
      { sentence: "Q3 季度，Nexora Tech 技术团队聚焦于三大核心目标。", grounded: true, confidence: 0.92 },
      { sentence: "完成微服务架构迁移的关键里程碑。", grounded: true, confidence: 0.95 },
      { sentence: "推进 AI 辅助编码平台的上线。", grounded: true, confidence: 0.88 },
    ],
  }),

  /** fidelityCheck: 引用准确性 */
  fidelity: JSON.stringify({
    pass: true,
    score: 0.91,
    issues: [],
  }),

  /** reranker: 重排序 — 返回固定 scores */
  rerankerScores: [0.95, 0.92, 0.88, 0.85, 0.82],

  /** conflictDetection: 冲突检测 */
  conflictDetection: JSON.stringify({
    hasConflicts: false,
    conflictRate: 0,
    conflicts: [],
  }),

  /** trustReport: 信任度报告 */
  trustReport: JSON.stringify({
    groundedness: { score: 0.89, label: "有据可查度", description: "内容有据可查，来源可追溯" },
    relevance: { score: 0.92, label: "内容相关度", description: "内容与需求高度相关" },
    completeness: { score: 0.87, label: "内容完整度", description: "大纲要点覆盖完整" },
    conflicts: { hasConflicts: false, conflictRate: 0, items: [], label: "内容冲突", description: "未检测到内容冲突" },
  }),

  /** documentStyle: 文档风格 */
  documentStyle: "technical_report",

  /** peopleContext: 人物上下文 */
  peopleContext: "陈强（技术负责人，技术部）\n苏楠（产品总监，产品部）",

  /** webSearchCitations: Web 搜索结果 */
  webSearchCitations: [] as string[],
};
