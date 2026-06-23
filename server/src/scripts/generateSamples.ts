/**
 * 生成 Sample Data — 按 PRD 第 7 节场景（张三的一周工作）
 *
 * 生成内容：
 * - 5 篇会议纪要 (Word .docx)
 * - 10 封邮件往来 (Outlook .eml)
 * - 1 篇 Teams 聊天记录 (Teams Message JSON)
 * - 6 篇技术文档 (Word .docx)
 * - 2 份 Excel 数据
 * - 1 份 PPT
 */

import fs from "fs";
import path from "path";

const SAMPLES_DIR = path.resolve(process.cwd(), "samples");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 会议纪要 (5 篇, Word .docx) ──────────────────────────────────────

const meetings = [
  {
    file: "documents/01-周一-standup-会议纪要.docx",
    title: "周一 Standup 会议纪要",
    date: "2026-06-16（周一）09:30-09:50",
    attendees: "张三（Tech Lead）、李四（后端）、王五（前端）、赵六（QA）、孙七（PM）",
    recorder: "张三",
    sections: [
      {
        heading: "本周目标",
        content: [
          "1. 完成用户认证模块开发（OAuth2 + JWT）— 张三负责",
          "2. 修复 3 个高优 Bug — 李四、王五负责",
          "   - BUG-201: 登录页面在 Safari 下样式错乱",
          "   - BUG-205: Token 刷新失败导致用户被踢出",
          "   - BUG-210: 密码重置邮件发送延迟",
          "3. 完成支付系统技术方案设计 — 张三、李四负责",
        ],
      },
      {
        heading: "讨论要点",
        content: [
          "- 认证模块需要支持 Microsoft OAuth2 和 GitHub OAuth2 两种方式",
          "- 支付系统需要先完成认证模块，因为涉及用户身份验证",
          "- 王五提出前端需要一个新的 Token 管理组件",
          "- 赵六建议增加 E2E 测试覆盖认证流程",
        ],
      },
      {
        heading: "Action Items",
        content: [
          "任务 | 负责人 | 截止日期",
          "完成 OAuth2 基础框架 | 张三 | 周三",
          "修复 BUG-201 | 王五 | 周二",
          "修复 BUG-205 | 李四 | 周三",
          "修复 BUG-210 | 李四 | 周四",
          "编写认证模块 E2E 测试 | 赵六 | 周五",
          "支付系统技术方案初稿 | 张三、李四 | 周五",
        ],
      },
    ],
  },
  {
    file: "documents/02-周一-认证模块需求评审.docx",
    title: "认证模块需求评审会议",
    date: "2026-06-16（周一）14:00-15:30",
    attendees: "张三、李四、王五、赵六、孙七、周八（设计师）",
    recorder: "孙七",
    sections: [
      {
        heading: "需求概述",
        content: [
          "用户认证模块是 i-Write 平台的核心基础组件，需要支持：",
          "",
          "1. Microsoft OAuth2 登录 — 使用 MSAL.js 库",
          "2. GitHub OAuth 登录 — 用于连接 GitHub 知识源",
          "3. JWT Token 管理 — 自动刷新、安全存储",
          "4. 多 Provider 支持 — 用户可绑定多个身份",
        ],
      },
      {
        heading: "技术方案讨论",
        content: [
          "OAuth2 流程：",
          "- 采用 Authorization Code Flow + PKCE",
          "- Token 存储：HttpOnly Cookie（Access Token）+ 加密 localStorage（Refresh Token）",
          "- Token 刷新：Access Token 有效期 1 小时，Refresh Token 7 天",
          "",
          "安全要求：",
          "- 所有 Token 传输必须 HTTPS",
          "- CSRF 防护：State 参数验证",
          "- XSS 防护：HttpOnly Cookie + CSP 策略",
          "",
          "UI 设计：",
          "- 周八展示了登录页面设计稿",
          "- 支持「使用 Microsoft 账号登录」和「使用 GitHub 登录」两个按钮",
          "- 登录后显示用户头像和连接的知识源状态",
        ],
      },
      {
        heading: "决策",
        content: [
          "1. 优先实现 Microsoft OAuth2（P0），GitHub OAuth 次之（P1）",
          "2. Token 刷新采用静默方式，用户无感知",
          "3. 登录页面使用周八的设计方案",
        ],
      },
    ],
  },
  {
    file: "documents/03-周三-设计评审会议.docx",
    title: "认证模块设计评审会议",
    date: "2026-06-18（周三）10:00-11:30",
    attendees: "张三、李四、王五、赵六、周八",
    recorder: "李四",
    sections: [
      {
        heading: "后端实现（李四汇报）",
        content: [
          "已完成：",
          "- OAuth2 Authorization Code Flow 基础框架",
          "- Microsoft Graph API Token 交换",
          "- JWT Token 生成和验证",
          "",
          "技术难点：",
          "- redirect_uri 配置问题：Azure AD 要求 redirect_uri 完全匹配",
          "- Token 刷新竞态条件：多个并发请求同时刷新 Token 可能导致冲突",
          "",
          "解决方案：",
          "- 使用环境变量管理不同环境的 redirect_uri",
          "- Token 刷新使用分布式锁（Redis SETNX）",
        ],
      },
      {
        heading: "前端实现（王五汇报）",
        content: [
          "已完成：",
          "- 登录页面 UI",
          "- Token 存储和自动刷新逻辑",
          "",
          "待完成：",
          "- 知识源连接状态组件",
          "- 多账号切换 UI",
        ],
      },
      {
        heading: "测试计划（赵六汇报）",
        content: [
          "- E2E 测试覆盖：登录 → Token 刷新 → 知识源连接 → 登出",
          "- 边界测试：Token 过期、网络中断、并发刷新",
        ],
      },
      {
        heading: "评审结论",
        content: [
          "✅ 设计方案通过，继续开发",
          "⚠️ 需要补充：错误处理和降级策略",
        ],
      },
    ],
  },
  {
    file: "documents/04-周四-认证模块联调会议.docx",
    title: "认证模块联调会议",
    date: "2026-06-19（周四）14:00-16:00",
    attendees: "张三、李四、王五、赵六",
    recorder: "张三",
    sections: [
      {
        heading: "成功项 ✅",
        content: [
          "1. Microsoft OAuth2 登录流程 — 联调通过",
          "   - 用户点击「使用 Microsoft 登录」 → 跳转 Microsoft 授权页 → 回调获取 Token → 登录成功",
          "   - Token 自动刷新正常工作",
          "",
          "2. JWT Token 管理 — 联调通过",
          "   - Access Token 1 小时过期后自动刷新",
          "   - Refresh Token 过期后引导用户重新登录",
          "",
          "3. 知识源连接 — 联调通过",
          "   - 登录后自动连接 OneDrive",
          "   - 可手动连接 GitHub",
        ],
      },
      {
        heading: "发现的问题 ⚠️",
        content: [
          "1. BUG-215: Token 刷新时偶尔出现 401 错误",
          "   - 原因：Token 刷新请求和 API 请求同时发出，旧 Token 已失效但新 Token 还没返回",
          "   - 解决方案：在 Token 刷新期间，将后续请求加入队列，等待新 Token",
          "",
          "2. BUG-216: GitHub OAuth 回调偶尔超时",
          "   - 原因：GitHub API 响应慢（>5s）",
          "   - 解决方案：增加超时时间到 10s，添加重试机制",
        ],
      },
      {
        heading: "下一步",
        content: [
          "- 张三：修复 BUG-215（Token 刷新竞态）",
          "- 李四：修复 BUG-216（GitHub OAuth 超时）",
          "- 赵六：完成 E2E 测试",
        ],
      },
    ],
  },
  {
    file: "documents/05-周五-Retro会议.docx",
    title: "周五 Sprint Retrospective",
    date: "2026-06-20（周五）16:00-17:00",
    attendees: "张三、李四、王五、赵六、孙七",
    recorder: "孙七",
    sections: [
      {
        heading: "完成情况",
        content: [
          "任务 | 状态 | 负责人",
          "认证模块 OAuth2 基础框架 | ✅ 完成 | 张三",
          "Microsoft OAuth2 登录 | ✅ 完成 | 张三、李四",
          "GitHub OAuth 登录 | ✅ 完成 | 李四",
          "JWT Token 管理 | ✅ 完成 | 张三",
          "登录页面 UI | ✅ 完成 | 王五",
          "BUG-201 修复 | ✅ 完成 | 王五",
          "BUG-205 修复 | ✅ 完成 | 李四",
          "BUG-210 修复 | ✅ 完成 | 李四",
          "E2E 测试 | 🔄 进行中 (80%) | 赵六",
          "支付系统技术方案 | ✅ 完成 | 张三、李四",
        ],
      },
      {
        heading: "亮点 🌟",
        content: [
          "- 认证模块提前一天完成联调",
          "- Token 刷新竞态问题快速定位并修复",
          "- 团队协作顺畅，沟通高效",
        ],
      },
      {
        heading: "待改进 ⚠️",
        content: [
          "- E2E 测试未完成，需要下周继续",
          "- 支付系统技术方案需要设计评审",
          "- 文档更新不及时，需要养成写文档的习惯",
        ],
      },
      {
        heading: "下周计划",
        content: [
          "1. 完成 E2E 测试并修复发现的问题",
          "2. 支付系统设计评审",
          "3. 开始支付模块开发",
          "4. 更新技术文档",
        ],
      },
    ],
  },
];

