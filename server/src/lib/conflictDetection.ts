/**
 * 内容冲突检测 (Conflict Detection)
 *
 * 检测知识库中不同来源之间的矛盾信息。
 *
 * 冲突类型：
 * 1. 时间冲突：不同时间点的信息矛盾（如"1周后发布" vs "1个月后上线"）
 * 2. 来源权威冲突：不同权威度的来源矛盾（如实习生 vs VP）
 * 3. 视角冲突：不同立场的观点矛盾（如销售乐观 vs 研发保守）
 * 4. 数据冲突：不同数据源的数值矛盾（如报表A说100万 vs 报表B说90万）
 *
 * 处理策略：
 * - 检测：LLM-as-Judge 对比跨源声明，识别矛盾
 * - 度量：冲突率 = 有冲突的声明数 / 总声明数
 * - 展示：在文档中标注冲突，列出各来源说法，让用户决定
 */

import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens, estimateTokens } from "./llmUtils.js";

// ============ Types ============

export interface ConflictItem {
  topic: string;                    // 冲突主题
  conflictType: "temporal" | "authority" | "perspective" | "data" | "other";
  claims: Array<{
    text: string;                   // 声明内容
    source: string;                 // 来源名称
    sourceAuthority?: number;       // 来源权威度 (0-1)
    timestamp?: string;             // 信息时间戳
  }>;
  severity: "high" | "medium" | "low";  // 冲突严重程度
  recommendation?: string;          // 处理建议
}

export interface ConflictDetectionResult {
  conflicts: ConflictItem[];
  conflictRate: number;             // 冲突率 (0-1)
  hasConflicts: boolean;
}

// ============ LLM Judge ============

const CONFLICT_DETECTOR_SYSTEM = `You are a conflict detection expert for knowledge-grounded document generation.

Your task: Analyze claims from different knowledge sources and identify contradictions or conflicts.

CONFLICT TYPES:
- temporal: Information from different time periods that contradict (e.g., "launch in 1 week" vs "launch in 1 month")
- authority: Information from sources with different authority levels that contradict (e.g., intern vs VP)
- perspective: Different viewpoints or interpretations that contradict (e.g., sales optimistic vs engineering conservative)
- data: Numerical or factual data that contradicts (e.g., "100万 revenue" vs "90万 revenue")
- other: Any other type of contradiction

SEVERITY LEVELS:
- high: Critical business decision affected, must resolve before using document
- medium: Important information discrepancy, should address in document
- low: Minor difference or nuance, can note but not critical

OUTPUT FORMAT (strict JSON):
{
  "conflicts": [
    {
      "topic": "产品发布时间",
      "conflict_type": "temporal",
      "claims": [
        {"text": "销售部说1周后发布产品", "source": "销售部周报", "source_authority": 0.6, "timestamp": "2024-01-15"},
        {"text": "研发说要1个月后才能上线产品", "source": "研发部会议纪要", "source_authority": 0.8, "timestamp": "2024-01-20"}
      ],
      "severity": "high",
      "recommendation": "建议以研发部说法为准，因为技术实现时间更可靠"
    }
  ],
  "conflict_rate": 0.15,
  "has_conflicts": true
}`;

const CONFLICT_DETECTOR_USER = `## 知识来源内容

{{SOURCES}}

请分析这些知识来源中的声明，找出所有矛盾或冲突的地方。

输出 JSON：
{
  "conflicts": [
    {
      "topic": "冲突主题",
      "conflict_type": "temporal/authority/perspective/data/other",
      "claims": [
        {"text": "声明内容", "source": "来源名称", "source_authority": 0.8, "timestamp": "2024-01-15"}
      ],
      "severity": "high/medium/low",
      "recommendation": "处理建议"
    }
  ],
  "conflict_rate": 0.15,
  "has_conflicts": true
}`;

// ============ Core Logic ============

/**
 * 解析 JSON 响应
 */
