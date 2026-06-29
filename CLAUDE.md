# CLAUDE.md — i-Write 开发指南


## 核心原则：两类 Key 严格隔离

1. **APP 用户 Key**：用户在 APP 设置页配置，存入 server keyStore
2. **开发者自动测试 Key**：只来自 `.env`，通过请求体字段传递给服务端
3. **绝对不能交叉/fallback/优先/混合使用**

---

## 核心原则：测试数据库严格隔离

1. **生产数据库**：`server/data/docstudio.db` 是用户数据，**绝对不能被任何自动测试写**，但可以读取
2. **隔离机制**：集成测试必须调用 `resetDbForTesting(":memory:")`；E2E 测试必须通过 `startIsolatedServer()` 启动隔离子进程
3. **AI 自测规则**：Claude 改完代码后验证修改时，**绝对不能**直接 `curl localhost:3000` 打用户正在运行的 dev server，必须走隔离测试路径

❌ **绝对禁止**：
- 任何测试直接写 `server/data/docstudio.db`，但可以读取
- 写新集成测试文件时忘记在 `beforeAll` 中调用 `resetDbForTesting()`
- 用 `curl localhost:3000` 对用户 dev server 做 ad-hoc 验证

✅ **正确做法**：
- E2E 验证：`npm run test:e2e`（自动启动隔离服务器）
- 集成测试：`npm run test:integration`（每个文件必须注入内存数据库）
- 临时验证：使用 `tests/e2e-shared/server-lifecycle.mjs` 的 `startIsolatedServer()`
- 用完立即清理：测试结束必须 kill 隔离 server 进程、删除临时目录

---

## 核心原则：工作目录外文件直接用 RunCommand 读取

`Read` 工具只能访问工作目录内的文件。对于工作目录外的文件（如 `~/Downloads/`、`/tmp/`、`~/.marscode/` 等），**禁止**先 `cp` 到工作目录再 `Read`。

❌ **绝对禁止**：
- `cp /outside/file ./project/` 然后 `Read ./project/xxx`（无意义的 IO，还留临时文件）

✅ **正确做法**：
- 直接用 `RunCommand` 读取：`cat "/outside/file"`、`head -N "/outside/file"`、`tail -N "/outside/file"`
- 读取后无需清理

---

## 核心原则：Client 只做 UI，Server 做业务逻辑（ADR-001）

**client 端只负责 UI 渲染和调用后端 API，绝对不能包含业务逻辑、数据存储、数据处理。**

❌ **绝对禁止**：
- 在 client 端直接操作 IndexedDB/localStorage 存取业务数据
- 在 client 端做数据过滤、排序、聚合等业务逻辑
- 在 client 端直接调用第三方 API（必须经过 server 代理）
- 在 client 端实现 RAG 检索、rerank、评分等逻辑
- 在 client 端解析 LLM 输出、提取结构化数据
- 在 client 端管理 API Key 或做 provider 连通性判断

✅ **正确做法**：
- client 通过 `fetch("/api/...")` 调用 server 端点，只负责展示返回结果
- 业务逻辑（LLM 调用、检索、rerank、评分、数据处理）全部在 `server/src/` 实现
- 数据存储（SQLite、文件）只在 server 端操作
- client 端唯一允许的本地状态：UI 状态（展开/折叠、选中项、loading 状态）
- 依赖方向：`shared ← client`、`shared ← server`、`client ↛ server`（仅通过 `/api/*` HTTP）


---

## .env 文件位置

项目根目录的 `.env` 文件包含所有 API key，**仅用于自动测试脚本**。

```env
# LLM Provider（用户在 APP 设置页自己配置，这里仅供测试）
GEMINI_KEY=your_gemini_key
MiMo_KEY=your_mimo_key
Openrouter_KEY=your_openrouter_key

# 知识库 Embedding
siliconflow_Key=your_siliconflow_key

# Microsoft Graph API（测试用，生产环境用户 OAuth 授权）
MS_CLIENT_ID=your_ms_client_id
MS_CLIENT_SECRET=your_ms_client_secret

# GitHub API（测试用）
GITHUB_TOKEN=your_github_token
```

---

## API Key 传递方式（自动测试）

**本节仅适用于自动测试脚本。** APP 生产环境的 key 由用户在设置页配置，存入 keyStore，APP 运行时从 keyStore 读取。

自动测试时，所有 API key 都通过**请求体**传递，不通过 header，不通过 keyStore：

| 用途 | 请求体字段 | 示例 |
|------|-----------|------|
| LLM API key | `apiKey` | `{ "apiKey": "sk-xxx" }` |
| Embedding API | `embedding.apiKey` | `{ "embedding": { "apiKey": "sk-xxx", "baseUrl": "...", "modelId": "..." } }` |
| Reranker API | `reranker.apiKey` | `{ "reranker": { "apiKey": "sk-xxx", "baseUrl": "...", "modelId": "..." } }` |
| MS Graph Token | `msAccessToken` | `{ "msAccessToken": "eyJxxx" }` |
| GitHub Token | `githubToken` | `{ "githubToken": "ghp_xxx" }` |

