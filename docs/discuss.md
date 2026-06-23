# i-Write, a Document Generation Studio — 讨论记录

> 记录从项目想法诞生到 MVP 方案确定的全过程讨论。
> 注：产品原名 Document Studio，后改名为 i-Write，详见 PRD 命名章节。

---

## 第一轮：项目方向选择

**用户：**

有个比赛 `https://www.trae.cn/ai-creativity?utm_source=IDE&user_id=2358912376902076&username=kun&product=trae`

帮我想一个参赛的题目/项目 idear。现在初步的想法是：
- 现在的patentExaminator （ `https://github.com/wukun2005-gif/patentExaminator` ） ，第二赛道
- 做一个Office products family 里，自动根据 这些产品存储的 knowledge （自己的文档和自己可以访问的其他人的文档）生成自己想要的office 文档的 插件工具 ？工具还自带一个离线评估小平台，可以知道评估生成质量，让用户对生成的内容的事实依据有信心有完全的了解有溯源可查有信心可以发布生成的内容。属于第二赛道
- 或者GraphMe （ `https://github.com/wukun2005-gif/GraphMe` ）进一步变成可以使用的产品？把用户的所有chatGPT的聊天记录都导入，成为可视化的记忆前端 ？但这算哪个赛道呢？

有什么想法、建议和意见吗？

**AI：**

## 赛道确认

比赛有 4 个通用赛道：
- **赛道一**：生活娱乐 / 造点新花样
- **赛道二**：学习工作 / 造个新解法
- **赛道三**：社会服务 / 造种新体验
- **赛道四**：硬件交互 / 造个新物种
- 附加赛题：智慧助老、青少年身心健康、古籍活化、非遗创新

你说的"第二赛道"就是**赛道二：学习工作**。

## 三个方案对比分析

### 方案一：patentExaminator（赛道二）

| 维度 | 评价 |
|------|------|
| 完成度 | 很高，已有完整产品 + PRD/DESIGN/DEV PLAN |
| 技术亮点 | RAG + Web Search + Groundedness 三重知识增强 + 离线评估平台 |
| 差异化 | 离线评估平台是杀手锏，让用户对 AI 输出"有信心" |
| 风险 | 太 niche（专利审查员），评委可能难以共鸣；已有大量代码，是否能算"比赛期间用 TRAE 创作"存疑 |

### 方案二：Office 知识插件 + 离线评估（赛道二）

| 维度 | 评价 |
|------|------|
| 创新性 | 把 RAG + Groundedness 思路从专利场景迁移到 Office 全家桶，思路新颖 |
| 实用价值 | 每个 Office 用户都可能用到，受众极广 |
| 差异化 | "离线评估 + 事实溯源 + 可发布信心" 这个三位一体角度，目前市场上没有竞品 |
| 赛道匹配 | 完美契合"学习工作/造个新解法" |
| 风险 | 从零开发量大，Office 插件集成（Outlook/Word/Excel/PPT）有技术复杂度 |

### 方案三：GraphMe（不确定赛道）

| 维度 | 评价 |
|------|------|
| 视觉效果 | 3D 记忆星云非常抓眼球，演示效果好 |
| 赛道归属 | 有点模糊——导入 ChatGPT 聊天记录做知识管理 → 赛道二；做记忆可视化回顾 → 赛道一；做 AI 陪伴记忆 → 附加赛题（智慧助老/青少年） |
| 技术深度 | 双层记忆模型、CQI 评分、10 维度数据模型有深度 |
| 风险 | 赛道定位不清晰是最大问题；"导入 ChatGPT 聊天记录"可能涉隐私合规问题 |

## 我的建议：方案二，融合方案一的技术

**推荐方向：Office Knowledge Studio — 基于可信 AI 的 Office 文档智能生成插件**

核心思路：

```
你已有的 Office 文档（Word/PPT/Excel/Outlook）
        +
你可访问的团队/组织的共享文档
        ↓
    RAG 知识检索
        ↓
   AI 生成目标文档（报告/方案/PPT/邮件）
        ↓
  离线评估平台（Groundedness 验证 + 事实溯源）
        ↓
  用户对生成内容有信心 → 可发布
```

