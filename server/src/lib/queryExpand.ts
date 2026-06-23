/**
 * 查询扩展模块 — 跨语言扩展 + 同义词扩展 + Multi-Query 改写
 * Feature #9: Query Expansion
 */

// ── 跨语言扩展 ───────────────────────────────────────────

const CROSS_LANG_MAP: Record<string, string[]> = {
  "项目": ["project"],
  "进展": ["progress", "update"],
  "周报": ["weekly report", "weekly update"],
  "计划": ["plan", "planning"],
  "目标": ["goal", "objective", "target"],
  "完成": ["complete", "finish", "done"],
  "问题": ["issue", "problem"],
  "风险": ["risk"],
  "团队": ["team"],
  "产品": ["product"],
  "技术": ["technology", "technical"],
  "设计": ["design"],
  "测试": ["test", "testing"],
  "发布": ["release", "launch"],
  "需求": ["requirement", "requirements"],
  "功能": ["feature", "functionality"],
  "性能": ["performance"],
  "优化": ["optimize", "optimization"],
  "架构": ["architecture"],
  "数据库": ["database", "DB"],
  "接口": ["API", "interface"],
  "文档": ["document", "documentation"],
};

/** 跨语言查询扩展 */
function expandCrossLanguage(query: string): string[] {
  const expanded: string[] = [query];
  for (const [zh, enList] of Object.entries(CROSS_LANG_MAP)) {
    if (query.includes(zh)) {
      expanded.push(...enList);
    }
  }
  return expanded;
}

// ── 同义词扩展 ───────────────────────────────────────────

const SYNONYMS: Record<string, string[]> = {
  "完成": ["达成", "实现", "搞定", "做完"],
  "进展": ["推进", "进度", "发展"],
  "问题": ["难点", "瓶颈", "困难", "障碍"],
  "计划": ["安排", "规划", "打算"],
  "优化": ["改进", "改善", "提升"],
  "测试": ["验证", "检验"],
  "发布": ["上线", "部署"],
  "需求": ["诉求", "需要"],
  "团队": ["小组", "部门"],
};

/** 同义词查询扩展 */
function expandSynonyms(query: string): string[] {
  const expanded: string[] = [query];
  for (const [term, syns] of Object.entries(SYNONYMS)) {
    if (query.includes(term)) {
      expanded.push(...syns);
    }
  }
  return expanded;
}

// ── Multi-Query 改写 ─────────────────────────────────────

/** 生成多个查询变体 */
export function generateQueryVariants(query: string): string[] {
  const variants: string[] = [query];

  // 1. 跨语言扩展
  const crossLang = expandCrossLanguage(query);
  variants.push(...crossLang.filter((q) => q !== query));

  // 2. 同义词扩展
  const synonyms = expandSynonyms(query);
  variants.push(...synonyms.filter((q) => q !== query));

  // 3. 简化版（去掉修饰词）
  const simplified = query
    .replace(/请|帮|我|一下|看看/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (simplified && simplified !== query) {
    variants.push(simplified);
  }

  // 4. 关键词提取版
  const keywords = query
    .split(/[，。、；\s]+/)
    .filter((w) => w.length >= 2)
    .join(" ");
  if (keywords && keywords !== query) {
    variants.push(keywords);
  }

  // 去重
  return [...new Set(variants)];
}

// ── 完整查询扩展流程 ─────────────────────────────────────

export interface ExpandedQuery {
  original: string;
  expanded: string[];
  combined: string; // 所有扩展合并为一个查询
}

/** 完整的查询扩展 */
export function expandQuery(query: string): ExpandedQuery {
  const variants = generateQueryVariants(query);
  const combined = variants.join(" ");

  return {
    original: query,
    expanded: variants,
    combined,
  };
}
