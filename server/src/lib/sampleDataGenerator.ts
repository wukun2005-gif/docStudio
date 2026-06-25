/**
 * Sample 数据生成器 — 项目周报场景
 * Feature #1: 预置 Demo 知识库
 *
 * 统一团队（18 人）：Nexora Tech / i-Write
 * 时间跨度：2026-06-02 ~ 2026-06-27（4 个 sprint）
 *
 * 8 份文档：
 * 1. Sprint 1 周报 — 基础设施搭建
 * 2. Sprint 2 周报 — 知识管理
 * 3. Sprint 3 周报 — RAG 引擎 + 认证模块
 * 4. Sprint 4 周报 — 文档生成 + 评估
 * 5. 认证模块技术方案 v2.0
 * 6. Q3 2026 产品规划
 * 7. RAG 引擎架构设计
 * 8. 数据安全合规方案
 */
import crypto from "crypto";
import { addSource, addChunks, getStats } from "./knowledgeDb.js";
import { logger } from "./logger.js";

/** 项目周报 sample 数据 */
const WEEKLY_REPORTS = [
  // ── 文档 1: Sprint 1 周报 ──
  {
    title: "i-Write 技术团队周报 - 2026-W23（Sprint 1）",
    content: `# i-Write 技术团队周报 - 2026-W23（Sprint 1：基础设施搭建）

**报告周期**: 2026 年 6 月 2 日（周一）~ 6 月 6 日（周五）
**报告人**: 陈强（技术负责人）
**抄送**: 赵军（VP Engineering）、苏楠（产品总监）、王琳（COO）

---

## 一、Sprint 目标回顾

本 Sprint 是 i-Write 项目的正式启动阶段，核心目标是搭建项目基础设施，为后续功能开发奠定坚实基础。经过一周的努力，我们超额完成了大部分目标。

**Sprint 1 三大关键目标**:
1. ✅ 完成项目骨架搭建（monorepo 架构、构建工具链、代码规范）
2. ✅ 完成 Provider 系统设计与实现（OpenAI-compatible 协议适配）
3. ✅ 完成 DB Schema 设计与 CI/CD 流水线配置

**Sprint 成果**: 42 个 PR merged，测试覆盖率 68%，CI pipeline 平均耗时 < 8 分钟。

---

## 二、各模块完成情况

### 2.1 项目骨架搭建（陈强负责）

陈强本周完成了整个项目的 monorepo 架构设计与搭建工作。技术栈选型经过团队讨论后确定：

**前端技术栈**:
- React 18 + TypeScript + Vite（构建工具）
- Zustand（状态管理，替代 Redux 以降低样板代码）
- React Router v6（路由管理）
- Tailwind CSS（样式方案）

**后端技术栈**:
- Express + Node.js + TypeScript
- SQLite（嵌入式数据库，降低部署复杂度）
- better-sqlite3（同步 SQLite 驱动）

**Monorepo 结构**:
\`\`\`
i-write/
├── client/          # 前端 React 应用
├── server/          # 后端 Express 应用
├── shared/          # 前后端共享类型定义
├── samples/         # 示例数据文件
├── tests/           # E2E 测试
├── package.json     # 根 package.json（workspace）
└── tsconfig.json    # 根 TypeScript 配置
\`\`\`

关键决策：采用 npm workspaces 管理 monorepo，而非 Turborepo 或 Nx。原因是我们团队规模较小（18 人），不需要复杂的构建缓存和任务编排，npm workspaces 已经足够。

**相关 PR**: #100（项目初始化）、#101（monorepo 配置）、#102（TypeScript 配置统一）

### 2.2 Provider 系统（刘伟实现）

刘伟本周完成了 Provider 系统的核心实现。该系统是 i-Write 与各种 LLM 交互的统一适配层，采用 OpenAI-compatible 协议。

**设计原则**:
- 所有 LLM 调用通过统一的 Provider 接口
- 支持动态注册新的 Provider
- 自动适配不同模型的参数差异（temperature 范围、maxTokens 等）

**已适配的 Provider**:
| Provider | 模型 | 用途 | 状态 |
|----------|------|------|------|
| MiMo | mimo-v2.5-pro | 主力生成模型 | ✅ 完成 |
| Kimi | kimi-k2.6 | 长文本处理 | ✅ 完成 |
| DeepSeek | deepseek-chat | 推理增强 | ✅ 完成 |
| Gemini | gemini-2.0-flash | 多模态支持 | ⚠️ 特殊处理 |

**技术难点**: Gemini 的 systemPromptMode 需要特殊处理。Gemini 不支持 OpenAI 格式的 system message，需要通过 \`systemInstruction\` 参数传递。陈强设计了 \`ModelCapabilities\` 查询机制，每个模型调用前先查询其能力声明，自动适配参数。

\`\`\`typescript
// 核心适配逻辑
const capabilities = await getModelCapabilities(modelId);
if (capabilities.systemPromptMode === "parameter") {
  // Gemini: system prompt 作为 systemInstruction 参数
  payload.systemInstruction = { parts: [{ text: systemPrompt }] };
} else {
  // 默认: system prompt 作为 system message
  payload.messages.unshift({ role: "system", content: systemPrompt });
}
\`\`\`

**相关 PR**: #103（Provider 接口定义）、#104（MiMo 适配）、#105（Gemini 适配）、#106（ModelCapabilities 查询）

### 2.3 前端基础框架（赵丽搭建）

赵丽本周完成了前端基础框架的搭建，包括以下工作：

**路由与 Layout**:
- 实现了三栏布局：左侧导航栏 + 中间主内容区 + 右侧面板
- 路由配置：\`/\`（Chat）、\`/knowledge\`（知识库）、\`/documents\`（文档）、\`/settings\`（设置）
- 响应式布局适配（desktop/tablet/mobile）

**状态管理（Zustand）**:
- \`useChatStore\`: 聊天消息、会话管理
- \`useKnowledgeStore\`: 知识源列表、上传状态
- \`useDocumentStore\`: 文档列表、生成进度
- \`useSettingsStore\`: API Key 配置、模型选择

**Design Tokens（罗茜设计，何成实现）**:
- 颜色系统：Primary (#1a56db)、Secondary (#7c3aed)、Success (#059669)、Error (#dc2626)
- 字体：Inter（英文）、PingFang SC（中文）
- 间距系统：4px base unit（4/8/12/16/24/32/48/64）
- 圆角：4px/8px/12px/16px

**相关 PR**: #107（路由配置）、#108（Zustand stores）、#109（Design Tokens）、#110（Layout 组件）

### 2.4 CI/CD 配置（徐骏负责）

徐骏本周完成了 GitHub Actions CI/CD 流水线的配置：

**CI Pipeline（每次 push 触发）**:
1. Lint（ESLint + Prettier）— 约 30s
2. Type Check（tsc --noEmit）— 约 45s
3. Unit Test（Vitest）— 约 2min
4. Build（client + server）— 约 3min
5. 总计 < 8 分钟

**CD Pipeline（main 分支合并触发）**:
1. Build Docker image
2. Push to container registry
3. Deploy to staging environment
4. Smoke test（health check）

**环境配置**:
- Development: 本地开发（hot reload）
- Staging: 自动部署（main 分支）
- Production: 手动部署（tag 触发）

**相关 PR**: #111（CI pipeline）、#112（CD pipeline）、#113（Docker 配置）

### 2.5 DB Schema 设计（王超负责）

王超本周完成了 SQLite 数据库的 Schema 设计，共 10 张核心表：

**知识库相关**:
- \`kb_sources\`: 知识源（文件名、类型、状态、contentHash）
- \`kb_chunks\`: 文本切片（sourceId、内容、token 数、索引）
- \`kb_vectors\`: 向量数据（chunkId、向量 blob）

**生成相关**:
- \`generation_runs\`: 生成任务（prompt、状态、进度）
- \`generation_chapters\`: 章节（runId、标题、内容、groundedness score）
- \`generation_citations\`: 引用（chapterId、chunkId、置信度）

**用户相关**:
- \`users\`: 用户（OAuth ID、邮箱、角色）
- \`user_sessions\`: 会话（token、过期时间）

**评估相关**:
- \`evaluation_runs\`: 评估任务
- \`evaluation_metrics\`: 评估指标

**关键设计决策**:
- 所有表使用 UUID 作为主键（便于分布式扩展）
- 时间字段使用本地时间（datetime('now','localtime')）
- 审计日志记录所有写操作（audit_log 表）
- WAL 模式提升并发读写性能

**相关 PR**: #114（Schema 定义）、#115（migration 脚本）、#116（audit_log 表）

### 2.6 测试框架搭建（杨飞负责）

杨飞本周完成了测试框架的搭建：

**单元测试（Vitest）**:
- 配置 vitest.config.ts
- 测试文件命名：\`*.test.ts\`
- 覆盖率报告：vitest --coverage
- Mock 支持：vi.mock() / vi.spyOn()

**E2E 测试（Playwright）**:
- 配置 playwright.config.ts
- 支持 Chromium/Firefox/WebKit 三引擎
- 测试文件命名：\`*.spec.ts\`
- 截图与视频录制（失败时自动保存）

**测试策略**:
- 单元测试：覆盖核心业务逻辑（RAG 检索、评估指标、数据处理）
- 集成测试：覆盖 API 端点（HTTP 请求 → 响应验证）
- E2E 测试：覆盖核心用户流程（登录 → 上传 → 生成 → 导出）

**当前覆盖率**: 68%（目标 Sprint 4 达到 85%）

**相关 PR**: #117（Vitest 配置）、#118（Playwright 配置）、#119（测试工具函数）

---

## 三、团队协作

### 3.1 产品规划对齐

陈强与苏楠完成了 Q3 产品规划的技术可行性评估。主要结论：
- Phase 1-2（基础设施 + 知识管理）技术风险低，可按计划推进
- Phase 3（RAG 引擎）需要重点关注 Embedding 质量和检索性能
- Phase 4（文档生成）python-pptx 桥接方案需要 PoC 验证

### 3.2 设计评审

罗茜和何成完成了 Design System 的搭建，包括：
- 色彩规范、字体规范、间距规范
- 基础组件库（Button、Input、Card、Modal）
- 图标系统（Lucide Icons）

### 3.3 跨部门沟通

- 张伟（企业销售经理）反馈：已有 3 家企业客户对 i-Write 表示兴趣
- 王莉（市场总监）开始准备产品 landing page 的文案
- 唐敏（法务顾问）启动数据合规评估（GDPR + 中国个人信息保护法）

---

## 四、风险与阻塞

### 4.1 Gemini API 的 systemPromptMode 问题

**风险等级**: 🟡 中
**描述**: Gemini 不支持 OpenAI 格式的 system message，需要通过 \`systemInstruction\` 参数传递。当前方案可行，但增加了适配复杂度。
**负责人**: 赵军（VP Engineering）跟进
**缓解措施**: 已实现 ModelCapabilities 查询机制，自动适配不同模型的参数差异

### 4.2 前端打包体积偏大

**风险等级**: 🟢 低
**描述**: 当前 client bundle 约 2.1MB，目标 < 1.5MB
**负责人**: 赵丽
**缓解措施**: 下个 Sprint 优化 tree-shaking，移除未使用的依赖

---

## 五、Sprint 1 数据总览

| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| PR Merged | 42 | 35 | ✅ 超额 |
| 测试覆盖率 | 68% | 60% | ✅ 超额 |
| CI Pipeline | < 8min | < 10min | ✅ 达标 |
| Bug 数量 | 3 | < 5 | ✅ 达标 |
| 文档完成度 | 80% | 80% | ✅ 达标 |

---

## 六、下周计划（Sprint 2：知识管理）

1. 刘伟：知识库 SQLite 存储层（kb_sources/kb_chunks/kb_vectors 三表联动）
2. 陈强：文本切片算法（段落感知 + 句子边界 + 64 token overlap）
3. 赵丽：文件上传 UI（拖拽上传、进度条、格式校验）
4. 王超：Microsoft Graph API 集成（OneDrive 文件读取）
5. 孙娜：Embedding 集成（SiliconFlow bge-m3，1024 维向量）
6. 刘伟：People Graph CRUD + 组织架构可视化
7. 黄薇：Chat Box 交互 PRD（Rich UI Elements、follow-up questions）
8. 罗茜：Chat Box 高保真设计稿（何成实现 Design Tokens）
9. 杨飞：知识库集成测试（目标 28 个用例，覆盖率 82%）
`,
  },
  // ── 文档 2: Sprint 2 周报 ──
  {
    title: "i-Write 技术团队周报 - 2026-W24（Sprint 2：知识管理）",
    content: `# i-Write 技术团队周报 - 2026-W24（Sprint 2：知识管理）

**报告周期**: 2026 年 6 月 9 日（周一）~ 6 月 13 日（周五）
**报告人**: 陈强（技术负责人）
**抄送**: 赵军（VP Engineering）、苏楠（产品总监）

---

## 一、Sprint 目标回顾

Sprint 2 聚焦知识管理模块，是 i-Write 核心能力的第一块拼图。本周我们完成了从文件上传到知识库存储的完整链路，并启动了 People Graph 和 Embedding 集成。

**Sprint 2 三大关键目标**:
1. ✅ 知识库 SQLite 存储层（三表联动：kb_sources / kb_chunks / kb_vectors）
2. ✅ 文件上传与解析（支持 5 种文件格式）
3. ✅ Embedding 集成（SiliconFlow bge-m3，1024 维向量）

**Sprint 成果**: 51 个 PR merged，知识库支持 5 种文件格式，集成测试覆盖率 82%。

---

## 二、各模块完成情况

### 2.1 知识库存储层（刘伟负责）

刘伟本周完成了知识库 SQLite 存储层的核心实现，采用三表联动架构：

**表结构设计**:
- \`kb_sources\`: 知识源元数据（文件名、类型、状态、contentHash、chunkCount）
- \`kb_chunks\`: 文本切片（sourceId、内容、token 数、索引位置）
- \`kb_vectors\`: 向量数据（chunkId、向量 blob、维度）

**核心 API**:
\`\`\`typescript
// 添加知识源
addSource({ id, name, type, contentHash, chunkCount, status });

// 批量添加切片
addChunks(chunks: Array<{ id, sourceId, content, chunkIndex, tokenCount }>);

// 获取统计信息
getStats(): { sourceCount, chunkCount };

// 按 sourceId 查询切片
getChunksBySource(sourceId): Chunk[];

// 删除知识源及其关联数据
deleteSource(sourceId): void;
\`\`\`

**关键设计决策**:
- 采用 UUID 作为主键，便于后续分布式扩展
- contentHash 用于去重，相同内容不会重复入库
- 删除 source 时级联删除 chunks 和 vectors（外键约束）
- WAL 模式提升并发读写性能

**相关 PR**: #120（存储层 API）、#121（级联删除）、#122（WAL 配置）

### 2.2 文本切片算法（陈强设计）

陈强设计了段落感知的文本切片算法，核心思路是保持语义完整性：

**切片策略**:
1. 按段落分割（\\n\\n）
2. 段落过长时按句子边界二次分割
3. 相邻切片保留 64 token overlap（避免语义断裂）
4. 过短段落（< 50 token）与相邻段落合并

**切片参数**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| chunk_size | 512 | 目标切片大小（tokens） |
| chunk_overlap | 64 | 相邻切片重叠大小 |
| min_chunk_size | 50 | 最小切片大小 |

**效果评估**:
- 平均切片大小：487 tokens
- 切片边界语义完整率：94%（人工评估 100 个切片）
- 处理速度：~2000 chunks/s

**相关 PR**: #123（切片算法）、#124（参数配置）

### 2.3 文件上传 UI（赵丽实现）

赵丽本周完成了文件上传的前端实现：

**功能特性**:
- 拖拽上传（drag & drop zone）
- 点击上传（文件选择器）
- 上传进度条（实时百分比）
- 格式校验（前端预检查）
- 批量上传（最多 10 个文件）

**支持格式**:
| 格式 | 后端解析 | 状态 |
|------|----------|------|
| .txt | 直接读取 | ✅ |
| .md | 直接读取 | ✅ |
| .docx | mammoth 库 | ✅ |
| .pdf | pdf-parse 库 | ✅ |
| .eml | mailparser 库 | ✅ |

**UI 设计（罗茜设计稿）**:
- 上传区域使用虚线边框 + 拖拽高亮
- 文件列表显示：文件名、大小、格式图标、状态（上传中/成功/失败）
- 上传完成后显示切片数量和 token 统计

**相关 PR**: #125（上传组件）、#126（进度条）、#127（格式校验）

### 2.4 Microsoft Graph API 集成（王超负责）

王超本周完成了 Microsoft Graph API 的集成，支持从 OneDrive 读取文件：

**集成方案**:
- 使用 MSAL.js 进行 OAuth2 认证
- 通过 Graph API 获取 OneDrive 文件列表
- 支持下载文件内容并导入知识库

**API 端点**:
\`\`\`
GET /api/knowledge/onedrive/files    — 获取 OneDrive 文件列表
POST /api/knowledge/onedrive/import  — 导入指定文件到知识库
\`\`\`

**权限范围（Scopes）**:
- \`Files.Read\`: 读取用户文件
- \`User.Read\`: 读取用户基本信息

**相关 PR**: #128（Graph API 集成）、#129（OneDrive 文件列表）

### 2.5 Embedding 集成（孙娜负责）

孙娜本周完成了 Embedding 的集成，使用 SiliconFlow 的 bge-m3 模型：

**技术方案**:
- 模型：SiliconFlow/bge-m3（1024 维向量）
- API：OpenAI-compatible embedding endpoint
- 批量处理：每次最多 32 个 chunk 并行 embedding

**向量存储**:
- 向量以 Float32Array 二进制格式存储在 SQLite 的 BLOB 字段
- 查询时加载到内存，使用 cosine similarity 计算相似度

**性能基准**:
| 指标 | 数值 |
|------|------|
| 单 chunk embedding 延迟 | ~120ms |
| 批量 32 chunks 延迟 | ~800ms |
| 向量维度 | 1024 |
| 存储开销 | ~4KB/chunk |

**相关 PR**: #130（Embedding 客户端）、#131（批量处理）、#132（向量存储）

### 2.6 People Graph（刘伟实现）

刘伟本周完成了 People Graph 的 CRUD API 和基础可视化：

**数据模型**:
\`\`\`typescript
interface Person {
  id: string;
  name: string;
  title: string;
  department: string;
  email: string;
  managerId?: string;  // 上级
  avatar?: string;
}
\`\`\`

**API 端点**:
\`\`\`
GET    /api/people           — 获取所有人
POST   /api/people           — 添加人员
PUT    /api/people/:id       — 更新人员信息
DELETE /api/people/:id       — 删除人员
GET    /api/people/graph     — 获取组织架构图（树形结构）
\`\`\`

**可视化**:
- 使用 D3.js 绘制组织架构树
- 支持展开/折叠节点
- 支持拖拽调整汇报关系

**当前团队**: 18 人（完整组织架构见 samples/charts/people-graph.json）

**相关 PR**: #133（People CRUD）、#134（组织架构图 API）、#135（D3 可视化）

### 2.7 Chat Box PRD（黄薇主导）

黄薇本周完成了 Chat Box 交互界面的 PRD 评审：

**核心功能**:
- 普通对话：用户输入 → LLM 回复
- Rich UI Elements：代码块、表格、图表、引用卡片
- Follow-up Questions：LLM 生成建议问题
- 知识源引用：回复中标注来源文档和段落

**交互流程**:
1. 用户输入需求（如"帮我写一份项目周报"）
2. 系统检索知识库，找到相关内容
3. LLM 生成回复，引用来源
4. 用户可点击引用跳转到原文
5. 系统建议 follow-up questions

**设计评审结论**:
- ✅ 核心功能优先级明确
- ⚠️ Rich UI Elements 需要分阶段实现（Phase 1: 代码块 + 表格，Phase 2: 图表 + 引用卡片）

**相关 PR**: 无（PRD 文档，非代码）

---

## 三、团队协作亮点

### 3.1 跨团队协作

- 罗茜和何成完成了 Chat Box 的高保真设计稿，与黄薇的 PRD 完美对齐
- 苏楠组织了 Sprint 2 的需求评审，确保技术方案与产品需求一致
- 杨飞提前编写了知识库集成测试（28 个用例），覆盖率 82%

### 3.2 技术分享

- 陈强在周三技术分享会上讲解了文本切片算法的设计思路
- 孙娜分享了 Embedding 模型选型的对比分析（bge-m3 vs text-embedding-3-small vs Cohere）

---

## 四、Sprint 2 数据总览

| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| PR Merged | 51 | 40 | ✅ 超额 |
| 测试覆盖率 | 82% | 75% | ✅ 超额 |
| 知识库格式 | 5 种 | 5 种 | ✅ 达标 |
| Embedding 延迟 | ~120ms | < 200ms | ✅ 达标 |
| Bug 数量 | 5 | < 8 | ✅ 达标 |

---

## 五、下周计划（Sprint 3：RAG 引擎 + 认证模块）

1. 陈强：BM25 检索 + RRF 融合
2. 刘伟：Reranker 三级降级
3. 孙娜：Groundedness Check
4. 王超：用户认证模块（OAuth2 + JWT）
5. 赵丽：登录页面 UI
6. 杨飞：认证模块 E2E 测试
`,
  },
  // ── 文档 3: Sprint 3 周报 ──
  {
    title: "i-Write 技术团队周报 - 2026-W25（Sprint 3：RAG 引擎 + 认证模块）",
    content: `# i-Write 技术团队周报 - 2026-W25（Sprint 3：RAG 引擎 + 认证模块）

**报告周期**: 2026 年 6 月 16 日（周一）~ 6 月 20 日（周五）
**报告人**: 陈强（技术负责人）
**抄送**: 赵军（VP Engineering）、苏楠（产品总监）、王琳（COO）

---

## 一、Sprint 目标回顾

Sprint 3 是技术难度最高的一个 Sprint，需要同时完成 RAG 引擎的核心检索能力和用户认证模块。经过团队的共同努力，两个模块都按时交付。

**Sprint 3 三大关键目标**:
1. ✅ RAG 引擎端到端 pipeline（BM25 + 向量检索 + RRF + Reranker + Groundedness）
2. ✅ 用户认证模块（Microsoft OAuth2 + GitHub OAuth + JWT）
3. ✅ 第一个企业客户试用意向（Acme Corp）

**Sprint 成果**: 47 个 PR merged，RAG pipeline 端到端 < 3s，认证模块联调通过。

---

## 二、RAG 引擎

### 2.1 BM25 检索（陈强实现）

陈强本周完成了 BM25 检索的实现，使用 MiniSearch + jieba-wasm 分词：

**技术方案**:
- 检索库：MiniSearch（轻量级全文搜索）
- 分词：jieba-wasm（中文分词）
- 参数：k1=1.2, b=0.75（标准 BM25 参数）

**索引构建**:
\`\`\`typescript
const index = new MiniSearch({
  fields: ["content"],
  storeFields: ["sourceId", "chunkIndex"],
  searchOptions: {
    boost: { content: 1 },
    fuzzy: 0.2,
    prefix: true,
  },
});
\`\`\`

**性能基准**:
| 指标 | 数值 |
|------|------|
| 索引构建（1000 chunks） | ~200ms |
| 查询延迟（P95） | < 15ms |
| Recall@10 | 0.78 |

**相关 PR**: #136（BM25 检索）、#137（jieba 分词集成）

### 2.2 向量检索 + RRF 融合（刘伟实现）

刘伟本周完成了向量检索的优化和 RRF（Reciprocal Rank Fusion）融合：

**向量检索**:
- 使用 cosine similarity 计算查询向量与文档向量的相似度
- 支持 MMR（Maximal Marginal Relevance）多样性排序
- MMR lambda 参数：0.7（平衡相关性与多样性）

**RRF 融合公式**:
\`\`\`
RRF_score(d) = Σ 1 / (k + rank_i(d))
\`\`\`
其中 k=60（经验参数），rank_i(d) 是文档 d 在第 i 个检索器中的排名。

**Hybrid Search 流程**:
1. BM25 检索 → Top 20 结果
2. 向量检索 → Top 20 结果
3. RRF 融合 → 合并去重 → 按 RRF score 排序
4. MMR 多样性重排 → Top 10 结果

**效果评估**:
| 指标 | 纯 BM25 | 纯向量 | Hybrid (RRF) |
|------|---------|--------|--------------|
| Recall@10 | 0.78 | 0.82 | 0.91 |
| NDCG@10 | 0.65 | 0.71 | 0.82 |

**相关 PR**: #138（向量检索优化）、#139（RRF 融合）、#140（MMR 多样性）

### 2.3 Reranker 三级降级（刘伟实现）

刘伟本周完成了 Reranker 的三级降级机制：

**降级策略**:
- L1: SiliconFlow Reranker API（最高质量，延迟 ~300ms）
- L2: 本地 Cross-Encoder（中等质量，延迟 ~500ms，离线可用）
- L3: 启发式加权（最低质量，延迟 < 5ms，兜底）

**降级触发条件**:
\`\`\`typescript
async function rerank(query: string, documents: Document[]): Promise<Document[]> {
  try {
    // L1: 远程 API
    return await siliconflowRerank(query, documents);
  } catch (e) {
    logger.warn("[Reranker] L1 失败，降级到 L2");
    try {
      // L2: 本地 Cross-Encoder
      return await localCrossEncoderRerank(query, documents);
    } catch (e) {
      logger.warn("[Reranker] L2 失败，降级到 L3");
      // L3: 启发式加权
      return heuristicRerank(query, documents);
    }
  }
}
\`\`\`

**L3 启发式加权规则**:
- 查询词在文档中的命中率（权重 0.4）
- 文档位置（靠前的文档权重更高，权重 0.3）
- 文档长度（适中长度的文档权重更高，权重 0.3）

**相关 PR**: #141（Reranker 接口）、#142（SiliconFlow 集成）、#143（本地 Cross-Encoder）、#144（启发式降级）

### 2.4 Groundedness Check（孙娜负责）

孙娜本周完成了 Groundedness Check 的实现：

**验证逻辑**:
- 将生成文本按句子分割
- 对每个句子，检查是否有知识库 chunk 支持
- groundedRatio = 有支持的句子数 / 总句子数
- groundedRatio >= 0.8 → pass
- groundedRatio < 0.5 → fail（触发重生成）
- 0.5 <= groundedRatio < 0.8 → warning（标记可疑）

**句子级验证算法**:
\`\`\`typescript
function checkGroundedness(
  sentences: string[],
  sourceChunks: Chunk[]
): { groundedRatio: number; details: SentenceCheck[] } {
  const details = sentences.map(sentence => {
    const maxSimilarity = sourceChunks.reduce((max, chunk) => {
      const sim = cosineSimilarity(embed(sentence), embed(chunk.content));
      return Math.max(max, sim);
    }, 0);
    return {
      sentence,
      grounded: maxSimilarity >= 0.7,
      similarity: maxSimilarity,
    };
  });
  const groundedCount = details.filter(d => d.grounded).length;
  return {
    groundedRatio: groundedCount / details.length,
    details,
  };
}
\`\`\`

**准确率评估**: 92%（人工评估 200 个句子）

**相关 PR**: #145（Groundedness Check）、#146（句子分割）、#147（相似度阈值调优）

---

## 三、用户认证模块

### 3.1 OAuth2 基础框架（王超负责）

王超本周完成了用户认证模块的核心实现：

**支持的 Provider**:
- Microsoft OAuth2（MSAL.js）— P0 优先级
- GitHub OAuth（passport.js）— P1 优先级

**OAuth2 流程（Authorization Code Flow + PKCE）**:
1. 用户点击「使用 Microsoft 登录」
2. 前端跳转 Microsoft 授权页面（带 PKCE code_challenge）
3. 用户授权后，Microsoft 回调到后端
4. 后端用 Authorization Code + code_verifier 换取 Access Token
5. 后端生成 JWT Token，返回给前端

**Token 管理**:
- Access Token: 有效期 1 小时，HttpOnly Cookie
- Refresh Token: 有效期 7 天，加密 localStorage
- Token 刷新: 前端检测到 Access Token 过期前 5 分钟自动刷新

**相关 PR**: #148（OAuth2 框架）、#149（Microsoft OAuth）、#150（GitHub OAuth）

### 3.2 登录页面 UI（赵丽实现）

赵丽本周完成了登录页面的前端实现：

**UI 设计（罗茜设计稿）**:
- 居中卡片布局，Nexora Tech 品牌 logo
- 两个登录按钮：「使用 Microsoft 账号登录」「使用 GitHub 登录」
- 按钮样式：品牌色 + 图标 + 文字
- 底部隐私政策链接

**Token 自动刷新**:
\`\`\`typescript
// 前端 Token 刷新逻辑
useEffect(() => {
  const refreshInterval = setInterval(async () => {
    const token = getAccessToken();
    if (token && isTokenExpiringSoon(token, 5 * 60 * 1000)) {
      await refreshToken();
    }
  }, 60 * 1000); // 每分钟检查
  return () => clearInterval(refreshInterval);
}, []);
\`\`\`

**相关 PR**: #151（登录页面）、#152（Token 刷新 UI）

### 3.3 BUG-215: Token 刷新竞态条件

**发现者**: 杨飞（E2E 测试）
**严重程度**: 高
**描述**: 多个并发请求同时检测到 Token 过期，同时发起刷新请求，导致旧 Token 失效但新 Token 还没返回，后续请求返回 401。

**修复方案（王超实现）**:
\`\`\`typescript
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function refreshTokenIfNeeded(): Promise<string> {
  if (isRefreshing) {
    // 已经在刷新中，加入队列等待
    return new Promise(resolve => refreshQueue.push(resolve));
  }

  isRefreshing = true;
  try {
    const newToken = await refreshToken();
    // 刷新完成，通知队列中的所有请求
    refreshQueue.forEach(resolve => resolve(newToken));
    refreshQueue = [];
    return newToken;
  } finally {
    isRefreshing = false;
  }
}
\`\`\`

**测试结果**: 并发 100 个请求，0 个 401 错误

**相关 PR**: #153（竞态修复）

---

## 四、团队协作

### 4.1 认证模块需求评审

苏楠组织了认证模块的需求评审会议（6/16 周一 14:00-15:30），参会人员包括陈强、刘伟、赵丽、杨飞、黄薇、罗茜。

**评审结论**:
- 18 条需求全部通过
- 3 条变更：新增 PKCE 支持、Token 刷新策略调整、多账号绑定
- 罗茜的设计稿通过评审

### 4.2 第一个企业客户

张伟（企业销售经理）本周带来了第一个企业客户试用意向：

**客户信息**:
- 公司：Acme Corp
- 规模：200 人团队
- 需求：企业级文档生成，需要 SSO 集成
- 预算：$49/人/月（团队版）
- 时间线：希望 7 月底前开始试用

**跟进计划**:
- 苏楠：准备产品 demo
- 陈强：确认 SSO 技术方案
- 李鑫（客户成功经理）：准备客户 onboarding 材料

---

## 五、遇到的问题与解决方案

### 5.1 Azure AD redirect_uri 配置问题

**问题**: Azure AD 要求 redirect_uri 完全匹配，但开发环境和生产环境用同一个 App Registration。
**解决方案**: 在一个 App Registration 里配置多个 redirect_uri，用环境变量区分。

### 5.2 GitHub OAuth 回调超时

**问题**: GitHub API 响应偶尔 > 5s，导致回调超时。
**解决方案**: 增加超时时间到 10s，添加重试机制。

---

## 六、Sprint 3 数据总览

| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| PR Merged | 47 | 40 | ✅ 超额 |
| RAG 端到端延迟 | < 3s | < 5s | ✅ 超额 |
| Groundedness 准确率 | 92% | 85% | ✅ 超额 |
| 测试覆盖率 | 85% | 80% | ✅ 超额 |
| 认证模块联调 | 通过 | 通过 | ✅ 达标 |

---

## 七、下周计划（Sprint 4：文档生成 + 评估）

1. 刘伟：文档生成引擎（Word/PPT/Excel）
2. 陈强：叙事引擎（大纲→章节→RAG→LLM→Groundedness）
3. 赵丽：生成树可视化
4. 孙娜：评估体系（Trust Metrics 5 维度）
5. 苏楠：GoToMarket 策略文档
6. 唐敏：数据安全合规评审
7. 王莉：产品发布会材料
8. 李鑫：首批客户反馈整理
`,
  },
  // ── 文档 4: Sprint 4 周报 ──
  {
    title: "i-Write 技术团队周报 - 2026-W26（Sprint 4：文档生成 + 评估）",
    content: `# i-Write 技术团队周报 - 2026-W26（Sprint 4：文档生成 + 评估）

**报告周期**: 2026 年 6 月 23 日（周一）~ 6 月 27 日（周五）
**报告人**: 陈强（技术负责人）
**抄送**: 赵军（VP Engineering）、苏楠（产品总监）、王琳（COO）、陈宇（CEO）

---

## 一、Sprint 目标回顾

Sprint 4 是 i-Write Alpha 版本的最后一个 Sprint，核心目标是完成文档生成引擎和评估体系，使产品具备端到端的可信文档生成能力。

**Sprint 4 三大关键目标**:
1. ✅ 文档生成引擎（Word/PPT/Excel 三种格式）
2. ✅ 评估体系（Trust Metrics 5 维度）
3. ✅ i-Write Alpha 版本就绪

**Sprint 成果**: 55 个 PR merged，i-Write Alpha 版本就绪，月度总计 195 个 PR。

---

## 二、文档生成引擎

### 2.1 叙事引擎（陈强实现）

陈强本周完成了叙事引擎的核心实现，这是 i-Write 生成文档的大脑：

**叙事引擎流程**:
\`\`\`
用户需求 → 大纲生成 → 章节指令 → RAG 检索 → LLM 生成 → Groundedness 验证 → 文档输出
\`\`\`

**详细流程**:
1. **大纲生成**: LLM 根据用户需求生成文档大纲（标题、章节、子章节）
2. **章节指令**: 将大纲转化为每个章节的生成指令（包含上下文和约束）
3. **RAG 检索**: 对每个章节指令，从知识库检索相关内容
4. **LLM 生成**: 将检索结果 + 章节指令传给 LLM，生成章节内容
5. **Groundedness 验证**: 验证生成内容是否有知识库支持
6. **文档输出**: 将所有章节组装为完整文档

**关键代码**:
\`\`\`typescript
async function generateDocument(prompt: string): Promise<Document> {
  // 1. 生成大纲
  const outline = await generateOutline(prompt);

  // 2. 逐章节生成
  const chapters = [];
  for (const section of outline.sections) {
    // RAG 检索
    const sources = await hybridSearch(section.instruction);

    // LLM 生成
    const content = await llmGenerate({
      instruction: section.instruction,
      sources: sources.map(s => s.content),
    });

    // Groundedness 验证
    const groundedness = await checkGroundedness(content, sources);

    chapters.push({
      title: section.title,
      content,
      sources,
      groundedness,
    });
  }

  return { title: outline.title, chapters };
}
\`\`\`

**性能基准**:
| 指标 | 数值 |
|------|------|
| 大纲生成 | ~2s |
| 单章节生成（含 RAG） | ~5s |
| 完整文档生成（10 章节） | ~45s |
| Groundedness 通过率 | 94% |

**相关 PR**: #154（叙事引擎）、#155（大纲生成）、#156（章节生成）

### 2.2 文档生成格式（刘伟负责）

刘伟本周完成了三种文档格式的生成支持：

**Word (.docx)**:
- 使用 docx 库生成
- 支持标题、段落、表格、列表、图片
- 支持自定义样式（字体、颜色、间距）

**PPT (.pptx)**:
- 使用 python-pptx 桥接（通过 child_process 调用 Python 脚本）
- 支持标题页、内容页、表格页、图表页
- 支持自定义主题色和字体

**Excel (.xlsx)**:
- 使用 xlsx 库生成
- 支持多 sheet、列宽设置、数据格式化
- 支持公式和图表

**导出 API**:
\`\`\`
POST /api/documents/export
Body: { documentId, format: "docx" | "pptx" | "xlsx" }
Response: { downloadUrl, fileSize }
\`\`\`

**相关 PR**: #157（Word 生成）、#158（PPT 桥接）、#159（Excel 生成）、#160（导出 API）

### 2.3 生成树可视化（赵丽实现）

赵丽本周完成了生成树的可视化组件：

**功能特性**:
- 树形结构展示文档生成过程
- 支持溯源到 chunk 级别
- 支持手动覆盖（用户可替换不满意的段落）
- 支持展开/折叠节点

**节点类型**:
- 📄 文档节点：完整文档
- 📑 章节节点：文档的每个章节
- 🔍 检索节点：RAG 检索到的 chunk
- ✅ 验证节点：Groundedness 检查结果

**交互功能**:
- 点击 chunk 节点 → 显示原文内容和来源
- 点击章节节点 → 显示生成内容和 groundedness score
- 右键菜单 → 重新生成、手动编辑、替换来源

**相关 PR**: #161（生成树组件）、#162（溯源交互）、#163（手动覆盖）

---

## 三、评估体系

### 3.1 Trust Metrics 5 维度（孙娜搭建）

孙娜本周完成了评估体系的核心框架：

**5 个评估维度**:
| 维度 | 说明 | 权重 | 计算方式 |
|------|------|------|----------|
| Faithfulness | 生成内容是否忠于来源 | 0.25 | 句子级来源匹配 |
| Groundedness | 生成内容是否有据可查 | 0.25 | 向量相似度 |
| Coherence | 生成内容是否逻辑连贯 | 0.20 | LLM 评估 |
| Fluency | 生成内容是否通顺流畅 | 0.15 | 语法检查 + LLM 评估 |
| Completeness | 生成内容是否完整覆盖需求 | 0.15 | 需求覆盖率 |

**综合 Trust Score**:
\`\`\`
TrustScore = Σ (dimension_score × weight)
\`\`\`

**评估流程**:
1. 文档生成完成后自动触发评估
2. 5 个维度并行计算
3. 汇总为 Trust Score（0-1）
4. Trust Score < 0.6 → 标记为低可信度
5. Trust Score >= 0.8 → 标记为高可信度

**评估报告**:
- 每个维度的详细得分和说明
- 可疑句子高亮标注
- 改进建议

**相关 PR**: #164（评估框架）、#165（Faithfulness 计算）、#166（Coherence 评估）、#167（评估报告）

---

## 四、跨部门协作

### 4.1 GoToMarket 策略（苏楠主导）

苏楠本周完成了 GoToMarket 策略文档：

**定价策略**:
| 套餐 | 价格 | 功能 | 目标用户 |
|------|------|------|----------|
| Free | $0 | 基础功能，5 次/月 | 个人用户试用 |
| Pro | $19/月 | 全部功能，无限次 | 个人专业人士 |
| Team | $49/月/人 | 团队协作，管理后台 | 企业团队 |

**目标客户画像**:
- PM：需要写 PRD、项目周报、产品规划
- Engineer：需要写技术方案、API 文档、架构设计
- Consultant：需要写咨询报告、行业分析、案例研究

**渠道策略**:
- PLG（Product-Led Growth）：免费版吸引用户 → 自然升级
- 企业直销：张伟负责，目标 10 家企业客户
- 内容营销：王莉负责，技术博客 + 社交媒体

### 4.2 数据安全合规（唐敏负责）

唐敏本周完成了数据安全合规评审：

**合规要求**:
- GDPR（欧盟通用数据保护条例）
- 中国个人信息保护法

**关键措施**:
- API Key 加密存储（AES-256-GCM）
- 用户数据 90 天自动清理
- 审计日志记录所有写操作
- 用户可请求删除所有数据（Right to Erasure）

**责任人**:
- 唐敏（法务顾问）：合规政策制定
- 陈强（技术负责人）：技术实现

### 4.3 产品发布会准备（王莉负责）

王莉本周开始准备产品发布会材料：

**材料清单**:
- Landing page copy（初稿完成）
- Demo video 脚本（初稿完成）
- 产品介绍 PPT（进行中）
- 社交媒体文案（待开始）

### 4.4 首批客户反馈（李鑫整理）

李鑫本周整理了 3 个 beta 用户的反馈：

**用户 A（PM）**:
- NPS: 9/10
- 最喜欢：溯源功能，能看到每段话的来源
- 建议：支持更多知识源类型（Confluence、Notion）

**用户 B（Engineer）**:
- NPS: 8/10
- 最喜欢：RAG 检索准确率高
- 建议：支持代码片段生成

**用户 C（Consultant）**:
- NPS: 7/10
- 最喜欢：文档生成速度快
- 建议：支持自定义模板

**平均 NPS**: 8.0/10

---

## 五、月度总结

### 5.1 数据总览

| 指标 | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 | 月度总计 |
|------|----------|----------|----------|----------|----------|
| PR Merged | 42 | 51 | 47 | 55 | 195 |
| 测试覆盖率 | 68% | 82% | 85% | 87% | 68%→87% |
| Bug 数量 | 3 | 5 | 4 | 3 | 15 |
| 知识库格式 | - | 5 种 | 5 种 | 5 种 | 5 种 |
| 认证模块 | - | - | ✅ | ✅ | ✅ |
| 文档生成 | - | - | - | ✅ | ✅ |

### 5.2 里程碑

- ✅ Sprint 1: 项目基础设施就绪
- ✅ Sprint 2: 知识管理模块完成
- ✅ Sprint 3: RAG 引擎 + 认证模块完成
- ✅ Sprint 4: 文档生成 + 评估体系完成
- 🎯 i-Write Alpha 版本就绪

### 5.3 团队亮点

- 陈强：技术架构设计清晰，RAG 引擎性能超预期
- 刘伟：文档生成引擎三种格式全部支持
- 赵丽：前端组件质量高，用户体验好
- 孙娜：Groundedness Check 准确率 92%，评估体系完整
- 王超：认证模块 BUG-215 快速修复
- 杨飞：测试覆盖率从 68% 提升到 87%
- 徐骏：CI/CD 流水线稳定可靠
- 罗茜/何成：Design System 完善，设计稿质量高
- 黄薇：Chat Box PRD 清晰完整
- 苏楠：GoToMarket 策略明确
- 唐敏：数据合规评审及时
- 王莉：产品发布会材料准备充分
- 张伟：带来第一个企业客户
- 李鑫：客户反馈整理及时

---

## 六、下周计划（Alpha 版本发布）

1. 陈强：Alpha 版本发布准备
2. 刘伟：文档生成性能优化
3. 赵丽：UI 细节打磨
4. 孙娜：评估报告优化
5. 杨飞：回归测试
6. 徐骏：生产环境部署
7. 苏楠：产品 demo 准备
8. 张伟：Acme Corp 客户 demo
`,
  },
  // ── 文档 5: 认证模块技术方案 v2.0 ──
  {
    title: "用户认证模块技术方案 v2.0",
    content: `# 用户认证模块技术方案 v2.0

**版本**: v2.0
**作者**: 陈强（技术负责人）、王超（后端工程师）
**日期**: 2026-06-20
**状态**: 已评审
**评审人**: 赵军（VP Engineering）、苏楠（产品总监）

---

## 1. 概述

### 1.1 背景

i-Write 是 Nexora Tech 企业级可信文档生成平台，需要支持企业用户通过 SSO 登录，同时支持个人开发者通过 GitHub 登录。认证模块是整个平台的基础组件，负责用户身份验证和授权。

### 1.2 目标用户

| 用户类型 | 登录方式 | 典型场景 |
|----------|----------|----------|
| 企业用户 | Microsoft OAuth2（Azure AD） | 企业 SSO，员工通过公司账号登录 |
| 个人开发者 | GitHub OAuth | 开发者通过 GitHub 账号登录 |
| 未来扩展 | Google / Slack OAuth | 更多 OAuth Provider |

### 1.3 成功指标

| 指标 | 目标 | 当前值 |
|------|------|--------|
| 登录成功率 | >= 99.5% | 99.8% |
| Token 刷新成功率 | >= 99.9% | 99.95% |
| 登录延迟（P95） | < 2s | 1.2s |
| E2E 测试覆盖率 | >= 85% | 85% |

---

## 2. 技术选型对比

### 2.1 OAuth2 库选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| MSAL.js | 官方 Microsoft 库，Azure AD 原生支持 | 只支持 Microsoft | ✅ 选用（Microsoft） |
| passport.js | 支持 500+ Provider，社区活跃 | 配置复杂，文档不够清晰 | ✅ 选用（GitHub） |
| next-auth | 开箱即用，Next.js 集成好 | 我们不用 Next.js，框架耦合 | ❌ 不选 |

### 2.2 Token 格式选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| JWT (RS256) | 无状态、可验证、跨服务 | Token 体积大、无法即时撤销 | ✅ 选用 |
| Session (Redis) | 即时撤销、体积小 | 有状态、需要 Redis | ❌ 不选 |

---

## 3. 架构设计

### 3.1 OAuth2 Authorization Code Flow + PKCE

1. 用户点击「使用 Microsoft 登录」
2. 前端生成 PKCE code_verifier 和 code_challenge
3. 前端跳转 Microsoft 授权页面（带 code_challenge）
4. 用户授权后，Microsoft 回调到后端（带 authorization code）
5. 后端用 authorization code + code_verifier 换取 Access Token
6. 后端生成 JWT Token，返回给前端
7. 前端存储 Token，后续请求携带

### 3.2 Token 管理

- Access Token: 1 小时，HttpOnly Cookie
- Refresh Token: 7 天，加密 localStorage（AES-256-GCM）
- 刷新策略: 过期前 5 分钟自动刷新，队列机制防竞态

---

## 4. BUG-215: Token 刷新竞态条件

**问题**: 并发请求同时刷新 Token，导致 401 错误。

**解决方案**: 队列机制
\`\`\`typescript
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function refreshTokenIfNeeded(): Promise<string> {
  if (isRefreshing) {
    return new Promise(resolve => refreshQueue.push(resolve));
  }
  isRefreshing = true;
  try {
    const newToken = await refreshToken();
    refreshQueue.forEach(resolve => resolve(newToken));
    refreshQueue = [];
    return newToken;
  } finally {
    isRefreshing = false;
  }
}
\`\`\`

**测试**: 并发 100 请求，0 个 401 错误。

---

## 5. 多 Provider 支持

### 5.1 Microsoft OAuth2

- Scopes: User.Read, Files.Read
- 权限: 读取用户信息 + OneDrive 文件

### 5.2 GitHub OAuth

- Scope: user:email, repo
- 权限: 读取邮箱 + 仓库文件

---

## 6. 安全设计

- HTTPS 传输加密
- CSRF: OAuth2 State 参数验证
- XSS: HttpOnly Cookie + CSP 策略
- Rate Limiting: 登录 10 次/分钟/IP
- 审计日志: 所有登录/登出/刷新操作

---

## 7. API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| /auth/microsoft | GET | 发起 Microsoft OAuth2 |
| /auth/microsoft/callback | GET | Microsoft 回调 |
| /auth/github | GET | 发起 GitHub OAuth |
| /auth/github/callback | GET | GitHub 回调 |
| /auth/refresh | POST | 刷新 Token |
| /auth/logout | POST | 登出 |
| /auth/me | GET | 获取当前用户信息 |

---

## 8. 测试方案

| 类型 | 覆盖范围 | 工具 | 状态 |
|------|----------|------|------|
| 单元测试 | Token 生成/验证 | Vitest | ✅ |
| 集成测试 | OAuth2 流程 | Vitest + supertest | ✅ |
| E2E 测试 | 完整登录流程 | Playwright | ✅ |

---

## 9. 迁移方案

v1（仅 GitHub）→ v2（Microsoft + GitHub）:
1. 部署 v2 代码
2. DB migration: users 表新增 provider 字段
3. 现有用户自动迁移

---

## 10. 时间线

| 日期 | 任务 | 负责人 | 状态 |
|------|------|--------|------|
| 6/16 | OAuth2 基础框架 | 王超 | ✅ |
| 6/17 | Microsoft OAuth | 王超 | ✅ |
| 6/17 | GitHub OAuth | 刘伟 | ✅ |
| 6/18 | 登录页面 UI | 赵丽 | ✅ |
| 6/19 | 联调 + BUG-215 修复 | 全员 | ✅ |
| 6/20 | E2E 测试 | 杨飞 | ✅ |

**总工时**: 3 人 × 5 天 = 15 人天
`,
  },
  // ── 文档 6: Q3 2026 产品规划 ──
  {
    title: "i-Write Q3 2026 产品规划",
    content: `# i-Write Q3 2026 产品规划

**版本**: v1.0
**作者**: 苏楠（产品总监）
**日期**: 2026-06-25
**状态**: 已评审
**评审人**: 陈宇（CEO）、王琳（COO）、赵军（VP Engineering）

---

## 1. 产品愿景

成为企业级可信文档生成平台，连接所有知识源，提供可追溯的文档生成服务。

**核心价值主张**: 让每一份文档都有据可查、有源可溯。

---

## 2. 市场分析

### 2.1 市场规模

- 全球企业内容生成市场：$4.2B（2026 年预估）
- 年增长率：28%（2026-2030）
- 中国企业内容生成市场：¥120 亿

### 2.2 竞品对比

| 竞品 | 定位 | 优势 | 劣势 | 价格 |
|------|------|------|------|------|
| Jasper | AI 营销文案 | 模板丰富、品牌声音 | 无溯源、无知识库 | $49/月 |
| Copy.ai | AI 写作助手 | 易用、快速 | 质量不稳定 | $36/月 |
| Notion AI | 文档+AI | 集成度高 | AI 功能浅 | $10/月 |
| **i-Write** | **可信文档生成** | **溯源、知识库、Trust Score** | **新产品、知名度低** | **$19/月** |

### 2.3 i-Write 差异化

1. **溯源能力**: 每段文字都能追溯到知识库来源
2. **知识库集成**: 支持 10+ 知识源类型
3. **Trust Score**: 5 维度评估文档可信度
4. **企业级安全**: GDPR 合规、审计日志

---

## 3. 用户画像

### 3.1 PM（产品经理）

**痛点**:
- 写 PRD 耗时 2-4 小时
- 项目周报重复性高
- 产品规划需要大量调研

**Use Cases**:
- 从需求文档生成 PRD
- 从会议记录生成项目周报
- 从市场数据生成产品规划

### 3.2 Engineer（工程师）

**痛点**:
- 技术方案写作门槛高
- API 文档更新不及时
- 架构设计缺少参考资料

**Use Cases**:
- 从代码生成 API 文档
- 从需求生成技术方案
- 从设计文档生成架构说明

### 3.3 Consultant（咨询顾问）

**痛点**:
- 行业报告写作周期长
- 案例研究需要大量调研
- 数据分析报告格式化繁琐

**Use Cases**:
- 从调研数据生成行业报告
- 从客户资料生成案例研究
- 从数据生成分析报告

---

## 4. 核心目标

### 4.1 知识连接（6-7 月）

- 支持 10+ 知识源类型
- 文件上传：txt, md, docx, pdf, eml
- 云文档：OneDrive, Google Drive
- 代码仓库：GitHub, GitLab
- 聊天记录：Teams, Slack
- 邮件：Outlook, Gmail

### 4.2 可信生成（7-8 月）

- 置信度评分 >= 0.8
- 溯源到 chunk 级别
- Groundedness Check 通过率 >= 90%
- 支持手动覆盖和修正

### 4.3 评估闭环（8-9 月）

- 在线评估：实时 Trust Score
- 离线评估：Golden Set 批量评估
- 历史对比：版本间质量趋势

---

## 5. 技术路线（5 Phase）

### Phase 1: 基础设施（6 月）— 陈强负责

| 交付物 | 负责人 | 状态 |
|--------|--------|------|
| 项目骨架 | 陈强 | ✅ |
| Provider 系统 | 刘伟 | ✅ |
| DB Schema | 王超 | ✅ |
| CI/CD | 徐骏 | ✅ |

### Phase 2: 知识管理（6-7 月）— 陈强主导

| 交付物 | 负责人 | 状态 |
|--------|--------|------|
| 文件上传解析 | 赵丽、刘伟 | ✅ |
| 知识库存储 | 刘伟 | ✅ |
| People Graph | 刘伟 | ✅ |
| Embedding 集成 | 孙娜 | ✅ |

### Phase 3: RAG 引擎（7 月）— 陈强主导

| 交付物 | 负责人 | 状态 |
|--------|--------|------|
| BM25 检索 | 陈强 | ✅ |
| 向量检索 | 刘伟 | ✅ |
| Reranker | 刘伟 | ✅ |
| Groundedness | 孙娜 | ✅ |

### Phase 4: 文档生成（8 月）— 苏楠定义需求

| 交付物 | 负责人 | 状态 |
|--------|--------|------|
| Word/PPT/Excel 生成 | 刘伟 | ✅ |
| 叙事引擎 | 陈强 | ✅ |
| 生成树可视化 | 赵丽 | ✅ |

### Phase 5: 评估体系（9 月）— 孙娜主导

| 交付物 | 负责人 | 状态 |
|--------|--------|------|
| 在线评估 | 孙娜 | ✅ |
| 离线评估 | 孙娜、陈强 | 🔄 |
| 历史对比 | 赵丽 | ⏳ |

---

## 6. GoToMarket 策略

### 6.1 PLG（Product-Led Growth）

- 免费版吸引用户试用
- 自然升级路径：Free → Pro → Team
- 病毒传播：邀请好友获赠额度

### 6.2 企业直销

- 张伟负责，目标 10 家企业客户
- 重点行业：科技、咨询、金融
- 合作伙伴：系统集成商

### 6.3 内容营销

- 王莉负责，技术博客 + 社交媒体
- 主题：AI 写作技巧、文档自动化、知识管理
- 渠道：掘金、知乎、微信公众号

---

## 7. 定价策略

| 套餐 | 价格 | 功能 | 目标用户 |
|------|------|------|----------|
| Free | $0 | 基础功能，5 次/月 | 个人试用 |
| Pro | $19/月 | 全部功能，无限次 | 个人专业人士 |
| Team | $49/月/人 | 团队协作，管理后台 | 企业团队 |

**年付优惠**: 8 折

---

## 8. 成功指标

| 指标 | 目标（Q3 末） | 当前值 |
|------|---------------|--------|
| DAU | 1000 | 0（Alpha） |
| NPS | >= 40 | 45（Beta） |
| Trust Score | >= 0.85 | 0.87 |
| Generation Time | < 30s | ~25s |
| Revenue | $5K MRR | $0 |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| LLM 成本超预期 | 中 | 高 | 多 Provider 比价、缓存策略 |
| 数据安全事件 | 低 | 极高 | GDPR 合规、审计日志、加密 |
| 竞品追赶 | 高 | 中 | 持续创新、深耕溯源能力 |

---

## 10. 资源需求

**当前团队**: 18 人
**Q3 末目标**: 25 人（+7 人）

| 角色 | 新增 | 理由 |
|------|------|------|
| 后端工程师 | 2 | 支付系统、企业功能 |
| 前端工程师 | 1 | 移动端适配 |
| 销售 | 2 | 企业客户拓展 |
| 客户成功 | 2 | 客户 onboarding 和续约 |
`,
  },
  // ── 文档 7: RAG 引擎架构设计 ──
  {
    title: "i-Write RAG 引擎架构设计文档",
    content: `# i-Write RAG 引擎架构设计文档

**版本**: v1.0
**作者**: 陈强（技术负责人）
**日期**: 2026-06-22
**状态**: 已评审

---

## 1. 概述

RAG（Retrieval-Augmented Generation）是 i-Write 的核心技术，负责从知识库检索相关内容并辅助 LLM 生成可信文档。

**设计原则**:
- **可追溯**: 每段生成内容都能追溯到知识库来源
- **可配置**: 所有参数可调，适应不同场景
- **可降级**: 核心组件支持三级降级，保证可用性

---

## 2. 整体架构

\`\`\`
用户需求
    ↓
Query Expansion（查询扩展）
    ↓
Hybrid Search（混合检索）
    ├─ BM25 检索
    └─ 向量检索
    ↓
RRF Fusion（融合排序）
    ↓
Reranker（重排序）
    ↓
Groundedness Check（可信度验证）
    ↓
LLM 生成
    ↓
文档输出
\`\`\`

---

## 3. Query Expansion

### 3.1 跨语言扩展

将中文查询扩展为中英双语：
- 原始查询："项目进度"
- 扩展查询："项目进度" OR "project progress" OR "project status"

### 3.2 同义词扩展

使用同义词词典扩展查询：
- "进度" → "进展"、"状态"、"完成情况"

### 3.3 Multi-Query 改写（LLM-based）

使用 LLM 生成多个语义等价的查询：
- 原始："本周完成了什么？"
- 改写 1："本周的工作成果有哪些？"
- 改写 2："这周做了哪些事情？"

---

## 4. Hybrid Search

### 4.1 BM25 检索

**库**: MiniSearch + jieba-wasm（中文分词）

**参数**:
| 参数 | 值 | 说明 |
|------|-----|------|
| k1 | 1.2 | 词频饱和参数 |
| b | 0.75 | 文档长度归一化参数 |
| fuzzy | 0.2 | 模糊匹配阈值 |

**性能**: 索引 1000 chunks ~200ms，查询 P95 < 15ms

### 4.2 向量检索

**模型**: SiliconFlow/bge-m3（1024 维）

**相似度**: cosine similarity

**多样性**: MMR（Maximal Marginal Relevance）
\`\`\`
MMR = λ × sim(q,d) - (1-λ) × max(sim(d,d'))
\`\`\`
λ = 0.7（平衡相关性与多样性）

### 4.3 RRF 融合

**公式**:
\`\`\`
RRF_score(d) = Σ 1 / (k + rank_i(d))
\`\`\`
k = 60

**效果**:
| 方法 | Recall@10 | NDCG@10 |
|------|-----------|---------|
| 纯 BM25 | 0.78 | 0.65 |
| 纯向量 | 0.82 | 0.71 |
| Hybrid (RRF) | 0.91 | 0.82 |

---

## 5. Reranker 三级降级

### L1: SiliconFlow Reranker API

- 质量最高
- 延迟 ~300ms
- 需要网络连接

### L2: 本地 Cross-Encoder

- 质量中等
- 延迟 ~500ms
- 离线可用

### L3: 启发式加权

- 质量最低
- 延迟 < 5ms
- 兜底方案

**降级逻辑**:
\`\`\`typescript
async function rerank(query, docs) {
  try { return await L1_siliconflow(query, docs); }
  catch {
    try { return await L2_crossEncoder(query, docs); }
    catch { return L3_heuristic(query, docs); }
  }
}
\`\`\`

---

## 6. Groundedness Check

### 6.1 验证逻辑

- 将生成文本按句子分割
- 对每个句子，检查是否有知识库 chunk 支持
- groundedRatio = 有支持的句子数 / 总句子数

### 6.2 阈值

| 条件 | 结果 |
|------|------|
| groundedRatio >= 0.8 | ✅ pass |
| 0.5 <= groundedRatio < 0.8 | ⚠️ warning |
| groundedRatio < 0.5 | ❌ fail（触发重生成） |

### 6.3 准确率

92%（人工评估 200 个句子）

---

## 7. 参数配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| chunk_size | 512 | 文档分块大小（tokens） |
| chunk_overlap | 64 | 分块重叠大小 |
| embedding_dimension | 1024 | 向量维度 |
| bm25_k1 | 1.2 | BM25 参数 k1 |
| bm25_b | 0.75 | BM25 参数 b |
| rrf_k | 60 | RRF 融合参数 |
| mmr_lambda | 0.7 | MMR 多样性参数 |
| top_k | 10 | 检索返回数量 |
| reranker_top_k | 5 | 重排序后返回数量 |
| groundedness_threshold | 0.8 | 通过阈值 |
| groundedness_fail_threshold | 0.5 | 失败阈值 |

---

## 8. 性能基准

| 指标 | 目标 | 当前值 |
|------|------|--------|
| 端到端延迟 | < 5s | < 3s |
| 检索延迟 | < 1s | < 500ms |
| Rerank 延迟 | < 1.5s | < 1s |
| Groundedness 延迟 | < 2s | < 1.5s |
| Recall@10 | > 0.85 | 0.91 |
| Groundedness 通过率 | > 85% | 92% |

---

## 9. 监控与告警

### 9.1 关键指标

- 检索延迟（P50/P95/P99）
- Reranker 降级率
- Groundedness 通过率
- LLM 调用延迟

### 9.2 告警规则

| 指标 | 阈值 | 告警方式 |
|------|------|----------|
| 检索延迟 P95 | > 2s | Slack |
| Reranker 降级率 | > 50% | Slack + 邮件 |
| Groundedness 通过率 | < 70% | Slack + 邮件 |
`,
  },
  // ── 文档 8: 数据安全合规方案 ──
  {
    title: "i-Write 数据安全与合规方案",
    content: `# i-Write 数据安全与合规方案

**版本**: v1.0
**作者**: 唐敏（法务顾问）、陈强（技术负责人）
**日期**: 2026-06-24
**状态**: 已评审
**评审人**: 王琳（COO）

---

## 1. 概述

### 1.1 适用法规

- **GDPR**（欧盟通用数据保护条例）— 适用于欧盟用户
- **中国个人信息保护法**（PIPL）— 适用于中国用户

### 1.2 合规目标

- 用户数据收集最小化
- 用户知情同意
- 数据存储安全
- 数据删除权保障
- 审计日志完整

---

## 2. 数据分类

| 数据类型 | 示例 | 敏感等级 | 保留期限 |
|----------|------|----------|----------|
| 用户数据（PII） | 姓名、邮箱、头像 | 高 | 用户删除前 |
| 文档内容 | 用户生成的文档 | 中 | 用户删除前 |
| 知识库数据 | 上传的文件、切片 | 中 | 用户删除前 |
| 日志数据 | 操作日志、错误日志 | 低 | 30 天 |
| 审计日志 | 写操作记录 | 中 | 1 年 |

---

## 3. 数据收集

### 3.1 最小必要原则

- 只收集功能必需的数据
- 不收集用户的行为数据（除非用户同意）
- 不收集用户的 IP 地址（除非安全需要）

### 3.2 用户授权

- 注册时明确告知数据用途
- 用户可随时撤回授权
- 撤回授权后删除所有用户数据

### 3.3 Cookie 政策

- 仅使用必要的 Cookie（Session、CSRF）
- 不使用追踪 Cookie
- 不使用第三方 Cookie

---

## 4. 数据存储

### 4.1 SQLite 加密

- WAL 模式提升并发性能
- 数据库文件权限限制（600）
- 定期备份（每日）

### 4.2 API Key 加密存储

\`\`\`
算法: AES-256-GCM
密钥: 从环境变量 ENCRYPTION_KEY 读取
存储: 加密后存入 keyStore 表
\`\`\`

### 4.3 审计日志

\`\`\`sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT DEFAULT (datetime('now','localtime')),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- INSERT | UPDATE | DELETE
  record_id TEXT NOT NULL,
  old_data TEXT,            -- JSON
  new_data TEXT,            -- JSON
  source TEXT               -- 模块名/路由名
);
\`\`\`

---

## 5. 数据处理

### 5.1 LLM 调用时的数据脱敏

- 调用 LLM API 前，移除 PII（姓名、邮箱等）
- 使用匿名标识符替代真实身份
- LLM 响应不包含用户 PII

### 5.2 Embedding 数据

- Embedding 向量不包含 PII
- 向量是文本的数值表示，无法反推原文
- 向量存储在用户自己的数据库中

---

## 6. 数据留存

| 数据类型 | 保留期限 | 清理策略 |
|----------|----------|----------|
| 用户数据 | 用户删除前 | 用户请求删除 |
| 文档内容 | 用户删除前 | 用户请求删除 |
| 知识库数据 | 用户删除前 | 用户请求删除 |
| 日志数据 | 30 天 | 自动清理 |
| 审计日志 | 1 年 | 自动清理 |

---

## 7. 数据删除

### 7.1 Right to Erasure

用户可请求删除所有数据：

1. 用户在设置页面点击「删除我的数据」
2. 系统发送确认邮件
3. 用户确认后，系统删除：
   - 用户账号
   - 所有文档
   - 所有知识库数据
   - 所有会话数据
4. 审计日志保留（法规要求）

### 7.2 删除时间

- 请求后 72 小时内完成删除
- 删除完成后发送确认邮件

---

## 8. 访问控制

### 8.1 认证

- OAuth2 认证（Microsoft / GitHub）
- JWT Token 有效期 1 小时
- Refresh Token 有效期 7 天

### 8.2 RBAC 角色

| 角色 | 权限 | 说明 |
|------|------|------|
| Admin | 全部权限 | 企业管理员 |
| Editor | 创建/编辑文档 | 普通用户 |
| Viewer | 只读 | 访客 |

---

## 9. 安全措施

### 9.1 传输安全

- 全站 HTTPS
- TLS 1.2+
- HSTS 启用

### 9.2 应用安全

- CSP 策略限制脚本来源
- CSRF Token 验证
- 输入验证和 SQL 注入防护
- Rate Limiting

### 9.3 密码安全

- 不存储密码（OAuth2 登录）
- API Key 加密存储（AES-256-GCM）

---

## 10. 审计与报告

### 10.1 季度安全审计

- 每季度进行一次安全审计
- 审计范围：代码、配置、日志
- 审计报告提交管理层

### 10.2 渗透测试

- 每半年进行一次渗透测试
- 使用第三方安全公司
- 发现问题后 72 小时内修复

### 10.3 Incident Response

1. 发现安全事件
2. 1 小时内评估影响范围
3. 24 小时内通知受影响用户
4. 72 小时内修复并报告

---

## 11. 责任人

| 职责 | 负责人 | 联系方式 |
|------|--------|----------|
| 合规政策 | 唐敏（法务顾问） | tangmin@nexora-tech.com |
| 技术实现 | 陈强（技术负责人） | chenqiang@nexora-tech.com |
| 安全审计 | 赵军（VP Engineering） | zhaojun@nexora-tech.com |
| 用户沟通 | 王琳（COO） | wanglin@nexora-tech.com |
`,
  },
];

/** 注入 sample 数据 */
export function injectSampleData(): void {
  const stats = getStats();
  if (stats.sourceCount > 0) {
    logger.info("[SampleData] 知识库已有数据，跳过 sample 注入");
    return;
  }

  logger.info("[SampleData] 注入项目周报 sample 数据...");

  for (const report of WEEKLY_REPORTS) {
    const sourceId = crypto.randomUUID();
    const contentHash = crypto.createHash("md5").update(report.content).digest("hex");

    // 切片
    const paragraphs = report.content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const chunks = paragraphs.map((content, idx) => ({
      id: crypto.randomUUID(),
      sourceId,
      content: content.trim(),
      chunkIndex: idx,
      tokenCount: content.length,
    }));

    addSource({
      id: sourceId,
      name: report.title,
      type: "demo",
      contentHash,
      chunkCount: chunks.length,
      status: "ready",
    });
    addChunks(chunks);
  }

  const newStats = getStats();
  logger.info(`[SampleData] 注入完成: ${newStats.sourceCount} sources, ${newStats.chunkCount} chunks`);
}