**为什么选这个：**

1. **赛道二完美匹配**：学习工作场景，解决真实痛点
2. **复用 patentExaminator 技术栈**：RAG + Groundedness + 离线评估是你的核心长板，直接迁移
3. **差异化足够强**：市面上 Copilot 能生成文档，但**没有产品能做到"生成后告诉你哪些内容可信、哪些需要核实、每条事实来自哪份文档"**。这个"可溯源的 AI 生成"是独特卖点
4. **演示效果好**：离线评估平台可以做成 Dashboard，展示 Groundedness 分数、事实溯源链接，评委一眼就懂
5. **工作量可控**：核心引擎（RAG + 评估）可以从 patentExaminator 复用，比赛期间主要做 Office 前端界面 + 插件集成

**专利复审助手可以作为"垂直场景案例"展示**，证明这套技术栈在专业场景的有效性。

## 如果倾向 GraphMe

GraphMe 建议走**赛道一（生活娱乐）**，定位为"AI 记忆可视化与回顾工具"，核心故事：
- 把你的 ChatGPT 对话变成可视化的记忆星云
- 发现被遗忘的高价值对话
- 情感化、美学化的记忆回顾体验

但需要解决隐私合规问题，以及"这和赛道二有什么关系"的评委疑问。

## 总结

| 推荐度 | 方案 | 赛道 |
|--------|------|------|
| 最推荐 | Office Knowledge Studio（融合 patentExaminator 技术） | 赛道二 |
| 备选 | patentExaminator 原样提交 | 赛道二 |
| 可考虑 | GraphMe 产品化 | 赛道一 |

---

## 第二轮：产品方向细化

**用户：**

Office （或者字节文档/万维表格/ apple keynote, numbers, pages 等文档）document generation based on the knowledge, 我想把它做成跨平台（跨os，跨生产力工具平台，比如office， apple， ）的一个 Document Studio。 用户在各个平台的knowledge （包括飞书、微信、Teams等social 平台、小红书、微博、知乎、arxive、等） 来生成用户想要的叙事逻辑的文档定制平台。Document Customization Studio.

更重要的，对生成的文档的metrics定义，以及基于这些定义的离线评估平台。

展示文档的生成树，是基于什么来源最后生成的。

**AI：**

## Document Studio — 跨平台可信文档生成工作台

### 一句话定位

> 连接你所有平台的知识碎片，按你定义的叙事逻辑生成文档，并用可量化的评估体系告诉你：这份文档有多可信、每条事实来自哪里。