// ── 邮件往来 (10 封, Outlook .eml) ──────────────────────────────────────

const emails = [
  {
    file: "emails/01-孙七-张三-认证模块需求确认.eml",
    from: "孙七 (PM) <sunqi@company.com>",
    to: "张三 (Tech Lead) <zhangsan@company.com>",
    date: "2026-06-15（周日）20:30",
    subject: "认证模块需求确认 - 请周一评审前看一下",
    body: `张三你好，

明天下午的认证模块需求评审，我把需求文档整理好了，主要变化：

1. 新增 Microsoft OAuth2 支持 — 之前只计划了 GitHub OAuth，但考虑到我们的目标用户很多用 Microsoft 365，需要加上
2. Token 刷新策略调整 — 从 2 小时改为 1 小时，安全性更高
3. 多账号绑定 — 用户可以同时绑定 Microsoft 和 GitHub 账号

另外，设计团队（周八）已经出了登录页面的初稿，评审时一起看。

需求文档链接：[OneDrive: 认证模块 PRD v2.pdf]

Best,
孙七`,
  },
  {
    file: "emails/02-张三-团队-本周目标.eml",
    from: "张三 (Tech Lead) <zhangsan@company.com>",
    to: "团队全体 <team@company.com>",
    date: "2026-06-16（周一）08:00",
    subject: "本周目标 - 认证模块 + Bug 修复",
    body: `大家好，

本周目标：

1. 认证模块开发（优先级 P0）
   - OAuth2 基础框架 — 张三
   - Microsoft OAuth2 — 张三、李四
   - GitHub OAuth — 李四
   - 登录页面 UI — 王五
   - E2E 测试 — 赵六

2. Bug 修复（优先级 P0）
   - BUG-201: Safari 样式问题 — 王五
   - BUG-205: Token 刷新失败 — 李四
   - BUG-210: 密码重置延迟 — 李四

3. 支付系统技术方案（优先级 P1）
   - 初稿 — 张三、李四

请各位确认任务分配，有问题今天 Standup 讨论。

张三`,
  },
  {
    file: "emails/03-李四-张三-redirect-uri问题.eml",
    from: "李四 (后端) <lisi@company.com>",
    to: "张三 (Tech Lead) <zhangsan@company.com>",
    date: "2026-06-17（周二）11:15",
    subject: "[紧急] Azure AD redirect_uri 配置问题",
    body: `张三，

遇到一个问题：Azure AD 要求 redirect_uri 必须完全匹配，但我们的开发环境（localhost:3000）和生产环境（app.i-write.com）用的是同一个 Azure AD App Registration。

目前的解决方案：
1. 在 Azure AD 中配置多个 redirect_uri（开发 + 生产）
2. 用环境变量区分不同环境的 redirect_uri

你觉得方案 1 可行吗？还是需要创建两个 App Registration？

李四`,
  },
  {
    file: "emails/04-张三-李四-redirect-uri回复.eml",
    from: "张三 (Tech Lead) <zhangsan@company.com>",
    to: "李四 (后端) <lisi@company.com>",
    date: "2026-06-17（周二）11:45",
    subject: "Re: [紧急] Azure AD redirect_uri 配置问题",
    body: `李四，

用方案 1，在一个 App Registration 里配置多个 redirect_uri：
- http://localhost:3000/auth/callback（开发）
- https://app.i-write.com/auth/callback（生产）

环境变量里配置：
MS_REDIRECT_URI=http://localhost:3000/auth/callback  # 开发
MS_REDIRECT_URI=https://app.i-write.com/auth/callback  # 生产

这样最简单，不需要维护两个 App。

张三`,
  },
  {
    file: "emails/05-王五-团队-BUG201已修复.eml",
    from: "王五 (前端) <wangwu@company.com>",
    to: "团队全体 <team@company.com>",
    date: "2026-06-17（周二）16:30",
    subject: "BUG-201 已修复 - Safari 登录页面样式",
    body: `大家好，

BUG-201（Safari 下登录页面样式错乱）已修复。

原因：Safari 对 flexbox gap 属性的支持问题，改用 margin 替代。

PR: #128 — fix: safari login page layout

王五`,
  },
  {
    file: "emails/06-赵六-张三-E2E测试进展.eml",
    from: "赵六 (QA) <zhaoliu@company.com>",
    to: "张三 (Tech Lead) <zhangsan@company.com>",
    date: "2026-06-18（周三）17:00",
    subject: "E2E 测试进展 - 认证模块",
    body: `张三，

E2E 测试进展：

已完成：
- ✅ 登录流程测试（Microsoft + GitHub）
- ✅ Token 刷新测试
- ✅ 登出流程测试

进行中：
- 🔄 并发 Token 刷新测试（发现 BUG-215）
- 🔄 网络中断恢复测试

预计周五完成 80%，剩余 20%（边界测试）下周继续。

赵六`,
  },
  {
    file: "emails/07-孙七-客户-产品演示确认.eml",
    from: "孙七 (PM) <sunqi@company.com>",
    to: "客户 <client@partner.com>",
    date: "2026-06-18（周三）10:00",
    subject: "i-Write 产品演示确认 - 本周五下午",
    body: `您好，

i-Write 产品演示确认：

时间: 本周五（6/20）下午 14:00-15:00
地点: 线上会议（Teams 链接稍后发送）
内容:
1. 产品介绍（10 分钟）
2. 核心功能演示（30 分钟）
   - 知识源连接
   - 文档生成
   - 生成树溯源
3. Q&A（20 分钟）

请确认是否参加。

Best,
孙七`,
  },
  {
    file: "emails/08-张三-李四-支付系统方案讨论.eml",
    from: "张三 (Tech Lead) <zhangsan@company.com>",
    to: "李四 (后端) <lisi@company.com>",
    date: "2026-06-19（周四）09:00",
    subject: "支付系统技术方案 - 初稿讨论",
    body: `李四，

支付系统技术方案初稿写好了，主要设计：

1. 支付 Provider: Stripe（国际）+ 支付宝/微信支付（国内）
2. 订阅模式: 月付 / 年付 / 团队版
3. 账单管理: 自动生成发票、账单历史

技术要点：
- 使用 Stripe Checkout Session 简化集成
- Webhook 验证支付状态
- 订阅状态同步到用户配置

详细文档：[OneDrive: 支付系统技术方案 v1.docx]

你看看有没有遗漏的场景，明天设计评审讨论。

张三`,
  },
  {
    file: "emails/09-李四-张三-Token刷新竞态修复.eml",
    from: "李四 (后端) <lisi@company.com>",
    to: "张三 (Tech Lead) <zhangsan@company.com>",
    date: "2026-06-19（周四）18:00",
    subject: "BUG-215 已修复 - Token 刷新竞态问题",
    body: `张三，

BUG-215（Token 刷新时偶尔 401）已修复。

解决方案：
1. Token 刷新时设置 isRefreshing 标志
2. 后续请求检测到 isRefreshing 时，加入等待队列
3. Token 刷新完成后，用新 Token 重发队列中的请求

PR: #132 — fix: token refresh race condition

测试通过，并发 100 个请求不会出现 401。

李四`,
  },
  {
    file: "emails/10-张三-团队-本周总结.eml",
    from: "张三 (Tech Lead) <zhangsan@company.com>",
    to: "团队全体 <team@company.com>",
    date: "2026-06-20（周五）17:30",
    subject: "本周总结 - 认证模块完成",
    body: `大家好，

本周成果总结：

✅ 已完成
- 用户认证模块（Microsoft + GitHub OAuth2）
- JWT Token 管理（自动刷新、安全存储）
- 登录页面 UI
- 3 个 Bug 修复（BUG-201/205/210）
- 支付系统技术方案初稿

🔄 进行中
- E2E 测试（80% 完成）

📊 数据
- 代码提交：23 个 PR
- Bug 修复：3 个
- 测试覆盖率：72% → 85%

下周重点：
1. 完成 E2E 测试
2. 支付系统设计评审
3. 开始支付模块开发

感谢大家的辛苦付出！🎉

张三`,
  },
];

