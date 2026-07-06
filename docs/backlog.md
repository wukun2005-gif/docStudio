# i-Write Backlog

## 已修复 Bugs

- bug1: [✅] 冲突源前置过滤 — 生成前检测冲突→resolve→排除不可resolve的源，避免引用冲突源
- bug2: [✅] extractDocumentMetadata 正则提取人名有缺陷，改为 LLM NER 提取
- bug3: [✅] 评估阶段 SSE 流式进度反馈缺失，用户误以为卡住
- bug4: [✅] RAG 检索阶段接入 reranker API — hybridSearch 检索阶段未调用用户配置的 reranker API，导致相关 chunk 被 MMR 排除后无法补救

---

## 已修复 Bugs

### bug5: Query 构建 — LLM-based query rewrite 替代 regex 方案 ✅ 已修复

**优先级**：P1 → 已完成

**状态**：已实现 `server/src/lib/queryAnalyzer.ts`，用一次 LLM 调用分离内容要点和格式要求。

**修复内容**：

1. **新模块 `queryAnalyzer.ts`**：`analyzeQuery(userRequest, outline, ...)` 用 LLM 从用户请求中提取 `contentPoints`（内容要点）和 `formatRequirements`（格式要求）。支持 JSON schema 强制输出，失败时 fallback 到 null。

2. **bug5 fix — RAG 检索**：`buildRagQuery` 不再用 regex 穷举删除指令词，改为调用 `buildRagQueryFromAnalysis(sectionTitle, description, _queryAnalysis)`，用 LLM 提取的内容要点构建检索 query。如果 analysis 为 null，fallback 到原始 `title + description`。

3. **Bug4 fix — 完整度检查**：`checkDocumentCompleteness` 和 `checkDocumentRelevance` 的 `requirement` 参数改为 `buildContentRequirement(requirement, queryAnalysis)`，只用内容要点构建 requirement，格式要求（如"标题区分隔线页码统一风格"、"深色专业配色"）不进入完整度检查。

4. **缓存机制**：在 `generateDocument` 开头调用一次 `analyzeQuery`，结果缓存到模块级变量 `_queryAnalysis`，供整个生成流程复用（RAG 检索 + 完整度检查）。

**影响文件**：
- `server/src/lib/queryAnalyzer.ts`（新增）
- `server/src/lib/docGenerator.ts`（`buildRagQuery` 重写，`generateDocument` 添加 analysis 调用，导出 `getQueryAnalysis`）
- `server/src/routes/generation.ts`（两个评估调用点改用 `buildContentRequirement`）

**原方案（已过时）**：

用户在生成文档时，为每个章节指定 title + description。description 同时包含两类信息：
- **知识点**：用户希望覆盖的具体内容（如"团队规模与结构、部门分布、汇报关系"）
- **生成指令**：格式和排版要求（如"每项包括说明文字、数据表格和可视化图表"）

旧代码直接拼接 `title + description` 作为 RAG 检索 query，指令词（"数据表格"、"可视化图表"、"信息点"）在 BM25 中匹配到了知识库中不相关的文档（如 PRD.md 的内容质量要求表格），导致检索结果与知识点完全无关。临时修复用 regex 从 description 中删除指令短语，但 regex 无法穷举所有指令格式。

---

## 比赛专项 Features（TRAE AI 创造力大赛 · 第二赛道：学习工作/造个新解法）

### nf1: 一键 Demo（Mock Mode + FakeCursor + 90s 视频）

**背景**：参加 TRAE AI 创造力大赛第二赛道（学习工作/造个新解法），最终提交一个 90 秒演示视频。Demo 必须确定性运行、不能调用真实 LLM API（耗时不稳定、输出不确定），Mock Mode 是整个 Demo 的基石。

**Demo 核心叙事**：围绕 "Knowledge（知识驱动生成）+ Metrics（可量化信任指标）" 两个重点：