### 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Connectors                       │
│  飞书 │ 微信 │ Teams │ 小红书 │ 微博 │ 知乎 │ arXiv │ 本地文档  │
│  Office │ Apple iWork │ 字节文档 │ 万维表格 │ 更多...         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Narrative Engine（叙事引擎）                  │
│  用户定义：文档结构 → 叙事逻辑 → 章节大纲 → 风格偏好           │
│  模板市场：周报 / 调研报告 / 商业计划书 / PPT / 学术综述...      │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Generation + Trust Layer（生成+信任层）           │
│  RAG 检索 → LLM 生成 → Groundedness 验证 → 事实溯源           │
│                      │                                       │
│              离线评估平台                                      │
│          Metrics 定义 · Golden Set · Multi-Judge              │
│                      │                                       │
│              生成树可视化                                      │
│      每段文字 → 可追溯到来源文档的第几页第几段                   │
└─────────────────────────────────────────────────────────────┘
```

### 核心差异化：三个"为什么选你"

**1. 全平台知识连接器（广度）**

不是又一个"上传文档让 AI 总结"的工具。而是像一个**知识聚合器**，你把各个平台的账号一连，它就自动索引你的知识资产：
- 工作知识：飞书文档、Teams 聊天、邮件、万维表格
- 公共知识：知乎收藏、arXiv 论文、小红书笔记
- 本地知识：Office 文档、Apple iWork、本地文件夹

**2. 叙事引擎（用户控制权）**

市面上 Copilot 帮你生成文档，但"怎么生成"是黑盒。Document Studio 让用户**定义叙事逻辑**：
- 我想写一份行业调研报告，结构是：背景 → 竞品分析 → 技术趋势 → 结论
- 背景部分主要引用 arXiv 论文，竞品分析主要引用知乎和小红书
- 技术趋势部分引用我自己的飞书文档中的技术笔记
- 语气风格：学术严谨 / 商业汇报 / 通俗科普

**3. 信任体系（最关键差异）**

这是 patentExaminator 核心能力的迁移放大：

| 能力 | 说明 |
|------|------|
| Metrics 定义 | 用户可自定义评估维度：事实准确性 / 来源覆盖度 / 逻辑一致性 / 叙事流畅度 / 引用完整性 |
| 离线评估平台 | 导入 Golden Set（人工标注的理想输出），Multi-Judge 自动评分，持续监控生成质量 |
| 生成树可视化 | 文档中任意一段文字，点击即可展开"生成树"——这条结论来自哪份文档的哪一页、经过了怎样的推理链条 |

### 生成树（Provenance Tree）设计

```
📄 最终文档段落："石墨烯电池的能量密度可达 400Wh/kg"
│
├── 🔗 来源 1: arXiv 论文 "Graphene-based..." (2024, Fig.3)
│   └── 置信度: 0.92 | 引用: 第 4 页第 2 段
│
├── 🔗 来源 2: 飞书文档《电池技术调研报告》(你的团队文档)
│   └── 置信度: 0.85 | 引用: 第 7 页表格
│
├── 🔗 来源 3: 知乎专栏《新能源电池技术路线对比》
│   └── 置信度: 0.71 | 引用: 评论区高赞回复
│
└── ⚠️ Groundedness 综合评分: 0.83
    └── 建议：第 3 来源置信度偏低，建议核实或替换
