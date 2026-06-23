# i-Write, a Document Generation Studio — MVP 方案

> 参赛赛道：TRAE AI 创造力大赛 · 赛道二（学习工作 / 造个新解法）
> 注：产品原名 Document Studio，后改名为 i-Write，详见 PRD 命名章节。

---

## 一句话定位

AI 驱动的文档价值工作台 — 让人类关注文档要传达的信息和故事本身，由 AI 基于你的知识生成文档，你对内容做判断、决策和取舍。

---

## 产品决策汇总

以下所有决策均经过详细讨论确认：

| # | 决策项 | 选择 | 说明 |
|---|--------|------|------|
| 1 | Demo 场景 | 项目周报/汇报 | 模拟团队 leader 写周报，知识源包括会议纪要、邮件、代码 PR、聊天记录 |
| 2 | Office Add-in | 真实可用的 Add-in | 在 Word/Excel/PowerPoint Online 中真正 sideload 的侧边栏插件 |
| 3 | 评估体系 | 全面指标体系 | 10+ 指标 + Golden Set + Multi-Judge + 历史报告对比 |
| 4 | 界面语言 | 中文 | 全中文界面，面向国内用户和比赛 |
| 5 | 登录流程 | 真实 MS OAuth | 用户点 MS 登录按钮，真正走 OAuth 流程获取 token |
| 6 | 知识源 | 全部 | 本地文件、OneDrive/SharePoint、GitHub、arXiv、Office 全家桶 |
| 7 | 输出格式 | Word + PPT + Excel | .docx / .pptx / .xlsx 三种 Office 格式 |
| 8 | 生成树交互 | 段落级 + 拖拽重生成 | 点击段落展开生成树；拖拽节点到段落可精确重生成该段落 |
| 9 | 一键 Demo | MVP 验收后做 | 类似 GraphMe 的 FakeCursor 自动演示，验收后立刻做 |
| 10 | 首次体验 | 预置 Demo 数据 + Chat Box | 用户打开 app 即看到预置知识库，通过 chat 描述需求 |
| 11 | 叙事模板 | 模板 + 完全自定义 | 提供固定模板，也支持用户完全自定义文档结构 |
| 12 | Golden Set 用途 | 支持 LLM model 选择决策 | 用户切换 LLM model 时，通过离线评估对比质量差异 |
| 13 | 用户端评估 | 实时信任度 + 历史对比 | 生成后实时显示信任度报告，支持时间趋势 + 版本对比 |
| 14 | Chat 交互深度 | 智能判断 | 简单需求直接生成，复杂需求系统多轮追问 |
| 15 | Web + Add-in 关系 | 共享后端 | Web 应用和 Office Add-in 共享同一后端，数据互通 |
| 16 | 生成流程 | 大纲调整 → 一键生成 | 先生成大纲让用户调整结构和知识源分配，再一键生成完整文档 |
| 17 | 历史对比方式 | 时间趋势 + 版本对比 | 趋势图展示分数变化 + 两次生成结果 side-by-side 对比 |
| 18 | MS 内容获取 | 自动拉取 + 排除 | 登录后自动拉取所有 Office 内容，用户可排除不需要的 |
| 19 | 文档编辑 | 支持在线编辑 | 用户在 app 中直接编辑生成的文档，编辑后信任度报告自动更新 |
| 20 | 知识源冲突 | 两种来源都保留 | 用"一方面...另一方面..."呈现，生成树中标注两个来源 |
| 21 | 用户反馈 | 不收集反馈 | 仅通过评估指标自动判断质量 |
| 22 | 部署方式 | 最简方式部署 | 隐私由用户选择的 provider 决定（embedding/reranker/LLM 均为远程 API） |

---

## 要解决的问题

现代知识工作者的信息分散在十几个平台（GitHub、飞书、微信、Teams、小红书、微博、知乎、arXiv、本地文档等），写一份靠谱的文档需要在多个平台来回切换、复制粘贴、手动核对。AI 可以辅助生成，但用户对 AI 生成的内容缺乏信任——不知道事实有没有编造、来自哪里。

Document Studio 让用户像指挥乐队一样编排知识，生成文档的同时给出一份"可信度报告"和完整的"事实溯源树"。

---

## 核心用户旅程

### 首次体验（预置 Demo）