// ── Teams 聊天记录 (Teams Message JSON) ──────────────────────────────────────

const teamsMessages = {
  channel: "#dev-team",
  team: "i-Write 开发团队",
  dateRange: "2026-06-16 ~ 2026-06-20",
  messages: [
    { date: "2026-06-16", time: "09:52", user: "张三", content: "Standup 结束，本周目标已同步。大家有问题随时在群里讨论。" },
    { date: "2026-06-16", time: "10:15", user: "王五", content: "@张三 Safari 登录页面的问题我看了，是 gap 属性兼容性问题，今天能修完。" },
    { date: "2026-06-16", time: "10:18", user: "张三", content: "@王五 好的，修完提 PR 让李四 review。" },
    { date: "2026-06-16", time: "14:30", user: "李四", content: "OAuth2 基础框架 PR 已提：#120，大家帮忙 review。" },
    { date: "2026-06-16", time: "15:00", user: "赵六", content: "PR #120 看了，LGTM。测试覆盖很全。" },
    { date: "2026-06-17", time: "09:45", user: "李四", content: "@张三 Azure AD redirect_uri 的问题，我按你说的方案 1 处理了，一个 App Registration 配多个 uri。" },
    { date: "2026-06-17", time: "09:47", user: "张三", content: "👍 这样最简单。" },
    { date: "2026-06-17", time: "11:20", user: "王五", content: "BUG-201 修完了，PR #128。Safari 下 gap 改成 margin 就好了。" },
    { date: "2026-06-17", time: "14:00", user: "赵六", content: "Token 刷新的 E2E 测试发现一个问题：并发请求时偶尔 401。@李四 你看看？" },
    { date: "2026-06-17", time: "14:15", user: "李四", content: "收到，我看看。应该是刷新竞态问题。" },
    { date: "2026-06-18", time: "10:00", user: "孙七", content: "设计评审会议开始了，大家准备一下。" },
    { date: "2026-06-18", time: "15:30", user: "李四", content: "Token 刷新竞态问题定位了，用队列机制解决。今天提 PR。" },
    { date: "2026-06-18", time: "16:00", user: "赵六", content: "E2E 测试进展：登录流程、Token 刷新、登出都覆盖了。明天继续并发测试。" },
    { date: "2026-06-19", time: "09:30", user: "张三", content: "认证模块联调开始，大家准备一下各自的环境。" },
    { date: "2026-06-19", time: "15:00", user: "张三", content: "联调通过！🎉 认证模块基本功能都 OK 了。发现两个小问题（BUG-215、BUG-216），李四在修。" },
    { date: "2026-06-19", time: "17:45", user: "李四", content: "BUG-215 修完了，PR #132。并发 100 请求测试通过，0 个 401。" },
    { date: "2026-06-20", time: "16:30", user: "孙七", content: "Retro 会议总结发到邮件了，大家看一下。" },
    { date: "2026-06-20", time: "17:00", user: "张三", content: "本周辛苦大家！认证模块完成度很高，下周继续支付系统。🎉🎉🎉" },
  ],
};