| 时间 | 画面 | 内容 |
|------|------|------|
| 0-15s | 知识库全景 | 42 份知识源（会议/邮件/代码/文档）+ People Graph 18 人组织架构 |
| 15-40s | 一句话生成 | 输入"写一份 Q3 技术决策报告"→AI 生成大纲→确认→生成完整文档 |
| 40-50s | 来源树溯源 | 点击任意段落，右侧展示 Provenance Tree，每句话来自哪个知识源 |
| 50-60s | 统一评估卡（Tab 1） | 雷达图 + 4 指标分数：Groundedness/Relevance/Completeness/Conflict-Free |
| 60-70s | 置信度热力图 | 文档叠加绿/黄/红图层，一眼看到信任分布 |
| 70-80s | 统一评估卡（Tab 2） | 问题发现：未支撑断言、需求未覆盖、已拦截冲突、逻辑漏洞 |
| 80-90s | 审阅导出 | 审阅问题发现→导出 PPT |

**Mock Mode 架构**：
- 基于现有 `server/src/providers/demo.ts`（DemoProvider）和 `server/src/providers/fixtures/demo-fixtures.ts`（fixture 数据）扩展，实现 ProviderAdapter 接口，不修改任何业务代码
- 三层处理策略：
  - 不需要 LLM 的功能（知识库管理、People Graph、文件上传/列表、文档导出、RAG 检索）→ **直接用**，不 mock
  - 需要 LLM 的已实现功能（意图分析、大纲生成、段落生成、Groundedness 校验、Trust Report、Reranker）→ **DemoProvider 返回预写 fixture**
  - 需要 LLM 的未实现功能（热力图数据、AI 自审数据）→ **先写死 fixture，后期实现**
- Fixtures 数据：直接写在 demo-fixtures.ts 中，覆盖 demo 每一步（意图识别→大纲→逐段生成→评估→冲突检测→自审），无需录制

**FakeCursor**：右上角 ▶ 按钮触发自动演示，参考 GraphMe。自动模拟用户操作（打字、点击、拖拽），按 90 秒脚本节奏自动推进

**开发顺序**：Mock Mode（地基）→ FakeCursor（自动播放）→ 热力图 + 统一评估卡（可并行，最后接入流程）

---

### nf2: 置信度热力图（Confidence Heatmap）

**背景**：属于 "Metrics" 重点方向的视觉化呈现。现有 provenance 数据只在侧边栏以文字展示，不够直观。热力图让评委一眼看到文档的信任分布，是 90 秒视频的核心视觉记忆点。

**功能**：在生成的文档预览上叠加 Canvas/SVG 半透明图层，按段落着色：
- 🟢 绿色段落 = 多源交叉验证，置信度高（>= 2 个独立来源支撑）
- 🟡 黄色段落 = 单源支撑，置信度中（仅 1 个来源）
- 🔴 红色段落 = AI 推断，无直接来源（groundedness < 阈值）

**实现**：纯前端可视化，直接复用现有 provenanceTree 的段落-来源映射 + groundedness 分数，无需新增 LLM 调用。Demo 阶段数据来自 mock fixture

**Demo 位置**：90 秒视频第 60-70 秒，承上（来源树溯源）启下（评估卡问题发现）

---

### nf3: 统一评估卡（Unified Evaluation Card）× AI 文档自审

**背景**：原有评估信息分散在 DocPreview 的多处（3 个指标卡 + 冲突检测 + 各章节有据可查度 + 需求未覆盖），用户看到的信息散乱且有误解。同时将 AI 自审能力融入评估卡，形成统一的"评估"入口。

**核心设计决策**：
- **融合，不叠加**：将现有 evaluation 指标 + AI 自审整合为一张统一评估卡，用 Tab 分面
- **去掉"各章节有据可查度"**：来源树已提供此信息，不重复展示
- **冲突信息改表述**：从"发现 2 处内容冲突"改为"拦截 2 处知识库冲突，未进入生成文档"，消除用户"冲突内容进没进文档"的困惑
- **所有诊断信息统一在 Tab 2**：需求未覆盖、冲突拦截、AI 自审问题全部归入"问题发现"Tab，不散落各处
- **不引入新指标**：雷达图只使用现有 4 个真实指标（Groundedness/Relevance/Completeness/Conflict-Free），不造"Consistency"等新概念
- **不提供"一键修正"按钮**：无法保证修正结果一定变好（可能不变、可能更糟），且会消耗用户 token。不确定结果的修正会严重破坏用户信任。问题发现纯诊断，用户用现有手动方式处理（拖拽来源重生成 #19、补充知识源、自行编辑）

**UI 设计**：

