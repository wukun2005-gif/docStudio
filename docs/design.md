# i-Write, a Document Generation Studio — 技术设计文档

> 本文档面向 AI 开发工具，包含高层设计、详细架构、模块设计、开发计划。

---

## 1. 项目结构

```
docStudio/
├── server/                          # 后端
│   ├── src/
│   │   ├── index.ts                 # Express 入口
│   │   ├── lib/
│   │   │   ├── queryExpand.ts       # 查询扩展
│   │   │   ├── hybridSearch.ts      # 混合检索 (BM25 + 向量 + RRF)
│   │   │   ├── reranker.ts          # 重排序 (三级降级)
│   │   │   ├── groundednessCheck.ts # Groundedness 验证
│   │   │   ├── knowledgeDb.ts       # 知识库 SQLite
│   │   │   ├── docGenerator.ts      # 文档生成 (Word/PPT/Excel)
│   │   │   ├── narrativeEngine.ts   # 叙事引擎
│   │   │   ├── provenanceTree.ts    # 生成树
│   │   │   ├── chatRouter.ts        # Chat 智能判断
│   │   │   ├── evalMetrics.ts       # 评估指标
│   │   │   ├── evalRunner.ts        # 评估运行器
│   │   │   ├── multiJudge.ts        # Multi-Judge
│   │   │   ├── goldenSetGenerator.ts# Golden Set 生成
│   │   │   ├── sampleDataGenerator.ts # Sample 数据生成
│   │   │   ├── metricsCollector.ts  # Metrics 采集
│   │   │   ├── providers/           # LLM Provider
│   │   │   │   ├── registry.ts      # Provider 注册
│   │   │   │   └── openai.ts        # OpenAI-compatible
│   │   │   └── connectors/          # 知识源连接器
│   │   │       ├── msGraph.ts       # Microsoft Graph API
│   │   │       ├── github.ts        # GitHub API
│   │   │       ├── arxiv.ts         # arXiv API
│   │   │       └── localFiles.ts    # 本地文件上传
│   │   ├── routes/
│   │   │   ├── chat.ts              # Chat API
│   │   │   ├── knowledge.ts         # 知识库 API
│   │   │   ├── generation.ts        # 文档生成 API
│   │   │   ├── evaluation.ts        # 评估 API
│   │   │   ├── connectors.ts        # 连接器 API
│   │   │   └── settings.ts          # 设置 API
│   │   └── types/
│   │       └── index.ts
│   ├── data/                        # SQLite 数据文件
│   └── package.json
├── client/                          # 前端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatBox.tsx           # Chat Box 交互
│   │   │   ├── OutlineEditor.tsx     # 大纲编辑器
│   │   │   ├── DocumentViewer.tsx    # 文档查看器（含在线编辑）
│   │   │   ├── ProvenanceTree.tsx    # 生成树可视化
│   │   │   ├── TrustReport.tsx       # 信任度报告
│   │   │   ├── EvalDashboard.tsx     # 离线评估面板
│   │   │   ├── KnowledgePanel.tsx    # 知识源管理
│   │   │   ├── Settings.tsx          # 设置页
│   │   │   └── HistoryComparison.tsx # 历史对比
│   │   ├── store/
│   │   │   └── AppContext.tsx
│   │   └── types/
│   │       └── index.ts
│   └── package.json
├── shared/                          # 共享类型
│   ├── src/
│   │   └── types/
│   │       ├── knowledge.ts         # 知识库类型
│   │       ├── generation.ts        # 生成类型
│   │       ├── evaluation.ts        # 评估类型
│   │       └── metrics.ts           # 指标类型
│   └── package.json
├── office-addin/                    # Office Add-in
│   ├── manifest.xml
│   ├── src/
│   │   ├── taskpane/
│   │   │   ├── index.html
│   │   │   ├── main.tsx             # 侧边栏 React 入口
│   │   │   └── components/          # 复用 client 组件
│   │   └── commands/
│   │       └── commands.ts
│   └── assets/
├── samples/                         # Sample 数据
│   ├── documents/
│   ├── emails/
│   ├── presentations/
│   ├── spreadsheets/
│   └── chats/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── PRD.md
│   ├── design.md
│   └── discuss.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
└── .env
```

---

## 2. 高层架构