```
用户打开 Document Studio
    │
    ├─ 看到预置的 Demo 知识库（已索引的周报场景数据）
    │   ├─ 会议纪要 × 5
    │   ├─ 邮件往来 × 10
    │   ├─ 代码 PR × 8
    │   ├─ Teams 聊天记录 × 15
    │   └─ 技术文档 × 6
    │
    ├─ Chat Box 提示："描述你想要生成的文档"
    │   └─ 用户输入："帮我写一份本周项目进展周报"
    │
    ├─ 系统智能判断：需求明确，直接生成大纲
    │   └─ 展示大纲：背景 → 本周进展 → 风险与阻塞 → 下周计划
    │
    ├─ 用户微调大纲（可选）→ 点击"一键生成"
    │
    └─ 生成结果
        ├─ Word 文档（可直接下载 .docx）
        ├─ 生成树（点击任意段落查看来源）
        └─ 信任度报告（Groundedness 0.87 / 引用准确性 0.92 / ...）
```

### 正式使用（连接自己的知识源）

```
用户点击"连接知识源"
    │
    ├─ Microsoft 账号登录（OAuth）
    │   └─ 自动拉取 OneDrive / SharePoint / Teams / Outlook 内容
    │       └─ 用户可排除不需要的文件/文件夹
    │
    ├─ 连接 GitHub（OAuth）
    │   └─ 选择 repo，自动索引代码、Issues、PR
    │
    ├─ 上传本地文件
    │   └─ 拖拽上传 PDF/DOCX/TXT/HTML/Markdown
    │
    └─ 搜索 arXiv 论文
        └─ 关键词搜索 → 选择论文 → 自动索引

知识源就绪后 → Chat Box 描述需求 → 大纲调整 → 一键生成 → 信任度报告
```

### Office Add-in 模式

```
用户在 Excel Online 中打开 Document Studio 插件
    │
    ├─ 侧边栏加载（共享同一后端）
    │   ├─ 已连接的知识源自动可用
    │   └─ Chat Box 描述需求
    │
    ├─ 用户："根据这个 Excel 的数据生成一份 PPT 汇报"
    │
    ├─ 系统读取当前 Excel 内容 + 知识库检索
    │   └─ 生成大纲 → 用户确认 → 生成 PPT
    │
    └─ 结果
        ├─ 直接写入 PowerPoint Online
        ├─ 侧边栏展示生成树
        └─ 侧边栏展示信任度报告
```

---

## 两种使用模式

### 模式一：Web 应用（主入口）

```
Document Studio Web 应用
    │
    ├─ 知识源连接、叙事引擎、文档生成、评估平台
    │
    └─ 生成结果
        ├─ 直接在 Web 应用查看 + 生成树 + 评估
        ├─ 下载 .docx / .pptx / .xlsx
        └─ 一键推送到 Office Online（通过 Office Add-in）
```

### 模式二：Office Add-in（侧边栏）

```
用户在 Word / Excel / PowerPoint Online 中
    │
    ├─ 打开 Document Studio 加载项（侧边栏）
    │   ├─ 共享同一后端，已连接的知识源自动可用
    │   ├─ Chat Box 描述需求
    │   ├─ 可以读取当前 Office 文档内容作为上下文
    │   └─ 生成结果直接写入当前文档或创建新文档
    │
    └─ 典型场景
        ├─ 在 Excel 中调用插件生成 PPT 汇报
        ├─ 在 Word 中调用插件基于知识库补充内容
        └─ 在 PowerPoint 中调用插件生成演讲稿备注
```

---

## 竞品调研与差异化分析

### 用户最直接的质疑

> "我把所有文档放在一个文件夹里，告诉 ChatGPT/Claude 去读，然后让它生成 PPT，不就行了？为什么还需要 Document Studio？"

### 竞品全景图

#### 第一类：通用 AI 对话 + 文件上传（ChatGPT、Claude、Gemini）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 上传文件夹/文件 | 能 | 会话级别的文件管理，无法持久化知识库；跨会话需要重新上传 |
| 读文档内容 | 能 | 受上下文窗口限制，大文件夹需要分批处理 |
| 生成文档/PPT | 能 | 但生成内容**没有事实溯源**，用户不知道每句话来自哪份文件 |
| 评估生成质量 | 不能 | 没有任何系统化的评估机制，用户只能靠肉眼判断 |