```

### 赛道匹配：赛道二（学习工作）

完美契合。核心故事线：

> 现代知识工作者的信息分散在十几个平台，写一份靠谱的文档需要在多个平台来回切换、复制粘贴、手动核对。Document Studio 把这些碎片连接起来，让你像指挥乐队一样编排知识，生成文档的同时给你一份"可信度报告"。

### 参赛建设策略

考虑到比赛时间（初赛 7/15 截止），建议分阶段：

**初赛 Demo（可运行的最小 MVP）：**
- Web 应用（TRAE IDE 构建）
- 支持 3-5 个知识源连接器（本地文档 + 飞书 + arXiv + 知乎 + 小红书）
- 2-3 种文档模板（周报 / 调研报告 / PPT 大纲）
- 离线评估平台（从 patentExaminator 移植）
- 生成树可视化（核心亮点，Demo 重点展示）
- 跨平台用 Electron 套壳，展示"一个工具打开所有平台文档"

**Demo 展示流程设计：**
1. 连接知识源 → 展示飞书文档、arXiv 论文、知乎收藏自动索引
2. 选择模板"AI 行业调研报告" → 用户微调叙事结构
3. 一键生成 → 文档 + 生成树 + Groundedness 评分面板
4. 点击生成树节点 → 展示事实溯源，打开原始文档定位到具体位置
5. 离线评估面板 → 展示与 Golden Set 对比的评分

### 命名建议

几个选项供参考：
- **Document Studio** — 简洁直接
- **KnowledgeWeaver** — 强调知识编织
- **DocTrust** — 强调信任
- **SourceCraft** — 来源 + 工艺

### 与 patentExaminator 的关系

patentExaminator 可以作为一个**垂直场景案例**在 Demo 中展示："同样的技术栈，在专利审查这个高精度场景已经验证有效，现在我们把它扩展到所有人的文档创作中。"

---

## 第三轮：Office API 可行性调研

**用户：**

现在的office 软件（word，excel， teams，powerpoint，etc.) 有没有公开的api可以直接使用？这样可以做出一个office插件来把这个功能直接带入office 产品家族。比如anthropic 做了一个claude for excel 是不是就是使用这些office api来达到的？

**AI：**

是的，**Microsoft Office 有非常成熟的公开 API**，而且 Anthropic 的 Claude for Excel/PowerPoint/Word 正是基于这些 API 构建的。

## Microsoft Office 的 API 体系

### Office.js JavaScript API（核心）

这是 Office Add-in 的核心 API，**跨平台**（Windows、Mac、iPad、Web 版），一套代码到处运行：

| 能力 | 说明 |
|------|------|
| **Word API** | 读写文档内容、插入/替换段落、管理样式、脚注引用、注释 |
| **Excel API** | 读写单元格、表格、图表、公式、数据透视表、数据类型 |
| **PowerPoint API** | 读写幻灯片内容、形状、文本框、图片 |
| **Outlook API** | 读取邮件、日历、附件、上下文信息 |
| **Common API** | 对话框、UI 面板、用户身份认证（SSO）、设置 |

开发方式：**纯 HTML + CSS + JavaScript**，本质上是一个 Web 应用嵌入 Office 侧边栏。

### Claude for Excel 的实现方式

被证实就是基于 **Office.js (Excel JavaScript API)** 构建的 Office Add-in：
- 通过 Excel JavaScript API 读写工作簿数据
- 在侧边栏加载 Claude 的 Web 界面
- 通过 OAuth 连接 Claude 账号
- 支持 cell-level citation（单元格级溯源）
- 发布到 Microsoft AppSource 市场

源码参考：[Claude for Excel - Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/office/WA200010725)

### Microsoft Teams API

Teams 也有完整的 API 体系：
- **Microsoft Graph API**：读取 Teams 消息、频道、文件、用户
- **Bot Framework**：构建机器人，可以读取/发送消息
- **Messaging Extension**：搜索、操作命令
- **Microsoft 365 Agents Toolkit**：统一开发工具（VS Code 插件）

## 这对 Document Studio 意味着什么

你可以走**两条路线**，或者两条都做：

### 路线 A：Office Add-in（推荐作为 Demo 主力）

```
用户打开 Word/Excel/PowerPoint
    │
    ├─ 侧边栏加载 Document Studio 面板
    │   ├─ 选择知识源（飞书/Teams/本地/arXiv/知乎...）
    │   ├─ 选择模板（周报/调研报告/PPT/...）
    │   ├─ 定义叙事逻辑
    │   └─ 点击生成
    │
    └─ 结果直接写入当前文档
        └─ 附带生成树 + Groundedness 评分
```

**优势**：
- 一套代码 (HTML/JS/CSS) 跑在 Word、Excel、PPT 上
- 跨平台 (Windows/Mac/iPad/Web)
- 用户不需要离开 Office 就能使用
- 可以用 office.js 直接读写文档内容
- 可以发布到 Microsoft AppSource

### 路线 B：独立 Web 应用 + 多平台 Connector

```
Document Studio (Web 应用)
    ├─ Microsoft Graph API → Teams 消息、SharePoint 文档
    ├─ Feishu Open API → 飞书文档、飞书表格
    ├─ Office.js Add-in → Word/Excel/PPT 内容
    ├─ arXiv API → 论文
    ├─ 浏览器扩展 → 知乎/小红书/微博收藏
    └─ 本地文件 → 拖拽上传
