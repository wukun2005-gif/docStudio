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
import { registry, isModelQuotaExhausted, isModelTimeoutCooldown } from "../providers/registry.js";
import { isReasoningModelStatic } from "../providers/openai.js";
import { jsonrepair } from "jsonrepair";
import { getApiKey } from "../security/keyStore.js";
import { readSettingsFromDb } from "./settingsReader.js";
import { resolveEvalMaxTokens, estimateTokens } from "./llmUtils.js";
import { getModelCapabilities } from "../providers/model-capabilities-registry.js";

// ── 任务感知的模型选择 ──────────────────────────────────
//
// conflict detection 是"跨来源声明对比 + JSON 结构化输出"任务，
// 不需要推理模型的推理深度。当且仅当用户启用了 model fallback 时，
// 主动从 fallback 链中挑选第一个非推理模型。

function selectBestEvalModel(
  primaryModel: string,
  providerPreference: string[],
  dbSettings: ReturnType<typeof readSettingsFromDb>,
): string {
  if (!isReasoningModelStatic(primaryModel)) return primaryModel;

  const fallbackMap = dbSettings.enableModelFallback ?? {};
  const fallbackEnabled = Object.values(fallbackMap).some(Boolean);
  if (!fallbackEnabled) return primaryModel;

  // 只选【非推理 + 支持 structured output + 容量足够 + 不在冷却】的模型
  const fallbackLists = dbSettings.modelFallbacks ?? {};
  for (const pid of providerPreference) {
    if (!fallbackMap[pid]) continue;
    const list = fallbackLists[pid];
    if (!list || list.length === 0) continue;
    for (const m of list) {
      if (!isReasoningModelStatic(m)) {
        if (isModelQuotaExhausted(m)) continue;
        if (isModelTimeoutCooldown(m)) continue;
        const caps = getModelCapabilities(m);
        if (caps.maxOutputTokens < 4096) continue;
        if (!caps.supportsStructuredOutput) continue;
        logger.info(`[ConflictDetection] 任务感知选模型: ${primaryModel} → ${m} (非推理, 支持结构化输出)`);
        return m;
      }
    }
  }
  return primaryModel;
}

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
  recommendation?: string;          // 处理建议（自由文本，保留兼容）
  winnerSource?: string;            // LLM 判定的可信来源名（结构化裁决）
  winnerReason?: string;            // 裁决理由
}

export interface ConflictDetectionResult {
  conflicts: ConflictItem[];
  conflictRate: number;             // 冲突率 (0-1)
  hasConflicts: boolean;
}

// ============ LLM Judge ============

const CONFLICT_DETECTOR_SYSTEM = `You are a conflict detection expert for knowledge-grounded document generation.

Your task: Analyze claims from different knowledge sources and identify contradictions or conflicts. For each conflict, also determine which source is more credible and should be used in the final document.

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

WINNER SELECTION RULES:
- Prefer sources with higher authority (e.g., VP > intern)
- Prefer more recently indexed/modified sources — check the "(时间: ...)" in source headers. Newer timestamps generally indicate fresher, more current information.
- When multiple sources appear to be different versions of the same document (similar filenames), prefer the one with the most recent timestamp.
- Prefer sources with concrete data/evidence over vague claims
- When uncertain, prefer the source whose claim is more specific and detailed
- Set winner_source to the exact source name from the claim

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
      "winner_source": "研发部会议纪要",
      "reason": "技术实现时间比销售承诺更可靠，且研发部来源权威度更高"
    }
  ],
  "conflict_rate": 0.15,
  "has_conflicts": true
}`;

const CONFLICT_DETECTOR_USER = `## 知识来源内容

{{SOURCES}}

请分析这些知识来源中的声明，找出所有矛盾或冲突的地方。对每个冲突，判断哪个来源更可信，设置 winner_source。

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
      "winner_source": "更可信的来源名称",
      "reason": "判断理由"
    }
  ],
  "conflict_rate": 0.15,
  "has_conflicts": true
}`;

// ============ Core Logic ============

/**
 * 解析 LLM JSON 响应（使用 jsonrepair 处理 LLM 输出不确定性）
 * 照搬 groundednessCheck.ts 的同名函数
 */
function parseJsonResponse<T>(content: string): T | null {
  const rawLen = content.length;
  let cleaned = content.trim();

  // 步骤 1: 剥离 markdown 代码块标记
  const fencePatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\w*\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pat of fencePatterns) {
    const m = cleaned.match(pat);
    if (m) {
      cleaned = m[1]!.trim();
      break;
    }
  }

  // 步骤 2: 提取首尾大括号之间的内容
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 步骤 2.5: 折叠连续逗号
  cleaned = cleaned.replace(/,(\s*,)+/g, ",");

  // 步骤 3: jsonrepair 修复 + JSON.parse
  let repaired: string;
  try {
    repaired = jsonrepair(cleaned);
  } catch {
    return null;
  }

  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