**关键差距**：解决了"生成"问题，没有解决"可信"问题。

#### 第二类：AI 研究助手（Google NotebookLM）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 上传文档作为知识源 | 能 | 仅限于手动上传，不能自动连接平台 |
| 跨平台知识聚合 | 不能 | 只能上传文件 |
| 生成 Office 文档 | 不能 | 输出是笔记/FAQ/摘要/音频 |
| 生成质量评估 | 不能 | 没有评估系统 |

**关键差距**：是"研究助手"，不是"文档生成器"。

#### 第三类：AI 办公助手（Microsoft Copilot、Notion AI）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 基于生态内知识生成 | 能 | 仅限于自己的生态 |
| 跨平台知识聚合 | 不能 | 生态锁定 |
| 事实溯源 | 部分 | 仅限于生态内引用 |
| 离线评估平台 | 不能 | 没有 |
| 免费使用 | 不能 | 需要付费订阅 |

**关键差距**：生态锁定 + 无评估体系 + 付费。

#### 第四类：AI 演示文稿工具（Gamma、Beautiful.ai）

| 能力 | 能做到吗 | 局限 |
|------|:---:|------|
| 从 prompt 生成 PPT | 能 | 但内容来自 AI 预训练知识，不是来自你的文档 |
| 事实溯源 | 不能 | 完全没有 |
| 跨平台知识聚合 | 不能 | 不能连接你的平台 |

**关键差距**：是"设计生成器"，不是"知识生成器"。

### 差异化矩阵

| 能力维度 | ChatGPT/Claude | NotebookLM | Copilot | Gamma | **Document Studio** |
|----------|:---:|:---:|:---:|:---:|:---:|
| 跨平台知识聚合 | 上传文件 | 上传文件 | 仅 MS 生态 | 无 | **全平台连接** |
| 用户自定义叙事逻辑 | 无 | 无 | 无 | 无 | **章节+知识源+风格** |
| 生成 Office 文档 | 能 | 不能 | 能 | 仅 PPT | **Word+Excel+PPT** |
| 事实溯源（生成树） | 无 | 内联引用 | 生态内引用 | 无 | **段落级生成树+拖拽** |
| 离线评估平台 | 无 | 无 | 无 | 无 | **10+指标+Golden Set** |
| 免费可用 | 部分 | 有限 | 需付费 | 有限 | **完全免费** |

### 五个"只有 Document Studio 能做到"

1. **全平台知识连接**：同时连接 OneDrive、GitHub、arXiv、本地文档等
2. **叙事逻辑自定义**：每个章节指定不同的知识源和风格
3. **段落级生成树**：点击任意段落查看来源，拖拽节点精确重生成
4. **面向用户的离线评估**：Golden Set + Multi-Judge，支持 LLM model 选择决策
5. **以上全部免费打包**：无需付费订阅

---

## 核心差异化

### 1. 全平台知识连接器（广度）

不是又一个"上传文档让 AI 总结"的工具。用户通过 MS OAuth 登录后，系统自动拉取 OneDrive/SharePoint/Teams/Outlook 的内容作为知识源（用户可排除不需要的）。同时支持 GitHub、arXiv、本地文件上传。

### 2. 叙事引擎（用户控制权）

通过 Chat Box 与用户交互：
- 简单需求（"帮我写一份周报"）→ 系统直接生成大纲
- 复杂需求（"用 arXiv 写技术趋势，用 GitHub 写团队进展"）→ 系统多轮追问确认
- 用户可选固定模板，也可完全自定义文档结构
- 大纲生成后用户可调整结构和知识源分配 → 一键生成完整文档

### 3. 信任体系（最关键差异）

#### 在线评估（用户端）

每次生成文档后实时显示信任度报告：
- Groundedness 分数（事实是否有依据）
- 引用准确性（引用是否正确）
- 来源覆盖度（知识源是否充分利用）
- 历史对比：时间趋势图 + 版本 side-by-side 对比

#### 离线评估（管理端 / 决策支持）

用户切换 LLM model 时，通过 Golden Set 离线评估支持决策：
- 系统自动生成 Golden Set（问题 + 期望答案）
- Multi-Judge 评估（2 个 LLM judge 独立评分）
- 10+ 指标全面评估（详见评估体系章节）
- 历史报告对比，看哪个 model 质量更高