```

## 参赛 Demo 的务实建议

初赛 Demo 建议聚焦 **Office Add-in + 3 个知识源 + 生成树**：

| 组件 | 实现方式 | 工作量 |
|------|---------|--------|
| Word Add-in 侧边栏 | Office.js + React | 复用 patentExaminator 前端 |
| Excel Add-in 侧边栏 | 同一套代码，office.js 宿主检测 | 几乎零额外成本 |
| 知识源 - 本地文档 | 拖拽上传 + RAG 索引 | 已有 |
| 知识源 - 飞书/Teams | OAuth + Graph API / Feishu API | 中等 |
| 知识源 - arXiv | 公开 API | 低 |
| 文档生成引擎 | RAG + LLM | 已有 |
| 生成树可视化 | 前端 D3/ECharts 树图 | 新做，工作量可控 |
| 离线评估平台 | 从 patentExaminator 移植 | 已有 |

**关键演示流程**：

1. 在 Word 中打开 Document Studio 插件
2. 连接飞书文档 + arXiv + 本地文件夹
3. 选择模板"行业调研报告"，微调叙事结构
4. 点击生成 → 文档自动写入 Word
5. 点击任意段落 → 展开生成树，看到每条事实来自哪里
6. 打开评估面板 → 看到 Groundedness 评分

总结：**Office 的 API 足够成熟，完全可以做一个功能完整的 Office Add-in**。Claude for Excel 已经验证了这条路。你的 Document Studio 在此基础上增加了"跨平台知识源聚合 + 叙事引擎 + 生成树溯源 + 离线评估"，差异化足够强。

---

## 第四轮：免费 Office Online 可行性

**用户：**

我没有本地的office 应用 （我是macos，本地基本没有windows任何应用），一直都是使用这些app的免费 online版本： `https://word.cloud.microsoft.com/zh-hans/` ， `https://excel.cloud.microsoft.com/zh-hans/` `https://powerpoint.cloud.microsoft.com/zh-hans/` ， `https://onenote.cloud.microsoft.com/zh-hans/` `https://teams.live.com/v2/` `https://onedrive.live.com/?view=1` `https://outlook.live.com/mail/` `https://m365.cloud.microsoft/chat/blocked?ct=M365Copilot-UHF-TopNav&fromcode=cmmk9q81uwj&redirfrom=CsrToSSR&utm_campaign=M365Copilot-UHF-TopNav&utm_source=mktgweb` ，通过MSA在线访问。没钱买本地的收费版本。这种免费优先的情况，能用Office api 做出 demo 吗？可行吗？

**AI：**

可以直接用，而且比你想的简单。

## 结论：Office Online 免费版完全支持 Add-in 开发

Microsoft 官方文档明确写了 **"Sideload Office Add-ins to Office on the web"**，并且区分了两种账号类型：

- **Microsoft account（个人免费账号）**→ 手动 sideload
- **Microsoft 365 tenant account（企业/组织账号）**→ 集中部署

你的 MSA 账号属于第一种，完全可以 sideload 自己开发的 Add-in 到 Word/Excel/PowerPoint Online。

## 具体操作方式

在你的 Word/Excel/PowerPoint Online 网页版中，直接 sideload：

1. 打开 https://word.cloud.microsoft.com（或 Excel/PPT）
2. 新建或打开一个文档
3. 在功能区点击 **"加载项"（Add-ins）** → **"上传我的加载项"（Upload My Add-in）**
4. 上传你的 manifest.xml 文件
5. Add-in 侧边栏就会出现

manifest 存储在浏览器 local storage 中，换浏览器或清缓存需要重新上传。

## 关于 Microsoft 365 Developer Program（E5 沙盒）

这个之前确实免费（90 天续期），但 **2025 年起微软收紧了资格**，现在只对以下人群开放：

- Visual Studio Professional/Enterprise 订阅者
- Microsoft AI Cloud Partner Program 成员
- 有 Premier/Unified Support 合同的企业

**你需要申请吗？不需要。** 因为你的目标是参赛 Demo，在 Office Online 免费版上 sideload 就足够了。

## 对你参赛的实际影响

| 问题 | 答案 |
|------|------|
| 能开发 Office Add-in 吗？ | 能，Office.js API 在 Web 版完整可用 |
| 需要付费账号吗？ | 不需要，免费 MSA 即可 |
| 能读写 Word/Excel/PPT 内容吗？ | 能，office.js 支持文档读写 |
| 能演示给评委看吗？ | 能，浏览器打开即可 |
| 能发布到 Marketplace 吗？ | 需要 Partner Center 账号（比赛阶段不需要） |

## 务实策略

**比赛 Demo 方案**：独立 Web 应用 + Office Add-in 双重入口

