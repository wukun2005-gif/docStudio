/**
 * 生成 Sample Data — Nexora Tech / i-Write 项目（2026 年 6 月）
 *
 * 统一团队（18 人），时间跨度 4 个 sprint（6/2 ~ 6/27）
 *
 * 生成内容：
 * - 8 篇会议纪要 (Word .docx)
 * - 15 封邮件往来 (Outlook .eml)
 * - 40+ 条 Teams 聊天记录 (Teams Message JSON)
 * - 10 篇技术文档 (Word .docx)
 * - 4 份 Excel 数据
 * - 3 份 PPT
 */

import fs from "fs";
import path from "path";

const SAMPLES_DIR = path.resolve(process.cwd(), "samples");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 会议纪要 (8 篇, Word .docx) ──────────────────────────────────────

const meetings = [
  {
    file: "documents/01-周一-standup-会议纪要.docx",
    title: "Sprint 3 Standup 会议纪要",
    date: "2026-06-16（周一）09:30-09:50",
    attendees: "陈强（技术负责人）、刘伟（后端）、赵丽（前端）、杨飞（QA）、苏楠（PM）",
    recorder: "陈强",
    sections: [
      {
        heading: "本周目标",
        content: [
          "1. 完成用户认证模块开发（OAuth2 + JWT）— 陈强负责",
          "2. 修复 3 个高优 Bug — 刘伟、赵丽负责",
          "   - BUG-201: 登录页面在 Safari 下样式错乱",
          "   - BUG-205: Token 刷新失败导致用户被踢出",
          "   - BUG-210: 密码重置邮件发送延迟",
          "3. 完成支付系统技术方案设计 — 陈强、刘伟负责",
        ],
      },
      {
        heading: "讨论要点",
        content: [
          "- 认证模块需要支持 Microsoft OAuth2 和 GitHub OAuth2 两种方式",
          "- 支付系统需要先完成认证模块，因为涉及用户身份验证",
          "- 赵丽提出前端需要一个新的 Token 管理组件",
          "- 杨飞建议增加 E2E 测试覆盖认证流程",
        ],
      },
      {
        heading: "Action Items",
        content: [
          "任务 | 负责人 | 截止日期",
          "完成 OAuth2 基础框架 | 陈强 | 周三",
          "修复 BUG-201 | 赵丽 | 周二",
          "修复 BUG-205 | 刘伟 | 周三",
          "修复 BUG-210 | 刘伟 | 周四",
          "编写认证模块 E2E 测试 | 杨飞 | 周五",
          "支付系统技术方案初稿 | 陈强、刘伟 | 周五",
        ],
      },
    ],
  },
  {
    file: "documents/02-周一-认证模块需求评审.docx",
    title: "认证模块需求评审会议",
    date: "2026-06-16（周一）14:00-15:30",
    attendees: "陈强、刘伟、赵丽、杨飞、苏楠、罗茜（UX 设计主管）",
    recorder: "苏楠",
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
          "- 罗茜展示了登录页面设计稿",
          "- 支持「使用 Microsoft 账号登录」和「使用 GitHub 登录」两个按钮",
          "- 登录后显示用户头像和连接的知识源状态",
        ],
      },
      {
        heading: "决策",
        content: [
          "1. 优先实现 Microsoft OAuth2（P0），GitHub OAuth 次之（P1）",
          "2. Token 刷新采用静默方式，用户无感知",
          "3. 登录页面使用罗茜的设计方案",
        ],
      },
    ],
  },
  {
    file: "documents/03-周三-设计评审会议.docx",
    title: "认证模块设计评审会议",
    date: "2026-06-18（周三）10:00-11:30",
    attendees: "陈强、刘伟、赵丽、杨飞、罗茜",
    recorder: "刘伟",
    sections: [
      {
        heading: "后端实现（刘伟汇报）",
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
        heading: "前端实现（赵丽汇报）",
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
        heading: "测试计划（杨飞汇报）",
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
    attendees: "陈强、刘伟、赵丽、杨飞",
    recorder: "陈强",
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
          "- 陈强：修复 BUG-215（Token 刷新竞态）",
          "- 刘伟：修复 BUG-216（GitHub OAuth 超时）",
          "- 杨飞：完成 E2E 测试",
        ],
      },
    ],
  },
  {
    file: "documents/05-周五-Retro会议.docx",
    title: "周五 Sprint Retrospective",
    date: "2026-06-20（周五）16:00-17:00",
    attendees: "陈强、刘伟、赵丽、杨飞、苏楠",
    recorder: "苏楠",
    sections: [
      {
        heading: "完成情况",
        content: [
          "任务 | 状态 | 负责人",
          "认证模块 OAuth2 基础框架 | ✅ 完成 | 陈强",
          "Microsoft OAuth2 登录 | ✅ 完成 | 陈强、刘伟",
          "GitHub OAuth 登录 | ✅ 完成 | 刘伟",
          "JWT Token 管理 | ✅ 完成 | 陈强",
          "登录页面 UI | ✅ 完成 | 赵丽",
          "BUG-201 修复 | ✅ 完成 | 赵丽",
          "BUG-205 修复 | ✅ 完成 | 刘伟",
          "BUG-210 修复 | ✅ 完成 | 刘伟",
          "E2E 测试 | 🔄 进行中 (80%) | 杨飞",
          "支付系统技术方案 | ✅ 完成 | 陈强、刘伟",
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
  {
    file: "documents/06-支付系统设计评审.docx",
    title: "支付系统设计评审会议",
    date: "2026-06-23（周一）14:00-15:30",
    attendees: "陈强、刘伟、唐敏（法务顾问）、苏楠",
    recorder: "刘伟",
    sections: [
      {
        heading: "支付方案汇报（刘伟）",
        content: [
          "支付系统技术方案 v1.0 已完成，核心设计如下：",
          "",
          "支付 Provider 选型：",
          "- Stripe（国际支付）：2.9% + $0.30/笔，支持 135+ 种货币",
          "- 支付宝（国内支付）：0.6% 费率，企业账户需资质审核",
          "- 微信支付（国内支付）：0.6% 费率，需公众号认证",
          "",
          "订阅模式设计：",
          "- Free: $0/月，基础功能，5 次生成/月",
          "- Pro: $19/月，全部功能，无限生成",
          "- Team: $49/月/人，团队协作 + 管理后台",
          "- 年付优惠：8 折",
        ],
      },
      {
        heading: "安全与合规讨论（唐敏）",
        content: [
          "唐敏提出以下合规要求：",
          "",
          "1. PCI DSS 合规：使用 Stripe Checkout 可避免直接处理卡号，降低合规成本",
          "2. 退款政策：7 天无理由退款，超过 7 天按比例退款",
          "3. 发票管理：自动生成电子发票，支持增值税专用发票",
          "4. 数据留存：支付记录保留 5 年（税务要求）",
          "",
          "结论：Stripe Checkout 方案可行，合规风险可控。",
        ],
      },
      {
        heading: "技术方案讨论",
        content: [
          "Webhook 安全设计：",
          "- Stripe Webhook 签名验证（HMAC-SHA256）",
          "- 幂等性处理（防止重复扣款）",
          "- 失败重试机制（3 次，指数退避）",
          "",
          "订阅状态同步：",
          "- Webhook 事件 → 更新 user_subscriptions 表",
          "- 定时任务：每日凌晨 2 点同步一次（兜底）",
          "",
          "退款流程：",
          "- 用户申请 → 后端调用 Stripe Refund API → 更新订阅状态",
        ],
      },
      {
        heading: "决策与 Action Items",
        content: [
          "✅ 采用 Stripe Checkout 方案",
          "✅ 支持支付宝/微信支付（Phase 2）",
          "✅ 退款政策：7 天无理由退款",
          "",
          "任务 | 负责人 | 截止日期",
          "Stripe 集成开发 | 刘伟 | 6/30",
          "Webhook 安全验证 | 陈强 | 6/30",
          "订阅状态管理 | 刘伟 | 7/2",
          "退款流程开发 | 刘伟 | 7/4",
          "合规文档更新 | 唐敏 | 7/4",
        ],
      },
    ],
  },
  {
    file: "documents/07-GoToMarket策略会议.docx",
    title: "GoToMarket 策略会议",
    date: "2026-06-24（周二）10:00-11:30",
    attendees: "苏楠、王莉（市场总监）、张伟（企业销售经理）、李鑫（客户成功经理）",
    recorder: "苏楠",
    sections: [
      {
        heading: "市场分析（王莉汇报）",
        content: [
          "全球企业内容生成市场规模：$4.2B（2026 年预估）",
          "年增长率：28%（2026-2030）",
          "",
          "竞品分析：",
          "- Jasper: AI 营销文案，$49/月，无溯源能力",
          "- Copy.ai: AI 写作助手，$36/月，质量不稳定",
          "- Notion AI: 文档+AI，$10/月，AI 功能浅",
          "",
          "i-Write 差异化优势：",
          "1. 溯源能力：每段文字都能追溯到知识库来源",
          "2. 知识库集成：支持 10+ 知识源类型",
          "3. Trust Score：5 维度评估文档可信度",
        ],
      },
      {
        heading: "定价策略讨论",
        content: [
          "定价方案（已确认）：",
          "- Free: $0/月，5 次生成/月，吸引试用用户",
          "- Pro: $19/月，无限生成，个人专业人士",
          "- Team: $49/月/人，团队协作，企业团队",
          "",
          "年付优惠：8 折",
          "教育优惠：5 折（需 .edu 邮箱验证）",
        ],
      },
      {
        heading: "渠道策略（王莉、张伟）",
        content: [
          "PLG（Product-Led Growth）— 王莉负责：",
          "- 免费版吸引用户 → 自然升级",
          "- 病毒传播：邀请好友获赠 10 次额外生成",
          "- 内容营销：技术博客 + 社交媒体（掘金、知乎、微信公众号）",
          "",
          "企业直销 — 张伟负责：",
          "- 目标：Q3 完成 10 家企业客户签约",
          "- 重点行业：科技、咨询、金融",
          "- 合作伙伴：系统集成商、云服务商",
          "",
          "客户成功 — 李鑫负责：",
          "- 客户 onboarding 流程设计",
          "- 定期客户回访（月度）",
          "- NPS 调查（季度）",
        ],
      },
      {
        heading: "时间线",
        content: [
          "7 月：产品发布（Alpha → Beta）",
          "8 月：PLG 启动 + 企业直销启动",
          "9 月：首批企业客户上线",
          "",
          "关键里程碑：",
          "- 7/15: Beta 版本发布",
          "- 8/1: Landing page 上线",
          "- 8/15: 首个付费客户",
          "- 9/30: 10 家企业客户签约",
        ],
      },
    ],
  },
  {
    file: "documents/08-法务合规评审.docx",
    title: "法务合规评审会议",
    date: "2026-06-25（周三）14:00-15:30",
    attendees: "唐敏、王琳（COO）、陈强（技术负责人）",
    recorder: "唐敏",
    sections: [
      {
        heading: "合规要求概述（唐敏）",
        content: [
          "i-Write 需要满足以下法规要求：",
          "",
          "1. GDPR（欧盟通用数据保护条例）",
          "   - 适用范围：所有欧盟用户",
          "   - 核心要求：数据最小化、用户知情同意、删除权",
          "",
          "2. 中国个人信息保护法（PIPL）",
          "   - 适用范围：所有中国用户",
          "   - 核心要求：数据本地化、用户授权、安全评估",
        ],
      },
      {
        heading: "数据分类与处理",
        content: [
          "数据分类：",
          "- 用户数据（PII）：姓名、邮箱、头像 — 高敏感",
          "- 文档内容：用户生成的文档 — 中敏感",
          "- 知识库数据：上传的文件、切片 — 中敏感",
          "- 日志数据：操作日志、错误日志 — 低敏感",
          "- 审计日志：写操作记录 — 中敏感",
          "",
          "数据处理原则：",
          "- 最小必要：只收集功能必需的数据",
          "- 目的限制：数据只用于声明的目的",
          "- 存储限制：数据保留期限不超过必要时间",
        ],
      },
      {
        heading: "技术措施（陈强汇报）",
        content: [
          "已实施的安全措施：",
          "- API Key 加密存储（AES-256-GCM）",
          "- 审计日志记录所有写操作",
          "- 用户数据 90 天自动清理",
          "- HTTPS 全站加密",
          "- CSP 策略限制脚本来源",
          "",
          "待实施的措施：",
          "- 数据导出功能（用户可导出所有数据）",
          "- 数据删除功能（用户可请求删除所有数据）",
          "- 隐私政策页面",
          "- Cookie 同意弹窗",
        ],
      },
      {
        heading: "决策与 Action Items",
        content: [
          "✅ 数据分类方案通过",
          "✅ 安全措施方案通过",
          "✅ 数据留存政策通过",
          "",
          "任务 | 负责人 | 截止日期",
          "数据导出功能 | 陈强 | 7/5",
          "数据删除功能 | 陈强 | 7/5",
          "隐私政策页面 | 唐敏 | 7/1",
          "Cookie 同意弹窗 | 赵丽 | 7/1",
          "合规审计报告 | 唐敏 | 7/15",
        ],
      },
    ],
  },
];

// ── 邮件往来 (15 封, Outlook .eml) ──────────────────────────────────────

const emails = [
  {
    file: "emails/01-苏楠-陈强-认证模块需求确认.eml",
    from: "苏楠（产品总监） <sunan@nexora-tech.com>",
    to: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    date: "2026-06-15（周日）20:30",
    subject: "认证模块需求确认 - 请周一评审前看一下",
    body: `陈强你好，

明天下午的认证模块需求评审，我把需求文档整理好了，主要变化：

1. 新增 Microsoft OAuth2 支持 — 之前只计划了 GitHub OAuth，但考虑到我们的目标用户很多用 Microsoft 365，需要加上
2. Token 刷新策略调整 — 从 2 小时改为 1 小时，安全性更高
3. 多账号绑定 — 用户可以同时绑定 Microsoft 和 GitHub 账号

另外，设计团队（罗茜）已经出了登录页面的初稿，评审时一起看。

需求文档链接：[OneDrive: 认证模块 PRD v2.pdf]

Best,
苏楠`,
  },
  {
    file: "emails/02-陈强-团队-本周目标.eml",
    from: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
    date: "2026-06-16（周一）08:00",
    subject: "本周目标 - 认证模块 + Bug 修复",
    body: `大家好，

本周目标：

1. 认证模块开发（优先级 P0）
   - OAuth2 基础框架 — 陈强
   - Microsoft OAuth2 — 陈强、刘伟
   - GitHub OAuth — 刘伟
   - 登录页面 UI — 赵丽
   - E2E 测试 — 杨飞

2. Bug 修复（优先级 P0）
   - BUG-201: Safari 样式问题 — 赵丽
   - BUG-205: Token 刷新失败 — 刘伟
   - BUG-210: 密码重置延迟 — 刘伟

3. 支付系统技术方案（优先级 P1）
   - 初稿 — 陈强、刘伟

请各位确认任务分配，有问题今天 Standup 讨论。

陈强`,
  },
  {
    file: "emails/03-刘伟-陈强-redirect-uri问题.eml",
    from: "刘伟（高级后端工程师） <liuwei@nexora-tech.com>",
    to: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    date: "2026-06-17（周二）11:15",
    subject: "[紧急] Azure AD redirect_uri 配置问题",
    body: `陈强，

遇到一个问题：Azure AD 要求 redirect_uri 必须完全匹配，但我们的开发环境（localhost:3000）和生产环境（app.i-write.com）用的是同一个 Azure AD App Registration。

目前的解决方案：
1. 在 Azure AD 中配置多个 redirect_uri（开发 + 生产）
2. 用环境变量区分不同环境的 redirect_uri

你觉得方案 1 可行吗？还是需要创建两个 App Registration？

刘伟`,
  },
  {
    file: "emails/04-陈强-刘伟-redirect-uri回复.eml",
    from: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    to: "刘伟（高级后端工程师） <liuwei@nexora-tech.com>",
    date: "2026-06-17（周二）11:45",
    subject: "Re: [紧急] Azure AD redirect_uri 配置问题",
    body: `刘伟，

用方案 1，在一个 App Registration 里配置多个 redirect_uri：
- http://localhost:3000/auth/callback（开发）
- https://app.i-write.com/auth/callback（生产）

环境变量里配置：
MS_REDIRECT_URI=http://localhost:3000/auth/callback  # 开发
MS_REDIRECT_URI=https://app.i-write.com/auth/callback  # 生产

这样最简单，不需要维护两个 App。

陈强`,
  },
  {
    file: "emails/05-赵丽-团队-BUG201已修复.eml",
    from: "赵丽（高级前端工程师） <zhaoli@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
    date: "2026-06-17（周二）16:30",
    subject: "BUG-201 已修复 - Safari 登录页面样式",
    body: `大家好，

BUG-201（Safari 下登录页面样式错乱）已修复。

原因：Safari 对 flexbox gap 属性的支持问题，改用 margin 替代。

PR: #128 — fix: safari login page layout

赵丽`,
  },
  {
    file: "emails/06-杨飞-陈强-E2E测试进展.eml",
    from: "杨飞（QA 负责人） <yangfei@nexora-tech.com>",
    to: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    date: "2026-06-18（周三）17:00",
    subject: "E2E 测试进展 - 认证模块",
    body: `陈强，

E2E 测试进展：

已完成：
- ✅ 登录流程测试（Microsoft + GitHub）
- ✅ Token 刷新测试
- ✅ 登出流程测试

进行中：
- 🔄 并发 Token 刷新测试（发现 BUG-215）
- 🔄 网络中断恢复测试

预计周五完成 80%，剩余 20%（边界测试）下周继续。

杨飞`,
  },
  {
    file: "emails/07-苏楠-客户-产品演示确认.eml",
    from: "苏楠（产品总监） <sunan@nexora-tech.com>",
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
苏楠`,
  },
  {
    file: "emails/08-陈强-刘伟-支付系统方案讨论.eml",
    from: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    to: "刘伟（高级后端工程师） <liuwei@nexora-tech.com>",
    date: "2026-06-19（周四）09:00",
    subject: "支付系统技术方案 - 初稿讨论",
    body: `刘伟，

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

陈强`,
  },
  {
    file: "emails/09-刘伟-陈强-Token刷新竞态修复.eml",
    from: "刘伟（高级后端工程师） <liuwei@nexora-tech.com>",
    to: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    date: "2026-06-19（周四）18:00",
    subject: "BUG-215 已修复 - Token 刷新竞态问题",
    body: `陈强，

BUG-215（Token 刷新时偶尔 401）已修复。

解决方案：
1. Token 刷新时设置 isRefreshing 标志
2. 后续请求检测到 isRefreshing 时，加入等待队列
3. Token 刷新完成后，用新 Token 重发队列中的请求

PR: #132 — fix: token refresh race condition

测试通过，并发 100 个请求不会出现 401。

刘伟`,
  },
  {
    file: "emails/10-陈强-团队-本周总结.eml",
    from: "陈强（技术负责人） <chenqiang@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
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

陈强`,
  },
  {
    file: "emails/11-张伟-苏楠-企业客户需求.eml",
    from: "张伟（企业销售经理） <zhangwei@nexora-tech.com>",
    to: "苏楠（产品总监） <sunan@nexora-tech.com>",
    date: "2026-06-20（周五）10:00",
    subject: "Acme Corp 客户需求清单 - 请评审",
    body: `苏楠，

Acme Corp（200 人团队）的需求清单整理好了，他们对 i-Write 非常感兴趣：

核心需求：
1. SSO 集成 — 必须支持 Azure AD（已有）
2. 批量文档生成 — 一次生成 50+ 份文档
3. 团队权限管理 — Admin/Editor/Viewer 三级权限
4. API 接入 — 通过 API 集成到现有系统
5. 数据安全 — 必须满足 SOC 2 Type II

预算：$49/人/月 × 200 人 = $9,800/月（$117,600/年）

时间线：希望 7 月底前开始试用，8 月底正式上线。

请评审需求优先级，我下周安排技术 demo。

张伟`,
  },
  {
    file: "emails/12-唐敏-团队-数据合规要求.eml",
    from: "唐敏（法务顾问） <tangmin@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
    date: "2026-06-23（周一）09:00",
    subject: "GDPR 合规检查清单 - 请各部门确认",
    body: `大家好，

为确保 i-Write 满足 GDPR 合规要求，请各部门确认以下清单：

技术部（陈强）：
- [x] API Key 加密存储（AES-256-GCM）
- [x] 审计日志记录所有写操作
- [ ] 数据导出功能（用户可导出所有数据）
- [ ] 数据删除功能（用户可请求删除所有数据）

产品部（苏楠）：
- [ ] 隐私政策页面
- [ ] Cookie 同意弹窗
- [ ] 用户授权流程

市场部（王莉）：
- [ ] 隐私政策链接（Landing page）
- [ ] 数据处理说明（用户文档）

请在 7/1 前完成标记为 [ ] 的项目。

唐敏`,
  },
  {
    file: "emails/13-王莉-团队-GoToMarket时间线.eml",
    from: "王莉（市场总监） <wangli@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
    date: "2026-06-24（周二）15:00",
    subject: "产品发布计划 - GoToMarket 时间线",
    body: `大家好，

i-Write GoToMarket 时间线确认如下：

7 月：
- 7/1: Landing page 上线（王莉负责）
- 7/15: Beta 版本发布（陈强负责）
- 7/20: 社交媒体推广启动（王莉负责）

8 月：
- 8/1: PLG 启动（免费版开放注册）
- 8/15: 企业直销启动（张伟负责）
- 8/20: 首批客户 onboarding（李鑫负责）

9 月：
- 9/15: 产品发布会（线上）
- 9/30: Q3 目标：10 家企业客户签约

请各部门确认时间线，有问题本周五讨论。

王莉`,
  },
  {
    file: "emails/14-李鑫-黄薇-客户反馈汇总.eml",
    from: "李鑫（客户成功经理） <lixin@nexora-tech.com>",
    to: "黄薇（高级产品经理） <huangwei@nexora-tech.com>",
    date: "2026-06-25（周三）16:00",
    subject: "Beta 用户反馈汇总 - 3 个用户",
    body: `黄薇，

Beta 用户反馈汇总：

用户 A（PM，NPS 9/10）：
- 最喜欢：溯源功能，能看到每段话的来源
- 建议：支持更多知识源类型（Confluence、Notion）
- 使用频率：每天 2-3 次

用户 B（Engineer，NPS 8/10）：
- 最喜欢：RAG 检索准确率高
- 建议：支持代码片段生成
- 使用频率：每天 1 次

用户 C（Consultant，NPS 7/10）：
- 最喜欢：文档生成速度快
- 建议：支持自定义模板
- 使用频率：每周 3-4 次

平均 NPS: 8.0/10

建议优先处理：Confluence/Notion 集成（用户 A 的需求代表 PM 群体）。

李鑫`,
  },
  {
    file: "emails/15-徐骏-团队-CI-CD优化.eml",
    from: "徐骏（DevOps 工程师） <xujun@nexora-tech.com>",
    to: "团队全体 <team@nexora-tech.com>",
    date: "2026-06-26（周四）11:00",
    subject: "CI/CD Pipeline 优化 - 从 8 分钟降到 5 分钟",
    body: `大家好，

本周完成了 CI/CD Pipeline 的优化：

优化前：
- Lint: 30s
- Type Check: 45s
- Unit Test: 2min
- Build: 3min
- 总计: ~8 分钟

优化措施：
1. 并行执行 Lint 和 Type Check（节省 30s）
2. 测试缓存（只运行变更文件相关的测试，节省 1min）
3. Build 缓存（增量构建，节省 1min）

优化后：
- Lint + Type Check: 45s（并行）
- Unit Test: 1min（缓存）
- Build: 2min（增量）
- 总计: ~5 分钟

下一步计划：
- Docker 多阶段构建优化（预计再节省 30s）
- 测试分片（并行运行测试，预计再节省 30s）

徐骏`,
  },
];

// ── Teams 聊天记录 (Teams Message JSON) ──────────────────────────────────────

const teamsMessages = {
  channel: "#dev-team",
  team: "i-Write 开发团队",
  dateRange: "2026-06-16 ~ 2026-06-20",
  messages: [
    { date: "2026-06-16", time: "09:52", user: "陈强", content: "Standup 结束，本周目标已同步。大家有问题随时在群里讨论。" },
    { date: "2026-06-16", time: "10:15", user: "赵丽", content: "@陈强 Safari 登录页面的问题我看了，是 gap 属性兼容性问题，今天能修完。" },
    { date: "2026-06-16", time: "10:18", user: "陈强", content: "@赵丽 好的，修完提 PR 让刘伟 review。" },
    { date: "2026-06-16", time: "14:30", user: "刘伟", content: "OAuth2 基础框架 PR 已提：#120，大家帮忙 review。" },
    { date: "2026-06-16", time: "15:00", user: "杨飞", content: "PR #120 看了，LGTM。测试覆盖很全。" },
    { date: "2026-06-17", time: "09:45", user: "刘伟", content: "@陈强 Azure AD redirect_uri 的问题，我按你说的方案 1 处理了，一个 App Registration 配多个 uri。" },
    { date: "2026-06-17", time: "09:47", user: "陈强", content: "👍 这样最简单。" },
    { date: "2026-06-17", time: "11:20", user: "赵丽", content: "BUG-201 修完了，PR #128。Safari 下 gap 改成 margin 就好了。" },
    { date: "2026-06-17", time: "14:00", user: "杨飞", content: "Token 刷新的 E2E 测试发现一个问题：并发请求时偶尔 401。@刘伟 你看看？" },
    { date: "2026-06-17", time: "14:15", user: "刘伟", content: "收到，我看看。应该是刷新竞态问题。" },
    { date: "2026-06-18", time: "10:00", user: "苏楠", content: "设计评审会议开始了，大家准备一下。" },
    { date: "2026-06-18", time: "15:30", user: "刘伟", content: "Token 刷新竞态问题定位了，用队列机制解决。今天提 PR。" },
    { date: "2026-06-18", time: "16:00", user: "杨飞", content: "E2E 测试进展：登录流程、Token 刷新、登出都覆盖了。明天继续并发测试。" },
    { date: "2026-06-19", time: "09:30", user: "陈强", content: "认证模块联调开始，大家准备一下各自的环境。" },
    { date: "2026-06-19", time: "15:00", user: "陈强", content: "联调通过！🎉 认证模块基本功能都 OK 了。发现两个小问题（BUG-215、BUG-216），刘伟在修。" },
    { date: "2026-06-19", time: "17:45", user: "刘伟", content: "BUG-215 修完了，PR #132。并发 100 请求测试通过，0 个 401。" },
    { date: "2026-06-20", time: "16:30", user: "苏楠", content: "Retro 会议总结发到邮件了，大家看一下。" },
    { date: "2026-06-20", time: "17:00", user: "陈强", content: "本周辛苦大家！认证模块完成度很高，下周继续支付系统。🎉🎉🎉" },
  ],
};

// ── 技术文档 (10 篇, Word .docx) ──────────────────────────────────────

const techDocs = [
  {
    file: "documents/认证模块技术方案.docx",
    title: "用户认证模块技术方案",
    version: "v1.0",
    author: "陈强",
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
    author: "陈强、刘伟",
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
    author: "陈强",
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
  {
    file: "documents/数据安全合规方案.docx",
    title: "i-Write 数据安全与合规方案",
    version: "v1.0",
    author: "唐敏、陈强",
    date: "2026-06-24",
    status: "已评审",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "适用法规：GDPR（欧盟）、中国个人信息保护法（PIPL）",
          "合规目标：用户数据收集最小化、用户知情同意、数据存储安全、数据删除权保障、审计日志完整",
        ],
      },
      {
        heading: "2. 数据分类",
        content: [
          "数据类型 | 示例 | 敏感等级 | 保留期限",
          "用户数据（PII） | 姓名、邮箱、头像 | 高 | 用户删除前",
          "文档内容 | 用户生成的文档 | 中 | 用户删除前",
          "知识库数据 | 上传的文件、切片 | 中 | 用户删除前",
          "日志数据 | 操作日志、错误日志 | 低 | 30 天",
          "审计日志 | 写操作记录 | 中 | 1 年",
        ],
      },
      {
        heading: "3. 安全措施",
        content: [
          "- API Key 加密存储（AES-256-GCM）",
          "- 审计日志记录所有写操作",
          "- HTTPS 全站加密",
          "- CSP 策略限制脚本来源",
          "- Rate Limiting（登录 10 次/分钟/IP）",
        ],
      },
      {
        heading: "4. 数据留存与删除",
        content: [
          "数据留存政策：",
          "- 用户数据：用户删除前",
          "- 日志数据：30 天自动清理",
          "- 审计日志：1 年",
          "",
          "数据删除（Right to Erasure）：",
          "- 用户可请求删除所有数据",
          "- 72 小时内完成删除",
          "- 删除完成后发送确认邮件",
        ],
      },
    ],
  },
  {
    file: "documents/性能测试报告.docx",
    title: "i-Write 性能测试报告",
    version: "v1.0",
    author: "杨飞、陈强",
    date: "2026-06-23",
    status: "已完成",
    sections: [
      {
        heading: "1. 测试环境",
        content: [
          "- 服务器：AWS t3.medium（2 vCPU, 4GB RAM）",
          "- 数据库：SQLite（WAL 模式）",
          "- 测试工具：k6（负载测试）",
          "- 测试数据：1000 个知识源，50000 个 chunks",
        ],
      },
      {
        heading: "2. 测试结果",
        content: [
          "API 端点 | P50 | P95 | P99 | QPS",
          "GET /api/knowledge | 15ms | 45ms | 120ms | 500",
          "POST /api/knowledge/upload | 200ms | 500ms | 1.2s | 50",
          "POST /api/generation | 2s | 5s | 12s | 20",
          "GET /api/documents | 10ms | 30ms | 80ms | 800",
        ],
      },
      {
        heading: "3. 性能瓶颈",
        content: [
          "1. LLM API 调用延迟（P95: 3-5s）— 受外部 API 限制",
          "2. Embedding 计算延迟（P95: 800ms）— 可通过批量处理优化",
          "3. 大文档生成超时（> 50 chunks）— 需要分页生成",
        ],
      },
      {
        heading: "4. 优化建议",
        content: [
          "1. LLM 响应缓存（相同 prompt 不重复调用）",
          "2. Embedding 批量处理（32 chunks/次）",
          "3. 大文档分页生成（每页 10 chunks）",
          "4. 数据库索引优化（kb_chunks.sourceId）",
        ],
      },
    ],
  },
  {
    file: "documents/GoToMarket策略文档.docx",
    title: "i-Write GoToMarket 策略文档",
    version: "v1.0",
    author: "苏楠",
    date: "2026-06-24",
    status: "已评审",
    sections: [
      {
        heading: "1. 市场机会",
        content: [
          "全球企业内容生成市场规模：$4.2B（2026 年预估）",
          "年增长率：28%（2026-2030）",
          "i-Write 目标市场：$420M（10% 市场份额目标）",
        ],
      },
      {
        heading: "2. 目标客户画像",
        content: [
          "PM：需要写 PRD、项目周报、产品规划",
          "Engineer：需要写技术方案、API 文档、架构设计",
          "Consultant：需要写咨询报告、行业分析、案例研究",
        ],
      },
      {
        heading: "3. 定价策略",
        content: [
          "套餐 | 价格 | 功能 | 目标用户",
          "Free | $0 | 基础功能，5 次/月 | 个人试用",
          "Pro | $19/月 | 全部功能，无限次 | 个人专业人士",
          "Team | $49/月/人 | 团队协作，管理后台 | 企业团队",
          "年付优惠：8 折",
        ],
      },
      {
        heading: "4. 渠道策略",
        content: [
          "PLG（Product-Led Growth）：免费版吸引用户 → 自然升级",
          "企业直销：张伟负责，目标 10 家企业客户",
          "内容营销：王莉负责，技术博客 + 社交媒体",
        ],
      },
    ],
  },
  {
    file: "documents/客户案例研究.docx",
    title: "i-Write 客户案例研究 — Acme Corp",
    version: "v1.0",
    author: "李鑫、苏楠",
    date: "2026-06-25",
    status: "初稿",
    sections: [
      {
        heading: "1. 客户背景",
        content: [
          "公司：Acme Corp",
          "行业：科技",
          "规模：200 人团队",
          "需求：企业级文档生成，需要 SSO 集成",
        ],
      },
      {
        heading: "2. 痛点与需求",
        content: [
          "痛点：",
          "- 技术文档写作耗时（平均每份 4 小时）",
          "- 文档质量不一致（不同人写作风格差异大）",
          "- 文档更新不及时（代码改了文档没改）",
          "",
          "需求：",
          "- SSO 集成（Azure AD）",
          "- 批量文档生成（50+ 份/次）",
          "- 团队权限管理（Admin/Editor/Viewer）",
          "- API 接入（集成到现有系统）",
        ],
      },
      {
        heading: "3. 解决方案",
        content: [
          "i-Write Team 版本（$49/人/月）",
          "- Azure AD SSO 集成",
          "- 批量文档生成 API",
          "- 团队权限管理",
          "- 专属客户成功经理（李鑫）",
        ],
      },
      {
        heading: "4. ROI 分析",
        content: [
          "成本：$49/人/月 × 200 人 = $9,800/月（$117,600/年）",
          "收益：",
          "- 文档写作时间减少 60%（从 4 小时降到 1.5 小时）",
          "- 每人每月节省 10 小时 × $50/小时 = $500/人",
          "- 200 人 × $500 = $100,000/月",
          "",
          "ROI: ($100,000 - $9,800) / $9,800 = 920%",
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
console.log("📋 会议纪要 (8 篇, Word .docx):");
for (const m of meetings) {
  await generateDocx(m.file, m.title, {
    "日期": m.date,
    "参会人": m.attendees,
    "记录人": m.recorder,
  }, m.sections);
}

// 2. 邮件往来 (Outlook .eml)
console.log("\n📧 邮件往来 (15 封, Outlook .eml):");
for (const e of emails) {
  generateEml(e.file, e);
}

// 3. Teams 聊天记录 (Teams Message JSON)
console.log("\n💬 Teams 聊天记录 (JSON):");
generateTeamsJson("documents/Teams-聊天记录-dev-team.json", teamsMessages);

// 4. 技术文档 (Word .docx)
console.log("\n📄 技术文档 (10 篇, Word .docx):");
for (const doc of techDocs) {
  await generateDocx(doc.file, doc.title, {
    "版本": doc.version || "v1.0",
    "作者": doc.author || "i-Write 团队",
    "日期": doc.date,
    "状态": doc.status || "已发布",
  }, doc.sections);
}

// 5. Excel 文件 (4 份)
console.log("\n📊 生成 Excel 文件...");

try {
  const XLSX = await import("xlsx");

  // 1. 项目进度表
  const progressData = [
    ["项目", "状态", "完成度", "负责人", "开始日期", "截止日期", "备注"],
    ["用户认证模块", "✅ 完成", "100%", "陈强", "2026-06-16", "2026-06-20", "OAuth2 + JWT，已联调通过"],
    ["BUG-201 Safari样式", "✅ 完成", "100%", "赵丽", "2026-06-16", "2026-06-17", "gap 兼容性问题"],
    ["BUG-205 Token刷新", "✅ 完成", "100%", "刘伟", "2026-06-16", "2026-06-17", "过期处理优化"],
    ["BUG-210 密码重置", "✅ 完成", "100%", "刘伟", "2026-06-16", "2026-06-18", "改用异步队列"],
    ["登录页面 UI", "✅ 完成", "100%", "赵丽", "2026-06-16", "2026-06-16", "参考设计稿"],
    ["E2E 测试", "🔄 进行中", "80%", "杨飞", "2026-06-16", "2026-06-27", "并发测试待完成"],
    ["支付系统技术方案", "✅ 完成", "100%", "陈强、刘伟", "2026-06-16", "2026-06-20", "初稿已完成"],
    ["支付系统开发", "⏳ 未开始", "0%", "陈强、刘伟", "2026-06-23", "2026-07-04", "待设计评审"],
    ["知识源连接状态组件", "✅ 完成", "100%", "赵丽", "2026-06-18", "2026-06-18", "已集成到 Dashboard"],
    ["Token 刷新竞态修复", "✅ 完成", "100%", "刘伟", "2026-06-19", "2026-06-19", "并发 100 请求测试通过"],
  ];
  const progressWs = XLSX.utils.aoa_to_sheet(progressData);
  progressWs["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  const progressWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(progressWb, progressWs, "项目进度");

  // 2. Bug 统计表
  const bugData = [
    ["Bug ID", "标题", "优先级", "状态", "负责人", "创建日期", "修复日期", "模块"],
    ["BUG-201", "Safari 登录页面样式错乱", "高", "✅ 已修复", "赵丽", "2026-06-10", "2026-06-17", "前端"],
    ["BUG-205", "Token 刷新失败导致用户被踢出", "高", "✅ 已修复", "刘伟", "2026-06-11", "2026-06-17", "后端"],
    ["BUG-210", "密码重置邮件发送延迟", "高", "✅ 已修复", "刘伟", "2026-06-12", "2026-06-18", "后端"],
    ["BUG-215", "Token 刷新竞态导致 401", "高", "✅ 已修复", "刘伟", "2026-06-18", "2026-06-19", "前端"],
    ["BUG-216", "GitHub OAuth 回调超时", "中", "🔄 修复中", "刘伟", "2026-06-19", "", "后端"],
    ["BUG-217", "知识源状态更新延迟", "低", "⏳ 待修复", "赵丽", "2026-06-19", "", "前端"],
    ["BUG-218", "大文档生成超时", "中", "⏳ 待修复", "陈强", "2026-06-20", "", "后端"],
    ["BUG-219", "评估报告图表显示异常", "低", "⏳ 待修复", "赵丽", "2026-06-20", "", "前端"],
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

  // 3. Sprint 燃尽图数据
  const burndownData = [
    ["Sprint", "日期", "剩余工作量（故事点）", "已完成", "新增"],
    ["Sprint 1", "2026-06-02", 42, 0, 42],
    ["Sprint 1", "2026-06-03", 38, 4, 0],
    ["Sprint 1", "2026-06-04", 30, 8, 0],
    ["Sprint 1", "2026-06-05", 20, 10, 0],
    ["Sprint 1", "2026-06-06", 0, 20, 0],
    ["Sprint 2", "2026-06-09", 51, 0, 51],
    ["Sprint 2", "2026-06-10", 45, 6, 0],
    ["Sprint 2", "2026-06-11", 35, 10, 0],
    ["Sprint 2", "2026-06-12", 22, 13, 0],
    ["Sprint 2", "2026-06-13", 0, 22, 0],
    ["Sprint 3", "2026-06-16", 47, 0, 47],
    ["Sprint 3", "2026-06-17", 40, 7, 0],
    ["Sprint 3", "2026-06-18", 30, 10, 0],
    ["Sprint 3", "2026-06-19", 15, 15, 0],
    ["Sprint 3", "2026-06-20", 0, 15, 0],
    ["Sprint 4", "2026-06-23", 55, 0, 55],
    ["Sprint 4", "2026-06-24", 45, 10, 0],
    ["Sprint 4", "2026-06-25", 30, 15, 0],
    ["Sprint 4", "2026-06-26", 12, 18, 0],
    ["Sprint 4", "2026-06-27", 0, 12, 0],
  ];
  const burndownWs = XLSX.utils.aoa_to_sheet(burndownData);
  burndownWs["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 8 }];
  const burndownWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(burndownWb, burndownWs, "燃尽图数据");
  const burndownPath = path.join(SAMPLES_DIR, "spreadsheets", "Sprint燃尽图数据.xlsx");
  const burndownXlsx = XLSX.write(burndownWb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(burndownPath, Buffer.from(burndownXlsx));
  console.log("  ✅ spreadsheets/Sprint燃尽图数据.xlsx");

  // 4. 客户反馈跟踪表
  const feedbackData = [
    ["用户", "角色", "NPS", "最喜欢的功能", "建议", "优先级", "状态"],
    ["用户 A", "PM", 9, "溯源功能", "支持 Confluence/Notion", "P1", "已排期"],
    ["用户 B", "Engineer", 8, "RAG 检索准确率", "支持代码片段生成", "P2", "评估中"],
    ["用户 C", "Consultant", 7, "文档生成速度", "支持自定义模板", "P1", "已排期"],
    ["Acme Corp", "企业客户", 8, "SSO 集成", "批量文档生成", "P0", "开发中"],
  ];
  const feedbackWs = XLSX.utils.aoa_to_sheet(feedbackData);
  feedbackWs["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 8 }, { wch: 10 }];
  const feedbackWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(feedbackWb, feedbackWs, "客户反馈");
  const feedbackPath = path.join(SAMPLES_DIR, "spreadsheets", "客户反馈跟踪表.xlsx");
  const feedbackXlsx = XLSX.write(feedbackWb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(feedbackPath, Buffer.from(feedbackXlsx));
  console.log("  ✅ spreadsheets/客户反馈跟踪表.xlsx");
} catch (e) {
  console.log("  ⚠️ xlsx 库未安装，跳过 Excel 生成");
}

// 6. PPT 文件 (3 份) — 使用 python-pptx 生成以确保兼容性
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