---

## 生成树（Provenance Tree）设计

### 交互方式

```
📄 最终文档段落："本周完成了用户认证模块的开发"
│
├── 🔗 来源 1: Teams 聊天记录 (张三, 周二 14:30)
│   └── 置信度: 0.95 | 原文: "认证模块今天联调通过了"
│
├── 🔗 来源 2: GitHub PR #123 (merged, 周二 18:00)
│   └── 置信度: 0.98 | 原文: "feat: add OAuth2 authentication flow"
│
├── 🔗 来源 3: 会议纪要 (周一 standup)
│   └── 置信度: 0.82 | 原文: "本周目标：完成认证模块"
│
└── ⚠️ Groundedness 综合评分: 0.92
    └── 所有来源均支持该陈述，可信度高
```

### 拖拽重生成

用户可以：
1. 从生成树中拖拽一个节点（来源）到文档的任意段落
2. 选择"copy"（保留原引用）或"cut"（替换原引用）
3. 系统基于新的来源精确重生成该段落（其他段落不变）
4. 重生成后自动更新信任度报告

### 在线编辑

用户可以在 app 中直接编辑生成的文档（改文字、调格式），编辑后信任度报告自动更新。不需要下载后在 Office 中编辑。

### 知识源冲突处理

当不同知识源的信息冲突时（如 Teams 聊天说"已完成"，但 GitHub PR 还 open），系统不替用户做判断，而是两种来源都保留，用"一方面...另一方面..."的方式呈现，并在生成树中标注两个冲突来源。

---

