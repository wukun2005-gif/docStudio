/**
 * case-1782966166476.ts — 从 DB + MHTML 提取的真实 case 数据
 * 包含 3 个 sheet、5 个表格、6 个图表
 * 不调用任何外部 API
 */

export interface CaseSection {
  title: string;
  content: string; // HTML content（含 <table> 和 <script class="chart-spec">）
  groundingScore: number;
  sources: Array<{ chunkId: string; score: number; sourceName?: string }>;
}

export const CASE_1782966166476 = {
  caseId: "1782966166476",
  runId: "d8f4ea0d-60cd-4deb-ad47-77cc00dded5d",
  title: "Nexora Tech项目综合汇报",

  outline: [
    {
      id: "s1",
      title: "Sheet 1 - 本周项目进度看板",
      level: 1,
      children: [],
      description: "顶部有 2-3 行说明文字，概述本周整体交付情况；下方是一个项目进度表，列出本周所有项目/任务的完成状态、完成度百分比、负责人、周期、备注；在表格下方，嵌入一个按部门统计的任务完成率柱状图（技术部、产品部、设计部、QA），以及一个按负责人统计的工时分布饼图；底部附一个风险项一览表，列出延期风险任务及其影响评估",
    },
    {
      id: "s2",
      title: "Sheet 2 - Bug 质量分析",
      level: 1,
      children: [],
      description: "顶部说明文字，总结本周 Bug 的发现/修复趋势；一个 Bug 明细表（ID、标题、优先级、状态、负责人、创建/修复日期、所属模块）；下方嵌入 Bug 优先级分布饼图（高/中/低）和各模块 Bug 数量柱状图（前端/后端）；底部附一个 Bug 修复周期分析表，统计每种优先级的平均修复天数",
    },
    {
      id: "s3",
      title: "Sheet 3 - 团队协作与沟通分析",
      level: 1,
      children: [],
      description: "顶部说明文字，概述本周团队沟通密度和协作亮点；一个跨部门协作矩阵表，行=部门，列=协作类型（reporting/collaboration），单元格=协作次数；下方嵌入部门人员分布柱状图和沟通风格分布饼图；底部附一个关键邮件/会议决策摘要表",
    },
  ],

  sections: [
    {
      title: "Sheet 1 - 本周项目进度看板",
      content: `<section>
<h2>Sheet 1 - 本周项目进度看板</h2>
<p>收件人：陈宇、王琳、赵军</p>
<p>主题：Sheet 1 - 本周项目进度看板</p>
<p>陈宇、王琳和赵军，你们好：</p>
<p>本周整体交付情况良好，用户认证模块开发按计划推进，技术方案已确定采用 Authorization Code Flow + PKCE 方案以提升安全性。支付系统技术方案设计已初步完成，确定优先集成 Stripe 国际支付服务。</p>
<p>项目进度表如下：</p>
<table>
<thead><tr><th>项目/任务</th><th>完成状态</th><th>完成度百分比</th><th>负责人</th><th>周期</th><th>备注</th></tr></thead>
<tbody>
<tr><td>用户认证模块开发</td><td>进行中</td><td>75%</td><td>陈强</td><td>6/16-6/25</td><td>OAuth2 + JWT 实现，采用 PKCE 方案</td></tr>
<tr><td>Microsoft OAuth2 实现</td><td>进行中</td><td>60%</td><td>王超</td><td>6/16-6/22</td><td>遇到 redirect_uri 配置问题需文档记录</td></tr>
<tr><td>GitHub OAuth2 实现</td><td>进行中</td><td>65%</td><td>刘伟</td><td>6/16-6/22</td><td>passport.js 库集成</td></tr>
<tr><td>认证模块 E2E 测试框架</td><td>进行中</td><td>40%</td><td>杨飞</td><td>6/16-6/20</td><td>Playwright 框架搭建</td></tr>
<tr><td>支付系统技术方案设计</td><td>已完成</td><td>100%</td><td>陈强、刘伟</td><td>6/16-6/20</td><td>确定 Stripe 优先集成策略</td></tr>
<tr><td>BUG-201 登录页面Safari样式错乱</td><td>进行中</td><td>85%</td><td>赵丽</td><td>6/16-6/18</td><td>预计周二完成修复</td></tr>
<tr><td>BUG-205 Token刷新失败</td><td>进行中</td><td>70%</td><td>刘伟</td><td>6/16-6/19</td><td>预计周三完成修复</td></tr>
<tr><td>BUG-210 密码重置邮件延迟</td><td>进行中</td><td>50%</td><td>刘伟</td><td>6/16-6/20</td><td>预计周四完成修复</td></tr>
</tbody>
</table>
<h3>风险项一览表</h3>
<table>
<thead><tr><th>延期风险任务</th><th>影响评估</th><th>风险等级</th></tr></thead>
<tbody>
<tr><td>Azure AD redirect_uri 配置问题</td><td>可能影响 Microsoft OAuth2 集成进度，需额外 1-2 天解决</td><td>中等</td></tr>
<tr><td>Gemini API systemPromptMode 特殊处理</td><td>可能影响 Sprint 4 整体进度，已排入计划</td><td>较低</td></tr>
<tr><td>Token 刷新机制复杂度</td><td>用户体验受影响，可能导致登录会话不稳定</td><td>高等</td></tr>
</tbody>
</table>
<script class="chart-spec" type="application/json">
{"type":"bar","title":"各部门任务完成率","categories":["技术部","产品部","设计部","QA"],"series":[{"name":"完成率","values":[75,80,100,60]}]}
</script>
<script class="chart-spec" type="application/json">
{"type":"pie","title":"按负责人工时分布","categories":["张伟","李娜","王小美","赵强","孙丽","陈明"],"series":[{"name":"工时","values":[20,25,15,18,8,14]}]}
</script>
</section>`,
      groundingScore: 0.84,
      sources: [
        { chunkId: "b0292ea7-c54", score: 1.0, sourceName: "项目周报-2026-06-20.pptx" },
        { chunkId: "b0292ea7-c72", score: 0.0, sourceName: "项目周报-2026-06-20.pptx" },
      ],
    },
    {
      title: "Sheet 2 - Bug 质量分析",
      content: `<section>
<h2>Sheet 2 - Bug 质量分析</h2>
<p>本周 Bug 质量分析显示，团队在认证模块方面的修复工作取得了显著进展。截至 6 月 20 日，本周新增 3 个 Bug，修复 4 个 Bug，累计新增 15 个，修复 12 个，待修复 3 个。所有高优先级 Bug 均已完成修复，系统稳定性得到保障。</p>
<p>本周重点关注了认证模块的稳定性问题，特别是 Token 刷新机制的竞态条件得到了有效解决。通过实施 Promise 队列机制，系统登录成功率达到了 99.8%，Token 刷新成功率达到了 99.95%。目前仍有 3 个 Bug 待修复，主要集中在中低优先级问题，预计将在下周完成处理。</p>
<h3>Bug 详情列表</h3>
<table>
<thead><tr><th>Bug ID</th><th>标题</th><th>优先级</th><th>状态</th><th>负责人</th><th>创建日期</th><th>修复日期</th><th>模块</th></tr></thead>
<tbody>
<tr><td>BUG-201</td><td>Safari 登录页面样式错乱</td><td>高</td><td>已修复</td><td>赵丽</td><td>2026-06-10</td><td>2026-06-17</td><td>前端</td></tr>
<tr><td>BUG-205</td><td>Token 刷新失败导致用户被踢出</td><td>高</td><td>已修复</td><td>刘伟</td><td>2026-06-11</td><td>2026-06-17</td><td>后端</td></tr>
<tr><td>BUG-210</td><td>密码重置邮件发送延迟</td><td>高</td><td>已修复</td><td>刘伟</td><td>2026-06-12</td><td>2026-06-18</td><td>后端</td></tr>
<tr><td>BUG-215</td><td>Token 刷新竞态导致 401</td><td>高</td><td>已修复</td><td>刘伟</td><td>2026-06-18</td><td>2026-06-19</td><td>前端</td></tr>
<tr><td>BUG-216</td><td>GitHub OAuth 回调超时</td><td>中</td><td>修复中</td><td>刘伟</td><td>2026-06-19</td><td>-</td><td>后端</td></tr>
<tr><td>BUG-217</td><td>知识源状态更新延迟</td><td>低</td><td>待修复</td><td>赵丽</td><td>2026-06-19</td><td>-</td><td>前端</td></tr>
<tr><td>BUG-218</td><td>大文档生成超时</td><td>中</td><td>待修复</td><td>陈强</td><td>2026-06-20</td><td>-</td><td>后端</td></tr>
<tr><td>BUG-219</td><td>评估报告图表显示异常</td><td>低</td><td>待修复</td><td>赵丽</td><td>2026-06-20</td><td>-</td><td>前端</td></tr>
</tbody>
</table>
<h3>按优先级汇总的修复统计</h3>
<table>
<thead><tr><th>优先级</th><th>平均修复天数</th><th>修复数量</th><th>最短修复时间</th><th>最长修复时间</th></tr></thead>
<tbody>
<tr><td>高</td><td>1.5 天</td><td>4</td><td>1 天</td><td>2 天</td></tr>
<tr><td>中</td><td>-</td><td>0</td><td>-</td><td>-</td></tr>
<tr><td>低</td><td>-</td><td>0</td><td>-</td><td>-</td></tr>
</tbody>
</table>
<script class="chart-spec" type="application/json">
{"type":"pie","title":"Bug 优先级分布","categories":["高","中","低"],"series":[{"name":"数量","values":[4,2,2]}]}
</script>
<script class="chart-spec" type="application/json">
{"type":"bar","title":"各模块 Bug 数量","categories":["前端","后端"],"series":[{"name":"Bug 数","values":[4,4]}]}
</script>
</section>`,
      groundingScore: 0.5,
      sources: [
        { chunkId: "af2d7a12-c25", score: 1.0, sourceName: "Bug统计表.xlsx" },
      ],
    },
    {
      title: "Sheet 3 - 团队协作与沟通分析",
      content: `<section>
<h2>Sheet 3 - 团队协作与沟通分析</h2>
<p>本周团队沟通密度保持高位运行，日均 Teams 消息量达到 420 条，较上周增长 15%。协作亮点体现在每日 Standup 15 分钟内问题及时暴露，以及每个 PR 至少 2 人评审机制下发现 12 个潜在问题，有效保障了代码质量。</p>
<h3>跨部门协作矩阵</h3>
<table>
<thead><tr><th>部门</th><th>Reporting</th><th>Collaboration</th><th>总计</th></tr></thead>
<tbody>
<tr><td>技术部</td><td>28</td><td>45</td><td>73</td></tr>
<tr><td>产品部</td><td>15</td><td>32</td><td>47</td></tr>
<tr><td>设计部</td><td>8</td><td>18</td><td>26</td></tr>
<tr><td>QA 部</td><td>12</td><td>25</td><td>37</td></tr>
<tr><td>市场部</td><td>6</td><td>14</td><td>20</td></tr>
<tr><td>销售部</td><td>4</td><td>9</td><td>13</td></tr>
<tr><td>运营部</td><td>7</td><td>16</td><td>23</td></tr>
</tbody>
</table>
<h3>关键邮件/会议决策摘要</h3>
<table>
<thead><tr><th>邮件主题</th><th>发件人</th><th>决策要点</th><th>影响范围</th></tr></thead>
<tbody>
<tr><td>Sprint 4 任务调整通知</td><td>赵强</td><td>将 GitHub OAuth 回调超时等 5 项任务移入 Sprint 4</td><td>技术部、产品部</td></tr>
<tr><td>认证模块质量标准确认</td><td>孙娜</td><td>E2E 测试用例需达到 85% 覆盖率</td><td>QA 部、技术部</td></tr>
<tr><td>RAG 引擎性能指标设定</td><td>陈明</td><td>端到端延迟控制在 3s P95 以内</td><td>技术部、产品部</td></tr>
<tr><td>代码评审流程优化</td><td>杨飞</td><td>每个 PR 至少 2 人评审机制</td><td>全技术团队</td></tr>
<tr><td>Azure AD 配置文档完善</td><td>王超</td><td>补充 redirect_uri 配置说明</td><td>技术部、运维</td></tr>
</tbody>
</table>
<script class="chart-spec" type="application/json">
{"type":"bar","title":"部门人员分布","categories":["技术部","产品部","设计部","QA部","市场部","销售部","运营部"],"series":[{"name":"人数","values":[24,12,8,10,6,5,7]}]}
</script>
<script class="chart-spec" type="application/json">
{"type":"pie","title":"沟通风格分布","categories":["正式风格","轻松风格","技术风格"],"series":[{"name":"人数","values":[35,28,37]}]}
</script>
</section>`,
      groundingScore: 0.38,
      sources: [
        { chunkId: "b0292ea7-c73", score: 1.0, sourceName: "项目周报-2026-06-20.pptx" },
        { chunkId: "af2d7a12-c28", score: 0.49, sourceName: "Bug统计表.xlsx" },
        { chunkId: "cee3e99d-c12", score: 0.0, sourceName: "05-周五-Retro会议.docx" },
      ],
    },
  ] as CaseSection[],

  htmlContent: "",
  trustScore: 0.5733,
  documentStyle: "email" as const,
  conflictResolution: {
    resolved: [
      {
        topic: "BUG-215 状态",
        conflictType: "data",
        severity: "high",
        resolution: "llm_verdict",
        winningSource: "项目周报-2026-06-20.pptx",
        losingSources: ["Bug统计表.xlsx", "项目周报-2026-06-20.pptx", "04-周四-认证模块联调会议.docx"],
        reason: "项目周报显示该问题已修复完成，且时间戳与Bug统计表相同但权威度更高",
      },
      {
        topic: "GitHub OAuth回调超时问题状态",
        conflictType: "data",
        severity: "medium",
        resolution: "llm_verdict",
        winningSource: "项目周报-2026-06-20.pptx",
        losingSources: ["Bug统计表.xlsx"],
        reason: "项目周报显示问题已通过增加超时时间和重试机制解决，权威度更高",
      },
    ],
    unresolved: [],
  },
};
