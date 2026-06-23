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

## 相关文档

- [docs/discuss.md](./docs/PRD.md) — 产品PRD
- [docs/mvp.md](./docs/design.md) — design doc