## 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Connectors                       │
│  本地文件 │ OneDrive │ SharePoint │ Teams │ Outlook │ GitHub  │
│  arXiv │ Office 文档 │ 更多...                              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Narrative Engine（叙事引擎）                  │
│  Chat Box 交互 → 智能判断 → 大纲生成 → 用户调整 → 一键生成     │
│  模板市场：周报 / 调研报告 / 商业计划书 / PPT / 学术综述...      │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Generation + Trust Layer（生成+信任层）           │
│  RAG 检索 → LLM 生成 → Groundedness 验证 → 事实溯源           │
│                      │                                       │
│              在线评估（实时）                                    │
│          信任度报告 · 历史趋势 · 版本对比                       │
│                      │                                       │
│              离线评估（决策支持）                                │
│          Golden Set · Multi-Judge · 10+ Metrics              │
│                      │                                       │
│              生成树可视化                                      │
│      段落级溯源 · 拖拽重生成 · 置信度评分                       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Output Layer（输出层）                      │
│  Web 应用直接生成 │ Office Add-in 侧边栏生成                   │
│  .docx │ .pptx │ .xlsx │ 在线预览                             │
└─────────────────────────────────────────────────────────────┘
```

---

## RAG 引擎（核心能力）

复用 patentExaminator 验证过的 RAG 技术栈，从专利审查场景泛化到通用文档生成。

### Stage 1: Query Expansion

- **跨语言扩展**：中英文术语映射（如"认证" → "authentication"）
- **同义词扩展**：领域术语同义词（如"周报" → "weekly report / 进展汇报 / 工作总结"）
- **Multi-Query 改写**：生成多个查询变体（原文 / 核心关键词 / 同义替换 / 缩短版）

### Stage 2: Hybrid Search（BM25 + 向量 + RRF 融合）

- **BM25 关键词搜索**：基于 MiniSearch，支持中文分词（jieba-wasm）
- **向量语义搜索**：embedding API + cosine similarity
- **RRF 融合**：`score = sum(1 / (k + rank + 1))`，k=60
- **MMR 多样性排序**：避免返回过于相似的结果，lambda=0.7

### Stage 3: Reranker（三级降级）

- **Level 1**：远程 Reranker API（用户配置）
- **Level 2**：本地 Cross-Encoder（bge-reranker-base）
- **Level 3**：启发式加权打分（语义 0.4 + 关键词 0.25 + 来源类型 0.15 + 引用匹配 0.15 + 深度 0.05）

### Stage 4: Cross-Source Fusion（跨源融合）

- 合并多个知识源的检索结果
- 统一重排序
- 去重 + 来源标注

### Stage 5: Groundedness Check（LLM-as-Judge）

- 句子级验证：每句话分类为 `grounded` / `ungrounded` / `not_verifiable`
- `groundedRatio >= 0.8` → pass
- `0.5 <= groundedRatio < 0.8` → partial（只保留 grounded 部分）
- `groundedRatio < 0.5` → fail（触发重生成）
- 降级保护：judge 失败时默认 pass，不阻塞用户

---

## 评估体系

### 在线评估（用户端 — 每次生成后实时显示）

| 指标 | 说明 | 计算方式 |
|------|------|---------|
| Groundedness Score | 生成内容是否有事实依据 | LLM-as-Judge 句子级验证 |
| Citation Accuracy | 引用是否正确指向来源 | LLM-as-Judge + NLI |
| Source Coverage | 知识源是否被充分利用 | 已引用源 / 可用源 |
| Coherence Score | 文档逻辑是否连贯 | G-Eval (LLM + CoT) |
| Completeness Score | 大纲要求的内容是否都覆盖 | LLM-as-Judge 对比大纲 |

每次生成后自动保存评估结果，支持：
- **时间趋势图**：展示历次生成的分数变化
- **版本 side-by-side 对比**：选两次生成结果，逐指标对比

### 离线评估（管理端 — LLM model 选择决策支持）

#### Golden Set 结构

```json
{
  "id": "g-001",
  "query": "写一份本周项目进展周报",
  "expectedAnswer": "参考答案...",
  "mustIncludeFacts": ["完成认证模块开发", "修复3个bug", "下周计划..."],
  "expectedSource": "kb_only",
  "category": "weekly_report",
  "sourceType": "cross_source"
}
```

Golden Set 矩阵（sourceType × category）：
- **sourceType**：kb_only / web_only / cross_source / conflict / no_answer
- **category**：weekly_report / research_report / ppt_outline / data_analysis / email

#### 10+ 评估指标

| 维度 | 指标 | 说明 | 需要 Golden Set? |
|------|------|------|:---:|
| 检索质量 | NDCG@K | 检索结果排序质量 | 否 |
| 检索质量 | Recall@K | 检索结果覆盖度 | 否 |
| 事实准确性 | Faithfulness | 生成内容是否忠于检索到的上下文 | 否 |
| 事实准确性 | Groundedness | 每句话是否有来源支持 | 否 |
| 引用质量 | Citation Precision | 引用的来源是否真的支持该陈述 | 否 |
| 引用质量 | Citation Recall | 应该引用的陈述是否都有引用 | 否 |
| 文档质量 | Coherence | 文档逻辑连贯性 | 否 |
| 文档质量 | Fluency | 语言流畅度 | 否 |
| 文档质量 | Completeness | 内容完整度 | 是 |
| 端到端 | Answer Correctness | 与参考答案的正确性对比 | 是 |
| 端到端 | Fact Coverage | 关键事实是否都包含 | 是 |
| 端到端 | Source Routing | 知识源路由是否正确 | 是 |

#### Multi-Judge 架构

- 默认 2 个 judge：不同 LLM provider 独立评分
- 使用 `Promise.allSettled`：一个 judge 失败不影响另一个
- 聚合方式：连续值取算术平均，离散值取四舍五入平均
- 用户可配置 judge 的 provider 和 model

#### 评估流程（4 阶段）

1. **Phase 1 - RAG 生成**：用当前配置对 Golden Set 每个问题生成答案
2. **Phase 2 - 检索指标**：批量评估 NDCG、Recall
3. **Phase 3 - 语义指标**：批量评估 Faithfulness、Answer Correctness、Fact Coverage
4. **Phase 4 - 汇总**：组装所有指标，保存评估报告

---

## Fake 知识库（Demo 数据）

### 场景：项目周报/汇报

模拟一个团队 leader（"张三"）的一周工作，生成以下 fake 数据：

| 数据类型 | 数量 | 内容 |
|----------|------|------|
| 会议纪要 | 5 篇 | 周一 standup、周三设计评审、周五 retro 等 |
| 邮件往来 | 10 封 | 与产品经理、设计师、客户的沟通 |
| 代码 PR | 8 个 | GitHub PR，含 title、description、diff summary |
| Teams 聊天记录 | 15 条 | 团队群聊中的关键讨论 |
| 技术文档 | 6 篇 | 技术方案、API 文档、架构设计 |
| Excel 数据 | 2 份 | 项目进度表、bug 统计表 |
| PPT | 1 份 | 上周汇报 PPT |

所有 fake 数据围绕一个连贯的故事线：
- **周一**：确定本周目标（完成认证模块、修复 3 个高优 bug）
- **周二-周三**：开发过程中遇到技术难点，团队讨论解决方案
- **周四**：认证模块联调通过，发现新问题
- **周五**：完成大部分目标，准备周报

---

## 技术栈

| 层 | 技术 |
|------|------|
| 整体架构 | TypeScript Monorepo（server + client + shared） |
| 前端框架 | React 18 + TypeScript + Vite |
| 状态管理 | Zustand |
| 后端 | Express / Node.js |
| 数据库 | SQLite（用户数据 + 知识库 + 评估数据） |
| AI 适配 | OpenAI-compatible 协议（支持多 Provider，用户自己配置） |
| 向量检索 | 远程 embedding API + 内存 cosine similarity（用户自己配置） |
| 文档处理 | PDF/DOCX/TXT/HTML/Markdown 解析 |
| Office 导出 | docx / pptxgenjs / xlsx 库生成 Office 文件 |
| Office Add-in | Office.js JavaScript API |
| 可视化 | D3.js / ECharts（生成树图、评估图表） |
| 认证 | Microsoft OAuth 2.0 + GitHub OAuth |

### 复用 patentExaminator 的能力

- RAG 检索管道（Query Expansion → 混合检索 → RRF 融合 → Reranker 重排序）
- Groundedness 验证（LLM-as-Judge）
- 离线评估平台（Golden Set 生成 + Multi-Judge 评估 + Eval Set 管理）
- Metrics Dashboard（多维度 × 多指标实时监控）
- 多 Provider 支持 + 自动 fallback
- 演示模式（不消耗 Token，预置示例数据）

---

## 核心交互流程

### 1. Chat Box 交互（智能判断）

```
用户输入："帮我写一份本周项目进展周报"
    │
    ├─ 系统判断：需求明确（周报 + 本周 + 已有知识库）
    │   └─ 直接生成大纲，不追问
    │
    └─ 大纲展示：
        ├─ 一、本周目标回顾
        ├─ 二、完成情况
        ├─ 三、遇到的问题与解决方案
        ├─ 四、下周计划
        └─ 五、风险与阻塞