### 系统分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client Layer (React)                         │
│                                                                     │
│  ChatBox │ OutlineEditor │ DocumentViewer │ ProvenanceTree          │
│  TrustReport │ EvalDashboard │ KnowledgePanel │ Settings            │
│                                                                     │
│  职责: UI 渲染、用户交互、调用后端 API                                │
│  禁止: 业务逻辑、数据存储、直接调用第三方 API                         │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTP (fetch /api/*)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Server Layer (Express)                       │
│                                                                     │
│  ┌─── API Routes ───────────────────────────────────────────────┐  │
│  │  /api/chat/*        Chat 交互 + 叙事引擎                      │  │
│  │  /api/knowledge/*   知识库管理                                │  │
│  │  /api/generate/*    文档生成                                  │  │
│  │  /api/eval/*        评估平台                                  │  │
│  │  /api/connectors/*  知识源连接器                              │  │
│  │  /api/settings/*    配置管理                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─── Core Modules ─────────────────────────────────────────────┐  │
│  │  chatRouter       叙事引擎 (大纲生成 + 智能判断)               │  │
│  │  narrativeEngine  文档编排 (章节分配 + 风格)                   │  │
│  │  queryExpand      查询扩展                                    │  │
│  │  hybridSearch     混合检索 (BM25 + 向量 + RRF)                │  │
│  │  reranker         重排序 (三级降级)                            │  │
│  │  groundednessCheck 事实验证                                    │  │
│  │  docGenerator     Office 文档生成                              │  │
│  │  provenanceTree   生成树构建                                   │  │
│  │  evalMetrics      评估指标计算                                 │  │
│  │  multiJudge       Multi-Judge 评估                            │  │
│  │  goldenSetGenerator Golden Set 生成                           │  │
│  │  metricsCollector  指标采集                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─── Data Layer ───────────────────────────────────────────────┐  │
│  │  SQLite: knowledge.db (知识库) + eval.db (评估数据)           │  │
│  │  Tables: kb_sources, kb_chunks, kb_vectors, eval_runs, ...   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     External APIs (用户自选 Provider)                │
│                                                                     │
│  LLM API (OpenAI-compatible) │ Embedding API │ Reranker API        │
│  Microsoft Graph API │ GitHub API │ arXiv API                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据库设计

### SQLite 表结构

```sql
-- 知识库数据
CREATE TABLE kb_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'local_file' | 'onedrive' | 'github' | 'arxiv' | 'outlook' | 'teams'
  path TEXT,                    -- 文件路径或 URL
  content_hash TEXT,            -- 内容哈希（去重用）
  metadata JSON,                -- 来源元数据（作者、日期、repo 等）
  indexed_at DATETIME,
  status TEXT DEFAULT 'active'  -- 'active' | 'excluded' | 'error'
);

CREATE TABLE kb_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES kb_sources(id),
  content TEXT NOT NULL,
  chunk_index INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata JSON,                -- 标题、页码、段落号等
  embedding_model TEXT          -- 使用的 embedding model
);

CREATE TABLE kb_vectors (
  chunk_id TEXT PRIMARY KEY REFERENCES kb_chunks(id),
  vector BLOB                   -- Float32Array 序列化
);

-- 生成历史
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  outline JSON,                 -- 大纲结构
  result_content TEXT,          -- 生成的文档内容
  result_format TEXT,           -- 'docx' | 'pptx' | 'xlsx'
  provenance_tree JSON,         -- 生成树数据
  trust_scores JSON,            -- 信任度分数
  config JSON,                  -- 使用的 provider/model 配置
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 在线评估结果
CREATE TABLE trust_evaluations (
  id TEXT PRIMARY KEY,
  generation_id TEXT REFERENCES generation_runs(id),
  groundedness_score REAL,
  citation_accuracy REAL,
  source_coverage REAL,
  coherence_score REAL,
  completeness_score REAL,
  details JSON,                 -- 每个句子的验证结果
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Golden Set
CREATE TABLE golden_set (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  expected_answer TEXT,
  must_include_facts JSON,
  expected_source TEXT,         -- 'kb_only' | 'web_only' | 'cross_source' | 'conflict' | 'no_answer'
  category TEXT,                -- 'weekly_report' | 'research_report' | 'ppt_outline' | ...
  source_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 离线评估报告
CREATE TABLE eval_reports (
  id TEXT PRIMARY KEY,
  config JSON,                  -- 评估使用的配置
  golden_set_id TEXT,
  metrics JSON,                 -- 所有指标分数
  per_question_results JSON,    -- 每个问题的详细结果
  judge_config JSON,            -- judge 配置
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户配置
CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value JSON
);

-- People Graph（组织架构）
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  email TEXT,
  attributes JSON,                -- { relationships: [...], ... }
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime'))
);
```

**People Graph 数据模型**：
- 人员信息存储在 `people` 表
- 关系数据存储在 `attributes.relationships` JSON 字段中（非独立表）
- 导入 API 支持 `{ nodes, edges }` 格式，自动将 edges 转换为 relationships

---

## 4. API 设计

### Chat API

```
POST /api/chat
  Body: { message: string, context?: { conversationId } }
  Response: {
    type: 'outline' | 'question' | 'answer',
    content: string | Outline,
    conversationId: string
  }

POST /api/chat/regenerate-paragraph
  Body: {
    paragraphIndex: number,
    sourceIds: string[],      // 拖拽的新来源
    mode: 'copy' | 'cut',
    currentContent: string
  }
  Response: {
    newContent: string,
    updatedTrustScores: TrustScores
  }
```

### Knowledge API

```
GET  /api/knowledge/sources
  Response: Source[]

POST /api/knowledge/upload
  Body: FormData (files)
  Response: { uploaded: number, indexed: number }

POST /api/knowledge/connect/msgraph
  Body: { accessToken: string }
  Response: { connected: boolean, sourceCount: number }

POST /api/knowledge/connect/github
  Body: { accessToken: string, repos: string[] }
  Response: { connected: boolean, sourceCount: number }

POST /api/knowledge/connect/arxiv
  Body: { query: string, maxResults: number }
  Response: { papers: Paper[], imported: number }

PUT  /api/knowledge/sources/:id/exclude
  Body: { excluded: boolean }
  Response: { success: boolean }
```

### Generation API

```
POST /api/generate/outline
  Body: { query: string, template?: string }
  Response: { outline: Outline, conversationId: string }

POST /api/generate/confirm
  Body: { outline: Outline, format: 'docx' | 'pptx' | 'xlsx' }
  Response: {
    documentUrl: string,
    provenanceTree: ProvenanceTree,
    trustScores: TrustScores,
    generationId: string
  }

POST /api/generate/download
  Body: { generationId: string, format: 'docx' | 'pptx' | 'xlsx' }
  Response: Binary file
```

### Evaluation API

```
POST /api/eval/run
  Body: { config: LLMConfig }
  Response: { reportId: string, status: 'running' }

GET  /api/eval/reports
  Response: EvalReport[]

GET  /api/eval/reports/:id
  Response: EvalReport (含详细结果)

GET  /api/eval/reports/compare
  Query: { id1: string, id2: string }
  Response: { comparison: ComparisonResult }

POST /api/eval/golden-set/generate
  Body: { count: number, categories?: string[] }
  Response: { generated: number }

GET  /api/eval/golden-set
  Response: GoldenQuestion[]
```

### Settings API

```
GET  /api/settings
  Response: UserSettings

PUT  /api/settings/llm
  Body: { provider: string, model: string, apiKey: string, baseUrl: string }
  Response: { success: boolean, connected: boolean }

PUT  /api/settings/embedding
  Body: { provider: string, model: string, apiKey: string, baseUrl: string }
  Response: { success: boolean, connected: boolean }

PUT  /api/settings/reranker
  Body: { provider: string, model: string, apiKey: string, baseUrl: string }
  Response: { success: boolean, connected: boolean }
```

### People Graph API

```
GET  /api/people
  Response: { ok: true, people: Person[] }

GET  /api/people/org-tree
  Response: { ok: true, tree: Record<string, Person[]> }

GET  /api/people/export
  Response: { ok: true, people: Person[] }

POST /api/people/import
  Body: { people: [...] } | { nodes: [...], edges: [...] } | [...]
  Response: { ok: true, imported: number, relationships: number }

GET  /api/people/:id
  Response: { ok: true, person: Person }

GET  /api/people/:id/relationships
  Response: { ok: true, relationships: Array<{ person: Person, relationship: Relationship }> }

GET  /api/people/:id/context
  Response: { ok: true, context: string }

POST /api/people
  Body: { name, title?, department?, email?, attributes? }
  Response: { ok: true, id: string }

PUT  /api/people/:id
  Body: { name?, title?, department?, email? }
  Response: { ok: true }

DELETE /api/people/:id
  Response: { ok: true }
```

**路由顺序注意**：`/export` 和 `/import` 必须在 `/:id` 之前定义，否则会被 `/:id` 匹配。

---

## 5. 核心模块设计

### 5.1 Chat Router (chatRouter.ts)

职责：判断用户需求复杂度，决定直接生成还是多轮追问。

```typescript
interface ChatDecision {
  action: 'generate_outline' | 'ask_clarification';
  reason: string;
  questions?: string[];      // 需要追问的问题
}

async function routeChat(message: string, context: ChatContext): Promise<ChatDecision> {
  // 使用 LLM 判断需求是否明确
  // 明确 → generate_outline
  // 模糊 → ask_clarification + 具体问题
}
```

### 5.2 Narrative Engine (narrativeEngine.ts)

职责：生成大纲、管理章节结构、分配知识源。

```typescript
interface Outline {
  title: string;
  sections: Section[];
  style: 'academic' | 'business' | 'casual';
  template?: string;
}

interface Section {
  id: string;
  title: string;
  description: string;
  sourceTypes: string[];      // 指定知识源类型
  order: number;
}

async function generateOutline(query: string, context: ChatContext): Promise<Outline> {
  // 基于用户查询和知识库内容生成大纲
}

async function generateDocument(outline: Outline): Promise<GenerationResult> {
  // 按大纲每个章节执行 RAG + 生成
  // 构建生成树
  // 运行 Groundedness 验证
  // 导出为指定格式
}
```

### 5.3 RAG Pipeline

> **直接复用 patentExaminator 项目的实现**，包括核心算法和参数配置。

#### 参数默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| chunk_size | 512 | 文档分块大小（tokens） |
| chunk_overlap | 64 | 分块重叠大小 |
| embedding_model | 用户配置 | 默认使用 SiliconFlow/bge-m3 |
| embedding_dimension | 1024 | 向量维度 |
| bm25_k1 | 1.2 | BM25 参数 k1 |
| bm25_b | 0.75 | BM25 参数 b |
| rrf_k | 60 | RRF 融合参数 |
| mmr_lambda | 0.7 | MMR 多样性参数 |
| top_k | 10 | 检索返回数量 |
| reranker_top_k | 5 | 重排序后返回数量 |
| groundedness_threshold | 0.8 | Groundedness 通过阈值 |
| groundedness_fail_threshold | 0.5 | Groundedness 失败阈值（触发重生成） |

#### queryExpand.ts

```typescript
// 参考 patentExaminator: server/src/lib/queryExpand.ts
async function expandQuery(query: string): Promise<ExpandedQuery> {
  // 1. 跨语言扩展（中英文术语映射）
  // 2. 同义词扩展
  // 3. Multi-Query 改写
  return { original, expanded, variants: string[] };
}
```

#### hybridSearch.ts

```typescript
// 参考 patentExaminator: server/src/lib/hybridSearch.ts
async function hybridSearch(
  query: ExpandedQuery,
  knowledgeDb: KnowledgeDb,
  embeddingProvider: EmbeddingProvider
): Promise<SearchResult[]> {
  // 1. BM25 关键词搜索 (MiniSearch + jieba-wasm)
  // 2. 向量语义搜索 (embedding API + cosine similarity)
  // 3. RRF 融合 (k=60)
  // 4. MMR 多样性排序 (lambda=0.7)
  return rankedResults;
}
```

#### reranker.ts

```typescript
// 参考 patentExaminator: server/src/lib/reranker.ts
async function rerank(
  query: string,
  results: SearchResult[],
  config: RerankerConfig
): Promise<SearchResult[]> {
  // Level 1: 远程 Reranker API
  // Level 2: 本地 Cross-Encoder (bge-reranker-base)
  // Level 3: 启发式加权打分
  return rerankedResults;
}
```

#### groundednessCheck.ts

```typescript
// 参考 patentExaminator: server/src/lib/groundednessCheck.ts
async function checkGroundedness(
  generatedText: string,
  sources: Source[]
): Promise<GroundednessResult> {
  // 1. 句子分割
  // 2. LLM-as-Judge 验证每个句子
  // 3. 计算 groundedRatio
  // 4. 判定 pass / partial / fail
  return { verdict, groundedRatio, sentenceResults };
}
```

#### 统一入库 Pipeline 原则

**所有知识源入库渠道必须走同一个预处理+分块+去噪+向量化 pipeline。**

无论数据来自文件上传、GitHub、MS Graph、arXiv 还是其他 connector，入库前必须经过以下完整步骤：

1. **去重检查** — `computeTextHash` + `findDuplicateByHash`，重复数据直接跳过
2. **文本预处理** — `preprocessText`（清理页眉页脚、全角半角、日期标准化）
3. **智能分块** — `chunkText`（smartChunk），按语义边界分块
4. **去噪过滤** — `isNoise` / `isGarbled`，过滤噪声和乱码
5. **入库** — `addSource` + `addChunks`，写入 `kb_sources` + `kb_chunks`
6. **向量化** — `embedChunks`（如有 embedding 配置），写入 `kb_vectors`

```
文件上传 ─┐
GitHub ───┤                ┌─ computeTextHash (去重)
MS Graph ─┼─ extractText ──┤─ preprocessText (预处理)
arXiv ────┤                ├─ chunkText (分块)
其他 ─────┘                ├─ isNoise/isGarbled (去噪)
                           ├─ addSource + addChunks (入库)
                           └─ embedChunks (向量化)
```

❌ **禁止**：connector 直接调用 `addSource`/`addChunks` 绕过预处理 pipeline
❌ **禁止**：不同渠道使用不同的分块/去重/向量化策略
✅ **正确做法**：所有渠道的文本提取后，调用统一的 `ingestText()` 函数完成入库

> **注意**：connector 的职责是**数据拉取和格式转换**（将外部数据转为纯文本），不负责入库逻辑。入库由统一 pipeline 处理。

### 5.4 Document Generator (docGenerator.ts)

职责：生成 Word / PowerPoint / Excel 文件。

```typescript
async function generateWord(content: DocumentContent): Promise<Buffer> {
  // 使用 docx 库生成 .docx
  // 含标题、段落、引用、样式
}

async function generatePowerPoint(content: DocumentContent): Promise<Buffer> {
  // 使用 pptxgenjs 生成 .pptx
  // 含标题页、内容页、图表
}

async function generateExcel(data: TableData[]): Promise<Buffer> {
  // 使用 xlsx 库生成 .xlsx
  // 含数据表格、图表
}
```

### 5.5 Provenance Tree (provenanceTree.ts)

职责：构建生成树数据结构，支持拖拽重生成。

```typescript
interface ProvenanceNode {
  paragraphIndex: number;
  paragraphText: string;
  sources: SourceCitation[];
  groundednessScore: number;
}

interface SourceCitation {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  excerpt: string;
  confidence: number;
  offset: { start: number; end: number };
}

async function buildTree(
  generatedContent: string,
  searchResults: SearchResult[]
): Promise<ProvenanceTree> {
  // 每段话关联来源
  // 计算置信度
}

async function regenerateParagraph(
  paragraphIndex: number,
  newSources: SourceCitation[],
  mode: 'copy' | 'cut'
): Promise<{ newContent: string; updatedScores: TrustScores }> {
  // 精确重生成指定段落
  // 只修改目标段落，其他不变
  // 重新运行 Groundedness 验证
}
```

### 5.6 Evaluation System

#### 5.6.1 Metrics 体系设计原则

**用户可见指标（P0）**：只展示 3 个核心指标，回答用户 3 个核心问题：

| 用户问题 | 指标 | 英文名 | 衡量什么 |
|----------|------|--------|----------|
| "我能信任这个文档吗？" | **有据可查度** | Groundedness | 内容是否有来源支撑，是否有幻觉 |
| "这回答了我的需求吗？" | **内容相关度** | Relevance | 内容是否与用户需求相关 |
| "有遗漏重要信息吗？" | **内容完整度** | Completeness | 是否覆盖了用户需求的所有要点 |

**开发者调试指标（P1）**：用于离线评估和质量优化，不展示给用户：

| 指标 | 用途 |
|------|------|
| Context Precision | 检索质量调试 |
| Citation Precision | 引用准确性调试 |
| Hallucination Rate | 幻觉率监控 |

#### 5.6.2 用户可见指标实现

```typescript
// ===== 用户可见指标（4 个核心） =====

/**
 * 有据可查度 (Groundedness)
 * 公式：(有来源支撑的声明数 + 常识声明数) / 总声明数
 * 实现：逐句 LLM 验证，参照 RAGAS Faithfulness + FActScore
 */
async function computeGroundedness(
  sections: DocumentSection[],
  knowledgeChunks: Chunk[]
): Promise<{
  overall: number;           // 0-1
  sectionScores: number[];   // 每章节分数
  claimVerdicts: ClaimVerdict[];  // 每条声明的判定
}>;

/**
 * 内容相关度 (Relevance)
 * 公式：与用户需求相关的声明数 / 总声明数
 * 实现：逐句验证是否与用户原始需求相关
 */
async function computeRelevance(
  sections: DocumentSection[],
  userRequirement: string
): Promise<{
  overall: number;
  sectionScores: number[];
  irrelevantClaims: string[];  // 不相关的声明列表
}>;

/**
 * 内容完整度 (Completeness)
 * 公式：覆盖的需求要点数 / 需求的总要点数
 * 实现：从用户需求中提取要点，逐一检查是否覆盖
 */
async function computeCompleteness(
  sections: DocumentSection[],
  userRequirement: string
): Promise<{
  overall: number;
  coveredPoints: string[];     // 已覆盖的要点
  missingPoints: string[];     // 遗漏的要点
}>;

/**
 * 内容冲突检测 (Conflict Detection)
 * 公式：有冲突的声明数 / 总声明数
 * 实现：LLM-as-Judge 对比跨源声明，识别矛盾
 * 冲突类型：时间冲突、来源权威冲突、视角冲突、数据冲突
 */
async function detectConflicts(
  sections: Array<{
    title: string;
    content: string;
    sources: Array<{ name: string; content: string; authority?: number; timestamp?: string }>
  }>
): Promise<{
  hasConflicts: boolean;
  conflictRate: number;        // 0-1
  conflicts: ConflictItem[];   // 冲突详情
}>;
```

#### 5.6.3 开发者调试指标实现

```typescript
// ===== 开发者调试指标（不展示给用户） =====

// 检索质量
async function computeContextPrecision(query: string, results: SearchResult[]): Promise<number>;
async function computeContextRecall(query: string, results: SearchResult[]): Promise<number>;

// 引用质量
async function computeCitationPrecision(answer: string, sources: Source[]): Promise<number>;
async function computeCitationRecall(answer: string, sources: Source[]): Promise<number>;

// 幻觉监控
async function computeHallucinationRate(claimVerdicts: ClaimVerdict[]): Promise<number>;
```

#### multiJudge.ts

```typescript
async function multiJudge(
  task: string,
  content: string,
  judgeConfigs: JudgeConfig[]
): Promise<JudgeResult> {
  // 并行运行多个 judge
  // Promise.allSettled: 一个失败不影响另一个
  // 聚合: 连续值取平均，离散值取四舍五入平均
}
```

#### goldenSetGenerator.ts

```typescript
async function generateGoldenSet(
  count: number,
  knowledgeDb: KnowledgeDb
): Promise<GoldenQuestion[]> {
  // sourceType × category 矩阵分配
  // 每个 cell 批量生成问题
  // 约束修复: 答案 200-500 字, 3-8 个事实点
}
```

### 5.7 Connectors

#### msGraph.ts

```typescript
async function connectMsGraph(accessToken: string): Promise<ConnectionResult> {
  // 调用 Microsoft Graph API
  // 拉取 OneDrive / SharePoint / Teams / Outlook 内容
  // 返回文件列表供用户排除
}

async function fetchDocuments(accessToken: string, excludePaths: string[]): Promise<Document[]> {
  // 拉取文档内容（排除用户指定的）
}
```

#### github.ts

```typescript
async function connectGitHub(accessToken: string, repos: string[]): Promise<ConnectionResult> {
  // GitHub API 读取 repo
  // 索引代码、Issues、PR
}
```

#### arxiv.ts

```typescript
async function searchArxiv(query: string, maxResults: number): Promise<Paper[]> {
  // arXiv API 搜索论文
}

async function importPaper(paperId: string): Promise<Document> {
  // 下载论文 PDF 并解析
}
```

---

## 6. Office Add-in 设计

### manifest.xml 结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xsi:type="TaskPaneApp">
  <Id>docstudio-addin-id</Id>
  <Version>1.0.0</Version>
  <ProviderName>i-Write</ProviderName>
  <DefaultLocale>zh-CN</DefaultLocale>
  <DisplayName DefaultValue="i-Write"/>
  <Description DefaultValue="可信文档生成工作台"/>
  <Hosts>
    <Host Name="Workbook"/>   <!-- Excel -->
    <Host Name="Document"/>   <!-- Word -->
    <Host Name="Presentation"/> <!-- PowerPoint -->
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://localhost:3000/office-addin/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
```

### 侧边栏共享组件

Office Add-in 的侧边栏 React 应用复用 client 的核心组件：
- ChatBox
- OutlineEditor
- ProvenanceTree (简化版)
- TrustReport

通过 Office.js API 读取当前文档内容作为上下文。

---

## 7. 复用 patentExaminator 的模块

| 模块 | 来源 | 复用方式 |
|------|------|---------|
| queryExpand.ts | server/src/lib/queryExpand.ts | 泛化（去除专利硬编码） |
| hybridSearch.ts | server/src/lib/hybridSearch.ts | 直接复用 |
| reranker.ts | server/src/lib/reranker.ts | 直接复用 |
| groundednessCheck.ts | server/src/lib/groundednessCheck.ts | 直接复用 |
| multiJudge.ts | server/src/lib/multiJudge.ts | 直接复用 |
| evalMetrics.ts | server/src/lib/evalMetrics.ts | 泛化（增加文档质量指标） |
| evalRunner.ts | server/src/lib/evalRunner.ts | 泛化 |
| goldenSetGenerator.ts | server/src/lib/goldenSetGenerator.ts | 泛化 |
| metricsCollector.ts | server/src/lib/metricsCollector.ts | 直接复用 |
| provider registry | server/src/providers/registry.ts | 直接复用 |
| knowledgeDb.ts | server/src/lib/knowledgeDb.ts | 直接复用 |

---

## 8. 开发计划

> 每个 Phase 对应 PRD 中的功能模块，按依赖顺序执行。

### Phase 1: 项目脚手架 + 基础设施

**对应 PRD**: 8.1 知识源管理（#1-4）

```
1. 初始化 monorepo（shared/server/client）
2. 配置 TypeScript、Vite、Express、SQLite
3. 实现 knowledgeDb.ts（SQLite 表创建 + CRUD）
4. 实现 localFiles 连接器（文件上传 + 解析 + 分块）
5. 实现 sampleDataGenerator.ts（生成项目周报场景 sample 数据）
6. 实现 People Graph（组织架构 + 人际关系图谱）
7. 前端: KnowledgePanel（知识源列表 + 上传 + People Graph 可视化）
```

### Phase 2: RAG 引擎

**对应 PRD**: 8.3 RAG 引擎（#8-11）

```
1. 实现 queryExpand.ts（跨语言 + 同义词 + Multi-Query）
2. 实现 hybridSearch.ts（BM25 + 向量 + RRF + MMR）
3. 实现 reranker.ts（三级降级：远程 API → 本地 → 启发式）
4. 实现 groundednessCheck.ts（句子级验证 + groundedRatio）
```

### Phase 3: 叙事引擎 + 文档生成

**对应 PRD**: 8.2 叙事引擎（#4-7）+ 8.4 文档生成（#12-15）

```
1. 实现 chatRouter.ts（智能判断：直接生成 vs 多轮追问）
2. 实现 narrativeEngine.ts（大纲生成 + 模板 + 用户调整 + People Graph 集成）
3. 实现 docGenerator.ts（Word/PPT/Excel 导出，根据受众调整风格）
4. 前端: ChatBox（含 Rich UI Elements + 受众选择）+ OutlineEditor + DocumentViewer
```

### Phase 4: 生成树 + 拖拽重生成

**对应 PRD**: 8.5 生成树（#16-18）

```
1. 实现 provenanceTree.ts（构建 + 查询 + CRUD）
2. 实现拖拽重生成逻辑（copy/cut 模式）
3. 前端: ProvenanceTree 可视化（D3.js 树图）
4. 前端: 拖拽交互 + 实时更新
```

### Phase 5: 评估体系

**对应 PRD**: 8.6 评估体系（#19-22）

```
1. 实现 trust_evaluation 表 + API
2. 实现用户可见指标（4 个核心）：
   - 有据可查度 (Groundedness) — 逐句验证，含常识门控
   - 内容相关度 (Relevance) — 逐句验证是否与需求相关
   - 内容完整度 (Completeness) — 逐要点验证覆盖情况
   - 内容冲突检测 (Conflict Detection) — 跨源矛盾识别
3. 实现开发者调试指标（离线评估用）：
   - Context Precision / Recall — 检索质量
   - Citation Precision / Recall — 引用质量
   - Hallucination Rate — 幻觉率
4. 实现评估报告引导优化（低分段落识别）
5. 实现历史对比（时间趋势 + 版本对比）
6. 实现评估数据洞察（按文档类型分析质量）
7. 前端: TrustReport + HistoryComparison
```

### Phase 6: 配置与历史

**对应 PRD**: 8.7 配置与历史（#23-26）

```
1. 实现 Provider 配置页（LLM / embedding / reranker）
2. 实现迭代生成（基于历史记录复用配置）
3. 实现模板保存与调用
4. 实现演示模式（预置示例数据，不消耗 Token）
5. 实现历史文档自动入知识库
```

### Phase 7: 知识源连接器

**对应 PRD**: 8.8 知识源连接器（#27-32）

```
1. 实现 MS OAuth 登录流程
2. 实现 msGraph.ts（OneDrive/SharePoint/Outlook/Teams）
3. 实现 github.ts（OAuth + 代码/Issues/PR）
4. 实现 arxiv.ts（公开 API 搜索和导入）
5. 前端: 连接器 UI + OAuth 流程 + 排除功能
```

### Phase 8: 离线评估平台

**对应 PRD**: 8.10 离线评估平台（#36-39）

```
1. 实现 goldenSetGenerator.ts（自动生成 Golden Set）
2. 实现 evalMetrics.ts（开发者调试指标）：
   - Context Precision / Recall — 检索质量
   - Citation Precision / Recall — 引用质量
   - Hallucination Rate — 幻觉率
   - NDCG / Recall@K — 检索排序质量
3. 实现 multiJudge.ts（2 个 LLM judge 独立评分）
4. 实现 evalRunner.ts（4 阶段评估流程）
5. 前端: EvalDashboard（指标展示 + 报告对比）
```

### Phase 9: Office Add-in

**对应 PRD**: 8.9 Office Add-in（#33-35）

```
1. 创建 manifest.xml（支持 Word/Excel/PPT）
2. 实现 taskpane React 应用（复用 client 组件）
3. 实现 Office.js API 集成（读取当前文档内容）
4. 实现跨应用生成（在 Excel 中根据其他知识源生成 PPT）
5. 实现生成物保存（优先保存到 OneDrive）
6. Sideload 测试 + 调试
```

### Phase 10: Proactive Generation

**对应 PRD**: 8.11 Proactive Generation（#40-42）

```
1. 实现 Action Item 解析（从会议纪要提取任务）
2. 实现智能知识源发现（根据关键词搜索相关知识）
3. 实现质量门控（Groundedness Check 达标才建议）
4. 实现主动建议 UI（查看/编辑/忽略）
5. 实现与 Teams 集成（Graph API 订阅 / Bot）
```

### Phase 11: Workflow

**对应 PRD**: 8.12 Workflow（#43-45）

```
1. 实现 Workflow 数据结构（步骤定义 + 依赖关系）
2. 实现可视化 Workflow 编辑器（拖拽节点 + 连线）
3. 实现 Chat Box Workflow 描述解析
4. 实现 Workflow 执行引擎（按步骤执行 + 数据传递）
5. 实现 Workflow 触发（手动 + 自动检测数据更新）
```

### Phase 12: Sample Data 准备

**对应 PRD**: 7. Demo 场景设计

#### 实现方案

```
samples/                          # 样本文件目录
├── meetings/                     # 8 篇会议纪要 (.docx)
├── tech-docs/                    # 10 篇技术文档 (.docx)
├── emails/                       # 15 封邮件 (.eml)
├── chat/                         # Teams 聊天记录 (.json)
├── data/                         # 4 份 Excel 数据 (.xlsx)
├── presentations/                # 3 份 PPT 演示 (.pptx)
└── charts/
    └── people-graph.json         # 18 人组织架构
```

#### 生成脚本

| 脚本 | 用途 |
|------|------|
| `server/src/scripts/generateSamples.ts` | 生成 Word、邮件、Teams、Excel 文件 |
| `server/src/scripts/generatePpt.py` | 生成 PPT 文件（含图表） |

#### 关键设计决策

1. **文件生成 vs 数据库注入**：样本数据生成为物理文件，通过标准上传流程导入知识库，不绕过 embedding/chunking 管道
2. **People Graph 导入**：通过 `POST /api/people/import` API 导入，支持 `{ nodes, edges }` 格式
3. **内容长度**：长文档 3000-5000 字符，确保 chunker 产出多个 chunk
4. **图文比例**：Word 文档含表格，PPT 含图表（柱状图、饼图）

#### E2E 测试

```bash
# 全链路测试（27 个用例）
node tests/e2e-sample-data.mjs

# 数据质量指标计算
node tests/data-quality-metrics.mjs
```

测试覆盖：知识库上传、搜索召回、People Graph CRUD、文档生成 Citation 链路、数据质量 Metrics 报告。

#### 数据质量指标实现

**Self-BLEU（文档间相似度）**：
- 算法：计算文档间 BLEU 分数平均值
- 实现：对 .eml 和 .json 文件提取文本，采样计算 1-4 gram 精确度
- 阈值：< 0.50

**Uniqueness（非近重复文档比例）**：
- 算法：Jaccard 相似度，> 0.85 视为近重复
- 实现：对采样文档计算 token 集合相似度
- 阈值：>= 0.90

**Type Coverage（类型覆盖度）**：
- 算法：实际类型 / 目标类型
- 目标类型：docx, email, json, excel, ppt
- 阈值：100%

**Structural Conformance（结构符合度）**：
- 算法：检查文档结构要素（如 email 必含 subject/from/to）
- 实现：正则匹配 + 模板检查
- 阈值：>= 80%

**Fluency（流畅度）**：
- 算法：LLM-as-judge 评分 1-5 分
- 实现：调用 MiMo API，采样 5 个文件评分
- 阈值：>= 3.5/5

### Phase 13: 打磨 + 演示

**对应 PRD**: P2 Backlog 部分（#46）

```
1. 优化 Chat Box 交互体验
2. 优化生成树可视化
3. 优化信任度报告展示
4. 确保完整 Demo 流程顺畅（5 幕 × 30 秒）
5. 实现一键 Demo（参考 GraphMe 项目的 FakeCursor 功能）
6. 测试跨应用生成（在 Excel 中生成 PPT）
```

#### 一键 Demo 实现（参考 GraphMe）

**参考项目**: GraphMe（/Users/wukun/Documents/tmp/GraphMe）

**GraphMe 的 FakeCursor 功能**:
- 右上角 ▶ 按钮触发自动演示
- 首次访问自动进入 4 步引导流程
- 模拟用户操作，自动执行完整演示
- 用户可随时中断

**i-Write 实现要求**:

| 功能 | 说明 | 参考 GraphMe |
|------|------|--------------|
| ▶ 按钮 | 右上角固定位置，点击触发演示 | GraphMe 右上角 ▶ 按钮 |
| 首次引导 | 新用户自动进入 4 步引导 | GraphMe 首次访问引导 |
| FakeCursor | 模拟鼠标/键盘操作 | GraphMe FakeCursor |
| 进度条 | 显示当前幕数/总幕数 | GraphMe 进度指示 |
| 可中断 | 点击任意位置中断 | GraphMe 中断机制 |

**Demo 流程自动化**:
```
1. 自动输入: "生成一份产品介绍 PPT"
2. 自动点击: 发送按钮
3. 自动等待: 生成完成
4. 自动点击: 打开生成的 PPT
5. 自动展示: 生成树溯源
6. 重复 2-5 幕
```

**技术实现**:
- 使用 `requestAnimationFrame` 驱动动画
- 使用 CSS `pointer-events: none` 防止用户干扰
- 使用 `setTimeout` 控制节奏
- 支持 `Escape` 键中断

---

## 9. 环境配置

### .env 文件

```env
# LLM Provider（测试用，生产环境用户在 APP 配置）
GEMINI_KEY=
MiMo_KEY=
Openrouter_KEY=

# Embedding/Reranker
siliconflow_Key=

# Microsoft Graph（测试用）
MS_CLIENT_ID=
MS_CLIENT_SECRET=

# MSA 测试账号（用于自动测试和演示）
MSA_ACCOUNT=
MSA_PASSWORD=

# GitHub（测试用）
GITHUB_TOKEN=
```

# GitHub（测试用）
GITHUB_TOKEN=
```

### 常用命令

```bash
npm run dev              # 启动开发（前端 + 后端）
npm run build            # 构建
npm test                 # 单元测试
npm run test:integration # 集成测试
npm run test:e2e         # E2E 测试
npm run typecheck        # 类型检查
npm run lint             # ESLint
npm run verify           # 完整验证
npm run samples          # 生成 sample 数据
npm run eval:run         # 运行离线评估
npm run eval:report      # 查看评估报告
```

---

## Change Log

| 日期 | 简述 | 影响范围 | 关联 commit |
|------|------|---------|-------------|
| 2026-07-04 | nf3: AI 文档自审 / 压力测试 — 风险雷达图（SVG）+ 5 个问题卡片（严重程度/类别/建议）+ 一键修正按钮 + DemoOverlay 集成 | DocumentAudit.tsx, DocPreview.tsx, DemoOverlay.tsx | — |
| 2026-07-04 | nf2: 置信度热力图 — 文档段落左边缘着色（绿多源/黄单源/红AI推断）+ 浮动图例 + DemoOverlay 集成 | DocPreview.tsx, DemoOverlay.tsx | — |
| 2026-07-04 | nf1: 一键 Demo — DemoProvider（实现 ProviderAdapter）+ FakeCursor（参考 GraphMe 模式）+ 90s 自动演示脚本 | demo.ts, DemoOverlay.tsx, App.tsx, registry.ts | — |
| 2026-06-28 | Bug3: 修复生成阶段 SSE spinner 刷新问题 + 新增评估阶段 SSE 流式端点 | DocPreview.tsx, GenerationPage.tsx, generation.ts | — |
| 2026-06-28 | Bug2: extractDocumentMetadata 人名提取改为 LLM NER（合并到标题生成）+ regex 回退改进 | docGenerator.ts | — |