```
Document Studio 独立 Web 应用（主入口）
    │
    ├─ 知识源连接、叙事引擎、文档生成、评估平台
    │
    └─ 生成结果 → 一键推送到 Office Online
          │
          └─ 通过 Office Add-in（侧边栏）在 Word/Excel/PPT
              中直接打开生成结果，展示生成树溯源
```

这样 Demo 演示时：
1. 先在 Web 应用展示完整流程（知识连接 → 叙事定义 → 生成 → 评估）
2. 然后切到 Word Online，打开 Add-in 侧边栏，展示生成结果已写入文档
3. 点击任意段落展示生成树

**完全不需要付费账号，一套免费 MSA 搞定全部。**

---

## 第五轮：竞品调研与差异化分析

**用户：**

还需要做个竞品调研：现在的用户完全可以把所有的文档放在一个文件夹里，然后告诉LLM去自己读这个文件夹，然后按照指令生成指定格式和内容的文档，比如直接生成ppt。那为什么用户还需要这个docStudio产品？差异化在哪里？

先好好地认真全面升入仔细地做好市场调研，找出差异化方向。

**AI：**

进行了全面的竞品调研，覆盖五大类竞品：

### 第一类：通用 AI 对话 + 文件上传（ChatGPT、Claude、Gemini）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 上传文件夹/文件 | 能 | 会话级别的文件管理，无法持久化知识库；跨会话需要重新上传 |
| 读文档内容 | 能 | 受上下文窗口限制，大文件夹需要分批处理 |
| 生成文档/PPT | 能 | Claude 2025.9 上线文件生成；ChatGPT 有 Code Interpreter。但生成内容**没有事实溯源**，用户不知道每句话来自哪份文件 |
| 评估生成质量 | 不能 | 没有任何系统化的评估机制，用户只能靠肉眼判断 |

**关键差距**：ChatGPT/Claude 是"对话式生成"，不是"可信文档工作台"。它解决了"生成"问题，没有解决"可信"问题。

### 第二类：AI 研究助手（Google NotebookLM）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 上传文档作为知识源 | 能 | 支持 PDF、网页、YouTube 等，但仅限于**手动上传**，不能自动连接飞书/Teams/微信等平台 |
| 基于来源的问答 | 能 | 内联引用，指向原始段落——这是 NotebookLM 最强的地方 |
| 跨平台知识聚合 | 不能 | 只能上传文件，不能连接外部平台 API |
| 生成 Office 文档 | 不能 | 输出是笔记/FAQ/摘要/音频，不是 Word/Excel/PPT |
| 生成质量评估 | 不能 | 没有评估系统 |
| 叙事逻辑自定义 | 不能 | 无法让用户定义"用 arXiv 论文写技术趋势，用知乎写竞品分析"这种精细分配 |

**关键差距**：NotebookLM 是"研究助手"，不是"文档生成器"。它帮你理解内容，但不会帮你生成可交付的 Office 文档，更不会帮你评估生成质量。

### 第三类：AI 办公助手（Microsoft Copilot、Notion AI）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 基于生态内知识生成 | 能 | Copilot 可读 OneDrive/SharePoint/Teams/邮件；Notion AI 可读 Notion 工作区 |
| 跨平台知识聚合 | 不能 | Copilot 仅限于 Microsoft 365 生态；Notion AI 仅限于 Notion 生态 |
| 事实溯源 | 部分 | Copilot 提供引用，但仅限于 Microsoft 生态内；Notion AI 只引用 Notion 页面 |
| 离线评估平台 | 不能 | 没有 |
| 用户自定义叙事逻辑 | 不能 | 只能按系统预设的模式生成 |
| 免费使用 | 不能 | Copilot 需要 Microsoft 365 付费订阅（$30/用户/月）；Notion AI 需要付费 add-on |

**关键差距**：Copilot 和 Notion AI 是"生态锁定型"工具。它们只在自己的生态内工作，无法跨平台聚合知识。且需要付费订阅。