```

```
用户输入："帮我写一份关于AI行业的调研报告"
    │
    ├─ 系统判断：需求模糊（哪个方向？什么深度？给谁看？）
    │   └─ 多轮追问
    │       ├─ "调研的重点方向是什么？技术趋势、市场分析、还是竞品对比？"
    │       ├─ "报告的受众是谁？技术团队、管理层、还是客户？"
    │       └─ "需要引用哪些知识源？arXiv 论文、GitHub 项目、还是你的内部文档？"
    │
    └─ 确认后生成大纲
```

### 2. 大纲调整

```
系统生成大纲后，用户可以：
    │
    ├─ 拖拽调整章节顺序
    ├─ 添加 / 删除 / 重命名章节
    ├─ 为每个章节指定知识源（如：技术趋势用 arXiv，团队进展用 GitHub）
    ├─ 选择语气风格（学术严谨 / 商业汇报 / 通俗科普）
    └─ 点击"一键生成"
```

### 3. 生成树拖拽重生成

```
用户查看生成文档的某个段落
    │
    ├─ 点击段落 → 展开生成树（显示所有来源 + 置信度）
    │
    ├─ 用户从生成树中拖拽一个新来源节点到该段落
    │   └─ 选择"copy"（补充引用）或"cut"（替换引用）
    │
    └─ 系统精确重生成该段落
        ├─ 只修改目标段落，其他段落不变
        └─ 自动更新信任度报告
```

### 4. 离线评估（LLM Model 选择）

```
用户在设置页切换 LLM provider / model
    │
    ├─ 点击"评估当前配置"
    │
    ├─ 系统自动运行：
    │   ├─ 从 Golden Set 生成答案（用新配置）
    │   ├─ Multi-Judge 评估
    │   └─ 生成评估报告
    │
    └─ 展示结果
        ├─ 与上次配置的对比表
        ├─ 各指标分数对比
        └─ 建议："新配置在 Faithfulness 上提升 12%，但 Coherence 下降 5%"