```
┌─────────────────────────────────────────┐
│  📊 文档评估                            │
├─────────────────────────────────────────┤
│  [评分概览]  [问题发现 (5)]              │
│                                         │
│  Tab 1: 评分概览                        │
│  ┌─────────────────────────────────┐    │
│  │  🕸️ 雷达图（4维）                │    │
│  │  Groundedness   ████████░  85%  │    │
│  │  Relevance      █████████░ 92%  │    │
│  │  Completeness   ██████░░░  68%  │    │
│  │  Conflict-Free  █████████░ 95%  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Tab 2: 问题发现 (5)                    │
│  ┌─────────────────────────────────┐    │
│  │  🔴 未支撑断言（2）              │    │
│  │  · 第3段"成本降低40%"无来源支撑  │    │
│  │  · 第5段"业界领先"无对比数据     │    │
│  │  → 建议：拖拽来源重生成该段落     │    │
│  │                                 │    │
│  │  🟡 需求要点未覆盖（2）          │    │
│  │  · 安全合规评估                  │    │
│  │  · 成本分析                      │    │
│  │  → 建议：补充相关知识源           │    │
│  │                                 │    │
│  │  🟢 已拦截冲突（2）  未进入文档   │    │
│  │  · 支付方案：Stripe vs 支付宝    │    │
│  │  · 排期：Sprint 3 vs Sprint 4   │    │
│  │  → 已自动处理，无需操作           │    │
│  │                                 │    │
│  │  🟡 逻辑漏洞（1）                │    │
│  │  · 性能优化未考虑并发场景        │    │
│  │  → 建议：人工判断后修改           │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**问题类型与建议操作**：

| 问题类型 | 来源 | 建议操作 |
|----------|------|---------|
| 未支撑断言 | groundedness 低分段落 | 拖拽来源重生成该段落（现有 #19），或手动编辑 |
| 需求未覆盖 | completeness.missingPoints | 补充相关知识源后重新生成 |
| 已拦截冲突 | conflict detection | 已自动处理，仅告知 |
| 逻辑漏洞 | AI 自审（LLM 推理） | 人工判断后修改 |

**实现分两阶段**：
- Demo 阶段：mock fixture 提供预计算的审查结果，前端渲染统一评估卡 UI
- 赛后：实现真实 LLM 审查逻辑

**Demo 位置**：Tab 1（评分概览）在 50-60s 展示，Tab 2（问题发现）在 70-80s 展示

---

## P0 — 已完成

| # | Feature | 简述 |
|---|---------|------|
| 1 | 预置 Demo 知识库 ✅ | 42 份 Nexora Tech 场景 sample 数据，开箱即用 |
| 2 | 本地文件上传 ✅ | 拖拽上传 PDF/DOCX/TXT/HTML/Markdown，自动解析 |
| 3 | 历史文档入知识库 ✅ | 生成文档保存后自动成为新知识源 |
| 4 | People Graph ✅ | 18 人组织架构+关系图谱，高权重信号影响文档生成 |
| 5 | Chat Box 交互 ✅ | 智能判断需求复杂度，直接生成或多轮追问 |
| 6 | 大纲生成与调整 ✅ | 基于需求生成大纲，支持拖拽调整 |
| 7 | 叙事模板 ✅ | 3-5 种固定模板 + 用户自定义 |
| 8 | 一键生成 ✅ | 确认大纲后一键生成完整文档 |
| 9 | Query Expansion ✅ | 跨语言扩展 + 同义词 + Multi-Query 改写 |
| 10 | Hybrid Search ✅ | BM25 + 向量 + RRF 融合 + MMR 多样性排序 |
| 11 | Reranker ✅ | 三级降级：远程 API → 本地 Cross-Encoder → 启发式 |
| 12 | Groundedness Check ✅ | 句子级验证，>= 0.8 pass，< 0.5 触发重生成 |
| 13 | Word 生成 ✅ | 生成 .docx，含标题、段落、引用、样式 |
| 14 | PowerPoint 生成 ✅ | 生成 .pptx，含标题页、内容页、图表 |
| 15 | Excel 生成 ✅ | 生成 .xlsx，含数据表格、图表 |
| 16 | 在线编辑 ✅ | 用户可直接编辑生成的文档 |
| 17 | 生成树可视化 ✅ | 段落级生成树 + 置信度评分 |
| 18 | 生成树 CRUD ✅ | 删除/调整优先级/手动添加/替换来源 |
| 19 | 拖拽重生成 ✅ | 拖拽节点精确重生成指定段落 |
| 20 | 用户可见指标 ✅ | 4 个核心指标：Groundedness/Relevance/Completeness/Conflict |
| 22 | 评估报告引导优化 ✅ | 低分段落引导用户一键优化 |
| 23 | 历史对比 ✅ | 时间趋势图 + 版本 side-by-side 对比 |
| 24 | 评估数据洞察 ✅ | 按文档类型分析质量趋势 |
| 27 | 多 Provider 配置 ✅ | 用户配置 LLM / embedding / reranker provider |
| 28 | 迭代生成 ✅ | 基于历史记录复用配置一键生成新文档 |
| 29 | 模板保存 ✅ | 用户可将历史生成配置保存为模板 |
| 30 | 演示模式 ✅ | 不消耗 Token，预置示例数据 |

## P0 — 待实现

| # | Feature | 简述 |
|---|---------|------|
| 21 | 开发者调试指标 | 离线评估用：Context Precision/Recall、Citation、Hallucination Rate |

---

## P1 — 已完成

| # | Feature | 简述 |
|---|---------|------|
| 31 | MS OAuth 登录 ✅ | 真实 Microsoft 账号登录 |
| 32 | OneDrive/SharePoint ✅ | 自动拉取 Office 文档 + 排除功能 |
| 33 | GitHub 连接器 ✅ | OAuth 登录，读取 repo 代码/Issues/PR |
| 34 | arXiv 连接器 ✅ | 公开 API 搜索和导入论文 |
| 35 | Outlook 连接器 ✅ | 读取邮件内容作为知识源 |
| 36 | Teams 连接器 ✅ | 读取 Teams 聊天记录 |
| 37 | Word Add-in ✅ | 侧边栏集成，共享后端 |
| 38 | Excel Add-in ✅ | 同一套代码，读取 Excel 数据生成文档 |
| 39 | PowerPoint Add-in ✅ | 同一套代码，生成 PPT |
| 40 | Golden Set 生成 ✅ | 自动生成问题 + 期望答案 |
| 41 | Multi-Judge 评估 ✅ | 2 个 LLM judge 独立评分 |
| 42 | 10+ 指标评估 ✅ | NDCG / Recall / Faithfulness / Groundedness / Citation 等 |
| 43 | 评估报告管理 ✅ | 历史报告列表 + 对比功能 |
| 44 | Action Item 解析 ✅ | 从 Teams 会议纪要提取 Action Item |
| 45 | 智能知识源发现 ✅ | 根据 Action Item 自动搜索相关知识源 |
| 46 | 主动生成与建议 ✅ | 质量达标后主动建议用户 |
| 47 | Workflow 定义 ✅ | 可视化编辑器或 Chat Box 定义多步骤流程 |
| 48 | Workflow 执行 ✅ | 按步骤自动执行，步骤间数据传递 |
| 49 | Workflow 触发 ✅ | 手动触发 + 自动触发（检测数据更新） |

---

## P2 — Backlog

| # | Feature | 简述 |
|---|---------|------|
| 51 | 更多知识源 | 飞书、微信、小红书、知乎等 |
| 52 | 更多模板 | 商业计划书、学术综述、产品需求文档等 |
| 53 | 模板分享 | 团队共享模板库 |
| 54 | 批量生成 | 一次生成多份文档 |
| 55 | 协作功能 | 多人共享知识库和评估结果 |
| 56 | 用户反馈 | 收集用户反馈信号改进生成质量 |

---

## 参考项目

| 项目 | 参考内容 |
|------|---------|
| patentExaminator | RAG Pipeline 全部（Query Expansion、Hybrid Search、Reranker、Groundedness Check） |
| GraphMe | 一键 Demo（FakeCursor 自动演示）、首次引导流程 |

---

## 统计

| 优先级 | 数量 |
|--------|------|
| 比赛专项 | 3 |
| P0 已完成 | 26 |
| P0 待实现 | 1 |
| P1 已完成 | 19 |
| P2 | 6 |
| **总计** | **55** |