---

---

## 常见错误

❌ **错误做法**：尝试将 .env 中的 key 加载到 keyStore
✅ **正确做法**：测试脚本从 .env 读取 key，通过请求体字段传递给服务端

❌ **错误做法**：让 APP 读取 .env 中的 key
✅ **正确做法**：APP 只使用用户在设置页配置的 key

❌ **错误做法**：在 client 端实现 RAG 检索逻辑
✅ **正确做法**：RAG 检索全部在 server 端实现，client 只调用 API

❌ **错误做法**：在 client 端直接调用 Microsoft Graph API
✅ **正确做法**：client 获取 OAuth token 后传给 server，server 代理调用 Graph API

❌ **错误做法**：评估指标在前端计算
✅ **正确做法**：所有评估指标在 server 端计算，前端只展示结果

❌ **错误做法**：Fake 数据写死在代码里
✅ **正确做法**：示例数据通过 `fakeDataGenerator.ts` 生成，存入 SQLite

---

## 核心原则：LLM 模型自适应

**adapter 层必须消费 ModelCapabilities，自动适配不同 LLM 模型的参数差异。照搬 patentExaminator 方案。**

自适应维度：
1. **Temperature 范围钳制** — 查询模型声明的 range，将请求 temperature 钳制到合法区间；若模型不支持 temperature（如 DeepSeek 思考模式、Kimi K2.6），不发送该字段
2. **System Prompt 路由** — 根据 `systemPromptMode` 决定传递方式：`"message"`（默认）= 作为 messages 中的 system 角色；`"parameter"`（Gemini）= 作为 `systemInstruction` 参数
3. **Structured Output 门控** — 检查 `supportsStructuredOutput`，不支持时降级为 `json_object`
4. **Function Calling 门控** — 检查 `supportsFunctionCalling`，不支持时不发送 tools
5. **推理模型 maxTokens 乘数** — 推理模型自动 4x maxTokens
6. **Thinking Tokens 自动学习** — 从 API 响应中提取 `reasoning_tokens`，缓存到 L1 运行时缓存

能力查询路径：`getModelCapabilities(modelId)` → 精确匹配 → 最长前缀匹配 → 保守默认值

❌ **错误做法**：
- 硬编码 temperature=0.7，不查询模型能力
- 所有模型都用 messages 传递 system prompt
- 不检查能力就发送 response_format / tools

✅ **正确做法**：
- 每次 LLM 调用前查询 `getModelCapabilities()`
- 根据能力声明调整请求参数
- 运行时从响应中学习模型能力（如 thinking tokens）

---

## 核心原则：数据库审计日志

**所有数据库写操作（INSERT/UPDATE/DELETE）必须记录审计日志，照搬 patentExaminator 方案。**

审计日志记录在 `audit_log` 表中，包含：
- `timestamp` — 操作时间（本地时间）
- `table_name` — 操作的表名
- `operation` — INSERT | UPDATE | DELETE
- `record_id` — 操作的记录 ID
- `old_data` — 更新/删除前的数据（JSON）
- `new_data` — 插入/更新后的数据（JSON）
- `source` — 来源标记（模块名/路由名）

✅ **正确做法**：
```typescript
import { logAudit } from "./auditLog.js";

// 写操作前查询旧数据
const oldRow = db.prepare("SELECT * FROM table WHERE id = ?").get(id);

// 执行写操作
db.prepare("INSERT INTO table ...").run(...);

// 记录审计
logAudit({
  table: "table_name",
  operation: "INSERT",
  recordId: id,
  oldData: oldRow,        // UPDATE/DELETE 时提供
  newData: newData,       // INSERT/UPDATE 时提供
  source: "module_name",  // 来源标记
});
```

❌ **错误做法**：
- 写操作不记录审计日志
- 审计失败导致业务操作失败（审计异常必须吞掉，仅 warn 日志）

---

## 核心原则：所有时间使用本地时间

**所有用户和开发者可见的 datetime 都必须用本地时间，不能用 UTC。**

覆盖范围：
1. **Server 日志** — `logger.ts` 的 timestamp
2. **数据库字段** — SQLite 的 `datetime('now','localtime')`
3. **文件名中的时间戳**
4. **前端展示的所有时间** — session 创建时间、消息时间等
5. **导出文档中的时间** — 生成时间、导出时间

✅ **正确做法**：
- JS 端用 `localIso()` 或 `localShort()`（来自 `@i-write/shared`）
- SQLite 用 `datetime('now','localtime')`
- 展示用 `toLocaleString("zh-CN")`

❌ **错误做法**：
- `new Date().toISOString()` — 返回 UTC，禁止在用户可见场景使用
- `datetime('now')` — SQLite UTC，禁止使用

---

## 相关文档

- [docs/discuss.md](./docs/PRD.md) — 产品PRD
- [docs/mvp.md](./docs/design.md) — design doc