```

---

## MVP 功能范围

### P0 — 必须实现

| 功能 | 说明 |
|------|------|
| 预置 Demo 知识库 | 项目周报场景的 fake 数据，开箱即用 |
| Chat Box 交互 | 智能判断需求复杂度，直接生成或多轮追问 |
| 叙事引擎 | 大纲生成 → 用户调整 → 一键生成 |
| 叙事模板 | 周报 / 调研报告 / PPT 大纲（3 种固定模板 + 自定义） |
| RAG 引擎 | Query Expansion + Hybrid Search + RRF + Reranker + Groundedness |
| 文档生成 | 生成 Word / PowerPoint / Excel 文件 |
| 生成树可视化 | 段落级生成树 + 置信度评分 |
| 拖拽重生成 | 拖拽生成树节点精确重生成指定段落 |
| 在线评估 | 实时信任度报告（5 个核心指标） |
| 历史对比 | 时间趋势图 + 版本 side-by-side 对比 |
| 本地文件上传 | 拖拽上传 PDF/DOCX/TXT/HTML/Markdown |
| 多 Provider 配置 | 用户自己配置 LLM provider + embedding + reranker |
| 演示模式 | 不消耗 Token，预置示例数据 |

### P1 — 应该实现

| 功能 | 说明 |
|------|------|
| MS OAuth 登录 | 真实 Microsoft 账号登录 |
| OneDrive/SharePoint 连接器 | 自动拉取用户 Office 文档 + 排除功能 |
| GitHub 连接器 | OAuth 登录，读取 repo 代码/Issues/PR |
| arXiv 连接器 | 公开 API 搜索和导入论文 |
| 离线评估平台 | Golden Set 生成 + Multi-Judge + 10+ 指标 |
| 评估历史报告 | 历史报告列表 + 对比功能 |
| Office Add-in（Word） | 侧边栏集成，共享后端 |
| Office Add-in（Excel） | 同一套代码，读取 Excel 数据生成文档 |
| Office Add-in（PowerPoint） | 同一套代码，生成 PPT |
| Outlook 连接器 | 读取邮件内容作为知识源 |
| Teams 连接器 | 读取 Teams 聊天记录 |

### P2 — 可以延后

| 功能 | 说明 |
|------|------|
| 一键 Demo | 类似 GraphMe 的 FakeCursor 自动演示 |
| 更多知识源 | 飞书、微信、小红书、知乎等 |
| 更多模板 | 商业计划书、学术综述、产品需求文档等 |
| 协作功能 | 多人共享知识库和评估结果 |

---

## Office Add-in 技术方案

### 架构

```
Word / Excel / PowerPoint Online
    │
    ├─ Office.js 加载 Document Studio 侧边栏
    │   ├─ 侧边栏是一个 React 应用（和 Web 共享组件）
    │   ├─ 通过 Office.js API 读取当前文档内容
    │   └─ 通过 HTTP 调用共享后端 API
    │
    └─ 后端（共享）
        ├─ 知识库（已索引的数据）
        ├─ RAG 引擎
        ├─ 评估引擎
        └─ 文档生成引擎
