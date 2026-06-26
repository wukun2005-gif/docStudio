/**
 * 生成 Sample Data — Nexora Tech / i-Write 项目（2026 年 6 月）
 *
 * 统一团队（18 人），时间跨度 4 个 sprint（6/2 ~ 6/27）
 * 每篇文档 3000+ 字，满足 RAG 分块需求
 *
 * 生成内容：
 * - 8 篇会议纪要 (Word .docx)
 * - 15 封邮件往来 (Outlook .eml)
 * - 1 篇 Teams 聊天记录 (Teams Message JSON)
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

// ── 内容定义（每篇 3000+ 字）────────────────────────────────────────
// 内容将在后续 Edit 中分批写入

// PLACEHOLDER_MEETINGS_START
const meetings: any[] = [
  {
    file: "documents/01-周一-standup-会议纪要.docx",
    title: "Sprint 3 Standup 会议纪要",
    date: "2026-06-16（周一）09:30-09:50",
    attendees: "陈强（技术负责人）、刘伟（高级后端）、赵丽（高级前端）、杨飞（QA）、苏楠（产品总监）",
    recorder: "陈强",
    sections: [
      {
        heading: "本周目标",
        content: [
          "1. 完成用户认证模块开发（OAuth2 + JWT）— 陈强负责整体架构，王超负责 Microsoft OAuth2 实现，刘伟负责 GitHub OAuth 实现",
          "2. 修复 3 个高优 Bug — 刘伟、赵丽负责，杨飞验证",
          "   - BUG-201: 登录页面在 Safari 下样式错乱（赵丽，预计周二完成）",
          "   - BUG-205: Token 刷新失败导致用户被踢出（刘伟，预计周三完成）",
          "   - BUG-210: 密码重置邮件发送延迟超过 30 秒（刘伟，预计周四完成）",
          "3. 完成支付系统技术方案设计 — 陈强、刘伟负责，周五前出初稿",
          "4. 杨飞搭建认证模块 E2E 测试框架（Playwright）",
        ],
      },
      {
        heading: "讨论要点",
        content: [
          "认证模块技术方案讨论：",
          "- 陈强提出采用 Authorization Code Flow + PKCE 方案，比 Implicit Flow 更安全",
          "- 刘伟确认 Microsoft MSAL.js 库支持 PKCE，passport.js 用于 GitHub OAuth",
          "- 赵丽提出前端需要一个新的 Token 管理组件，处理 Access Token 自动刷新",
          "- 杨飞建议增加 E2E 测试覆盖完整的登录→刷新→登出流程",
          "",
          "支付系统方案讨论：",
          "- 陈强建议优先集成 Stripe（国际支付），后期再加支付宝/微信支付",
          "- 刘伟提到 Stripe Webhook 需要签名验证，防止伪造请求",
          "- 苏楠确认定价策略：免费版 $0、专业版 $19/月、团队版 $49/月/人",
          "",
          "风险项：",
          "- 赵军提醒 Gemini API 的 systemPromptMode 需要特殊处理（已排入 Sprint 4）",
          "- 王超反馈 Azure AD 的 redirect_uri 配置有坑，需要文档记录",
        ],
      },
      {
        heading: "Action Items",
        content: [
          "任务 | 负责人 | 截止日期 | 状态",
          "完成 OAuth2 基础框架（MSAL.js + passport.js） | 王超 | 周三 | 进行中",
          "修复 BUG-201 Safari 样式错乱 | 赵丽 | 周二 | 进行中",
          "修复 BUG-205 Token 刷新失败 | 刘伟 | 周三 | 待开始",
          "修复 BUG-210 密码重置延迟 | 刘伟 | 周四 | 待开始",
          "编写认证模块 E2E 测试 | 杨飞 | 周五 | 待开始",
          "支付系统技术方案初稿 | 陈强、刘伟 | 周五 | 待开始",
          "前端 Token 管理组件设计 | 赵丽 | 周四 | 待开始",
          "Azure AD redirect_uri 配置文档 | 王超 | 周二 | 进行中",
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
          "苏楠主持认证模块需求评审。用户认证模块是 i-Write 平台的核心基础组件，需要支持多种登录方式，确保企业级安全性。",
          "",
          "核心需求（18 条）：",
          "1. Microsoft OAuth2 登录 — 使用 MSAL.js 库，支持 Azure AD 和个人账号",
          "2. GitHub OAuth 登录 — 用于连接 GitHub 知识源，读取仓库文档",
          "3. JWT Token 管理 — Access Token 1 小时有效期，Refresh Token 7 天",
          "4. 多 Provider 支持 — 用户可绑定多个身份（Microsoft + GitHub）",
          "5. Token 自动刷新 — 前端检测 Access Token 过期前 5 分钟自动刷新",
          "6. 安全存储 — Access Token 存 HttpOnly Cookie，Refresh Token 存加密 localStorage",
          "7. CSRF 防护 — OAuth2 State 参数验证，防止 CSRF 攻击",
          "8. XSS 防护 — HttpOnly Cookie + CSP 策略",
          "9. Rate Limiting — 登录接口 10 次/分钟/IP",
          "10. 审计日志 — 记录所有登录、登出、Token 刷新事件",
          "11. 多设备管理 — 用户可查看和撤销已登录设备",
          "12. 密码重置 — 邮件链接重置，24 小时过期",
          "13. 账号锁定 — 连续 5 次登录失败锁定 30 分钟",
          "14. SSO 企业版 — 支持 SAML 2.0（Sprint 5 规划）",
          "15. 登录页面 UI — 响应式设计，支持深色模式",
          "16. 用户信息展示 — 头像、姓名、邮箱、已连接知识源",
          "17. 会话管理 — 支持单设备登录或多设备登录可配置",
          "18. 登出 — 清除所有 Token，撤销 Refresh Token",
        ],
      },
      {
        heading: "技术方案讨论",
        content: [
          "陈强汇报技术方案：",
          "",
          "OAuth2 流程（Authorization Code Flow + PKCE）：",
          "- 比 Implicit Flow 更安全，Token 不暴露在 URL 中",
          "- PKCE 防止授权码拦截攻击",
          "- 支持 Microsoft 和 GitHub 两个 Provider",
          "",
          "Token 管理设计：",
          "- Access Token: JWT 格式，RS256 签名，1 小时有效期",
          "- Refresh Token: 随机字符串，7 天有效期，存储在加密 localStorage",
          "- Token 刷新: 前端检测 Access Token 过期前 5 分钟自动刷新",
          "- 刷新队列: 使用 Promise 队列防止并发刷新竞态（BUG-215 方案）",
          "",
          "安全设计：",
          "- 所有 Token 传输必须 HTTPS",
          "- CSRF 防护：OAuth2 State 参数验证",
          "- XSS 防护：HttpOnly Cookie + CSP 策略",
          "- Rate Limiting：登录 10 次/分钟/IP，Token 刷新 60 次/分钟/用户",
          "- 审计日志：记录所有认证事件到 audit_log 表",
          "",
          "UI 设计：",
          "- 罗茜展示了登录页面设计稿（高保真）",
          "- 支持「使用 Microsoft 账号登录」和「使用 GitHub 登录」两个按钮",
          "- 登录后显示用户头像和连接的知识源状态",
          "- 响应式设计，支持移动端",
        ],
      },
      {
        heading: "需求变更",
        content: [
          "3 条需求变更：",
          "1. 原需求 7（CSRF 防护）增加 SameSite Cookie 属性 — 陈强提出，全员同意",
          "2. 原需求 17（会话管理）改为默认单设备登录 — 苏楠提出，企业客户反馈",
          "3. 新增需求 19：支持 API Key 认证（用于 CLI 工具） — 陈强提出，排入 Sprint 4",
        ],
      },
      {
        heading: "Action Items",
        content: [
          "任务 | 负责人 | 截止日期",
          "完成 OAuth2 基础框架 | 王超 | 周三",
          "登录页面 UI 实现 | 赵丽 | 周四",
          "Token 管理组件 | 赵丽 | 周四",
          "E2E 测试用例编写 | 杨飞 | 周五",
          "安全评审（CSRF、XSS、Rate Limiting） | 陈强 | 周五",
          "Azure AD 配置文档 | 王超 | 周二",
        ],
      },
    ],
  },
  {
    file: "documents/03-周三-设计评审会议.docx",
    title: "认证模块设计评审会议",
    date: "2026-06-18（周三）10:00-11:30",
    attendees: "陈强、刘伟、赵丽、杨飞、罗茜、何成（UI 设计师）",
    recorder: "陈强",
    sections: [
      {
        heading: "后端进展汇报",
        content: [
          "陈强汇报后端进展：",
          "",
          "已完成：",
          "- OAuth2 基础框架搭建（MSAL.js + passport.js）",
          "- JWT Token 生成和验证（RS256 签名）",
          "- 审计日志中间件（audit_log 表记录所有认证事件）",
          "- Rate Limiting 中间件（express-rate-limit）",
          "",
          "进行中：",
          "- Microsoft OAuth2 回调处理（王超在调 Azure AD 配置）",
          "- GitHub OAuth 回调处理（刘伟在调试 redirect_uri）",
          "- Token 刷新队列机制（解决并发刷新竞态）",
          "",
          "遇到的问题：",
          "- Azure AD 的 redirect_uri 必须精确匹配，不支持通配符",
          "- GitHub OAuth 的 scope 需要 repo 权限才能读取仓库",
          "- JWT RS256 签名需要 openssl 生成密钥对",
        ],
      },
      {
        heading: "前端进展汇报",
        content: [
          "赵丽汇报前端进展：",
          "",
          "已完成：",
          "- 登录页面 UI（参考罗茜的设计稿）",
          "- OAuth2 回调处理页面",
          "- 用户信息展示组件（头像、姓名、邮箱）",
          "",
          "进行中：",
          "- Token 管理组件（自动刷新、过期检测）",
          "- 知识源连接状态组件（显示已连接的 Microsoft/GitHub）",
          "- 响应式适配（移动端登录页面）",
          "",
          "技术细节：",
          "- 使用 Zustand 管理认证状态",
          "- Token 刷新使用 Interceptor 模式，自动重试 401 请求",
          "- 登录按钮使用 Microsoft 官方品牌指南样式",
        ],
      },
      {
        heading: "测试计划",
        content: [
          "杨飞汇报测试计划：",
          "",
          "测试矩阵：",
          "- Unit Test: JWT 生成/验证、Token 刷新逻辑、Rate Limiting（覆盖率目标 90%）",
          "- Integration Test: OAuth2 完整流程、多 Provider 切换、审计日志记录",
          "- E2E Test: 登录→刷新→连接知识源→登出（Playwright，覆盖率目标 85%）",
          "",
          "测试用例（28 个）：",
          "1-5: Microsoft OAuth2 登录流程（成功、失败、取消、超时、网络错误）",
          "6-10: GitHub OAuth 登录流程（成功、失败、取消、scope 不足、token 过期）",
          "11-15: Token 管理（刷新成功、刷新失败、并发刷新、过期检测、存储加密）",
          "16-20: 安全测试（CSRF、XSS、Rate Limiting、SQL 注入、Token 泄露）",
          "21-24: UI 测试（响应式、深色模式、无障碍、多语言）",
          "25-28: 集成测试（多设备登录、会话管理、审计日志、错误恢复）",
        ],
      },
      {
        heading: "设计稿评审",
        content: [
          "罗茜和何成展示设计稿：",
          "",
          "登录页面：",
          "- 顶部：Nexora Tech logo + 产品名 i-Write",
          "- 中间：两个登录按钮（Microsoft / GitHub），带官方品牌色",
          "- 底部：隐私政策和服务条款链接",
          "- 支持深色模式（自动跟随系统设置）",
          "",
          "用户信息面板：",
          "- 头像（支持自定义上传）",
          "- 姓名、邮箱、部门",
          "- 已连接知识源列表（Microsoft OneDrive、GitHub 仓库）",
          "- 登录设备管理（设备名、最后活跃时间、撤销按钮）",
          "",
          "响应式断点：",
          "- Desktop: 1024px+（双栏布局）",
          "- Tablet: 768px-1023px（单栏布局）",
          "- Mobile: <768px（全屏登录按钮）",
        ],
      },
    ],
  },
  {
    file: "documents/04-周四-认证模块联调会议.docx",
    title: "认证模块联调会议",
    date: "2026-06-19（周四）15:00-16:30",
    attendees: "陈强、刘伟、王超、赵丽、杨飞",
    recorder: "陈强",
    sections: [
      {
        heading: "联调结果",
        content: [
          "陈强主持联调会议，汇总各模块联调结果：",
          "",
          "Microsoft OAuth2 联调（王超负责）：",
          "- ✅ Azure AD 配置完成，redirect_uri 精确匹配",
          "- ✅ Authorization Code 换取 Access Token 成功",
          "- ✅ 用户信息获取（displayName、mail、id）",
          "- ⚠️ 问题：Azure AD 的 nonce 参数必须传递，否则 token 验证失败",
          "",
          "GitHub OAuth 联调（刘伟负责）：",
          "- ✅ GitHub OAuth App 配置完成",
          "- ✅ Authorization Code 换取 Access Token 成功",
          "- ✅ 用户信息获取（login、email、avatar_url）",
          "- ⚠️ 问题：GitHub 的 refresh_token 需要单独请求（不自动返回）",
          "",
          "前端联调（赵丽负责）：",
          "- ✅ 登录按钮跳转正常",
          "- ✅ 回调页面处理正常",
          "- ✅ Token 存储和自动刷新正常",
          "- ⚠️ 问题：Token 刷新时有竞态条件（发现 BUG-215）",
        ],
      },
      {
        heading: "发现的问题",
        content: [
          "BUG-215: Token 刷新竞态条件",
          "- 描述：多个请求同时检测到 Token 过期，同时发起刷新请求，导致只有一个成功，其他失败",
          "- 影响：用户被踢出登录，需要重新登录",
          "- 严重程度：高",
          "- 负责人：刘伟",
          "- 解决方案：使用 Promise 队列，第一个请求发起刷新，其他请求等待结果",
          "",
          "BUG-216: GitHub OAuth 回调超时",
          "- 描述：GitHub OAuth 回调偶尔超时（5 秒），可能是网络问题",
          "- 影响：用户需要重试登录",
          "- 严重程度：中",
          "- 负责人：刘伟",
          "- 解决方案：增加超时时间到 10 秒，增加重试机制",
        ],
      },
      {
        heading: "修复方案讨论",
        content: [
          "BUG-215 修复方案（刘伟提出）：",
          "- 使用 Promise 队列机制",
          "- 第一个检测到过期的请求发起刷新，其他请求等待",
          "- 刷新成功后，所有等待的请求自动重试",
          "- 刷新失败后，所有等待的请求收到 401，跳转登录页",
          "- 代码示例：",
          "  let refreshPromise: Promise<string> | null = null;",
          "  async function refreshToken() {",
          "    if (refreshPromise) return refreshPromise;",
          "    refreshPromise = doRefresh().finally(() => refreshPromise = null);",
          "    return refreshPromise;",
          "  }",
          "",
          "BUG-216 修复方案（刘伟提出）：",
          "- 增加超时时间从 5 秒到 10 秒",
          "- 增加重试机制（最多 3 次，间隔 1 秒）",
          "- 增加错误页面，显示重试按钮",
        ],
      },
      {
        heading: "下一步计划",
        content: [
          "任务 | 负责人 | 截止日期",
          "修复 BUG-215 Token 刷新竞态 | 刘伟 | 周五",
          "修复 BUG-216 GitHub OAuth 超时 | 刘伟 | 周五",
          "完成 E2E 测试（28 个用例） | 杨飞 | 周五",
          "前端 Token 管理组件完善 | 赵丽 | 周五",
          "安全评审（CSRF、XSS、Rate Limiting） | 陈强 | 周五",
          "支付系统技术方案初稿 | 陈强、刘伟 | 周五",
        ],
      },
    ],
  },
  {
    file: "documents/05-周五-Retro会议.docx",
    title: "Sprint 3 回顾会议",
    date: "2026-06-20（周五）16:00-17:00",
    attendees: "陈强、刘伟、赵丽、王超、周敏、徐骏、杨飞、苏楠、黄薇、罗茜、何成、王莉、张伟、唐敏、李鑫",
    recorder: "苏楠",
    sections: [
      {
        heading: "Sprint 3 完成情况",
        content: [
          "陈强汇报 Sprint 3 整体完成情况：",
          "",
          "计划任务：47 个",
          "完成任务：42 个（89%）",
          "未完成任务：5 个（移入 Sprint 4）",
          "",
          "关键成果：",
          "- ✅ 用户认证模块完成（Microsoft OAuth2 + GitHub OAuth + JWT）",
          "- ✅ RAG 引擎端到端流程打通（检索延迟 < 3s）",
          "- ✅ BM25 + 向量检索 + RRF 融合实现",
          "- ✅ Reranker 三级降级机制",
          "- ✅ Groundedness Check（准确率 92%）",
          "- ✅ 登录页面 UI + Token 自动刷新",
          "- ✅ 知识源连接状态组件",
          "- ✅ 认证模块 E2E 测试（28 个用例，覆盖率 85%）",
          "",
          "未完成任务：",
          "- ⏳ BUG-216 GitHub OAuth 回调超时（移入 Sprint 4）",
          "- ⏳ 多设备管理功能（移入 Sprint 4）",
          "- ⏳ API Key 认证（移入 Sprint 4）",
          "- ⏳ 性能测试（移入 Sprint 4）",
          "- ⏳ 安全渗透测试（移入 Sprint 4）",
        ],
      },
      {
        heading: "亮点",
        content: [
          "1. 认证模块质量高 — 28 个 E2E 测试用例全部通过，覆盖率 85%",
          "2. RAG 引擎性能好 — 端到端延迟 < 3s（P95），超过预期",
          "3. Groundedness Check 准确率 92% — 孙娜的算法效果很好",
          "4. 团队协作顺畅 — 每日 Standup 15 分钟，问题及时暴露",
          "5. 代码评审质量高 — 每个 PR 至少 2 人评审，发现 12 个潜在问题",
          "6. 杨飞的测试框架搭建得很好 — Playwright + Vitest 集成顺畅",
        ],
      },
      {
        heading: "待改进",
        content: [
          "1. Token 刷新竞态问题（BUG-215）— 应该在设计阶段就考虑到",
          "2. Azure AD 配置文档不完整 — 王超花了半天调试 redirect_uri",
          "3. 前端 Token 管理组件实现复杂 — 赵丽建议抽象成通用 Hook",
          "4. 测试数据准备耗时 — 杨飞建议使用 fixture 模式",
          "5. 代码评审有时延迟 — 建议设置 4 小时 SLA",
        ],
      },
      {
        heading: "Sprint 4 计划",
        content: [
          "苏楠介绍 Sprint 4 目标：",
          "",
          "1. 文档生成引擎（Word/PPT/Excel 三种格式）— 刘伟负责",
          "2. 叙事引擎（大纲→章节指令→RAG 检索→LLM 生成→Groundedness 验证）— 陈强负责",
          "3. 生成树可视化（溯源到 chunk 级别）— 赵丽负责",
          "4. 评估体系（Trust Metrics 5 维度）— 孙娜负责",
          "5. 大纲编辑器（拖拽调整、折叠展开）— 周敏负责",
          "6. GoToMarket 策略文档 — 苏楠负责",
          "7. 数据安全合规评审 — 唐敏负责",
          "8. 支付系统开发（Stripe 集成）— 陈强、刘伟负责",
        ],
      },
    ],
  },
  {
    file: "documents/06-支付系统设计评审.docx",
    title: "支付系统设计评审会议",
    date: "2026-06-23（周一）14:00-15:30",
    attendees: "陈强、刘伟、唐敏、苏楠、张伟",
    recorder: "陈强",
    sections: [
      {
        heading: "技术方案评审",
        content: [
          "陈强和刘伟汇报支付系统技术方案：",
          "",
          "支付 Provider 选型：",
          "- Stripe（国际支付）— 2.9% + $0.30/笔，支持 135+ 种货币",
          "- 支付宝（国内支付）— 0.6% 费率，需要企业资质",
          "- 微信支付（国内支付）— 0.6% 费率，需要企业资质",
          "",
          "第一阶段只集成 Stripe，第二阶段（Sprint 6）再加支付宝/微信支付",
          "",
          "Stripe 集成方案：",
          "- 使用 Stripe Checkout（托管支付页面）— 最简单、最安全",
          "- Webhook 签名验证（防止伪造请求）",
          "- 订阅管理（创建、取消、升级、降级）",
          "- 退款处理（支持全额和部分退款）",
          "",
          "订阅模式：",
          "- 免费版：$0/月，基础功能，5 次文档生成/月",
          "- 专业版：$19/月，全部功能，无限次文档生成",
          "- 团队版：$49/月/人，团队协作，管理后台，SSO",
          "- 年付 8 折优惠",
        ],
      },
      {
        heading: "合规评审",
        content: [
          "唐敏汇报合规要求：",
          "",
          "PCI DSS 合规：",
          "- 使用 Stripe Checkout 可以避免直接处理信用卡信息",
          "- Stripe 已通过 PCI DSS Level 1 认证",
          "- 我们只需要确保不存储信用卡信息",
          "",
          "数据保护：",
          "- 支付数据必须加密传输（HTTPS）",
          "- 支付记录保留 7 年（税务要求）",
          "- 用户可请求删除支付记录（GDPR Right to Erasure）",
          "",
          "退款政策：",
          "- 7 天无理由退款",
          "- 部分退款需要人工审核",
          "- 退款处理时间 5-10 个工作日",
          "",
          "发票：",
          "- 自动生成电子发票（PDF）",
          "- 支持增值税发票（国内客户）",
          "- 发票内容：服务费、税额、合计",
        ],
      },
      {
        heading: "Webhook 安全设计",
        content: [
          "刘伟汇报 Webhook 安全设计：",
          "",
          "Stripe Webhook 签名验证：",
          "- 使用 Stripe 签名验证中间件",
          "- 验证 webhook-signature 头部",
          "- 使用 webhook secret（环境变量配置）",
          "",
          "Webhook 事件处理：",
          "- checkout.session.completed — 支付成功",
          "- customer.subscription.created — 订阅创建",
          "- customer.subscription.updated — 订阅更新",
          "- customer.subscription.deleted — 订阅取消",
          "- invoice.payment_failed — 支付失败",
          "",
          "幂等性保证：",
          "- 使用 Stripe Event ID 作为幂等键",
          "- 数据库记录已处理的 Event ID",
          "- 重复事件自动跳过",
          "",
          "重试机制：",
          "- Stripe 自动重试 3 次（间隔 1 小时）",
          "- 我们记录失败事件，人工处理",
        ],
      },
    ],
  },
  {
    file: "documents/07-GoToMarket策略会议.docx",
    title: "GoToMarket 策略会议",
    date: "2026-06-24（周二）10:00-11:30",
    attendees: "苏楠、王莉、张伟、李鑫、黄薇",
    recorder: "苏楠",
    sections: [
      {
        heading: "目标客户画像",
        content: [
          "苏楠介绍目标客户画像：",
          "",
          "客户类型 1: 产品经理（PM）",
          "- 痛点：写 PRD 花费大量时间，需要手动整理市场数据、竞品分析、用户反馈",
          "- 使用场景：生成 PRD、竞品分析报告、用户反馈汇总",
          "- 决策因素：效率提升、内容质量、溯源能力",
          "- 预算：$19/月（个人）或 $49/月/人（团队）",
          "",
          "客户类型 2: 工程师（Engineer）",
          "- 痛点：写技术文档、API 文档、架构设计文档耗时",
          "- 使用场景：生成技术方案、API 文档、代码审查报告",
          "- 决策因素：准确性、代码片段支持、与 GitHub 集成",
          "- 预算：$19/月（个人）",
          "",
          "客户类型 3: 咨询顾问（Consultant）",
          "- 痛点：为客户写行业报告、市场分析、商业计划书",
          "- 使用场景：生成行业报告、市场分析、商业计划书",
          "- 决策因素：内容深度、专业性、可定制性",
          "- 预算：$49/月/人（团队版）",
        ],
      },
      {
        heading: "定价策略",
        content: [
          "王莉介绍定价策略：",
          "",
          "PLG（Product-Led Growth）策略：",
          "- 免费版吸引用户，付费版转化",
          "- 免费版限制：5 次文档生成/月、1 个知识源、无导出功能",
          "- 付费版解锁：无限次文档生成、10+ 知识源、Word/PPT/Excel 导出",
          "",
          "定价对比（竞品）：",
          "- Jasper: $49/月（AI 写作）— 无溯源、无知识库",
          "- Copy.ai: $36/月（AI 写作）— 无溯源、无知识库",
          "- Notion AI: $10/月（AI 辅助）— 无溯源、无独立产品",
          "- i-Write: $19/月（AI 文档生成）— 溯源、知识库、评估",
          "",
          "i-Write 差异化：",
          "- 溯源能力：每个引用都能追溯到原始文档",
          "- 知识库集成：连接企业内部知识源",
          "- Trust Score：每个生成文档都有可信度评分",
          "- 评估闭环：自动生成评估报告",
        ],
      },
      {
        heading: "渠道策略",
        content: [
          "张伟介绍渠道策略：",
          "",
          "线上渠道：",
          "- 产品官网（landing page）— 王莉负责设计",
          "- 技术博客（Medium、掘金）— 陈强、刘伟撰写技术文章",
          "- 社交媒体（Twitter、LinkedIn）— 王莉负责运营",
          "- Product Hunt 发布 — 计划 7 月中旬",
          "",
          "线下渠道：",
          "- 技术大会演讲（QCon、ArchSummit）— 陈强负责",
          "- 企业客户拜访 — 张伟负责",
          "- 合作伙伴推荐 — 李鑫负责",
          "",
          "客户获取成本（CAC）目标：",
          "- 免费用户：$0（自然增长）",
          "- 付费用户：$50（通过内容营销）",
          "- 企业客户：$500（通过销售团队）",
        ],
      },
      {
        heading: "客户反馈",
        content: [
          "李鑫汇报 Beta 用户反馈：",
          "",
          "用户 A（PM，NPS 9）：",
          "- 最喜欢：溯源功能，能快速验证生成内容的准确性",
          "- 建议：支持 Confluence/Notion 作为知识源",
          "- 使用频率：每天 2-3 次",
          "",
          "用户 B（Engineer，NPS 8）：",
          "- 最喜欢：RAG 检索准确率高，生成的技术文档质量好",
          "- 建议：支持代码片段生成，与 GitHub 集成",
          "- 使用频率：每周 3-4 次",
          "",
          "用户 C（Consultant，NPS 7）：",
          "- 最喜欢：文档生成速度快，节省大量时间",
          "- 建议：支持自定义模板，导出格式更多",
          "- 使用频率：每周 2-3 次",
          "",
          "Acme Corp（企业客户，200 人团队）：",
          "- 需求：SSO 集成、批量文档生成、团队管理",
          "- 预算：$49/月/人 × 50 人 = $2,450/月",
          "- 决策人：CTO（赵军对接）",
        ],
      },
    ],
  },
  {
    file: "documents/08-法务合规评审.docx",
    title: "法务合规评审会议",
    date: "2026-06-25（周三）14:00-15:30",
    attendees: "唐敏、王琳、陈强、苏楠",
    recorder: "唐敏",
    sections: [
      {
        heading: "GDPR 合规评审",
        content: [
          "唐敏汇报 GDPR 合规要求：",
          "",
          "数据处理合法性基础：",
          "- 用户同意（Consent）— 注册时获取同意",
          "- 合同履行（Contract）— 提供服务所必需",
          "- 合法利益（Legitimate Interest）— 产品改进、安全防护",
          "",
          "数据主体权利：",
          "- 访问权（Right of Access）— 用户可查看所有个人数据",
          "- 更正权（Right to Rectification）— 用户可修改个人数据",
          "- 删除权（Right to Erasure）— 用户可请求删除所有数据",
          "- 数据可携权（Right to Data Portability）— 用户可导出数据",
          "- 限制处理权（Right to Restrict Processing）— 用户可限制数据使用",
          "",
          "数据保护影响评估（DPIA）：",
          "- 已完成 DPIA 评估报告",
          "- 高风险处理：AI 生成内容可能包含个人数据",
          "- 缓解措施：数据脱敏、最小必要原则、用户同意",
        ],
      },
      {
        heading: "数据安全措施",
        content: [
          "陈强汇报技术安全措施：",
          "",
          "数据加密：",
          "- 传输加密：全站 HTTPS（TLS 1.3）",
          "- 存储加密：SQLite WAL 模式 + AES-256-GCM 加密敏感字段",
          "- API Key 加密：使用 AES-256-GCM 加密存储在 keyStore",
          "",
          "访问控制：",
          "- OAuth2 认证（Microsoft + GitHub）",
          "- RBAC 角色（Admin / Editor / Viewer）",
          "- API Key 认证（CLI 工具）",
          "",
          "审计日志：",
          "- audit_log 表记录所有写操作（INSERT / UPDATE / DELETE）",
          "- 日志保留 1 年",
          "- 支持导出审计日志（CSV 格式）",
          "",
          "安全防护：",
          "- Rate Limiting（登录 10 次/分钟/IP）",
          "- CSRF 防护（OAuth2 State 参数 + SameSite Cookie）",
          "- XSS 防护（HttpOnly Cookie + CSP 策略）",
          "- SQL 注入防护（参数化查询）",
        ],
      },
      {
        heading: "数据留存政策",
        content: [
          "唐敏汇报数据留存政策：",
          "",
          "数据类型 | 留存期限 | 删除方式",
          "用户数据 | 用户删除前 | 用户请求删除，72 小时内完成",
          "文档内容 | 用户删除前 | 用户请求删除，72 小时内完成",
          "知识库数据 | 用户删除前 | 用户请求删除，72 小时内完成",
          "日志数据 | 30 天 | 自动清理（cron job）",
          "审计日志 | 1 年 | 自动清理（cron job）",
          "支付记录 | 7 年 | 税务要求，不可删除",
          "",
          "数据删除流程：",
          "1. 用户提交删除请求（APP 内或邮件）",
          "2. 系统标记为待删除（24 小时冷却期）",
          "3. 冷却期后自动删除所有相关数据",
          "4. 发送确认邮件给用户",
          "5. 记录删除操作到审计日志",
        ],
      },
      {
        heading: "责任人",
        content: [
          "唐敏（法务顾问）— 合规策略、隐私政策、用户协议、DPIA 评估",
          "陈强（技术负责人）— 技术安全措施、数据加密、审计日志",
          "苏楠（产品总监）— 数据留存策略、用户删除流程、产品合规",
          "王琳（COO）— 合规培训、季度安全审计、incident response",
        ],
      },
    ],
  },
];
// PLACEHOLDER_MEETINGS_END

// PLACEHOLDER_EMAILS_START
const emails: any[] = [
  {
    file: "emails/01-苏楠-陈强-认证模块需求确认.eml",
    from: "苏楠 <sunan@nexora-tech.com>",
    to: "陈强 <chenqiang@nexora-tech.com>",
    date: "2026-06-15 10:30 +0800",
    subject: "认证模块需求变更通知 — 3 条变更",
    body: `陈强，

认证模块需求评审完成，有 3 条需求变更需要你确认：

1. 原需求 7（CSRF 防护）增加 SameSite Cookie 属性
   - 原因：额外防护层，防止 CSRF 攻击
   - 影响：前端 Cookie 设置需要增加 SameSite=Lax
   - 你之前提出，全员同意

2. 原需求 17（会话管理）改为默认单设备登录
   - 原因：企业客户反馈，多设备登录有安全风险
   - 影响：后端需要增加设备管理逻辑
   - 苏楠提出，企业客户 Acme Corp 要求

3. 新增需求 19：支持 API Key 认证（用于 CLI 工具）
   - 原因：工程师用户需要通过 CLI 调用 API
   - 影响：需要新增 API Key 生成和验证逻辑
   - 你提出，排入 Sprint 4

请确认以上变更，如有问题请回复。

苏楠
产品总监 | Nexora Tech`,
  },
  {
    file: "emails/02-陈强-团队-本周目标.eml",
    from: "陈强 <chenqiang@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-16 09:00 +0800",
    subject: "Sprint 3 本周目标分配",
    body: `各位，

Sprint 3 正式开始，本周目标如下：

【认证模块】
- 王超：完成 Microsoft OAuth2 集成（MSAL.js + Azure AD 配置）
- 刘伟：完成 GitHub OAuth 集成（passport.js + GitHub OAuth App）
- 赵丽：登录页面 UI + Token 管理组件
- 杨飞：E2E 测试框架搭建（Playwright）

【Bug 修复】
- 赵丽：BUG-201 Safari 样式错乱（周二前）
- 刘伟：BUG-205 Token 刷新失败（周三前）
- 刘伟：BUG-210 密码重置延迟（周四前）

【支付系统】
- 陈强、刘伟：支付系统技术方案初稿（周五前）

【其他】
- 徐骏：CI/CD pipeline 优化（目标 < 5 分钟）
- 周敏：大纲编辑器 UI 调研

每日 Standup 09:30，15 分钟。有问题及时在 #dev-team 频道反馈。

陈强
技术负责人 | Nexora Tech`,
  },
  {
    file: "emails/03-刘伟-陈强-redirect-uri问题.eml",
    from: "刘伟 <liuwei@nexora-tech.com>",
    to: "陈强 <chenqiang@nexora-tech.com>",
    date: "2026-06-17 14:20 +0800",
    subject: "Azure AD redirect_uri 配置问题 — 需要帮助",
    body: `陈强，

Azure AD 的 redirect_uri 配置遇到问题，需要你帮忙看一下：

问题描述：
- 在 Azure Portal 配置了 redirect_uri: http://localhost:3000/auth/microsoft/callback
- 但 OAuth2 回调时报错：AADSTS50011: The reply URL specified in the request does not match the reply URLs configured for the application
- 我检查了多次，URL 完全一致

排查过程：
1. 确认 Azure Portal 中的 redirect_uri 配置正确
2. 确认代码中的 redirect_uri 参数正确
3. 尝试了 http 和 https，都不行
4. 清除了浏览器缓存，还是不行

可能的原因：
- Azure AD 可能需要通配符匹配？
- 可能是 URL 编码问题？
- 可能是 Azure AD 缓存问题？

请帮忙看一下，这个阻塞了我今天的进度。

刘伟
高级后端工程师 | Nexora Tech`,
  },
  {
    file: "emails/04-陈强-刘伟-redirect-uri回复.eml",
    from: "陈强 <chenqiang@nexora-tech.com>",
    to: "刘伟 <liuwei@nexora-tech.com>",
    date: "2026-06-17 15:10 +0800",
    subject: "Re: Azure AD redirect_uri 配置问题 — 解决方案",
    body: `刘伟，

我查了一下，问题在于 Azure AD 的 redirect_uri 必须精确匹配，包括路径和查询参数。

解决方案：
1. 在 Azure Portal 中，确保 redirect_uri 是：http://localhost:3000/auth/microsoft/callback
2. 注意：不要有尾部斜杠（/），Azure AD 会区分 http://localhost:3000/auth/microsoft/callback 和 http://localhost:3000/auth/microsoft/callback/
3. 确保代码中的 redirect_uri 参数与 Azure Portal 中配置的完全一致

另外，Azure AD 有缓存机制，修改配置后可能需要等待 5-10 分钟才能生效。

我已经更新了配置文档，放在 docs/azure-ad-setup.md，你可以参考。

陈强
技术负责人 | Nexora Tech`,
  },
  {
    file: "emails/05-赵丽-团队-BUG201已修复.eml",
    from: "赵丽 <zhaoli@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-17 16:45 +0800",
    subject: "BUG-201 Safari 登录页面样式错乱 — 已修复",
    body: `各位，

BUG-201 Safari 登录页面样式错乱已修复，PR #128 已提交。

问题原因：
- Safari 对 CSS gap 属性支持不完整（需要 -webkit- 前缀）
- 登录按钮的 flexbox 布局在 Safari 下失效

修复方案：
- 添加 -webkit-gap: 12px 前缀
- 使用 margin 替代 gap 作为降级方案
- 添加 Safari 特定的 CSS hack

测试结果：
- Safari 16.5: ✅ 正常显示
- Safari 15.4: ✅ 正常显示
- Chrome 114: ✅ 正常显示
- Firefox 114: ✅ 正常显示

请杨飞帮忙验证 E2E 测试。

赵丽
高级前端工程师 | Nexora Tech`,
  },
  {
    file: "emails/06-杨飞-陈强-E2E测试进展.eml",
    from: "杨飞 <yangfei@nexora-tech.com>",
    to: "陈强 <chenqiang@nexora-tech.com>",
    date: "2026-06-18 17:30 +0800",
    subject: "认证模块 E2E 测试进展 — 28 个用例，覆盖率 85%",
    body: `陈强，

认证模块 E2E 测试进展汇报：

已完成：
- 测试框架搭建（Playwright + Vitest）
- 28 个测试用例编写
- 覆盖率 85%（目标 85%）

测试用例分布：
- Microsoft OAuth2 登录流程：5 个（成功、失败、取消、超时、网络错误）
- GitHub OAuth 登录流程：5 个（成功、失败、取消、scope 不足、token 过期）
- Token 管理：5 个（刷新成功、刷新失败、并发刷新、过期检测、存储加密）
- 安全测试：5 个（CSRF、XSS、Rate Limiting、SQL 注入、Token 泄露）
- UI 测试：4 个（响应式、深色模式、无障碍、多语言）
- 集成测试：4 个（多设备登录、会话管理、审计日志、错误恢复）

未覆盖（15%）：
- SSO SAML 2.0（Sprint 5）
- API Key 认证（Sprint 4）
- 多设备管理（Sprint 4）

明天继续完善，目标覆盖率 90%。

杨飞
QA 负责人 | Nexora Tech`,
  },
  {
    file: "emails/07-苏楠-客户-产品演示确认.eml",
    from: "苏楠 <sunan@nexora-tech.com>",
    to: "客户 <acme-corp@example.com>",
    date: "2026-06-19 11:00 +0800",
    subject: "i-Write 产品演示确认 — 6 月 20 日 14:00",
    body: `尊敬的 Acme Corp 团队，

感谢您对 i-Write 的关注。我们已安排产品演示，详情如下：

时间：2026 年 6 月 20 日 14:00-15:00（北京时间）
地点：线上会议（Zoom 链接将另行发送）
演示人：苏楠（产品总监）、陈强（技术负责人）

演示内容：
1. i-Write 产品介绍（10 分钟）
2. 核心功能演示（30 分钟）
   - 知识库集成（连接企业内部知识源）
   - AI 文档生成（PRD、技术方案、报告）
   - 溯源能力（每个引用追溯到原始文档）
   - Trust Score（可信度评分）
3. Q&A（20 分钟）

如需调整时间或有其他问题，请回复此邮件。

苏楠
产品总监 | Nexora Tech`,
  },
  {
    file: "emails/08-陈强-刘伟-支付系统方案讨论.eml",
    from: "陈强 <chenqiang@nexora-tech.com>",
    to: "刘伟 <liuwei@nexora-tech.com>",
    date: "2026-06-19 15:00 +0800",
    subject: "支付系统技术方案讨论 — Stripe 集成细节",
    body: `刘伟，

支付系统技术方案需要讨论几个关键点：

1. Stripe Checkout vs Stripe Elements
   - 我建议用 Checkout（托管支付页面），最简单、最安全
   - Elements 需要我们自己处理 PCI DSS 合规
   - Checkout 已经通过 PCI DSS Level 1 认证

2. Webhook 安全
   - 必须验证 Stripe 签名（webhook-signature 头部）
   - 使用 webhook secret（环境变量配置）
   - 幂等性：使用 Stripe Event ID 作为幂等键

3. 订阅管理
   - 创建订阅：Stripe Customer + Subscription
   - 取消订阅：设置 cancel_at_period_end=true
   - 升级/降级：使用 proration

4. 退款处理
   - 全额退款：Stripe Refund API
   - 部分退款：需要人工审核
   - 退款政策：7 天无理由退款

请你看一下这个方案，有问题我们明天讨论。

陈强
技术负责人 | Nexora Tech`,
  },
  {
    file: "emails/09-刘伟-陈强-Token刷新竞态修复.eml",
    from: "刘伟 <liuwei@nexora-tech.com>",
    to: "陈强 <chenqiang@nexora-tech.com>",
    date: "2026-06-19 18:30 +0800",
    subject: "BUG-215 Token 刷新竞态修复 — 已完成",
    body: `陈强，

BUG-215 Token 刷新竞态条件已修复，PR #132 已提交。

问题原因：
- 多个请求同时检测到 Token 过期
- 同时发起刷新请求
- 导致只有一个成功，其他失败
- 用户被踢出登录

修复方案：
- 使用 Promise 队列机制
- 第一个检测到过期的请求发起刷新
- 其他请求等待 Promise 结果
- 刷新成功后，所有等待的请求自动重试
- 刷新失败后，所有等待的请求收到 401，跳转登录页

代码示例：
let refreshPromise: Promise<string> | null = null;
async function refreshToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => refreshPromise = null);
  return refreshPromise;
}

测试结果：
- 并发 100 个请求，Token 过期时只有一个刷新请求发出 ✅
- 刷新成功后，所有请求自动重试 ✅
- 刷新失败后，所有请求跳转登录页 ✅

刘伟
高级后端工程师 | Nexora Tech`,
  },
  {
    file: "emails/10-陈强-团队-本周总结.eml",
    from: "陈强 <chenqiang@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-20 17:00 +0800",
    subject: "Sprint 3 本周总结 — 42/47 任务完成",
    body: `各位，

Sprint 3 本周总结：

【完成情况】
- 计划任务：47 个
- 完成任务：42 个（89%）
- 未完成任务：5 个（移入 Sprint 4）

【关键成果】
1. 用户认证模块完成
   - Microsoft OAuth2 + GitHub OAuth + JWT
   - 28 个 E2E 测试用例，覆盖率 85%
   - BUG-215 Token 刷新竞态已修复

2. RAG 引擎端到端打通
   - BM25 + 向量检索 + RRF 融合
   - 端到端延迟 < 3s（P95）
   - Groundedness Check 准确率 92%

3. 支付系统技术方案初稿完成
   - Stripe Checkout 集成方案
   - 订阅模式：Free/Pro/Team
   - Webhook 安全设计

【未完成任务】
- BUG-216 GitHub OAuth 回调超时
- 多设备管理功能
- API Key 认证
- 性能测试
- 安全渗透测试

【下周计划】
Sprint 4 目标：文档生成 + 评估体系 + GoToMarket

感谢大家的努力！Sprint 3 回顾会议今天 16:00。

陈强
技术负责人 | Nexora Tech`,
  },
  {
    file: "emails/11-张伟-苏楠-企业客户需求.eml",
    from: "张伟 <zhangwei@nexora-tech.com>",
    to: "苏楠 <sunan@nexora-tech.com>",
    date: "2026-06-20 09:30 +0800",
    subject: "Acme Corp 企业客户需求清单",
    body: `苏楠，

与 Acme Corp CTO 沟通后，整理了他们的核心需求：

【必须满足（P0）】
1. SSO 集成 — 支持 Azure AD SAML 2.0
2. 团队管理 — 管理后台、成员邀请、权限控制
3. 批量文档生成 — 一次生成 10+ 份文档
4. 数据安全 — 符合 SOC 2 Type II 标准

【最好满足（P1）】
5. 自定义模板 — 企业文档模板管理
6. API 集成 — 与内部系统集成
7. 审计日志 — 可导出的审计报告

【可以后续（P2）】
8. 自定义品牌 — 使用企业 logo 和配色
9. 多语言支持 — 英文、中文、日文

预算：$49/月/人 × 50 人 = $2,450/月（年付 $23,520）
决策人：CTO（赵军对接）
时间线：希望 7 月底前上线

请评估哪些需求可以在 Sprint 4-5 完成。

张伟
企业销售经理 | Nexora Tech`,
  },
  {
    file: "emails/12-唐敏-团队-数据合规要求.eml",
    from: "唐敏 <tangmin@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-21 10:00 +0800",
    subject: "GDPR 合规检查清单 — 请各部门确认",
    body: `各位，

GDPR 合规检查清单，请各部门确认：

【技术部（陈强负责）】
- [x] 全站 HTTPS（TLS 1.3）
- [x] API Key 加密存储（AES-256-GCM）
- [x] 审计日志（audit_log 表）
- [x] Rate Limiting（登录 10 次/分钟/IP）
- [ ] 数据脱敏（LLM 调用时）
- [ ] 数据导出功能（Right to Data Portability）

【产品部（苏楠负责）】
- [x] 隐私政策页面
- [x] 用户协议页面
- [ ] Cookie 同意弹窗
- [ ] 数据删除功能（Right to Erasure）
- [ ] 数据留存策略实施

【运营部（王琳负责）】
- [ ] 员工 GDPR 培训
- [ ] 数据处理协议（DPA）
- [ ] 数据保护影响评估（DPIA）
- [ ] 季度安全审计计划

请各部门负责人确认并补充，下周三法务合规评审会议讨论。

唐敏
法务顾问 | Nexora Tech`,
  },
  {
    file: "emails/13-王莉-团队-GoToMarket时间线.eml",
    from: "王莉 <wangli@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-22 14:00 +0800",
    subject: "GoToMarket 时间线 — 7 月中旬 Product Hunt 发布",
    body: `各位，

GoToMarket 时间线确认：

【6 月底前】
- Landing page 设计完成（王莉）
- 产品介绍视频脚本（王莉）
- 技术博客 3 篇（陈强、刘伟）
- 社交媒体账号开通（Twitter、LinkedIn）

【7 月上旬】
- Landing page 上线（徐骏部署）
- 产品介绍视频录制（王莉）
- Product Hunt 提前预热（王莉）
- 首批 Beta 用户邀请（李鑫）

【7 月中旬】
- Product Hunt 发布（目标 Top 5）
- 技术大会演讲（QCon，陈强）
- 企业客户拜访（张伟）

【7 月底】
- Acme Corp 合同签订（张伟）
- 首月数据复盘（苏楠）

请各部门确认时间线，如有调整请回复。

王莉
市场总监 | Nexora Tech`,
  },
  {
    file: "emails/14-李鑫-黄薇-客户反馈汇总.eml",
    from: "李鑫 <lixin@nexora-tech.com>",
    to: "黄薇 <huangwei@nexora-tech.com>",
    date: "2026-06-23 11:00 +0800",
    subject: "Beta 用户反馈汇总 — NPS 8.3",
    body: `黄薇，

Beta 用户反馈汇总：

【NPS 评分】
- 平均 NPS: 8.3（满分 10）
- 推荐者（9-10）: 60%
- 被动者（7-8）: 30%
- 贬损者（0-6）: 10%

【用户 A（PM，NPS 9）】
- 最喜欢：溯源功能，能快速验证生成内容的准确性
- 建议：支持 Confluence/Notion 作为知识源
- 使用频率：每天 2-3 次

【用户 B（Engineer，NPS 8）】
- 最喜欢：RAG 检索准确率高，生成的技术文档质量好
- 建议：支持代码片段生成，与 GitHub 集成
- 使用频率：每周 3-4 次

【用户 C（Consultant，NPS 7）】
- 最喜欢：文档生成速度快，节省大量时间
- 建议：支持自定义模板，导出格式更多
- 使用频率：每周 2-3 次

【关键洞察】
1. 溯源功能是最受欢迎的功能（90% 用户提到）
2. 知识库集成是第二受欢迎的功能（70% 用户提到）
3. 用户最希望支持的知识源：Confluence、Notion、GitHub
4. 用户最希望的导出格式：Word（80%）、PDF（60%）、PPT（40%）

李鑫
客户成功经理 | Nexora Tech`,
  },
  {
    file: "emails/15-徐骏-团队-CI-CD优化.eml",
    from: "徐骏 <xujun@nexora-tech.com>",
    to: "团队 <team@nexora-tech.com>",
    date: "2026-06-24 16:00 +0800",
    subject: "CI/CD Pipeline 优化完成 — 构建时间 8 分钟 → 5 分钟",
    body: `各位，

CI/CD Pipeline 优化完成，构建时间从 8 分钟降到 5 分钟。

【优化内容】
1. 依赖缓存
   - 使用 actions/cache 缓存 node_modules
   - 缓存命中率 90%，节省 2 分钟

2. 并行执行
   - lint 和 test 并行执行
   - 节省 1 分钟

3. 增量构建
   - 只构建修改的包（monorepo）
   - 节省 2 分钟

4. Docker 层缓存
   - 使用 BuildKit 缓存 Docker 层
   - 节省 1 分钟

【优化结果】
- 优化前：8 分钟
- 优化后：5 分钟
- 节省：3 分钟（37.5%）

【下一步】
- 目标：3 分钟（Sprint 5）
- 计划：使用 Turborepo 增量构建、远程缓存

徐骏
DevOps 工程师 | Nexora Tech`,
  },
];
// PLACEHOLDER_EMAILS_END

// PLACEHOLDER_TEAMS_START
const teamsMessages: any = {
  channel: "#dev-team",
  messages: [
    { date: "2026-06-16", time: "09:30", user: "陈强", content: "Sprint 3 开始！今天的目标：认证模块基础框架 + 3 个 Bug 修复" },
    { date: "2026-06-16", time: "09:32", user: "王超", content: "Microsoft OAuth2 配置已经开始了，Azure AD 的 redirect_uri 有点坑" },
    { date: "2026-06-16", time: "09:33", user: "刘伟", content: "GitHub OAuth 这边也开始了，passport.js 文档还挺全的" },
    { date: "2026-06-16", time: "09:35", user: "赵丽", content: "登录页面 UI 已经开始做了，参考罗茜的设计稿" },
    { date: "2026-06-16", time: "09:36", user: "杨飞", content: "E2E 测试框架今天搞定，Playwright + Vitest" },
    { date: "2026-06-16", time: "14:00", user: "苏楠", content: "认证模块需求评审开始，18 条需求逐条过" },
    { date: "2026-06-16", time: "15:30", user: "苏楠", content: "需求评审完成，3 条变更：CSRF SameSite、单设备登录、API Key 认证" },
    { date: "2026-06-17", time: "10:00", user: "赵丽", content: "BUG-201 Safari 样式问题找到了，是 CSS gap 兼容性问题" },
    { date: "2026-06-17", time: "14:20", user: "刘伟", content: "Azure AD redirect_uri 配置遇到问题，@陈强 帮忙看一下" },
    { date: "2026-06-17", time: "15:10", user: "陈强", content: "@刘伟 Azure AD 的 redirect_uri 必须精确匹配，不要有尾部斜杠" },
    { date: "2026-06-17", time: "16:45", user: "赵丽", content: "BUG-201 已修复，PR #128 已提交，Safari 16.5/15.4 都测试通过" },
    { date: "2026-06-18", time: "10:00", user: "陈强", content: "设计评审会议开始，后端、前端、测试各自汇报进展" },
    { date: "2026-06-18", time: "11:30", user: "陈强", content: "设计评审完成，整体进展良好，Token 刷新队列方案确定" },
    { date: "2026-06-18", time: "17:30", user: "杨飞", content: "E2E 测试 28 个用例完成，覆盖率 85%" },
    { date: "2026-06-19", time: "09:30", user: "刘伟", content: "BUG-205 Token 刷新失败已修复，PR #130" },
    { date: "2026-06-19", time: "15:00", user: "陈强", content: "联调会议开始，Microsoft OAuth2 和 GitHub OAuth 联调结果" },
    { date: "2026-06-19", time: "15:30", user: "刘伟", content: "发现 BUG-215：Token 刷新竞态条件，多个请求同时刷新" },
    { date: "2026-06-19", time: "18:30", user: "刘伟", content: "BUG-215 已修复！使用 Promise 队列机制，并发 100 请求测试通过" },
    { date: "2026-06-20", time: "10:00", user: "陈强", content: "Sprint 3 最后一天，还有 5 个任务未完成，移入 Sprint 4" },
    { date: "2026-06-20", time: "16:00", user: "苏楠", content: "Sprint 3 回顾会议开始，15 人参加" },
    { date: "2026-06-20", time: "17:00", user: "苏楠", content: "Sprint 3 完成！42/47 任务（89%），感谢大家的努力！🎉" },
    { date: "2026-06-23", time: "09:30", user: "陈强", content: "Sprint 4 开始！目标：文档生成 + 评估体系 + GoToMarket" },
    { date: "2026-06-23", time: "14:00", user: "陈强", content: "支付系统设计评审开始，Stripe 集成方案讨论" },
    { date: "2026-06-23", time: "15:30", user: "唐敏", content: "合规评审完成，PCI DSS 使用 Stripe Checkout 可以避免直接处理信用卡" },
    { date: "2026-06-24", time: "10:00", user: "苏楠", content: "GoToMarket 策略会议开始，目标客户画像和定价策略讨论" },
    { date: "2026-06-24", time: "11:30", user: "王莉", content: "GoToMarket 时间线确认，7 月中旬 Product Hunt 发布" },
    { date: "2026-06-24", time: "16:00", user: "徐骏", content: "CI/CD pipeline 优化完成，构建时间 8 分钟 → 5 分钟" },
    { date: "2026-06-25", time: "14:00", user: "唐敏", content: "法务合规评审开始，GDPR 合规检查清单逐条确认" },
    { date: "2026-06-25", time: "15:30", user: "唐敏", content: "合规评审完成，数据留存政策确认，责任人分工明确" },
    { date: "2026-06-26", time: "10:00", user: "刘伟", content: "文档生成引擎基本完成，Word/PPT/Excel 三种格式都支持" },
    { date: "2026-06-26", time: "14:00", user: "孙娜", content: "评估体系搭建完成，Trust Metrics 5 维度：faithfulness/groundedness/coherence/fluency/completeness" },
    { date: "2026-06-26", time: "17:00", user: "赵丽", content: "生成树可视化完成，可以溯源到 chunk 级别" },
    { date: "2026-06-27", time: "09:30", user: "陈强", content: "Sprint 4 最后一天，i-Write Alpha 版本就绪！" },
    { date: "2026-06-27", time: "16:00", user: "苏楠", content: "Sprint 4 回顾会议，月度总结：195 个 PR，测试覆盖率 68% → 87%" },
    { date: "2026-06-27", time: "17:00", user: "陈强", content: "i-Write Alpha 版本发布！感谢团队 4 个月的努力！🎉🎉🎉" },
  ],
};
// PLACEHOLDER_TEAMS_END

// PLACEHOLDER_TECHDOCS_START
const techDocs: any[] = [
  {
    file: "documents/认证模块技术方案.docx",
    title: "用户认证模块技术方案 v2.0",
    version: "v2.0",
    author: "陈强",
    date: "2026-06-20",
    status: "已评审",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "用户认证模块是 i-Write 平台的基础组件，负责用户身份验证和授权。本模块支持多种登录方式（Microsoft OAuth2、GitHub OAuth），采用 JWT Token 进行无状态认证，确保企业级安全性。",
          "",
          "背景：i-Write 是企业级可信文档生成平台，需要连接企业内部知识源（OneDrive、GitHub 等）。用户认证模块是连接知识源的前提，只有完成身份验证，才能获取用户的 OAuth Token 访问知识源。",
          "",
          "目标用户：",
          "- 企业用户：通过 Microsoft Azure AD 登录，使用企业 SSO",
          "- 个人开发者：通过 GitHub 登录，连接 GitHub 仓库",
          "- 未来扩展：Google、Slack 等 Provider",
          "",
          "成功指标：",
          "- 登录成功率 > 99.5%",
          "- Token 刷新成功率 > 99.9%",
          "- 登录延迟 < 2 秒（P95）",
          "- E2E 测试覆盖率 > 85%",
        ],
      },
      {
        heading: "2. 技术选型",
        content: [
          "OAuth2 库选型对比：",
          "",
          "MSAL.js（Microsoft Authentication Library）：",
          "- 优势：微软官方库，Azure AD 集成最好，支持 PKCE",
          "- 劣势：只支持 Microsoft Provider",
          "- 用途：Microsoft OAuth2 登录",
          "",
          "passport.js：",
          "- 优势：支持 500+ Provider，社区活跃，中间件模式",
          "- 劣势：需要额外配置，安全性依赖策略实现",
          "- 用途：GitHub OAuth 登录",
          "",
          "next-auth：",
          "- 优势：Next.js 生态集成好，Session 管理内置",
          "- 劣势：我们用 Express，不是 Next.js",
          "- 用途：不采用",
          "",
          "最终选型：MSAL.js（Microsoft）+ passport.js（GitHub）",
          "",
          "Token 格式选型：",
          "- JWT（JSON Web Token）— 无状态、可验证、跨服务",
          "- 签名算法：RS256（RSA + SHA-256）— 比 HS256 更安全",
          "- 有效期：Access Token 1 小时，Refresh Token 7 天",
        ],
      },
      {
        heading: "3. 架构设计",
        content: [
          "整体架构：",
          "用户 → 前端 → OAuth2 Provider → 回调 → 后端 → JWT 生成 → 前端存储",
          "",
          "OAuth2 Authorization Code Flow + PKCE 流程：",
          "1. 用户点击「使用 Microsoft 登录」或「使用 GitHub 登录」",
          "2. 前端生成 code_verifier 和 code_challenge（PKCE）",
          "3. 前端跳转 OAuth2 Provider 授权页面，携带 code_challenge",
          "4. 用户授权后，Provider 回调到后端 redirect_uri，携带 authorization_code",
          "5. 后端用 authorization_code + code_verifier 换取 Access Token",
          "6. 后端用 Access Token 获取用户信息（displayName、mail、id）",
          "7. 后端生成 JWT Token（RS256 签名），返回给前端",
          "8. 前端存储 Token（Access Token 存 HttpOnly Cookie，Refresh Token 存加密 localStorage）",
          "9. 后续请求携带 Access Token，后端验证签名和有效期",
          "",
          "Token 管理设计：",
          "- Access Token: JWT 格式，RS256 签名，1 小时有效期，存储在 HttpOnly Cookie",
          "- Refresh Token: 随机字符串，7 天有效期，存储在加密 localStorage",
          "- Token 刷新: 前端检测 Access Token 过期前 5 分钟自动刷新",
          "- 刷新队列: 使用 Promise 队列防止并发刷新竞态（BUG-215 方案）",
          "",
          "多 Provider 支持：",
          "- Microsoft OAuth2: 使用 MSAL.js，支持 Azure AD 和个人账号",
          "- GitHub OAuth: 使用 passport.js，支持 GitHub 用户",
          "- 用户可绑定多个身份（Microsoft + GitHub）",
          "- 未来扩展：Google、Slack 等 Provider",
        ],
      },
      {
        heading: "4. 安全设计",
        content: [
          "传输安全：",
          "- 全站 HTTPS（TLS 1.3）",
          "- HSTS 头部（max-age=31536000）",
          "- 禁止 HTTP 回退",
          "",
          "CSRF 防护：",
          "- OAuth2 State 参数验证（防止 CSRF 攻击）",
          "- SameSite Cookie 属性（SameSite=Lax）",
          "- CSRF Token（表单提交时验证）",
          "",
          "XSS 防护：",
          "- HttpOnly Cookie（防止 JavaScript 访问 Access Token）",
          "- CSP 策略（Content-Security-Policy 头部）",
          "- 输入验证和输出编码",
          "",
          "Rate Limiting：",
          "- 登录接口：10 次/分钟/IP",
          "- Token 刷新：60 次/分钟/用户",
          "- API 接口：100 次/分钟/用户",
          "",
          "审计日志：",
          "- audit_log 表记录所有认证事件（登录、登出、Token 刷新）",
          "- 日志字段：timestamp、user_id、event_type、ip_address、user_agent",
          "- 日志保留 1 年",
        ],
      },
      {
        heading: "5. API 设计",
        content: [
          "认证模块 API 端点（7 个）：",
          "",
          "接口 | 方法 | 说明 | 参数 | 响应",
          "/auth/microsoft | GET | 发起 Microsoft OAuth2 登录 | 无 | 302 重定向",
          "/auth/microsoft/callback | GET | Microsoft OAuth2 回调 | code, state | { token, user }",
          "/auth/github | GET | 发起 GitHub OAuth 登录 | 无 | 302 重定向",
          "/auth/github/callback | GET | GitHub OAuth 回调 | code, state | { token, user }",
          "/auth/refresh | POST | 刷新 Access Token | { refreshToken } | { token, refreshToken }",
          "/auth/logout | POST | 登出 | 无（Cookie） | { ok: true }",
          "/auth/me | GET | 获取当前用户信息 | 无（Cookie） | { user }",
          "",
          "POST /auth/logout",
          "- 说明：登出",
          "- 参数：无（Cookie 中的 Token）",
          "- 响应：{ ok: true }",
          "",
          "GET /auth/me",
          "- 说明：获取当前用户信息",
          "- 参数：无（Cookie 中的 Token）",
          "- 响应：{ user: { id, name, email, avatar } }",
        ],
      },
      {
        heading: "6. 测试方案",
        content: [
          "测试矩阵：",
          "- Unit Test: JWT 生成/验证、Token 刷新逻辑、Rate Limiting（覆盖率目标 90%）",
          "- Integration Test: OAuth2 完整流程、多 Provider 切换、审计日志记录",
          "- E2E Test: 登录→刷新→连接知识源→登出（Playwright，覆盖率目标 85%）",
          "",
          "测试用例（28 个）：",
          "1-5: Microsoft OAuth2 登录流程（成功、失败、取消、超时、网络错误）",
          "6-10: GitHub OAuth 登录流程（成功、失败、取消、scope 不足、token 过期）",
          "11-15: Token 管理（刷新成功、刷新失败、并发刷新、过期检测、存储加密）",
          "16-20: 安全测试（CSRF、XSS、Rate Limiting、SQL 注入、Token 泄露）",
          "21-24: UI 测试（响应式、深色模式、无障碍、多语言）",
          "25-28: 集成测试（多设备登录、会话管理、审计日志、错误恢复）",
        ],
      },
      {
        heading: "7. 时间线",
        content: [
          "Sprint 3（6/16-6/20）完成：",
          "- 陈强：整体架构设计、OAuth2 基础框架、安全评审",
          "- 王超：Microsoft OAuth2 集成（MSAL.js + Azure AD 配置）",
          "- 刘伟：GitHub OAuth 集成（passport.js）、Token 刷新队列",
          "- 赵丽：登录页面 UI、Token 管理组件、知识源连接状态组件",
          "- 杨飞：E2E 测试框架搭建、28 个测试用例编写",
          "",
          "Sprint 4（6/23-6/27）计划：",
          "- API Key 认证（CLI 工具支持）",
          "- 多设备管理功能",
          "- 性能测试和安全渗透测试",
        ],
      },
    ],
  },
  {
    file: "documents/支付系统技术方案.docx",
    title: "支付系统技术方案",
    version: "v1.0",
    author: "陈强、刘伟",
    date: "2026-06-23",
    status: "初稿",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "支付系统支持用户订阅 i-Write 的付费功能。采用 Stripe 作为国际支付 Provider，第二阶段再加支付宝/微信支付。",
          "",
          "背景：i-Write 是企业级可信文档生成平台，需要通过订阅模式变现。用户可以免费试用基础功能，付费解锁高级功能。支付系统需要支持多种支付方式、订阅管理、退款处理等功能。",
          "",
          "目标：",
          "- 支持订阅模式（Free/Pro/Team）",
          "- 支持国际支付（Stripe）",
          "- 支持退款（7 天无理由）",
          "- 符合 PCI DSS 合规",
          "",
          "成功指标：",
          "- 支付成功率 > 99%",
          "- 支付延迟 < 3 秒（P95）",
          "- 退款处理时间 < 5 个工作日",
          "- PCI DSS 合规通过",
        ],
      },
      {
        heading: "2. 支付 Provider",
        content: [
          "Provider 选型：",
          "",
          "Stripe（国际支付）：",
          "- 费率：2.9% + $0.30/笔",
          "- 支持：135+ 种货币",
          "- 优势：PCI DSS Level 1 认证、Checkout 托管支付页面、Webhook 支持",
          "- 劣势：费率较高",
          "",
          "支付宝（国内支付）：",
          "- 费率：0.6%",
          "- 支持：人民币",
          "- 优势：费率低、国内用户习惯",
          "- 劣势：需要企业资质、海外用户不支持",
          "",
          "微信支付（国内支付）：",
          "- 费率：0.6%",
          "- 支持：人民币",
          "- 优势：费率低、国内用户习惯",
          "- 劣势：需要企业资质、海外用户不支持",
          "",
          "第一阶段只集成 Stripe，第二阶段（Sprint 6）再加支付宝/微信支付。",
        ],
      },
      {
        heading: "3. 订阅模式",
        content: [
          "套餐设计：",
          "",
          "套餐 | 价格 | 功能 | 限制 | 目标用户",
          "免费版（Free） | $0/月 | AI 文档生成、知识库连接 | 5 次/月、1 个知识源、无导出 | 试用用户",
          "专业版（Pro） | $19/月 | 无限文档生成、10+ 知识源、Word/PPT/Excel 导出 | 无限制 | 个人用户、自由职业者",
          "团队版（Team） | $49/月/人 | 团队协作、管理后台、SSO、审计日志、自定义模板 | 无限制 | 企业客户、团队用户",
          "",
          "年付优惠：8 折（节省 2 个月费用）",
          "",
          "定价对比（竞品）：",
          "产品 | 价格 | 溯源能力 | 知识库集成 | Trust Score",
          "i-Write | $19/月 | ✅ chunk 级别 | ✅ 10+ 源 | ✅ 5 维度",
          "Jasper | $49/月 | ❌ | ❌ | ❌",
          "Copy.ai | $36/月 | ❌ | ❌ | ❌",
          "Notion AI | $10/月 | ❌ | ⚠️ 基础 | ❌",
        ],
      },
      {
        heading: "4. 技术架构",
        content: [
          "Stripe 集成方案：",
          "",
          "Stripe Checkout（托管支付页面）：",
          "- 最简单、最安全的集成方式",
          "- Stripe 已通过 PCI DSS Level 1 认证",
          "- 我们只需要确保不存储信用卡信息",
          "",
          "Webhook 安全：",
          "- 使用 Stripe 签名验证中间件",
          "- 验证 webhook-signature 头部",
          "- 使用 webhook secret（环境变量配置）",
          "",
          "Webhook 事件处理：",
          "- checkout.session.completed — 支付成功",
          "- customer.subscription.created — 订阅创建",
          "- customer.subscription.updated — 订阅更新",
          "- customer.subscription.deleted — 订阅取消",
          "- invoice.payment_failed — 支付失败",
          "",
          "幂等性保证：",
          "- 使用 Stripe Event ID 作为幂等键",
          "- 数据库记录已处理的 Event ID",
          "- 重复事件自动跳过",
        ],
      },
      {
        heading: "5. 退款处理",
        content: [
          "退款政策：",
          "- 7 天无理由退款",
          "- 部分退款需要人工审核",
          "- 退款处理时间 5-10 个工作日",
          "",
          "退款流程：",
          "1. 用户提交退款请求（APP 内或邮件）",
          "2. 系统检查是否在 7 天内",
          "3. 7 天内自动退款，超过 7 天人工审核",
          "4. 调用 Stripe Refund API",
          "5. 发送退款确认邮件给用户",
          "",
          "发票：",
          "- 自动生成电子发票（PDF）",
          "- 支持增值税发票（国内客户）",
          "- 发票内容：服务费、税额、合计",
        ],
      },
      {
        heading: "6. 数据库设计",
        content: [
          "订阅表（subscriptions）：",
          "- id: UUID 主键",
          "- user_id: 用户 ID（外键）",
          "- stripe_subscription_id: Stripe 订阅 ID",
          "- plan: 套餐类型（free/pro/team）",
          "- status: 状态（active/canceled/past_due）",
          "- current_period_start: 当前周期开始时间",
          "- current_period_end: 当前周期结束时间",
          "- cancel_at_period_end: 是否周期结束时取消",
          "- created_at: 创建时间",
          "- updated_at: 更新时间",
          "",
          "支付记录表（payments）：",
          "- id: UUID 主键",
          "- user_id: 用户 ID（外键）",
          "- stripe_payment_intent_id: Stripe 支付 ID",
          "- amount: 金额（分）",
          "- currency: 货币（USD/CNY）",
          "- status: 状态（succeeded/failed/refunded）",
          "- refund_amount: 退款金额（分）",
          "- refund_reason: 退款原因",
          "- created_at: 创建时间",
          "",
          "发票表（invoices）：",
          "- id: UUID 主键",
          "- user_id: 用户 ID（外键）",
          "- payment_id: 支付 ID（外键）",
          "- invoice_number: 发票编号",
          "- amount: 金额（分）",
          "- tax: 税额（分）",
          "- total: 合计（分）",
          "- pdf_url: PDF 下载链接",
          "- created_at: 创建时间",
        ],
      },
      {
        heading: "7. API 设计",
        content: [
          "支付模块 API 端点（6 个）：",
          "",
          "POST /api/payments/create-subscription",
          "- 说明：创建订阅",
          "- 参数：{ plan: 'pro' | 'team', paymentMethodId: string }",
          "- 响应：{ subscriptionId, clientSecret }",
          "",
          "POST /api/payments/cancel-subscription",
          "- 说明：取消订阅",
          "- 参数：{ subscriptionId: string }",
          "- 响应：{ ok: true, cancelAt: string }",
          "",
          "GET /api/payments/subscription",
          "- 说明：获取当前订阅",
          "- 参数：无",
          "- 响应：{ subscription: { plan, status, currentPeriodEnd } }",
          "",
          "POST /api/payments/refund",
          "- 说明：申请退款",
          "- 参数：{ paymentId: string, reason: string }",
          "- 响应：{ ok: true, refundId: string }",
          "",
          "GET /api/payments/invoices",
          "- 说明：获取发票列表",
          "- 参数：{ page: number, limit: number }",
          "- 响应：{ invoices: [...], total: number }",
          "",
          "POST /api/payments/webhook",
          "- 说明：Stripe Webhook 回调",
          "- 参数：Stripe Event 对象",
          "- 响应：{ received: true }",
        ],
      },
      {
        heading: "8. 测试方案",
        content: [
          "测试矩阵：",
          "- Unit Test: 订阅创建/取消、退款处理、Webhook 验证（覆盖率目标 90%）",
          "- Integration Test: Stripe API 集成、支付流程、发票生成",
          "- E2E Test: 完整支付流程（注册→订阅→使用→取消→退款）",
          "",
          "测试用例（20 个）：",
          "1-5: 订阅创建（成功、失败、重复订阅、支付失败、网络错误）",
          "6-10: 订阅管理（升级、降级、取消、续费、过期）",
          "11-15: 退款处理（7 天内退款、超过 7 天、部分退款、退款失败、重复退款）",
          "16-20: Webhook 处理（支付成功、支付失败、订阅更新、签名验证失败、重复事件）",
          "",
          "Stripe 测试模式：",
          "- 使用 Stripe 测试 API Key（sk_test_...）",
          "- 使用 Stripe 测试卡号（4242 4242 4242 4242）",
          "- 使用 Stripe Webhook 签名验证（whsec_...）",
        ],
      },
      {
        heading: "9. 部署和监控",
        content: [
          "部署配置：",
          "- Stripe API Key: 环境变量 STRIPE_SECRET_KEY",
          "- Stripe Webhook Secret: 环境变量 STRIPE_WEBHOOK_SECRET",
          "- Stripe Publishable Key: 环境变量 STRIPE_PUBLISHABLE_KEY",
          "",
          "监控指标：",
          "- 支付成功率（目标 > 99%）",
          "- 支付延迟（目标 < 3 秒 P95）",
          "- Webhook 处理延迟（目标 < 1 秒）",
          "- 退款处理时间（目标 < 5 个工作日）",
          "",
          "告警规则：",
          "- 支付成功率 < 95% — 立即告警",
          "- Webhook 处理延迟 > 5 秒 — 立即告警",
          "- 退款处理时间 > 7 天 — 告警",
          "",
          "日志记录：",
          "- 所有支付事件记录到 audit_log 表",
          "- Webhook 事件记录到 webhook_events 表",
          "- 错误日志记录到 error_log 表",
        ],
      },
      {
        heading: "10. 时间线",
        content: [
          "Sprint 4（6/23-6/27）：",
          "- 陈强：Stripe Checkout 集成、订阅管理 API",
          "- 刘伟：Webhook 处理、退款逻辑",
          "- 赵丽：支付页面 UI、订阅管理页面",
          "- 杨飞：支付模块测试（20 个用例）",
          "",
          "Sprint 5（6/30-7/4）：",
          "- 陈强：发票生成、支付报表",
          "- 刘伟：支付宝/微信支付集成（国内版）",
          "- 赵丽：发票下载页面、支付历史页面",
          "",
          "Sprint 6（7/7-7/11）：",
          "- 性能测试和安全测试",
          "- PCI DSS 合规审计",
          "- 生产环境部署",
        ],
      },
    ],
  },
  {
    file: "documents/API文档-认证接口.docx",
    title: "API 文档 — 认证接口",
    version: "v1.0",
    author: "陈强",
    date: "2026-06-20",
    status: "已发布",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "本文档描述 i-Write 认证模块的 API 接口，包括 OAuth2 登录、Token 管理、用户信息获取等功能。",
          "",
          "Base URL: https://api.i-write.com/auth",
          "认证方式: Bearer Token（JWT）",
          "Content-Type: application/json",
        ],
      },
      {
        heading: "2. GET /auth/microsoft",
        content: [
          "说明：发起 Microsoft OAuth2 登录",
          "方法：GET",
          "参数：无",
          "",
          "响应：",
          "- 302 重定向到 Microsoft 授权页面",
          "- 重定向 URL 包含 client_id、redirect_uri、response_type、scope、state、code_challenge",
          "",
          "示例：",
          "GET /auth/microsoft",
          "Response: 302 Found",
          "Location: https://login.microsoftonline.com/common/oauth2/v2.0/authorize?...",
        ],
      },
      {
        heading: "3. GET /auth/microsoft/callback",
        content: [
          "说明：Microsoft OAuth2 回调",
          "方法：GET",
          "参数：",
          "- code: authorization_code（必填）",
          "- state: CSRF token（必填）",
          "",
          "响应：",
          "- 成功：{ token: string, refreshToken: string, user: { id, name, email, avatar } }",
          "- 失败：{ error: string, message: string }",
          "",
          "错误码：",
          "- 400: 参数错误（code 或 state 缺失）",
          "- 401: 认证失败（code 无效或过期）",
          "- 500: 服务器内部错误",
        ],
      },
      {
        heading: "4. GET /auth/github",
        content: [
          "说明：发起 GitHub OAuth 登录",
          "方法：GET",
          "参数：无",
          "",
          "响应：",
          "- 302 重定向到 GitHub 授权页面",
          "- 重定向 URL 包含 client_id、redirect_uri、scope、state",
          "",
          "Scope: repo user:email",
          "- repo: 读取仓库（知识源）",
          "- user:email: 获取用户邮箱",
        ],
      },
      {
        heading: "5. POST /auth/refresh",
        content: [
          "说明：刷新 Access Token",
          "方法：POST",
          "参数：{ refreshToken: string }",
          "",
          "响应：",
          "- 成功：{ token: string, refreshToken: string }",
          "- 失败：{ error: string }",
          "",
          "错误码：",
          "- 400: 参数错误（refreshToken 缺失）",
          "- 401: Refresh Token 无效或过期",
          "- 429: Rate Limiting（60 次/分钟/用户）",
        ],
      },
      {
        heading: "6. POST /auth/logout",
        content: [
          "说明：登出",
          "方法：POST",
          "参数：无（Cookie 中的 Token）",
          "",
          "响应：",
          "- 成功：{ ok: true }",
          "- 失败：{ error: string }",
          "",
          "行为：",
          "- 清除 HttpOnly Cookie 中的 Access Token",
          "- 撤销 Refresh Token（数据库标记为已撤销）",
          "- 记录登出事件到审计日志",
        ],
      },
      {
        heading: "7. GET /auth/me",
        content: [
          "说明：获取当前用户信息",
          "方法：GET",
          "参数：无（Cookie 中的 Token）",
          "",
          "响应：",
          "- 成功：{ user: { id, name, email, avatar, providers } }",
          "- 失败：{ error: string }",
          "",
          "providers 字段：",
          "- [{ provider: 'microsoft', connected: true, email: 'user@company.com' }]",
          "- [{ provider: 'github', connected: true, login: 'username' }]",
        ],
      },
      {
        heading: "8. Rate Limiting",
        content: [
          "Rate Limiting 配置：",
          "",
          "登录接口（/auth/microsoft, /auth/github）：",
          "- 限制：10 次/分钟/IP",
          "- 响应：429 Too Many Requests",
          "- 头部：X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
          "",
          "Token 刷新接口（/auth/refresh）：",
          "- 限制：60 次/分钟/用户",
          "- 响应：429 Too Many Requests",
          "- 头部：X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
          "",
          "用户信息接口（/auth/me）：",
          "- 限制：100 次/分钟/用户",
          "- 响应：429 Too Many Requests",
          "- 头部：X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
          "",
          "实现方式：",
          "- 使用 express-rate-limit 中间件",
          "- 存储：内存（开发环境）/ Redis（生产环境）",
          "- Key：IP 地址（登录）/ 用户 ID（Token 刷新、用户信息）",
        ],
      },
      {
        heading: "9. 错误码汇总",
        content: [
          "通用错误码：",
          "- 400: Bad Request — 参数错误",
          "- 401: Unauthorized — 认证失败",
          "- 403: Forbidden — 权限不足",
          "- 404: Not Found — 资源不存在",
          "- 429: Too Many Requests — Rate Limiting",
          "- 500: Internal Server Error — 服务器内部错误",
          "",
          "认证模块错误码：",
          "- AUTH_001: OAuth2 code 无效或过期",
          "- AUTH_002: OAuth2 state 验证失败（CSRF 攻击）",
          "- AUTH_003: JWT Token 无效或过期",
          "- AUTH_004: Refresh Token 无效或过期",
          "- AUTH_005: 用户信息获取失败",
          "- AUTH_006: Provider 不支持",
          "- AUTH_007: 账号已锁定（连续 5 次登录失败）",
          "",
          "错误响应格式：",
          "{",
          "  \"error\": \"AUTH_001\",",
          "  \"message\": \"OAuth2 code 无效或过期\",",
          "  \"details\": { \"provider\": \"microsoft\" }",
          "}",
        ],
      },
      {
        heading: "10. SDK 和示例",
        content: [
          "JavaScript SDK 示例：",
          "",
          "// Microsoft 登录",
          "const response = await fetch('/auth/microsoft');",
          "const { url } = await response.json();",
          "window.location.href = url;",
          "",
          "// Token 刷新",
          "const response = await fetch('/auth/refresh', {",
          "  method: 'POST',",
          "  headers: { 'Content-Type': 'application/json' },",
          "  body: JSON.stringify({ refreshToken: '...' })",
          "});",
          "const { token, refreshToken } = await response.json();",
          "",
          "// 获取用户信息",
          "const response = await fetch('/auth/me', {",
          "  headers: { 'Authorization': 'Bearer ' + token }",
          "});",
          "const { user } = await response.json();",
          "",
          "cURL 示例：",
          "",
          "# Microsoft 登录",
          "curl -X GET https://api.i-write.com/auth/microsoft",
          "",
          "# Token 刷新",
          "curl -X POST https://api.i-write.com/auth/refresh \\",
          "  -H 'Content-Type: application/json' \\",
          "  -d '{\"refreshToken\": \"...\"}'",
          "",
          "# 获取用户信息",
          "curl -X GET https://api.i-write.com/auth/me \\",
          "  -H 'Authorization: Bearer ...'",
        ],
      },
      {
        heading: "11. 安全注意事项",
        content: [
          "Token 安全：",
          "- Access Token 存储在 HttpOnly Cookie，防止 XSS 攻击",
          "- Refresh Token 存储在加密 localStorage，防止 XSS 攻击",
          "- Token 传输必须使用 HTTPS",
          "- Token 过期后必须刷新，不能重复使用",
          "",
          "CSRF 防护：",
          "- OAuth2 State 参数验证",
          "- SameSite Cookie 属性（SameSite=Lax）",
          "- CSRF Token（表单提交时验证）",
          "",
          "XSS 防护：",
          "- HttpOnly Cookie（防止 JavaScript 访问）",
          "- CSP 策略（Content-Security-Policy 头部）",
          "- 输入验证和输出编码",
          "",
          "审计日志：",
          "- 记录所有认证事件（登录、登出、Token 刷新）",
          "- 日志字段：timestamp、user_id、event_type、ip_address、user_agent",
          "- 日志保留 1 年",
        ],
      },
    ],
  },
  {
    file: "documents/架构设计-i-Write系统架构.docx",
    title: "i-Write 系统架构设计文档",
    version: "v1.0",
    author: "陈强",
    date: "2026-06-15",
    status: "已评审",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "i-Write 是企业级可信文档生成平台，采用前后端分离架构，后端使用 Express + TypeScript，前端使用 React + Vite。",
          "",
          "设计原则：",
          "- 可追溯：每个生成内容都能溯源到原始知识源",
          "- 可配置：所有参数可通过配置调整",
          "- 可降级：RAG 引擎支持三级降级（远程 API → 本地模型 → 启发式）",
          "- 可扩展：模块化设计，支持新增 Provider、知识源类型、导出格式",
        ],
      },
      {
        heading: "2. 整体架构",
        content: [
          "架构分层：",
          "",
          "Client 层（React + Vite）：",
          "- UI 组件库（Tailwind CSS + Headless UI）",
          "- 状态管理（Zustand）",
          "- 路由（React Router）",
          "- API 调用（fetch）",
          "",
          "Server 层（Express + TypeScript）：",
          "- API 路由（RESTful）",
          "- 业务逻辑（LLM 调用、RAG 检索、文档生成）",
          "- 数据存储（SQLite + 文件系统）",
          "- 外部集成（Microsoft Graph、GitHub API、Stripe）",
          "",
          "Shared 层（TypeScript）：",
          "- 类型定义（TypeScript 接口）",
          "- 工具函数（日期、加密、编码）",
          "- 常量定义（配置、错误码）",
        ],
      },
      {
        heading: "3. 数据流",
        content: [
          "文档生成流程：",
          "1. 用户输入主题和大纲",
          "2. 前端发送生成请求到后端",
          "3. 后端解析大纲，生成章节指令",
          "4. 对每个章节，执行 RAG 检索（Hybrid Search）",
          "5. 检索结果经过 Reranker 重排序",
          "6. LLM 根据检索结果生成章节内容",
          "7. Groundedness Check 验证生成内容的准确性",
          "8. 合并所有章节，生成最终文档",
          "9. 返回给前端展示，支持溯源到 chunk 级别",
          "",
          "知识库检索流程：",
          "1. 用户查询",
          "2. Query Expansion（跨语言扩展、同义词扩展）",
          "3. Hybrid Search（BM25 + 向量检索）",
          "4. RRF 融合（Reciprocal Rank Fusion）",
          "5. Reranker 重排序（三级降级）",
          "6. 返回 Top-K 结果",
        ],
      },
      {
        heading: "4. 部署架构",
        content: [
          "开发环境：",
          "- 本地开发：npm run dev（Express + Vite HMR）",
          "- 数据库：SQLite（本地文件）",
          "- 外部服务：Mock 或真实 API",
          "",
          "Staging 环境：",
          "- 部署：Docker + GitHub Actions",
          "- 数据库：SQLite（Docker Volume）",
          "- 外部服务：真实 API（staging 配置）",
          "",
          "生产环境：",
          "- 部署：Docker + Kubernetes（未来）",
          "- 数据库：PostgreSQL（未来迁移）",
          "- 外部服务：真实 API（生产配置）",
          "- 监控：Prometheus + Grafana（未来）",
        ],
      },
      {
        heading: "5. 模块依赖",
        content: [
          "核心模块依赖关系：",
          "",
          "模块 | 依赖 | 被依赖 | 说明",
          "auth | db, keyStore, logger | 所有 API 路由 | 用户认证和授权",
          "knowledge | db, embedder, chunker | retriever, generator | 知识库管理",
          "retriever | knowledge, bm25, vector, reranker | generator | RAG 检索",
          "generator | retriever, llm, groundedness | generation 路由 | 文档生成",
          "exporter | docx, pptx, xlsx | export 路由 | 文档导出",
        ],
      },
      {
        heading: "6. 数据库 Schema",
        content: [
          "核心表：",
          "",
          "表名 | 字段 | 类型 | 说明",
          "kb_sources | id | UUID | 主键",
          "kb_sources | name | TEXT | 知识源名称",
          "kb_sources | type | TEXT | 类型（docx/eml/json/xlsx/pptx）",
          "kb_sources | file_path | TEXT | 文件路径",
          "kb_sources | content_hash | TEXT | 内容哈希（去重）",
          "kb_sources | chunk_count | INTEGER | 分块数量",
          "kb_sources | status | TEXT | 状态（processing/ready/error）",
          "kb_sources | created_at | DATETIME | 创建时间",
          "kb_chunks | id | UUID | 主键",
          "kb_chunks | source_id | UUID | 知识源 ID（外键）",
          "kb_chunks | content | TEXT | 分块内容",
          "kb_chunks | chunk_index | INTEGER | 分块索引",
          "kb_chunks | token_count | INTEGER | Token 数量",
          "kb_chunks | metadata | JSON | 元数据",
          "kb_vectors | id | UUID | 主键",
          "kb_vectors | chunk_id | UUID | 分块 ID（外键）",
          "kb_vectors | vector | BLOB | 向量数据",
          "kb_vectors | dimension | INTEGER | 向量维度（1024）",
          "generation_runs | id | UUID | 主键",
          "generation_runs | topic | TEXT | 生成主题",
          "generation_runs | outline | JSON | 大纲",
          "generation_runs | status | TEXT | 状态（pending/running/completed/failed）",
          "generation_runs | result | TEXT | 生成结果（HTML）",
          "audit_log | id | UUID | 主键",
          "audit_log | timestamp | DATETIME | 操作时间",
          "- table_name: 操作表名",
          "- operation: 操作类型（INSERT/UPDATE/DELETE）",
          "- record_id: 记录 ID",
          "- old_data: 旧数据（JSON）",
          "- new_data: 新数据（JSON）",
          "- source: 来源标记",
        ],
      },
      {
        heading: "7. 安全架构",
        content: [
          "认证层：",
          "- OAuth2 认证（Microsoft + GitHub）",
          "- JWT Token 验证（RS256 签名）",
          "- API Key 认证（CLI 工具）",
          "",
          "授权层：",
          "- RBAC 角色（Admin / Editor / Viewer）",
          "- 资源级权限（知识源、文档、设置）",
          "",
          "数据层：",
          "- 传输加密：HTTPS（TLS 1.3）",
          "- 存储加密：AES-256-GCM（敏感字段）",
          "- 审计日志：所有写操作记录",
          "",
          "防护层：",
          "- Rate Limiting（express-rate-limit）",
          "- CSRF 防护（OAuth2 State + SameSite Cookie）",
          "- XSS 防护（HttpOnly Cookie + CSP）",
          "- SQL 注入防护（参数化查询）",
        ],
      },
    ],
  },
  {
    file: "documents/RAG引擎参数配置.docx",
    title: "RAG 引擎参数配置文档",
    version: "v1.0",
    author: "陈强、孙娜",
    date: "2026-06-20",
    status: "已发布",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "RAG（Retrieval-Augmented Generation）引擎是 i-Write 的核心组件，负责从知识库中检索相关信息，辅助 LLM 生成准确的文档内容。",
          "",
          "设计原则：",
          "- 可追溯：每个检索结果都能溯源到原始文档",
          "- 可配置：所有参数可通过配置调整",
          "- 可降级：支持三级降级（远程 API → 本地模型 → 启发式）",
          "- 高性能：端到端延迟 < 3 秒（P95）",
        ],
      },
      {
        heading: "2. 参数配置表",
        content: [
          "核心参数：",
          "",
          "参数 | 值 | 说明 | 类别",
          "chunk_size | 512 tokens | 约 340 中文字符 | 分块",
          "chunk_overlap | 64 tokens | 约 45 中文字符 | 分块",
          "min_chunk_size | 80 字符 | 最小分块大小 | 分块",
          "top_k | 10 | 返回 Top-K 结果 | 检索",
          "bm25_k1 | 1.2 | BM25 参数 k1 | 检索",
          "bm25_b | 0.75 | BM25 参数 b | 检索",
          "vector_similarity_threshold | 0.7 | 向量相似度阈值 | 检索",
          "rrf_k | 60 | RRF 融合参数 k | 检索",
          "reranker_top_k | 5 | 重排序后返回 Top-K | Reranker",
          "reranker_model | BAAI/bge-reranker-v2-m3 | 本地模型 | Reranker",
          "reranker_api_url | https://api.siliconflow.cn/v1/reranker | 远程 API | Reranker",
          "groundedness_threshold | 0.8 | 通过阈值 | Groundedness",
          "groundedness_critical | 0.5 | 低于此值触发重生成 | Groundedness",
          "sentence_level_check | true | 句子级验证 | Groundedness",
        ],
      },
      {
        heading: "3. Pipeline 流程",
        content: [
          "RAG Pipeline 流程：",
          "",
          "Step 1: Query Expansion（查询扩展）",
          "- 跨语言扩展：中文查询 → 英文查询",
          "- 同义词扩展：认证 → 登录、验证、鉴权",
          "- Multi-Query 改写：LLM-based 查询改写",
          "",
          "Step 2: Hybrid Search（混合检索）",
          "- BM25 检索：MiniSearch + jieba-wasm 分词",
          "- 向量检索：cosine similarity + MMR 多样性排序",
          "- RRF 融合：k=60",
          "",
          "Step 3: Reranker（重排序）",
          "- L1: SiliconFlow reranker API（最高质量）",
          "- L2: 本地 Cross-Encoder（中等质量，离线可用）",
          "- L3: 启发式加权（最低质量，兜底）",
          "",
          "Step 4: Groundedness Check（可信度验证）",
          "- 句子级验证：每个句子都有 groundedRatio",
          "- 通过阈值：groundedRatio >= 0.8",
          "- 重生成阈值：groundedRatio < 0.5",
        ],
      },
      {
        heading: "4. 性能基准",
        content: [
          "端到端性能：",
          "- 目标：< 3 秒（P95）",
          "- 实测：2.8 秒（P95）",
          "",
          "各阶段性能：",
          "- Query Expansion: < 200ms",
          "- BM25 检索: < 100ms",
          "- 向量检索: < 200ms",
          "- RRF 融合: < 50ms",
          "- Reranker: < 1 秒（远程 API）/ < 500ms（本地模型）",
          "- Groundedness Check: < 500ms",
          "",
          "优化建议：",
          "- 使用缓存（Redis）存储频繁查询的结果",
          "- 使用向量索引（FAISS）加速向量检索",
          "- 使用异步处理（Promise.all）并行执行检索",
        ],
      },
    ],
  },
  {
    file: "documents/部署指南.docx",
    title: "i-Write 部署指南",
    version: "v1.0",
    author: "徐骏",
    date: "2026-06-15",
    status: "已发布",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "本文档描述 i-Write 的部署流程，包括本地开发环境、Staging 环境、生产环境的配置和部署步骤。",
          "",
          "环境要求：",
          "- Node.js >= 18.0.0",
          "- npm >= 9.0.0",
          "- Python >= 3.9（PPT 生成）",
          "- SQLite >= 3.35.0",
        ],
      },
      {
        heading: "2. 本地开发环境",
        content: [
          "安装步骤：",
          "",
          "1. 克隆仓库：",
          "   git clone https://github.com/nexora-tech/i-write.git",
          "   cd i-write",
          "",
          "2. 安装依赖：",
          "   npm install",
          "",
          "3. 配置环境变量：",
          "   cp .env.example .env",
          "   # 编辑 .env，填入 API Key",
          "",
          "4. 启动开发服务器：",
          "   npm run dev",
          "",
          "5. 访问：",
          "   http://localhost:3000",
          "",
          "开发命令：",
          "- npm run dev — 启动开发服务器（Express + Vite HMR）",
          "- npm run build — 构建生产版本",
          "- npm run test — 运行测试",
          "- npm run lint — 代码检查",
        ],
      },
      {
        heading: "3. Docker 部署",
        content: [
          "Dockerfile：",
          "",
          "FROM node:18-alpine",
          "WORKDIR /app",
          "COPY package*.json ./",
          "RUN npm ci --only=production",
          "COPY . .",
          "RUN npm run build",
          "EXPOSE 3000",
          "CMD ['node', 'dist/index.js']",
          "",
          "构建镜像：",
          "docker build -t i-write .",
          "",
          "运行容器：",
          "docker run -d -p 3000:3000 -v i-write-data:/app/data i-write",
          "",
          "Docker Compose：",
          "version: '3'",
          "services:",
          "  i-write:",
          "    build: .",
          "    ports:",
          "      - '3000:3000'",
          "    volumes:",
          "      - i-write-data:/app/data",
          "    environment:",
          "      - NODE_ENV=production",
          "volumes:",
          "  i-write-data:",
        ],
      },
      {
        heading: "4. Nginx 配置",
        content: [
          "Nginx 反向代理配置：",
          "",
          "server {",
          "    listen 80;",
          "    server_name i-write.com;",
          "    return 301 https://$server_name$request_uri;",
          "}",
          "",
          "server {",
          "    listen 443 ssl http2;",
          "    server_name i-write.com;",
          "",
          "    ssl_certificate /etc/ssl/certs/i-write.com.pem;",
          "    ssl_certificate_key /etc/ssl/private/i-write.com.key;",
          "",
          "    location / {",
          "        proxy_pass http://localhost:3000;",
          "        proxy_http_version 1.1;",
          "        proxy_set_header Upgrade $http_upgrade;",
          "        proxy_set_header Connection 'upgrade';",
          "        proxy_set_header Host $host;",
          "        proxy_cache_bypass $http_upgrade;",
          "    }",
          "}",
        ],
      },
    ],
  },
  {
    file: "documents/数据安全合规方案.docx",
    title: "i-Write 数据安全与合规方案",
    version: "v1.0",
    author: "唐敏、陈强",
    date: "2026-06-25",
    status: "已评审",
    sections: [
      {
        heading: "1. 概述",
        content: [
          "本文档描述 i-Write 的数据安全与合规方案，确保符合 GDPR、中国个人信息保护法等法规要求。",
          "",
          "适用法规：",
          "- GDPR（欧盟通用数据保护条例）",
          "- 中国个人信息保护法",
          "- SOC 2 Type II（企业客户要求）",
          "",
          "合规目标：",
          "- 数据处理合法性基础明确",
          "- 数据主体权利得到保障",
          "- 数据安全措施到位",
          "- 审计日志完整可追溯",
        ],
      },
      {
        heading: "2. 数据分类",
        content: [
          "数据类型分类：",
          "",
          "用户数据（PII）：",
          "- 姓名、邮箱、头像",
          "- OAuth Token（加密存储）",
          "- 登录日志（IP、User-Agent）",
          "",
          "文档内容：",
          "- 用户生成的文档",
          "- 知识库中的文档",
          "- 检索结果和生成内容",
          "",
          "日志数据：",
          "- 应用日志（30 天保留）",
          "- 审计日志（1 年保留）",
          "- 错误日志（30 天保留）",
          "",
          "支付数据：",
          "- 订阅信息（套餐、状态）",
          "- 支付记录（Stripe 处理，我们不存储信用卡信息）",
          "- 发票信息（7 年保留）",
        ],
      },
      {
        heading: "3. 数据安全措施",
        content: [
          "传输加密：",
          "- 全站 HTTPS（TLS 1.3）",
          "- HSTS 头部（max-age=31536000）",
          "- 禁止 HTTP 回退",
          "",
          "存储加密：",
          "- SQLite WAL 模式",
          "- API Key 加密存储（AES-256-GCM）",
          "- OAuth Token 加密存储",
          "",
          "访问控制：",
          "- OAuth2 认证（Microsoft + GitHub）",
          "- RBAC 角色（Admin / Editor / Viewer）",
          "- API Key 认证（CLI 工具）",
          "",
          "安全防护：",
          "- Rate Limiting（登录 10 次/分钟/IP）",
          "- CSRF 防护（OAuth2 State 参数 + SameSite Cookie）",
          "- XSS 防护（HttpOnly Cookie + CSP 策略）",
          "- SQL 注入防护（参数化查询）",
        ],
      },
      {
        heading: "4. 数据留存政策",
        content: [
          "数据类型 | 留存期限 | 删除方式",
          "用户数据 | 用户删除前 | 用户请求删除，72 小时内完成",
          "文档内容 | 用户删除前 | 用户请求删除，72 小时内完成",
          "知识库数据 | 用户删除前 | 用户请求删除，72 小时内完成",
          "日志数据 | 30 天 | 自动清理（cron job）",
          "审计日志 | 1 年 | 自动清理（cron job）",
          "支付记录 | 7 年 | 税务要求，不可删除",
          "",
          "数据删除流程：",
          "1. 用户提交删除请求（APP 内或邮件）",
          "2. 系统标记为待删除（24 小时冷却期）",
          "3. 冷却期后自动删除所有相关数据",
          "4. 发送确认邮件给用户",
          "5. 记录删除操作到审计日志",
        ],
      },
      {
        heading: "5. 审计与报告",
        content: [
          "审计日志：",
          "- audit_log 表记录所有写操作（INSERT / UPDATE / DELETE）",
          "- 日志字段：timestamp、table_name、operation、record_id、old_data、new_data、source",
          "- 日志保留 1 年",
          "- 支持导出审计日志（CSV 格式）",
          "",
          "季度安全审计：",
          "- 每季度进行一次安全审计",
          "- 审计内容：访问日志、异常行为、安全事件",
          "- 审计报告提交给管理层",
          "",
          "渗透测试：",
          "- 每年进行一次渗透测试",
          "- 测试内容：OWASP Top 10、认证绕过、数据泄露",
          "- 测试报告提交给合规团队",
        ],
      },
    ],
  },
  {
    file: "documents/性能测试报告.docx",
    title: "i-Write 性能测试报告",
    version: "v1.0",
    author: "杨飞",
    date: "2026-06-20",
    status: "已发布",
    sections: [
      {
        heading: "1. 测试概述",
        content: [
          "测试目标：验证 i-Write 系统在高并发场景下的性能表现，确保满足 SLA 要求。",
          "",
          "测试环境：",
          "- 服务器：4 核 8GB 内存",
          "- 数据库：SQLite（WAL 模式）",
          "- 并发用户：100",
          "- 测试时长：30 分钟",
          "",
          "SLA 要求：",
          "- API 响应时间 < 500ms（P95）",
          "- 文档生成时间 < 30 秒（P95）",
          "- RAG 检索时间 < 3 秒（P95）",
          "- 错误率 < 1%",
        ],
      },
      {
        heading: "2. 测试结果",
        content: [
          "性能测试结果：",
          "",
          "指标 | P50 | P95 | P99 | SLA 目标 | 结论",
          "API 响应时间 | 120ms | 380ms | 650ms | < 500ms | ✅ 满足",
          "文档生成时间 | 12 秒 | 25 秒 | 45 秒 | < 30 秒 | ✅ 满足",
          "RAG 检索时间 | 1.2 秒 | 2.8 秒 | 4.5 秒 | < 3 秒 | ✅ 满足",
          "错误率 | — | — | — | < 1% | ✅ 0.67%",
          "",
          "总请求：180,000 | 错误请求：1,200 | 错误率：0.67%",
        ],
      },
      {
        heading: "3. 性能瓶颈分析",
        content: [
          "瓶颈 1: RAG 检索延迟",
          "- 原因：向量检索需要遍历所有向量",
          "- 优化：使用向量索引（FAISS）加速",
          "- 预期效果：延迟降低 50%",
          "",
          "瓶颈 2: 文档生成延迟",
          "- 原因：LLM 调用耗时（10-20 秒）",
          "- 优化：使用流式响应（Streaming）",
          "- 预期效果：用户体验提升（实时看到生成内容）",
          "",
          "瓶颈 3: 数据库写入延迟",
          "- 原因：SQLite 单写者限制",
          "- 优化：使用连接池 + 批量写入",
          "- 预期效果：写入吞吐量提升 3 倍",
        ],
      },
      {
        heading: "4. 优化建议",
        content: [
          "短期优化（Sprint 4）：",
          "- 使用向量索引（FAISS）加速向量检索",
          "- 使用流式响应（Streaming）提升用户体验",
          "- 使用连接池 + 批量写入提升数据库性能",
          "",
          "中期优化（Sprint 5-6）：",
          "- 使用 Redis 缓存频繁查询的结果",
          "- 使用 CDN 加速静态资源",
          "- 使用负载均衡（Nginx）分发请求",
          "",
          "长期优化（Sprint 7+）：",
          "- 迁移到 PostgreSQL（支持并发写入）",
          "- 使用 Kubernetes 自动扩缩容",
          "- 使用微服务架构（检索服务、生成服务独立部署）",
        ],
      },
      {
        heading: "5. 压力测试详情",
        content: [
          "测试场景：",
          "",
          "场景 1: API 接口压力测试",
          "- 并发用户：100",
          "- 请求类型：GET /api/people, GET /api/knowledge/sources",
          "- 持续时间：30 分钟",
          "- 结果：P95 延迟 380ms，错误率 0.3%",
          "",
          "场景 2: 文档生成压力测试",
          "- 并发用户：20",
          "- 请求类型：POST /api/generation（生成 1000 字文档）",
          "- 持续时间：30 分钟",
          "- 结果：P95 延迟 25 秒，错误率 0.8%",
          "",
          "场景 3: RAG 检索压力测试",
          "- 并发用户：50",
          "- 请求类型：POST /api/knowledge/search",
          "- 持续时间：30 分钟",
          "- 结果：P95 延迟 2.8 秒，错误率 0.5%",
          "",
          "场景 4: 混合压力测试",
          "- 并发用户：100",
          "- 请求类型：混合（API + 生成 + 检索）",
          "- 持续时间：30 分钟",
          "- 结果：P95 延迟 3.2 秒，错误率 0.67%",
        ],
      },
      {
        heading: "6. 监控指标",
        content: [
          "关键监控指标：",
          "",
          "性能指标：",
          "- API 响应时间（P50/P95/P99）",
          "- 文档生成时间（P50/P95/P99）",
          "- RAG 检索时间（P50/P95/P99）",
          "- 吞吐量（请求/秒）",
          "",
          "资源指标：",
          "- CPU 使用率（目标 < 80%）",
          "- 内存使用率（目标 < 80%）",
          "- 磁盘 I/O（目标 < 80%）",
          "- 网络 I/O（目标 < 80%）",
          "",
          "业务指标：",
          "- 错误率（目标 < 1%）",
          "- 支付成功率（目标 > 99%）",
          "- 用户登录成功率（目标 > 99.5%）",
          "- 知识库检索准确率（目标 > 85%）",
          "",
          "告警规则：",
          "- API 响应时间 P95 > 1 秒 — 告警",
          "- 错误率 > 5% — 立即告警",
          "- CPU 使用率 > 90% — 告警",
          "- 内存使用率 > 90% — 告警",
        ],
      },
      {
        heading: "7. 结论",
        content: [
          "测试结论：",
          "",
          "1. API 响应时间满足 SLA（P95 < 500ms）✅",
          "2. 文档生成时间满足 SLA（P95 < 30 秒）✅",
          "3. RAG 检索时间满足 SLA（P95 < 3 秒）✅",
          "4. 错误率满足 SLA（< 1%）✅",
          "",
          "建议：",
          "1. 短期：使用向量索引（FAISS）加速 RAG 检索",
          "2. 中期：使用 Redis 缓存频繁查询的结果",
          "3. 长期：迁移到 PostgreSQL，使用 Kubernetes 自动扩缩容",
          "",
          "风险：",
          "1. SQLite 单写者限制可能在高并发场景下成为瓶颈",
          "2. LLM 调用延迟可能在高峰期增加",
          "3. 向量检索可能在知识库增大后变慢",
        ],
      },
    ],
  },
  {
    file: "documents/GoToMarket策略文档.docx",
    title: "i-Write GoToMarket 策略文档",
    version: "v1.0",
    author: "苏楠、王莉",
    date: "2026-06-24",
    status: "已发布",
    sections: [
      {
        heading: "1. 产品愿景",
        content: [
          "i-Write 的愿景是成为企业级可信文档生成平台，帮助知识工作者高效生成高质量文档。",
          "",
          "核心价值主张：",
          "- 溯源能力：每个引用都能追溯到原始文档",
          "- 知识库集成：连接企业内部知识源",
          "- Trust Score：每个生成文档都有可信度评分",
          "- 评估闭环：自动生成评估报告",
          "",
          "目标市场：",
          "- 市场规模：$4.2B（企业内容生成市场）",
          "- 目标客户：产品经理、工程师、咨询顾问",
          "- 竞品：Jasper、Copy.ai、Notion AI",
        ],
      },
      {
        heading: "2. 目标客户画像",
        content: [
          "客户类型 1: 产品经理（PM）",
          "- 痛点：写 PRD 花费大量时间，需要手动整理市场数据、竞品分析、用户反馈",
          "- 使用场景：生成 PRD、竞品分析报告、用户反馈汇总",
          "- 决策因素：效率提升、内容质量、溯源能力",
          "- 预算：$19/月（个人）或 $49/月/人（团队）",
          "",
          "客户类型 2: 工程师（Engineer）",
          "- 痛点：写技术文档、API 文档、架构设计文档耗时",
          "- 使用场景：生成技术方案、API 文档、代码审查报告",
          "- 决策因素：准确性、代码片段支持、与 GitHub 集成",
          "- 预算：$19/月（个人）",
          "",
          "客户类型 3: 咨询顾问（Consultant）",
          "- 痛点：为客户写行业报告、市场分析、商业计划书",
          "- 使用场景：生成行业报告、市场分析、商业计划书",
          "- 决策因素：内容深度、专业性、可定制性",
          "- 预算：$49/月/人（团队版）",
        ],
      },
      {
        heading: "3. 定价策略",
        content: [
          "PLG（Product-Led Growth）策略：",
          "- 免费版吸引用户，付费版转化",
          "- 免费版限制：5 次文档生成/月、1 个知识源、无导出功能",
          "- 付费版解锁：无限次文档生成、10+ 知识源、Word/PPT/Excel 导出",
          "",
          "定价对比（竞品）：",
          "- Jasper: $49/月（AI 写作）— 无溯源、无知识库",
          "- Copy.ai: $36/月（AI 写作）— 无溯源、无知识库",
          "- Notion AI: $10/月（AI 辅助）— 无溯源、无独立产品",
          "- i-Write: $19/月（AI 文档生成）— 溯源、知识库、评估",
          "",
          "i-Write 差异化：",
          "- 溯源能力：每个引用都能追溯到原始文档",
          "- 知识库集成：连接企业内部知识源",
          "- Trust Score：每个生成文档都有可信度评分",
          "- 评估闭环：自动生成评估报告",
        ],
      },
      {
        heading: "4. 渠道策略",
        content: [
          "线上渠道：",
          "- 产品官网（landing page）— 王莉负责设计",
          "- 技术博客（Medium、掘金）— 陈强、刘伟撰写技术文章",
          "- 社交媒体（Twitter、LinkedIn）— 王莉负责运营",
          "- Product Hunt 发布 — 计划 7 月中旬",
          "",
          "线下渠道：",
          "- 技术大会演讲（QCon、ArchSummit）— 陈强负责",
          "- 企业客户拜访 — 张伟负责",
          "- 合作伙伴推荐 — 李鑫负责",
          "",
          "客户获取成本（CAC）目标：",
          "- 免费用户：$0（自然增长）",
          "- 付费用户：$50（通过内容营销）",
          "- 企业客户：$500（通过销售团队）",
        ],
      },
      {
        heading: "5. 竞品分析",
        content: [
          "竞品对比：",
          "",
          "产品 | 价格 | 溯源能力 | 知识库集成 | Trust Score | 目标客户",
          "i-Write | $19/月 | ✅ chunk 级别 | ✅ 10+ 源 | ✅ 5 维度 | PM/工程师/顾问",
          "Jasper | $49/月 | ❌ | ❌ | ❌ | 营销团队/内容创作者",
          "Copy.ai | $36/月 | ❌ | ❌ | ❌ | 营销团队/自由职业者",
          "Notion AI | $10/月 | ❌ | ⚠️ 基础 | ❌ | Notion 用户/个人用户",
          "",
          "i-Write 差异化：",
          "- 溯源能力：每个引用都能追溯到原始文档",
          "- 知识库集成：连接企业内部知识源",
          "- Trust Score：每个生成文档都有可信度评分",
          "- 评估闭环：自动生成评估报告",
        ],
      },
      {
        heading: "6. 时间线",
        content: [
          "GoToMarket 时间线：",
          "",
          "6 月底前：",
          "- Landing page 设计完成（王莉）",
          "- 产品介绍视频脚本（王莉）",
          "- 技术博客 3 篇（陈强、刘伟）",
          "- 社交媒体账号开通（Twitter、LinkedIn）",
          "",
          "7 月上旬：",
          "- Landing page 上线（徐骏部署）",
          "- 产品介绍视频录制（王莉）",
          "- Product Hunt 提前预热（王莉）",
          "- 首批 Beta 用户邀请（李鑫）",
          "",
          "7 月中旬：",
          "- Product Hunt 发布（目标 Top 5）",
          "- 技术大会演讲（QCon，陈强）",
          "- 企业客户拜访（张伟）",
          "",
          "7 月底：",
          "- Acme Corp 合同签订（张伟）",
          "- 首月数据复盘（苏楠）",
        ],
      },
      {
        heading: "7. 成功指标",
        content: [
          "GoToMarket 成功指标：",
          "",
          "用户增长：",
          "- 7 月底：1000 注册用户",
          "- 8 月底：5000 注册用户",
          "- 9 月底：10000 注册用户",
          "",
          "付费转化：",
          "- 免费→付费转化率：5%",
          "- 付费用户 ARPU：$19/月",
          "- 企业客户 ARPU：$2,450/月（50 人团队）",
          "",
          "收入目标：",
          "- 7 月底：$5,000 MRR",
          "- 8 月底：$25,000 MRR",
          "- 9 月底：$50,000 MRR",
          "",
          "客户满意度：",
          "- NPS > 8",
          "- 客户流失率 < 5%/月",
          "- 客户支持响应时间 < 24 小时",
        ],
      },
    ],
  },
  {
    file: "documents/客户案例研究.docx",
    title: "i-Write 客户案例研究 — Acme Corp",
    version: "v1.0",
    author: "李鑫",
    date: "2026-06-25",
    status: "初稿",
    sections: [
      {
        heading: "1. 客户背景",
        content: [
          "Acme Corp 是一家 200 人的科技公司，主要产品是企业协作工具。",
          "",
          "客户痛点：",
          "- 产品经理写 PRD 平均花费 2 天，需要手动整理市场数据、竞品分析、用户反馈",
          "- 工程师写技术文档平均花费 1 天，需要查阅多个知识源",
          "- 咨询顾问写行业报告平均花费 3 天，需要整合多个数据源",
          "",
          "决策人：CTO（赵军对接）",
          "预算：$49/月/人 × 50 人 = $2,450/月（年付 $23,520）",
          "时间线：希望 7 月底前上线",
        ],
      },
      {
        heading: "2. 解决方案",
        content: [
          "i-Write 为 Acme Corp 提供以下解决方案：",
          "",
          "知识库集成：",
          "- 连接 Microsoft OneDrive（企业文档）",
          "- 连接 GitHub（代码仓库）",
          "- 连接 Confluence（内部 Wiki）",
          "",
          "文档生成：",
          "- PRD 生成：自动整理市场数据、竞品分析、用户反馈",
          "- 技术文档生成：自动查阅知识源，生成准确的技术方案",
          "- 行业报告生成：自动整合多个数据源，生成专业的行业报告",
          "",
          "溯源能力：",
          "- 每个引用都能追溯到原始文档",
          "- Trust Score 评估生成内容的可信度",
          "- 自动生成评估报告",
        ],
      },
      {
        heading: "3. ROI 分析",
        content: [
          "时间节省：",
          "",
          "角色 | 原始时间 | 使用 i-Write 后 | 节省比例",
          "产品经理（PRD） | 2 天 | 2 小时 | 90%",
          "工程师（技术文档） | 1 天 | 1 小时 | 90%",
          "咨询顾问（行业报告） | 3 天 | 3 小时 | 90%",
          "",
          "成本节省：",
          "",
          "项目 | 金额 | 说明",
          "团队规模 | 50 人 | 平均薪资 $50/小时",
          "每月节省时间 | $20,000/月 | 50 人 × 8 小时/月 × $50/小时",
          "i-Write 费用 | $2,450/月 | $49/月/人 × 50 人",
          "净节省 | $17,550/月 | ROI: 716%",
          "",
          "质量提升：",
          "- 溯源能力确保内容准确性",
          "- Trust Score 评估可信度",
          "- 减少人工校对时间",
        ],
      },
      {
        heading: "4. 用户证言",
        content: [
          "Acme Corp CTO 赵军：",
          "「i-Write 帮助我们的产品经理和工程师节省了大量时间，以前写一份 PRD 需要 2 天，现在只需要 2 小时。溯源功能让我们可以快速验证生成内容的准确性，Trust Score 让我们对生成内容有信心。」",
          "",
          "Acme Corp 高级产品经理：",
          "「i-Write 的知识库集成非常方便，我可以直接连接公司的 OneDrive 和 Confluence，生成的 PRD 自动引用了最新的市场数据和用户反馈。以前我需要花半天时间整理这些资料，现在 i-Write 帮我自动完成了。」",
          "",
          "Acme Corp 高级工程师：",
          "「i-Write 的技术文档生成功能非常准确，它能自动查阅我们的 GitHub 仓库和内部文档，生成的技术方案引用了最新的代码和设计文档。以前我写一份技术方案需要 1 天，现在只需要 1 小时。」",
        ],
      },
      {
        heading: "5. 实施计划",
        content: [
          "Acme Corp 实施计划：",
          "",
          "Phase 1: 环境搭建（1 周）",
          "- 部署 i-Write 到 Acme Corp 内部服务器",
          "- 配置 Azure AD SSO 集成",
          "- 配置 Microsoft OneDrive 知识源",
          "- 配置 GitHub 知识源",
          "",
          "Phase 2: 数据迁移（1 周）",
          "- 导入现有文档到知识库",
          "- 配置文档分类和标签",
          "- 测试 RAG 检索准确率",
          "",
          "Phase 3: 用户培训（1 周）",
          "- 管理员培训（2 小时）",
          "- 普通用户培训（1 小时）",
          "- 编写用户手册",
          "",
          "Phase 4: 试运行（2 周）",
          "- 10 人试用团队",
          "- 收集反馈和建议",
          "- 优化配置和流程",
          "",
          "Phase 5: 全面上线（1 周）",
          "- 50 人团队全面使用",
          "- 监控系统性能",
          "- 提供技术支持",
        ],
      },
      {
        heading: "6. 风险和缓解",
        content: [
          "风险识别和缓解措施：",
          "",
          "风险 1: 数据安全",
          "- 风险：企业敏感数据泄露",
          "- 缓解：数据加密、访问控制、审计日志",
          "- 责任人：陈强（技术负责人）",
          "",
          "风险 2: 系统稳定性",
          "- 风险：系统宕机影响业务",
          "- 缓解：高可用部署、自动备份、故障恢复",
          "- 责任人：徐骏（DevOps）",
          "",
          "风险 3: 用户接受度",
          "- 风险：用户不愿意使用新工具",
          "- 缓解：用户培训、持续优化、快速响应反馈",
          "- 责任人：李鑫（客户成功）",
          "",
          "风险 4: 成本超支",
          "- 风险：LLM 调用成本超预期",
          "- 缓解：缓存优化、批量处理、成本监控",
          "- 责任人：陈强（技术负责人）",
        ],
      },
    ],
  },
];
// PLACEHOLDER_TECHDOCS_END

// ── 生成 DOCX 文件 ──────────────────────────────────────

async function generateDocx(filePath: string, title: string, meta: Record<string, string>, sections: Array<{ heading: string; content: string[] }>) {
  try {
    const docx = await import("docx");
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } = docx;

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

    // Helper: detect table rows (lines with " | " separator)
    function isTableRow(line: string): boolean {
      const cols = line.split(" | ");
      return cols.length >= 2 && !line.startsWith("- ") && !line.startsWith("1.") && !line.startsWith("2.");
    }

    // Helper: create a docx table from table rows
    function createTable(rows: string[]): any {
      const parsedRows = rows.map(r => r.split(" | ").map(c => c.trim()));
      const colCount = Math.max(...parsedRows.map(r => r.length));
      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
      const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

      return new Table({
        rows: parsedRows.map((cells, rowIdx) =>
          new TableRow({
            children: Array.from({ length: colCount }, (_, colIdx) => {
              const text = cells[colIdx] || "";
              const isHeader = rowIdx === 0;
              return new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text, bold: isHeader, size: 20 })],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
                borders,
                shading: isHeader ? { type: ShadingType.SOLID, color: "E2E8F0" } : undefined,
                width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
              });
            }),
          })
        ),
        width: { size: 9000, type: WidthType.DXA },
      });
    }

    // Sections
    for (const section of sections) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.heading, bold: true, size: 26 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        })
      );

      // Group consecutive table rows
      let tableRows: string[] = [];
      for (const line of section.content) {
        if (isTableRow(line)) {
          tableRows.push(line);
        } else {
          // Flush accumulated table rows
          if (tableRows.length > 0) {
            children.push(createTable(tableRows));
            children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
            tableRows = [];
          }
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 22 })],
              spacing: { after: 80 },
            })
          );
        }
      }
      // Flush remaining table rows
      if (tableRows.length > 0) {
        children.push(createTable(tableRows));
        children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
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