// ── 技术文档 (6 篇, Word .docx) ──────────────────────────────────────

const techDocs = [
  {
    file: "documents/认证模块技术方案.docx",
    title: "用户认证模块技术方案",
    version: "v1.0",
    author: "张三",
    date: "2026-06-15",
    status: "已评审",
    sections: [
      {
        heading: "1. 概述",
        content: ["用户认证模块是 i-Write 平台的基础组件，负责用户身份验证和授权。"],
      },
      {
        heading: "2. 技术选型",
        content: [
          "组件 | 选型 | 理由",
          "OAuth2 库 | MSAL.js (Microsoft) / passport.js (GitHub) | 官方推荐",
          "Token 格式 | JWT (RS256) | 无状态、可验证",
          "Token 存储 | HttpOnly Cookie + 加密 localStorage | 安全 + 兼容",
          "会话管理 | Redis | 分布式、高性能",
        ],
      },
      {
        heading: "3. 架构设计",
        content: [
          "用户 → 前端 → OAuth2 Provider → 回调 → 后端 → JWT 生成 → 前端存储",
          "",
          "OAuth2 流程：",
          "1. 用户点击「使用 Microsoft 登录」",
          "2. 前端跳转 Microsoft 授权页面",
          "3. 用户授权后，Microsoft 回调到后端",
          "4. 后端用 Authorization Code 换取 Access Token",
          "5. 后端生成 JWT Token，返回给前端",
          "6. 前端存储 Token，后续请求携带",
          "",
          "Token 管理：",
          "- Access Token: 有效期 1 小时，存储在 HttpOnly Cookie",
          "- Refresh Token: 有效期 7 天，存储在加密 localStorage",
          "- Token 刷新: 前端检测到 Access Token 过期前 5 分钟自动刷新",
        ],
      },
      {
        heading: "4. 安全设计",
        content: [
          "- 所有 Token 传输使用 HTTPS",
          "- CSRF 防护：OAuth2 State 参数验证",
          "- XSS 防护：HttpOnly Cookie + CSP 策略",
          "- Token 刷新使用分布式锁防止竞态",
        ],
      },
      {
        heading: "5. API 设计",
        content: [
          "接口 | 方法 | 说明",
          "/auth/microsoft | GET | 发起 Microsoft OAuth2",
          "/auth/microsoft/callback | GET | Microsoft 回调",
          "/auth/github | GET | 发起 GitHub OAuth",
          "/auth/github/callback | GET | GitHub 回调",
          "/auth/refresh | POST | 刷新 Token",
          "/auth/logout | POST | 登出",
          "/auth/me | GET | 获取当前用户信息",
        ],
      },
    ],
  },
  {
    file: "documents/支付系统技术方案.docx",
    title: "支付系统技术方案",
    version: "v1.0",
    author: "张三、李四",
    date: "2026-06-19",
    status: "初稿",
    sections: [
      {
        heading: "1. 概述",
        content: ["支付系统支持用户订阅 i-Write 的付费功能。"],
      },
      {
        heading: "2. 支付 Provider",
        content: [
          "Provider | 适用场景 | 费率",
          "Stripe | 国际支付 | 2.9% + $0.30",
          "支付宝 | 国内支付 | 0.6%",
          "微信支付 | 国内支付 | 0.6%",
        ],
      },
      {
        heading: "3. 订阅模式",
        content: [
          "套餐 | 价格 | 功能",
          "免费版 | $0 | 基础功能，5 次/月",
          "专业版 | $19/月 | 全部功能，无限次",
          "团队版 | $49/月/人 | 团队协作，管理后台",
        ],
      },
      {
        heading: "4. 技术架构",
        content: [
          "用户 → 前端 → Stripe Checkout → 支付完成 → Webhook → 后端更新订阅状态",
        ],
      },
      {
        heading: "5. 关键流程",
        content: [
          "订阅流程：",
          "1. 用户选择套餐",
          "2. 前端创建 Stripe Checkout Session",
          "3. 用户完成支付",
          "4. Stripe 发送 Webhook 到后端",
          "5. 后端更新用户订阅状态",
          "",
          "退款流程：",
          "1. 用户申请退款",
          "2. 后端调用 Stripe Refund API",
          "3. 更新用户订阅状态",
        ],
      },
    ],
  },
  {
    file: "documents/API文档-认证接口.docx",
    title: "API 文档 — 认证接口",
    version: "v1.0",
    date: "2026-06-18",
    sections: [
      {
        heading: "基础信息",
        content: [
          "Base URL: /api/auth",
          "认证: Bearer Token (JWT)",
        ],
      },
      {
        heading: "GET /api/auth/microsoft",
        content: ["发起 Microsoft OAuth2 登录。", "响应: 302 重定向到 Microsoft 授权页面"],
      },
      {
        heading: "GET /api/auth/microsoft/callback",
        content: [
          "Microsoft OAuth2 回调。",
          "参数: code (string), state (string)",
          "响应: { accessToken, refreshToken, expiresIn }",
        ],
      },
      {
        heading: "POST /api/auth/refresh",
        content: [
          "刷新 Access Token。",
          "请求体: { refreshToken }",
          "响应: { accessToken, expiresIn }",
        ],
      },
      {
        heading: "POST /api/auth/logout",
        content: ["登出当前用户。", "响应: { success: true }"],
      },
      {
        heading: "GET /api/auth/me",
        content: [
          "获取当前用户信息。",
          "响应: { id, name, email, providers }",
        ],
      },
    ],
  },
  {
    file: "documents/架构设计-i-Write系统架构.docx",
    title: "i-Write 系统架构设计",
    version: "v1.0",
    author: "张三",
    date: "2026-06-14",
    sections: [
      {
        heading: "1. 系统架构",
        content: [
          "Frontend (React + TypeScript + Vite)",
          "  ├─ Chat Box",
          "  ├─ 大纲编辑器",
          "  ├─ 文档查看器",
          "  ├─ 生成树可视化",
          "  └─ 评估面板",
          "",
          "Backend (Express + Node.js)",
          "  ├─ 叙事引擎",
          "  ├─ RAG 引擎",
          "  ├─ 评估引擎",
          "  ├─ 知识源连接器",
          "  └─ SQLite",
          "",
          "External APIs",
          "  ├─ LLM API (MiMo / OpenAI / DeepSeek)",
          "  ├─ Embedding API (SiliconFlow)",
          "  ├─ Reranker API (SiliconFlow)",
          "  ├─ Microsoft Graph API",
          "  └─ GitHub API",
        ],
      },
      {
        heading: "2. 技术栈",
        content: [
          "层 | 技术",
          "前端 | React 18 + TypeScript + Vite",
          "状态管理 | Zustand",
          "后端 | Express / Node.js",
          "数据库 | SQLite",
          "AI 适配 | OpenAI-compatible 协议",
          "向量检索 | 远程 embedding + 内存 cosine",
        ],
      },
      {
        heading: "3. 数据流",
        content: [
          "1. 用户输入需求 → 叙事引擎生成大纲",
          "2. 大纲每个章节 → RAG 检索相关内容",
          "3. 检索结果 + 章节指令 → LLM 生成段落",
          "4. 每段话 → Groundedness 验证",
          "5. 生成树构建 → 文档输出",
        ],
      },
    ],
  },
  {
    file: "documents/RAG引擎参数配置.docx",
    title: "RAG 引擎参数配置",
    version: "v1.0",
    date: "2026-06-15",
    sections: [
      {
        heading: "参数列表",
        content: [
          "参数 | 默认值 | 说明",
          "chunk_size | 512 | 文档分块大小（tokens）",
          "chunk_overlap | 64 | 分块重叠大小",
          "embedding_model | 用户配置 | 默认 SiliconFlow/bge-m3",
          "embedding_dimension | 1024 | 向量维度",
          "bm25_k1 | 1.2 | BM25 参数 k1",
          "bm25_b | 0.75 | BM25 参数 b",
          "rrf_k | 60 | RRF 融合参数",
          "mmr_lambda | 0.7 | MMR 多样性参数",
          "top_k | 10 | 检索返回数量",
          "reranker_top_k | 5 | 重排序后返回数量",
          "groundedness_threshold | 0.8 | Groundedness 通过阈值",
          "groundedness_fail_threshold | 0.5 | 失败阈值（触发重生成）",
        ],
      },
      {
        heading: "Pipeline 流程",
        content: [
          "Query Expansion → Hybrid Search → Reranker → Cross-Source Fusion → Groundedness Check",
          "",
          "1. Query Expansion — 跨语言扩展、同义词扩展、Multi-Query 改写",
          "2. Hybrid Search — BM25 + 向量语义搜索 + RRF 融合 + MMR 多样性排序",
          "3. Reranker — 三级降级：远程 API → 本地 Cross-Encoder → 启发式加权",
          "4. Groundedness Check — 句子级验证：groundedRatio >= 0.8 → pass",
        ],
      },
    ],
  },
  {
    file: "documents/部署指南.docx",
    title: "i-Write 部署指南",
    version: "v1.0",
    date: "2026-06-14",
    sections: [
      {
        heading: "环境要求",
        content: [
          "- Node.js >= 18",
          "- npm >= 9",
          "- SQLite >= 3.35",
        ],
      },
      {
        heading: "快速开始",
        content: [
          "# 克隆仓库",
          "git clone https://github.com/company/i-write.git",
          "cd i-write",
          "",
          "# 安装依赖",
          "npm install",
          "",
          "# 配置环境变量",
          "cp .env.example .env",
          "# 编辑 .env 填入 API Key",
          "",
          "# 启动开发服务器",
          "npm run dev",
        ],
      },
      {
        heading: "环境变量",
        content: [
          "# LLM Provider",
          "GEMINI_KEY=",
          "MiMo_KEY=",
          "",
          "# Embedding/Reranker",
          "siliconflow_Key=",
          "",
          "# Microsoft Graph",
          "MS_CLIENT_ID=",
          "MS_CLIENT_SECRET=",
          "",
          "# GitHub",
          "GITHUB_TOKEN=",
        ],
      },
      {
        heading: "构建部署",
        content: [
          "# 构建",
          "npm run build",
          "",
          "# 启动",
          "npm start",
        ],
      },
      {
        heading: "生产环境建议",
        content: [
          "- 使用 PM2 管理进程",
          "- 使用 Nginx 反向代理",
          "- 启用 HTTPS",
          "- 定期备份 SQLite 数据库",
        ],
      },
    ],
  },
];