/** LLM 返回 snake_case JSON，统一转为 camelCase */
function normalizeConflictItem(raw: any): ConflictItem {
  return {
    topic: raw.topic ?? "",
    conflictType: raw.conflict_type ?? raw.conflictType ?? "other",
    claims: (raw.claims ?? []).map((c: any) => ({
      text: c.text ?? "",
      source: c.source ?? "",
      sourceAuthority: c.source_authority ?? c.sourceAuthority,
      timestamp: c.timestamp,
    })),
    severity: raw.severity ?? "medium",
    recommendation: raw.recommendation,
    winnerSource: raw.winner_source ?? raw.winnerSource,
    winnerReason: raw.reason ?? raw.winner_reason,
  };
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

      // 任务感知：conflict detection 不需要推理模型
      const effectiveModelId = selectBestEvalModel(modelId, providers, dbSettings);

      const maxTokens = resolveEvalMaxTokens(effectiveModelId);

      if (i === 0) {
        logger.info(`[ConflictDetection] 模型: ${effectiveModelId}, maxTokens: ${maxTokens}`);
      }

      const { response } = await registry.runWithFallback(
        providers,
        {
          modelId: effectiveModelId,
          messages: [
            { role: "system", content: CONFLICT_DETECTOR_SYSTEM },
            { role: "user", content: prompt },
          ],
          apiKey: "",
          maxTokens,
          temperature: 0,
          timeoutMs: 60_000,
          evalMode: true,
        },
        undefined,
        undefined,
        providerApiKeys,
      );

      const parsed = parseJsonResponse<any>(response.text);
      if (!parsed) continue;

      const batchConflicts: ConflictItem[] = (parsed.conflicts ?? []).map(normalizeConflictItem);
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
  sections: Array<{ title: string; content: string; sources: Array<{ chunkId: string; content: string; score: number; sourceName?: string; timestamp?: string }> }>,
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
        timestamp: source.timestamp,
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
    throw e;
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
  resolution: "authority" | "temporal" | "llm_verdict" | "unresolvable";
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

  // 剥离 LLM 输出中常见的 (来源 N) 编号后缀
  const stripSourceIndex = (s: string): string => s.replace(/\(来源\s*\d+\)/g, "").trim();

  const normKeyMap = new Map<string, string>();
  for (const key of sourceToChunkIds.keys()) {
    normKeyMap.set(normalizeSourceName(key), key);
  }

  // 从 knownKey 中提取纯文件名（"章节标题 - 文件名.docx" → "文件名.docx"）
  const extractFilename = (key: string): string | null => {
    const idx = key.lastIndexOf(" - ");
    if (idx === -1) return null;
    return key.slice(idx + 3);
  };

  const lookupChunkIds = (llmSource: string, topicForLog: string): string[] => {
    // 0. 先剥离 LLM 可能附加的 (来源 N) 后缀
    const cleanSource = stripSourceIndex(llmSource);

    // 1. 精确匹配
    const exact = sourceToChunkIds.get(cleanSource);
    if (exact) return exact;
    // 2. 归一化精确匹配
    const norm = normalizeSourceName(cleanSource);
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
    // 4. 提取 knownKey 中的纯文件名再做子串匹配
    for (const key of sourceToChunkIds.keys()) {
      const filename = extractFilename(key);
      if (!filename) continue;
      const filenameNorm = normalizeSourceName(filename);
      if (norm.includes(filenameNorm) || filenameNorm.includes(norm)) {
        return sourceToChunkIds.get(key) ?? [];
      }
    }
    // 5. 找不到 — 降级为 debug，避免刷屏
    logger.debug(`[ConflictResolution] source-name lookup 失败（eval 会重新发现此冲突）: topic="${topicForLog}", llmSource="${llmSource}", cleanSource="${cleanSource}", knownKeys=${[...sourceToChunkIds.keys()].slice(0, 5).join(", ")}...`);
    return [];
  };

  // 排除指定 source 的 chunks（去重写入 excludedSet）
  const excludeSource = (source: string, topic: string) => {
    const ids = lookupChunkIds(source, topic);
    for (const id of ids) { if (!excludedSet.has(id)) { excludedSet.add(id); excludedChunkIds.push(id); } }
  };

  // 把某个 conflict 的所有 sides 的 chunks 全部排除（最后兜底）
  const excludeAllSides = (conflict: ConflictItem): ConflictResolutionItem => {
    for (const claim of conflict.claims) {
      excludeSource(claim.source, conflict.topic);
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

    // ── 优先级 1：LLM winner_source（检测阶段已裁决，零额外延迟）──
    if (conflict.winnerSource) {
      const winnerClaim = conflict.claims.find(
        (c) => c.source === conflict.winnerSource,
      );
      if (winnerClaim) {
        const losers = conflict.claims.filter((c) => c.source !== conflict.winnerSource);
        resolution = {
          topic: conflict.topic,
          conflictType: conflict.conflictType,
          severity: conflict.severity,
          resolution: "llm_verdict",
          winningSource: conflict.winnerSource,
          losingSources: losers.map((l) => l.source),
          reason: conflict.winnerReason ?? `LLM 判定「${conflict.winnerSource}」更可信`,
        };
        for (const loser of losers) {
          excludeSource(loser.source, conflict.topic);
        }
        logger.info(`[ConflictResolution] LLM 裁决: topic="${conflict.topic}", winner="${conflict.winnerSource}"`);
      } else {
        // winnerSource 不匹配任何 claim → 降级到规则
        logger.warn(`[ConflictResolution] winnerSource 不匹配: topic="${conflict.topic}", winnerSource="${conflict.winnerSource}", claims=${conflict.claims.map(c => c.source).join(", ")}`);
      }
    }

    // ── 优先级 2：权威度规则 ──
    if (!resolution) {
      const withAuth = conflict.claims.filter((c) => c.sourceAuthority != null);
      // 只要至少有一方有权威度分数就尝试，单方有权威时自动胜出
      if (withAuth.length >= 1) {
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
            excludeSource(loser.source, conflict.topic);
          }
        }
      }
    }

    // ── 优先级 3：时间规则（仅 temporal 类型）──
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
          excludeSource(loser.source, conflict.topic);
        }
      }
    }

    if (resolution) {
      resolved.push(resolution);
    } else if (forceResolveAll) {
      // 最后兜底：LLM 裁决和规则都无法解决 → 移除所有 sides
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