function parseJsonResponse<T>(content: string): T | null {
  try {
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 调用 LLM 进行冲突检测（参考 patentExaminator）
 */
async function callConflictDetector(
  sources: Array<{ name: string; content: string; authority?: number; timestamp?: string }>,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<ConflictDetectionResult> {
  // 格式化来源内容
  const formatSource = (s: { name: string; content: string; authority?: number; timestamp?: string }, i: number): string => {
    let header = `### 来源 ${i + 1}: ${s.name}`;
    if (s.authority !== undefined) header += ` (权威度: ${s.authority})`;
    if (s.timestamp) header += ` (时间: ${s.timestamp})`;
    return `${header}\n\n${s.content}`;
  };

  // ── 分批策略：按章节分组，同一章节的来源尽量放在一批 ──
  // 单批上限 40K tokens，超出则按章节边界拆分；保留全部来源不截断
  const MAX_BATCH_TOKENS = 40_000;

  // 按章节分组（sectionKey = 章节标题前缀）
  const sectionGroups = new Map<string, Array<{ name: string; content: string; authority?: number; timestamp?: string }>>();
  for (const source of sources) {
    const sectionKey = source.name.split(" - ")[0] ?? "其他";
    if (!sectionGroups.has(sectionKey)) sectionGroups.set(sectionKey, []);
    sectionGroups.get(sectionKey)!.push(source);
  }

  const batches: Array<Array<{ name: string; content: string; authority?: number; timestamp?: string }>> = [];
  let currentBatch: Array<{ name: string; content: string; authority?: number; timestamp?: string }> = [];
  let currentTokens = 0;

  for (const [, group] of sectionGroups) {
    const groupTokens = group.reduce((sum, s) => sum + estimateTokens(s.content), 0);
    // 整组能放下就放一起；放不下就单独成批（不再拆分单章节）
    if (currentTokens + groupTokens > MAX_BATCH_TOKENS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }
    currentBatch.push(...group);
    currentTokens += groupTokens;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  logger.info(`[ConflictDetection] 来源总数: ${sources.length}, 章节组: ${sectionGroups.size}, 分批数: ${batches.length}`);

  // 构建跨批摘要（其他批次的章节标题，便于 LLM 识别跨章节冲突）
  const batchSectionSummaries: string[] = batches.map((batch, i) => {
    const sections = new Set(batch.map((s) => s.name.split(" - ")[0]));
    return `批次 ${i + 1}: ${Array.from(sections).join("、")}`;
  });
  const crossBatchOutline = batches.length > 1
    ? `\n【全文来源分布】\n${batchSectionSummaries.join("\n")}`
    : "";

  // 合并所有批次结果
  const allConflicts: ConflictItem[] = [];
  let weightedConflictRate = 0;
  let totalWeight = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const sourcesText = batch.map((s, idx) => formatSource(s, i * 1000 + idx)).join("\n\n---\n\n");
    const batchLabel = batches.length === 1 ? "" : `\n\n【当前批次：第 ${i + 1}/${batches.length} 批，共 ${batch.length} 个来源】${crossBatchOutline}`;
    const fullSourcesText = batches.length === 1
      ? sourcesText
      : `【全部来源总数：${sources.length}】${batchLabel}\n\n${sourcesText}`;

    const prompt = CONFLICT_DETECTOR_USER.replace("{{SOURCES}}", fullSourcesText);

    try {
      const dbSettings = readSettingsFromDb();
      const providers = [providerId];
      const providerApiKeys: Record<string, string> = {};
      for (const pid of providers) {
        const key = apiKey ?? getApiKey(pid);
        if (key) providerApiKeys[pid] = key;
      }

      const maxTokens = resolveEvalMaxTokens(modelId);

      if (i === 0) {
        logger.info(`[ConflictDetection] 模型: ${modelId}, maxTokens: ${maxTokens}`);
      }

      const { response } = await registry.runWithFallback(
        providers,
        {
          modelId: modelId,
          messages: [
            { role: "system", content: CONFLICT_DETECTOR_SYSTEM },
            { role: "user", content: prompt },
          ],
          apiKey: "",
          maxTokens,
          temperature: 0,
          timeoutMs: 300_000,
          evalMode: true,
        },
        undefined,
        undefined,
        providerApiKeys,
      );

      const parsed = parseJsonResponse<any>(response.text);
      if (!parsed) continue;

      const batchConflicts: ConflictItem[] = parsed.conflicts ?? [];
      const batchRate = parsed.conflict_rate ?? parsed.conflictRate ?? 0;

      allConflicts.push(...batchConflicts);
      weightedConflictRate += batchRate * batch.length;
      totalWeight += batch.length;
    } catch (e) {
      logger.warn(`[ConflictDetection] 批次 ${i + 1} 失败: ${e}`);
    }
  }

  const conflictRate = totalWeight > 0 ? weightedConflictRate / totalWeight : 0;
  return {
    conflicts: allConflicts,
    conflictRate,
    hasConflicts: allConflicts.length > 0,
  };
}

/**
 * 检测文档中的冲突
 */
export async function detectConflicts(
  sections: Array<{ title: string; content: string; sources: Array<{ chunkId: string; content: string; score: number; sourceName?: string }> }>,
  apiKey: string,
  providerId: string,
  modelId: string,
): Promise<ConflictDetectionResult> {
  // 收集所有来源
  const allSources: Array<{ name: string; content: string; authority?: number; timestamp?: string }> = [];

  for (const section of sections) {
    for (const source of section.sources) {
      // 从来源名称推断权威度
      let authority: number | undefined;
      const name = source.sourceName ?? source.chunkId;
      if (/VP|总监|总经理|CEO/i.test(name)) authority = 0.9;
      else if (/经理|主管|负责人/i.test(name)) authority = 0.7;
      else if (/实习生|助理/i.test(name)) authority = 0.4;

      allSources.push({
        name: `${section.title} - ${name}`,
        content: source.content,
        authority,
      });
    }
  }

  if (allSources.length < 2) {
    return { conflicts: [], conflictRate: 0, hasConflicts: false };
  }

  try {
    const result = await callConflictDetector(allSources, apiKey, providerId, modelId);
    return result;
  } catch (e) {
    logger.warn(`[ConflictDetection] Conflict detection failed: ${e}`);
    return { conflicts: [], conflictRate: 0, hasConflicts: false };
  }
}

/**
 * 生成冲突报告（用于在文档中展示）
 */
export function generateConflictReport(conflicts: ConflictItem[]): string {
  if (conflicts.length === 0) return "";

  let report = "\n\n---\n\n## ⚠️ 待查冲突\n\n";
  report += "以下内容存在来源冲突，建议核实后再使用：\n\n";

  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    const severityEmoji = conflict.severity === "high" ? "🔴" : conflict.severity === "medium" ? "🟡" : "🟢";

    report += `### ${severityEmoji} 冲突 ${i + 1}: ${conflict.topic}\n\n`;
    report += `**类型**: ${conflict.conflictType === "temporal" ? "时间冲突" :
                           conflict.conflictType === "authority" ? "来源权威冲突" :
                           conflict.conflictType === "perspective" ? "视角冲突" :
                           conflict.conflictType === "data" ? "数据冲突" : "其他冲突"}\n\n`;
    report += `**严重程度**: ${conflict.severity === "high" ? "高" : conflict.severity === "medium" ? "中" : "低"}\n\n`;

    report += "**各方说法**:\n\n";
    for (const claim of conflict.claims) {
      report += `- **${claim.source}**: ${claim.text}`;
      if (claim.timestamp) report += ` (${claim.timestamp})`;
      report += "\n";
    }

    if (conflict.recommendation) {
      report += `\n**建议**: ${conflict.recommendation}\n`;
    }

    report += "\n";
  }

  return report;
}

// ============ Auto-Resolution ============

export interface ConflictResolutionItem {
  topic: string;
  conflictType: ConflictItem["conflictType"];
  severity: ConflictItem["severity"];
  resolution: "authority" | "temporal" | "unresolvable";
  winningSource: string;
  losingSources: string[];
  reason: string;
}

export interface ConflictResolutionResult {
  resolved: ConflictResolutionItem[];
  unresolved: ConflictResolutionItem[];
  excludedChunkIds: string[];
}

function safeParseTimestamp(ts: string | undefined, fallback: number): number {
  if (!ts) return fallback;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? fallback : parsed;
}

export function autoResolveConflicts(
  conflicts: ConflictItem[],
  sourceToChunkIds: Map<string, string[]>,
  options?: { forceResolveAll?: boolean },
): ConflictResolutionResult {
  const resolved: ConflictResolutionItem[] = [];
  const unresolved: ConflictResolutionItem[] = [];
  const excludedChunkIds: string[] = [];
  const excludedSet = new Set<string>();
  const forceResolveAll = options?.forceResolveAll ?? false;

  // 模糊 source name 查找：LLM 经常 paraphrase 来源名（如"销售部周报" → "销售部-周报"），
  // 精确匹配失败会导致 chunk 不排除，eval 时重新发现同一冲突。
  const normalizeSourceName = (s: string): string =>
    s.toLowerCase().replace(/[\s_\-./\\|:：,，;；()（）\[\]【】《》]+/g, "").replace(/\.(pdf|docx|txt|md|eml|pptx|json|csv|xlsx)$/i, "");

  const normKeyMap = new Map<string, string>();
  for (const key of sourceToChunkIds.keys()) {
    normKeyMap.set(normalizeSourceName(key), key);
  }

  const lookupChunkIds = (llmSource: string, topicForLog: string): string[] => {
    // 1. 精确匹配
    const exact = sourceToChunkIds.get(llmSource);
    if (exact) return exact;
    // 2. 归一化精确匹配
    const norm = normalizeSourceName(llmSource);
    const normKey = normKeyMap.get(norm);
    if (normKey) return sourceToChunkIds.get(normKey) ?? [];
    // 3. 最长归一化子串匹配
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const [normK, origK] of normKeyMap) {
      if (norm.includes(normK) && normK.length > bestLen) {
        bestLen = normK.length;
        bestKey = origK;
      } else if (normK.includes(norm) && norm.length > bestLen) {
        bestLen = norm.length;
        bestKey = origK;
      }
    }
    if (bestKey) return sourceToChunkIds.get(bestKey) ?? [];
    // 4. 找不到 — 日志警告，避免静默失败
    logger.warn(`[ConflictResolution] source-name lookup 失败（eval 会重新发现此冲突）: topic="${topicForLog}", llmSource="${llmSource}", knownKeys=${[...sourceToChunkIds.keys()].slice(0, 5).join(", ")}...`);
    return [];
  };

  // 把某个 conflict 的所有 sides 的 chunks 全部排除（forceResolveAll 兜底）
  const excludeAllSides = (conflict: ConflictItem): ConflictResolutionItem => {
    for (const claim of conflict.claims) {
      const ids = lookupChunkIds(claim.source, conflict.topic);
      for (const id of ids) { if (!excludedSet.has(id)) { excludedSet.add(id); excludedChunkIds.push(id); } }
    }
    return {
      topic: conflict.topic,
      conflictType: conflict.conflictType,
      severity: conflict.severity,
      resolution: "unresolvable",
      winningSource: "",
      losingSources: conflict.claims.map((c) => c.source),
      reason: "无法自动判定胜负，移除所有冲突侧以确保文档不含矛盾陈述",
    };
  };

  for (const conflict of conflicts) {
    if (conflict.claims.length < 2) continue;

    let resolution: ConflictResolutionItem | null = null;

    const withAuth = conflict.claims.filter((c) => c.sourceAuthority != null);

    if (withAuth.length >= 2) {
      const sorted = [...conflict.claims].sort(
        (a, b) => (b.sourceAuthority ?? 0) - (a.sourceAuthority ?? 0),
      );
      const winner = sorted[0]!;
      const losers = sorted.slice(1);
      const winnerTime = safeParseTimestamp(winner.timestamp, 0);
      const newerLosers = losers.filter(
        (l) => safeParseTimestamp(l.timestamp, 0) > winnerTime,
      );

      if (newerLosers.length === 0 || winnerTime === 0) {
        resolution = {
          topic: conflict.topic,
          conflictType: conflict.conflictType,
          severity: conflict.severity,
          resolution: "authority",
          winningSource: winner.source,
          losingSources: losers.map((l) => l.source),
          reason: `以权威度更高的来源「${winner.source}」(权威度 ${(winner.sourceAuthority ?? 0).toFixed(1)}) 为准`,
        };
        for (const loser of losers) {
          const ids = lookupChunkIds(loser.source, conflict.topic);
          for (const id of ids) { if (!excludedSet.has(id)) { excludedSet.add(id); excludedChunkIds.push(id); } }
        }
      }
    }

    if (!resolution && conflict.conflictType === "temporal") {
      const withTs = conflict.claims.filter((c) => c.timestamp && !isNaN(Date.parse(c.timestamp)));
      if (withTs.length >= 2) {
        const sorted = [...withTs].sort(
          (a, b) => Date.parse(b.timestamp!) - Date.parse(a.timestamp!),
        );
        const winner = sorted[0]!;
        const losers = sorted.slice(1);
        resolution = {
          topic: conflict.topic,
          conflictType: conflict.conflictType,
          severity: conflict.severity,
          resolution: "temporal",
          winningSource: winner.source,
          losingSources: losers.map((l) => l.source),
          reason: `以时间更新的来源「${winner.source}」(${winner.timestamp}) 为准`,
        };
        for (const loser of losers) {
          const ids = lookupChunkIds(loser.source, conflict.topic);
          for (const id of ids) { if (!excludedSet.has(id)) { excludedSet.add(id); excludedChunkIds.push(id); } }
        }
      }
    }

    if (resolution) {
      resolved.push(resolution);
    } else if (forceResolveAll) {
      // 强制解决：无法判定胜负时，移除所有 sides 的 chunks，确保文档无矛盾
      const forced = excludeAllSides(conflict);
      resolved.push(forced);
      logger.warn(`[ConflictResolution] 强制解决冲突（移除所有 sides）: topic="${conflict.topic}", type=${conflict.conflictType}, sides=${conflict.claims.map(c => c.source).join(", ")}`);
    } else {
      unresolved.push({
        topic: conflict.topic,
        conflictType: conflict.conflictType,
        severity: conflict.severity,
        resolution: "unresolvable",
        winningSource: "",
        losingSources: conflict.claims.map((c) => c.source),
        reason: "无法自动解决，需要用户手动决定",
      });
    }
  }

  return { resolved, unresolved, excludedChunkIds };
}