```

### Office.js API 能力

| 宿主 | 能力 |
|------|------|
| Word | 读写文档内容、插入/替换段落、管理样式、脚注引用 |
| Excel | 读写单元格、表格、图表、公式、数据透视表 |
| PowerPoint | 读写幻灯片内容、形状、文本框、图片 |
| Outlook | 读取邮件、日历、附件、上下文信息 |

### Add-in manifest.xml

- 基于 Office.js JavaScript API
- 一套代码（HTML/CSS/JS）运行在 Word / Excel / PowerPoint Online
- 跨平台：Windows / Mac / iPad / Web
- 通过 Microsoft 个人免费账号即可 sideload 测试

---

## 技术栈细节

### 复用 patentExaminator 的模块

| 模块 | 来源文件 | 复用方式 |
|------|---------|---------|
| Query Expansion | `server/src/lib/queryExpand.ts` | 泛化（去除专利领域硬编码） |
| Hybrid Search | `server/src/lib/hybridSearch.ts` | 直接复用 |
| Reranker | `server/src/lib/reranker.ts` | 直接复用 |
| Groundedness Check | `server/src/lib/groundednessCheck.ts` | 直接复用 |
| Multi-Judge | `server/src/lib/multiJudge.ts` | 直接复用 |
| Eval Metrics | `server/src/lib/evalMetrics.ts` | 泛化（增加文档质量指标） |
| Eval Runner | `server/src/lib/evalRunner.ts` | 泛化 |
| Golden Set Generator | `server/src/lib/goldenSetGenerator.ts` | 泛化（从专利场景到通用场景） |
| Metrics Collector | `server/src/lib/metricsCollector.ts` | 直接复用 |
| Provider Registry | `server/src/providers/registry.ts` | 直接复用 |
| Knowledge DB | `server/src/lib/knowledgeDb.ts` | 直接复用 |

### 新增模块

| 模块 | 说明 |
|------|------|
| `narrativeEngine.ts` | 叙事引擎（大纲生成 + 用户调整 + 一键生成） |
| `docGenerator.ts` | 文档生成（Word/PPT/Excel 导出） |
| `provenanceTree.ts` | 生成树数据结构 + 拖拽重生成逻辑 |
| `chatRouter.ts` | Chat Box 智能判断（直接生成 vs 多轮追问） |
| `connectors/` | 知识源连接器（MS Graph、GitHub、arXiv） |
| `fakeDataGenerator.ts` | Fake 数据生成器 |
| `evalDashboard.tsx` | 评估 Dashboard 前端组件 |

---

## Demo 演示流程设计

### 第一幕：开箱即用（30 秒）

1. 打开 Document Studio → 看到预置的 Demo 知识库
2. Chat Box 输入"帮我写一份本周项目进展周报"
3. 系统生成大纲 → 用户点击"一键生成"
4. 生成 Word 文档 + 信任度报告

### 第二幕：生成树溯源（30 秒）

1. 点击文档中"本周完成了用户认证模块的开发"段落
2. 展开生成树 → 显示 3 个来源（Teams 聊天、GitHub PR、会议纪要）
3. 拖拽一个新的来源（邮件）到该段落 → 选择"补充引用"
4. 段落精确重生成，信任度分数更新

### 第三幕：连接真实数据（30 秒）

1. 点击"连接知识源" → Microsoft 账号登录
2. 自动拉取 OneDrive 文档 → 排除不需要的文件
3. 连接 GitHub → 选择 repo
4. 重新生成周报 → 来源变为真实数据

### 第四幕：Office Add-in（30 秒）

1. 打开 Excel Online → 加载 Document Studio 插件
2. 侧边栏 Chat Box："根据这个 Excel 的数据生成一份 PPT 汇报"
3. 生成 PPT → 直接写入 PowerPoint Online
4. 侧边栏展示生成树 + 信任度报告

### 第五幕：离线评估（30 秒）

1. 打开评估面板 → 点击"评估当前 LLM 配置"
2. 系统运行 Golden Set + Multi-Judge 评估
3. 展示 10+ 指标评估报告
4. 切换 LLM model → 再次评估 → 对比两次结果
5. "新配置在 Faithfulness 上提升 12%"

---

## 与 patentExaminator 的关系

patentExaminator 是 Document Studio 的技术原型和垂直场景验证：

- 相同的 RAG + Groundedness + 离线评估技术栈
- 在专利审查（高精度、高信任度场景）已验证有效
- Document Studio 将此技术栈泛化到所有人的文档创作场景
- patentExaminator 可作为 Demo 中的垂直场景案例展示

---

## 数据流与隐私

用户的文档内容无论如何都会经过远程 API（embedding、reranker、LLM 均为远程服务），这是 RAG 的本质。MVP 的隐私策略：

- **用户自选 provider**：用户选择信任哪个 embedding、reranker、LLM provider
- **文档内容只发送到用户选择的 provider**，Document Studio 本身不存储用户的文档原文
- **部署方式**：最简方式部署，隐私由用户选择的 provider 决定

---

## 开发环境

- 开发工具：TRAE IDE
- Office 测试环境：Office Online 免费版（Word/Excel/PowerPoint cloud.microsoft.com）
- 账号：Microsoft 个人免费账号（MSA）
- 无需 Microsoft 365 付费订阅

---

## 命名

- **Document Studio** — 简洁直接（采用）
- KnowledgeWeaver — 强调知识编织
- DocTrust — 强调信任
- SourceCraft — 来源 + 工艺