// ── 生成 Word .docx 文件 ──────────────────────────────────────

async function generateDocx(filePath: string, title: string, meta: Record<string, string>, sections: Array<{ heading: string; content: string[] }>) {
  try {
    const docx = await import("docx");
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;

    const children: any[] = [];

    // Title
    children.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 32 })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      })
    );

    // Metadata
    for (const [key, value] of Object.entries(meta)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${key}: `, bold: true, size: 22 }),
            new TextRun({ text: value, size: 22 }),
          ],
          spacing: { after: 100 },
        })
      );
    }

    // Separator
    children.push(new Paragraph({ text: "", spacing: { after: 200 } }));

    // Sections
    for (const section of sections) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.heading, bold: true, size: 26 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        })
      );

      for (const line of section.content) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
            spacing: { after: 80 },
          })
        );
      }
    }

    const doc = new Document({
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);
    const fullPath = path.join(SAMPLES_DIR, filePath);
    ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, Buffer.from(buffer));
    console.log(`  ✅ ${filePath}`);
  } catch (e: any) {
    console.log(`  ⚠️ docx 生成失败 (${filePath}): ${e.message}`);
  }
}

// ── 生成 EML 文件 ──────────────────────────────────────

function generateEml(filePath: string, email: { from: string; to: string; date: string; subject: string; body: string }) {
  const emlContent = `From: ${email.from}
To: ${email.to}
Date: ${email.date}
Subject: ${email.subject}
MIME-Version: 1.0
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: 7bit

${email.body}`;

  const fullPath = path.join(SAMPLES_DIR, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, emlContent, "utf-8");
  console.log(`  ✅ ${filePath}`);
}

// ── 生成 Teams Message JSON ──────────────────────────────────────

function generateTeamsJson(filePath: string, data: any) {
  const fullPath = path.join(SAMPLES_DIR, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✅ ${filePath}`);
}