### 第四类：AI 演示文稿工具（Gamma、Beautiful.ai、Tome）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 从 prompt 生成 PPT | 能 | Gamma 30 秒生成 10 页 PPT |
| 基于个人知识生成 | 不能 | 生成的 PPT 内容来自 AI 的预训练知识，**不是来自你的文档** |
| 事实溯源 | 不能 | 完全没有来源追溯 |
| 生成质量评估 | 不能 | 没有 |
| 跨平台知识聚合 | 不能 | 不能连接你的飞书/Teams 等 |

**关键差距**：这些工具是"设计生成器"，不是"知识生成器"。它们让你快速做出好看的 PPT，但不保证内容的准确性和可追溯性。Tome 更是已在 2025 年 4 月关停原产品。

### 第五类：RAG 评估工具（Vertex AI、Ragas、Maxim）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| RAG 评估指标 | 能 | 提供 Faithfulness、Relevance、Groundedness 等指标 |
| 离线评估 | 能 | 支持批量评估 |
| 面向终端用户 | 不能 | 都是**开发者工具**，需要写代码配置，不是给普通用户用的 |
| 文档生成 | 不能 | 只评估，不生成 |

**关键差距**：评估能力存在，但全是开发者工具，没有一个产品把"文档生成 + 离线评估"做成面向普通用户的一体化体验。

### 差异化矩阵

| 能力维度 | ChatGPT / Claude | NotebookLM | Copilot | Gamma | RAG 评估工具 | **Document Studio** |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| 跨平台知识聚合 | 上传文件 | 上传文件 | 仅 MS 生态 | 无 | 无 | **飞书/Teams/微信/知乎/arXiv/本地** |
| 用户自定义叙事逻辑 | 无 | 无 | 无 | 无 | 无 | **章节结构 + 知识源分配 + 风格偏好** |
| 生成 Office 文档 | 能 | 不能 | 能 | 仅 PPT | 不能 | **Word/Excel/PPT** |
| 事实溯源（生成树） | 无 | 内联引用 | 生态内引用 | 无 | 无 | **段落级生成树 + 置信度** |
| 离线评估平台 | 无 | 无 | 无 | 无 | 开发者用 | **面向用户的离线评估 + Metrics 自定义** |
| 免费可用 | 部分 | 有限 | 需付费 | 有限 | 部分 | **完全免费** |
| 跨 OS 平台 | 能 | 能 | 能 | 能 | 能 | **Web + Office Add-in** |

### 核心差异化定位

**Document Studio 不是又一个"AI 生成文档"的工具，而是世界上第一个"可信文档生成工作台"。**

在这个定位下，Document Studio 占据了一个空白象限：

```
                 生成能力
                    ▲
                    │
          Gamma    │  ChatGPT/Claude
          (设计)    │  (对话式生成)
                    │
   ─────────────────┼──────────────────► 可信度
                    │
          NotebookLM│  ★ Document Studio
          (研究)    │  (可信文档工作台)
                    │
```

**五个"只有 Document Studio 能做到"：**

1. **只有 Document Studio 能同时连接飞书、Teams、微信、知乎、arXiv、本地文档等十几个平台的知识**，而不是只限于一个生态。
2. **只有 Document Studio 能让用户定义叙事逻辑**——"技术趋势用 arXiv 写，竞品分析用知乎写，团队进展用飞书文档写"——每个章节指定不同的知识源。
3. **只有 Document Studio 提供段落级生成树**——点击任意一段文字，就能看到它来自哪份文档的哪一页，置信度是多少，有没有相互矛盾的信息源。
4. **只有 Document Studio 把离线评估平台做成面向普通用户的产品**——用户可以定义自己的评估维度，导入 Golden Set，系统自动评分，持续监控生成质量。
5. **只有 Document Studio 将以上所有能力打包成一个免费可用的产品**，无需任何付费订阅。

### 一句话回答用户质疑

> "ChatGPT 能帮你生成一份 PPT，但不会告诉你第 3 页的结论是否可靠、来自哪份文档、有没有被后续信息推翻。Document Studio 会。"

---

## 第六轮：输出 MVP 文档

**用户：**

把现在讨论的结果，写成一个mvp.md，存入到 ../docStudio/docs 目录中

**AI：**

已创建 mvp.md，包含完整的产品方案文档。