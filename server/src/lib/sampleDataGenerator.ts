/**
 * Sample 数据生成器 — 项目周报场景
 * Feature #1: 预置 Demo 知识库
 *
 * 人员与 People Graph 完全对齐：张明(CEO)、李华(CTO)、王芳(产品总监)、陈强(技术负责人)、赵丽(前端)、刘伟(后端)、孙娜(数据科学家)
 */
import crypto from "crypto";
import { addSource, addChunks, getStats } from "./knowledgeDb.js";
import { logger } from "./logger.js";

/** 项目周报 sample 数据 */
const WEEKLY_REPORTS = [
  {
    title: "i-Write 技术团队周报 - 2026-W24",
    content: `# i-Write 技术团队周报 - 2026年第24周

## 本周完成

### RAG 引擎（陈强负责）
- 陈强完成了 RAG pipeline 的 reranker 三级降级机制，远程 API 失败时自动切换到本地 Cross-Encoder
- 刘伟优化了向量检索的 cosine similarity 计算，性能提升 40%
- 孙娜完成了 Groundedness check 准确率评估，提升至 92%

### 产品功能（王芳主导需求）
- 王芳完成 Chat Box 交互界面 PRD 评审，支持 Rich UI Elements
- 赵丽实现了大纲编辑器拖拽调整功能
- 刘伟完成文档生成引擎 Word/PPT/Excel 三种格式支持

### 测试与质量（孙娜负责）
- 孙娜完成 E2E 测试覆盖率提升至 85%，发现 BUG-215 Token 刷新竞态问题
- 赵丽修复了 Safari 登录页布局问题（BUG-201）
- 刘伟修复了 Token 刷新竞态条件（BUG-215）

## 下周计划
- 陈强启动 People Graph 功能开发
- 赵丽完成生成树可视化组件
- 孙娜开始离线评估体系搭建
- 王芳组织支付系统设计评审

## 风险与阻塞
- Embedding API 限流问题需与供应商沟通（陈强跟进）
- 前端打包体积偏大，赵丽需优化 tree-shaking`,
  },
  {
    title: "i-Write 技术团队周报 - 2026-W23",
    content: `# i-Write 技术团队周报 - 2026年第23周

## 本周完成

### 知识库（陈强架构，刘伟实现）
- 刘伟完成知识库 SQLite 存储层，支持 kb_sources / kb_chunks / kb_vectors
- 陈强设计了文本切片算法，段落感知 + 句子边界 + overlap
- 赵丽实现了本地文件上传 UI，支持拖拽上传

### RAG 引擎（陈强主导）
- 陈强实现了 BM25 检索（MiniSearch + jieba-wasm 分词）
- 刘伟完成了向量检索的 cosine similarity + MMR 多样性排序
- RRF 融合公式调优，k=60 参数验证通过

### 评估体系
- 陈强搭建了 Multi-Judge 评估框架
- 孙娜实现了 NDCG@K 和 Recall@K 指标
- 王芳参与了 Golden Set 生成器的 matrix-driven 方案评审

## 下周计划
- 陈强完成 reranker 三级降级
- 刘伟启动 groundedness check 开发
- 赵丽完成 Chat Box UI 设计评审
- 孙娜编写集成测试用例

## 团队动态
- 新入职前端工程师 1 名，赵丽负责 onboarding
- 陈强与数据团队完成 RAG pipeline 技术对齐`,
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

### Phase 1: 基础设施 (6月) — 陈强负责架构
- 项目骨架搭建（陈强、刘伟）
- Provider 系统（陈强设计，刘伟实现）
- DB Schema 设计（陈强）

### Phase 2: 知识管理 (7月) — 陈强主导
- 文件上传与解析（赵丽前端，刘伟后端）
- People Graph（陈强设计，刘伟实现）
- Demo 知识库（王芳提供业务场景，陈强实现）

### Phase 3: RAG 引擎 (7-8月) — 陈强主导
- Query Expansion（陈强）
- Hybrid Search（陈强、刘伟）
- Reranker（陈强）
- Groundedness Check（刘伟）

### Phase 4: 文档生成 (8月) — 王芳定义需求
- Word/PPT/Excel 生成（刘伟）
- 叙事引擎（陈强）
- 生成树（赵丽）

### Phase 5: 评估体系 (9月) — 孙娜主导
- 在线评估（孙娜）
- 离线评估（孙娜、陈强）
- 历史对比（赵丽前端）

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
