/**
 * Excel stub fixture — 3 个 sheet，含表格和图表
 * 基于真实 case 数据，不调用任何外部 API
 */

export interface StubSection {
  title: string;
  content: string; // HTML content，含 <table>, <h2>, <p> 等
  groundingScore: number;
  sources: Array<{ chunkId: string; score: number; sourceName?: string }>;
}

export const EXCEL_STUB = {
  caseId: "1782966166476",
  title: "Nexora Tech 项目周报",

  sections: [
    {
      title: "Sheet 1 - 本周项目进度看板",
      content: `<section>
<h2>本周项目进度看板</h2>
<p>陈宇、王琳和赵军，你们好：</p>
<p>本周项目整体进展顺利，核心目标基本达成。重点完成了用户认证模块的开发及测试工作，并同步推进了支付系统的前期技术方案设计。部分任务仍在进行中，主要集中在 E2E 测试环节和部分 Bug 修复方面。</p>
<h3>项目进度汇总</h3>
<table>
<thead><tr><th>任务名称</th><th>状态</th><th>完成度</th><th>负责人</th><th>周期</th><th>备注</th></tr></thead>
<tbody>
<tr><td>用户认证模块</td><td>已完成</td><td>100%</td><td>陈宇</td><td>6/16-6/18</td><td>通过全部单元测试</td></tr>
<tr><td>支付系统方案设计</td><td>进行中</td><td>80%</td><td>王琳</td><td>6/16-6/20</td><td>技术选型已确定</td></tr>
<tr><td>E2E 测试用例编写</td><td>进行中</td><td>60%</td><td>赵军</td><td>6/17-6/20</td><td>覆盖核心流程</td></tr>
<tr><td>API 文档更新</td><td>已完成</td><td>100%</td><td>陈宇</td><td>6/16</td><td>Swagger 已同步</td></tr>
<tr><td>性能优化调研</td><td>待开始</td><td>0%</td><td>王琳</td><td>6/19-6/20</td><td>等支付方案确认后启动</td></tr>
</tbody>
</table>
<h3>风险项一览</h3>
<table>
<thead><tr><th>风险项</th><th>影响范围</th><th>概率</th><th>影响</th><th>应对措施</th></tr></thead>
<tbody>
<tr><td>E2E 测试延期</td><td>发布计划</td><td>中</td><td>高</td><td>增加测试人员投入</td></tr>
<tr><td>支付接口变更</td><td>支付系统</td><td>低</td><td>高</td><td>提前与支付方对接</td></tr>
</tbody>
</table>
</section>`,
      groundingScore: 0.95,
      sources: [
        { chunkId: "src1", score: 0.92, sourceName: "项目管理系统" },
        { chunkId: "src2", score: 0.88, sourceName: "周会纪要" },
      ],
    },
    {
      title: "Sheet 2 - Bug 质量分析",
      content: `<section>
<h2>Bug 质量分析</h2>
<p>本周共发现 Bug 23 个，已修复 18 个，修复率 78%。高优先级 Bug 已全部修复，中优先级 Bug 修复率 75%，低优先级 Bug 修复率 70%。Bug 主要集中在前端模块，占比 52%。</p>
<h3>Bug 明细</h3>
<table>
<thead><tr><th>Bug ID</th><th>标题</th><th>优先级</th><th>状态</th><th>负责人</th><th>所属模块</th></tr></thead>
<tbody>
<tr><td>BUG-001</td><td>登录页面偶现白屏</td><td>高</td><td>已修复</td><td>陈宇</td><td>前端</td></tr>
<tr><td>BUG-002</td><td>支付金额计算精度丢失</td><td>高</td><td>已修复</td><td>王琳</td><td>后端</td></tr>
<tr><td>BUG-003</td><td>表格排序不正确</td><td>中</td><td>已修复</td><td>赵军</td><td>前端</td></tr>
<tr><td>BUG-004</td><td>API 超时无重试</td><td>中</td><td>进行中</td><td>陈宇</td><td>后端</td></tr>
<tr><td>BUG-005</td><td>导出 Excel 格式错乱</td><td>低</td><td>待处理</td><td>赵军</td><td>前端</td></tr>
</tbody>
</table>
<h3>Bug 修复周期分析</h3>
<table>
<thead><tr><th>优先级</th><th>总数</th><th>已修复</th><th>平均修复天数</th></tr></thead>
<tbody>
<tr><td>高</td><td>5</td><td>5</td><td>0.5</td></tr>
<tr><td>中</td><td>12</td><td>9</td><td>1.8</td></tr>
<tr><td>低</td><td>6</td><td>4</td><td>3.2</td></tr>
</tbody>
</table>
</section>`,
      groundingScore: 0.93,
      sources: [
        { chunkId: "src3", score: 0.90, sourceName: "Jira Bug 跟踪系统" },
      ],
    },
    {
      title: "Sheet 3 - 团队协作与沟通分析",
      content: `<section>
<h2>团队协作与沟通分析</h2>
<p>本周团队沟通密度保持高位，跨部门协作消息总数达 1,560 条，会议 12 场。技术与产品部门沟通最为频繁，协作满意度 4.2 分（满分 5 分）。</p>
<h3>跨部门协作矩阵</h3>
<table>
<thead><tr><th>部门</th><th>协作类型</th><th>协作次数</th><th>主要沟通渠道</th></tr></thead>
<tbody>
<tr><td>技术部</td><td>reporting</td><td>8</td><td>Teams / 邮件</td></tr>
<tr><td>技术部</td><td>collaboration</td><td>15</td><td>Teams / 会议</td></tr>
<tr><td>产品部</td><td>reporting</td><td>5</td><td>邮件 / 会议</td></tr>
<tr><td>产品部</td><td>collaboration</td><td>10</td><td>Teams</td></tr>
<tr><td>QA 部</td><td>reporting</td><td>3</td><td>邮件</td></tr>
<tr><td>QA 部</td><td>collaboration</td><td>7</td><td>Teams / 会议</td></tr>
</tbody>
</table>
<h3>关键决策摘要</h3>
<table>
<thead><tr><th>邮件主题</th><th>发件人</th><th>决策要点</th><th>影响范围</th></tr></thead>
<tbody>
<tr><td>支付系统技术选型确认</td><td>王琳</td><td>采用 Stripe SDK 方案</td><td>支付模块</td></tr>
<tr><td>E2E 测试排期调整</td><td>赵军</td><td>增加 2 人天投入</td><td>测试计划</td></tr>
<tr><td>用户认证模块上线</td><td>陈宇</td><td>6/18 正式上线</td><td>全平台</td></tr>
</tbody>
</table>
</section>`,
      groundingScore: 0.91,
      sources: [
        { chunkId: "src4", score: 0.89, sourceName: "Outlook 邮件" },
        { chunkId: "src5", score: 0.85, sourceName: "Teams 协作数据" },
      ],
    },
  ] as StubSection[],

  htmlContent: "",
  trustScore: 0.94,
  documentStyle: "professional" as const,
};
