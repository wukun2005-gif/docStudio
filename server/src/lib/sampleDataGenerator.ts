/**
 * Sample 数据生成器 — 项目周报场景
 * Feature #1: 预置 Demo 知识库
 */
import crypto from "crypto";
import { addSource, addChunks, getStats } from "./knowledgeDb.js";
import { logger } from "./logger.js";

/** 项目周报 sample 数据 */
const WEEKLY_REPORTS = [
  {
    title: "AI 产品团队周报 - 2026-W24",
    content: `# AI 产品团队周报 - 2026年第24周

## 本周完成

### 模型优化
- 完成了 RAG pipeline 的 reranker 三级降级机制，远程 API 失败时自动切换到本地 Cross-Encoder
- 优化了 query expansion 的跨语言扩展，新增日语和韩语支持
- Groundedness check 准确率提升至 92%

### 产品功能
- Chat Box 交互界面完成初版设计，支持 Rich UI Elements
- 大纲编辑器实现拖拽调整功能
- 文档生成引擎支持 Word/PPT/Excel 三种格式

### 基础设施
- 迁移到新的 SQLite WAL 模式，写入性能提升 3x
- 完成 provider fallback 逻辑，429 自动切换下一个 provider
- 集成测试覆盖率提升至 85%

## 下周计划
- 启动 People Graph 功能开发
- 完成生成树可视化组件
- 开始离线评估体系搭建

## 风险与阻塞
- Embedding API 限流问题需与供应商沟通
- 前端打包体积偏大，需优化 tree-shaking`,
  },
  {
    title: "AI 产品团队周报 - 2026-W23",
    content: `# AI 产品团队周报 - 2026年第23周

## 本周完成

### 知识库
- 完成知识库 SQLite 存储层，支持 kb_sources / kb_chunks / kb_vectors
- 实现本地文件上传功能，支持 PDF/DOCX/TXT/HTML/Markdown
- 文本切片算法优化，段落感知 + 句子边界 + overlap

### RAG 引擎
- 实现 BM25 检索（MiniSearch + jieba-wasm 分词）
- 向量检索支持 cosine similarity + MMR 多样性排序
- RRF 融合公式调优，k=60 参数验证通过

### 评估体系
- Multi-Judge 评估框架搭建完成
- 实现 NDCG@K 和 Recall@K 指标
- Golden Set 生成器完成 matrix-driven 方案

## 下周计划
- 完成 reranker 三级降级
- 启动 groundedness check 开发
- Chat Box UI 设计评审

## 团队动态
- 新入职前端工程师 1 名，已完成 onboarding
- 与数据团队完成 RAG pipeline 技术对齐`,
  },
  {
    title: "产品规划文档 - Q3 2026",
    content: `# i-Write Q3 2026 产品规划

## 产品愿景
成为企业级可信文档生成平台，连接所有知识源，提供可追溯的文档生成服务。

## 核心目标
1. **知识连接**: 支持 10+ 知识源类型，包括本地文件、云文档、邮件、聊天记录
2. **可信生成**: 每段文字都有来源追溯，置信度评分 >= 0.8
3. **评估闭环**: 在线评估 + 离线评估 + 历史对比，持续优化生成质量

## 技术路线

### Phase 1: 基础设施 (6月)
- 项目骨架搭建
- Provider 系统
- DB Schema 设计

### Phase 2: 知识管理 (7月)
- 文件上传与解析
- People Graph
- Demo 知识库

### Phase 3: RAG 引擎 (7-8月)
- Query Expansion
- Hybrid Search
- Reranker
- Groundedness Check

### Phase 4: 文档生成 (8月)
- Word/PPT/Excel 生成
- 叙事引擎
- 生成树

### Phase 5: 评估体系 (9月)
- 在线评估
- 离线评估
- 历史对比

## 成功指标
- 文档生成时间 < 30s
- 用户满意度 >= 4.5/5
- 信任度评分 >= 0.85`,
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