// ── 主生成流程 ──────────────────────────────────────

console.log("📝 生成 Sample Data...\n");

// 1. 会议纪要 (Word .docx)
console.log("📋 会议纪要 (5 篇, Word .docx):");
for (const m of meetings) {
  await generateDocx(m.file, m.title, {
    "日期": m.date,
    "参会人": m.attendees,
    "记录人": m.recorder,
  }, m.sections);
}

// 2. 邮件往来 (Outlook .eml)
console.log("\n📧 邮件往来 (10 封, Outlook .eml):");
for (const e of emails) {
  generateEml(e.file, e);
}

// 3. Teams 聊天记录 (Teams Message JSON)
console.log("\n💬 Teams 聊天记录 (JSON):");
generateTeamsJson("documents/Teams-聊天记录-dev-team.json", teamsMessages);

// 4. 技术文档 (Word .docx)
console.log("\n📄 技术文档 (6 篇, Word .docx):");
for (const doc of techDocs) {
  await generateDocx(doc.file, doc.title, {
    "版本": doc.version || "v1.0",
    "作者": doc.author || "i-Write 团队",
    "日期": doc.date,
    "状态": doc.status || "已发布",
  }, doc.sections);
}

// 5. Excel 文件 (2 份)
console.log("\n📊 生成 Excel 文件...");

try {
  const XLSX = await import("xlsx");

  // 1. 项目进度表
  const progressData = [
    ["项目", "状态", "完成度", "负责人", "开始日期", "截止日期", "备注"],
    ["用户认证模块", "✅ 完成", "100%", "张三", "2026-06-16", "2026-06-20", "OAuth2 + JWT，已联调通过"],
    ["BUG-201 Safari样式", "✅ 完成", "100%", "王五", "2026-06-16", "2026-06-17", "gap 兼容性问题"],
    ["BUG-205 Token刷新", "✅ 完成", "100%", "李四", "2026-06-16", "2026-06-17", "过期处理优化"],
    ["BUG-210 密码重置", "✅ 完成", "100%", "李四", "2026-06-16", "2026-06-18", "改用异步队列"],
    ["登录页面 UI", "✅ 完成", "100%", "王五", "2026-06-16", "2026-06-16", "参考设计稿"],
    ["E2E 测试", "🔄 进行中", "80%", "赵六", "2026-06-16", "2026-06-27", "并发测试待完成"],
    ["支付系统技术方案", "✅ 完成", "100%", "张三、李四", "2026-06-16", "2026-06-20", "初稿已完成"],
    ["支付系统开发", "⏳ 未开始", "0%", "张三、李四", "2026-06-23", "2026-07-04", "待设计评审"],
    ["知识源连接状态组件", "✅ 完成", "100%", "王五", "2026-06-18", "2026-06-18", "已集成到 Dashboard"],
    ["Token 刷新竞态修复", "✅ 完成", "100%", "李四", "2026-06-19", "2026-06-19", "并发 100 请求测试通过"],
  ];
  const progressWs = XLSX.utils.aoa_to_sheet(progressData);
  progressWs["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  const progressWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(progressWb, progressWs, "项目进度");

  // 2. Bug 统计表
  const bugData = [
    ["Bug ID", "标题", "优先级", "状态", "负责人", "创建日期", "修复日期", "模块"],
    ["BUG-201", "Safari 登录页面样式错乱", "高", "✅ 已修复", "王五", "2026-06-10", "2026-06-17", "前端"],
    ["BUG-205", "Token 刷新失败导致用户被踢出", "高", "✅ 已修复", "李四", "2026-06-11", "2026-06-17", "后端"],
    ["BUG-210", "密码重置邮件发送延迟", "高", "✅ 已修复", "李四", "2026-06-12", "2026-06-18", "后端"],
    ["BUG-215", "Token 刷新竞态导致 401", "高", "✅ 已修复", "李四", "2026-06-18", "2026-06-19", "前端"],
    ["BUG-216", "GitHub OAuth 回调超时", "中", "🔄 修复中", "李四", "2026-06-19", "", "后端"],
    ["BUG-217", "知识源状态更新延迟", "低", "⏳ 待修复", "王五", "2026-06-19", "", "前端"],
    ["BUG-218", "大文档生成超时", "中", "⏳ 待修复", "张三", "2026-06-20", "", "后端"],
    ["BUG-219", "评估报告图表显示异常", "低", "⏳ 待修复", "王五", "2026-06-20", "", "前端"],
  ];
  const bugWs = XLSX.utils.aoa_to_sheet(bugData);
  bugWs["!cols"] = [{ wch: 10 }, { wch: 35 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 8 }];
  const bugWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bugWb, bugWs, "Bug 统计");

  // 写入 Excel 文件
  const progressPath = path.join(SAMPLES_DIR, "spreadsheets", "项目进度表.xlsx");
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  const progressXlsx = XLSX.write(progressWb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(progressPath, Buffer.from(progressXlsx));
  console.log("  ✅ spreadsheets/项目进度表.xlsx");

  const bugPath = path.join(SAMPLES_DIR, "spreadsheets", "Bug统计表.xlsx");
  const bugXlsx = XLSX.write(bugWb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(bugPath, Buffer.from(bugXlsx));
  console.log("  ✅ spreadsheets/Bug统计表.xlsx");
} catch (e) {
  console.log("  ⚠️ xlsx 库未安装，跳过 Excel 生成");
}

// 6. PPT 文件 (1 份) — 使用 python-pptx 生成以确保兼容性
console.log("\n📽️ 生成 PPT 文件...");

try {
  const { execSync } = await import("child_process");
  const scriptPath = path.resolve(process.cwd(), "server/src/scripts/generatePpt.py");
  execSync(`python3 "${scriptPath}"`, { stdio: "inherit" });
} catch (e: any) {
  console.log(`  ⚠️ PPT 生成失败: ${e.message}`);
}

console.log("\n🎉 Sample Data 全部生成完成！");
console.log("📁 文件格式：");
console.log("  - 会议纪要: Word (.docx)");
console.log("  - 邮件: Outlook (.eml)");
console.log("  - Teams 聊天: JSON");
console.log("  - 技术文档: Word (.docx)");
console.log("  - Excel: .xlsx");
console.log("  - PPT: .pptx");
