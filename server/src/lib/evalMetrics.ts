/**
 * 评估指标模块 — 5 核心信任度指标
 * Feature #20: 在线评估
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { logger } from "./logger.js";
// TrustMetrics 类型定义（与 shared 保持一致）
export interface TrustMetrics {
  faithfulness: number;
  groundedness: number;
  coherence: number;
  fluency: number;
  completeness: number;
  // actionable insights（LLM 生成的扣分原因/改进建议）
  faithfulness_insight?: string;
  groundedness_insight?: string;
  coherence_insight?: string;
  fluency_insight?: string;
  completeness_insight?: string;
}

// ── 评估指标计算 ──────────────────────────────────────

export interface EvalRequest {
  content: string;
  sources: Array<{ content: string; score: number }>;
  providerPreference: string[];
  modelId: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
}

/** 构建评估 prompt */
function buildEvalPrompt(content: string, sources: EvalRequest["sources"]): { system: string; user: string } {
  const system = `你是文档质量评估专家。评估以下文档的 5 个核心指标，每个指标 0-1 分。

文档已用 [¶1] [¶2] ... 标记段落编号。

指标说明：
1. faithfulness (事实忠实度): 文档内容是否基于提供的参考来源
2. groundedness (有据可查度): 每个声明是否有明确的来源支撑
3. coherence (连贯性): 文档结构是否清晰，逻辑是否连贯
4. fluency (流畅性): 语言是否流畅，表达是否准确
5. completeness (完整性): 是否覆盖了所有必要的信息

insight 要求：
- 引用具体段落编号（如 [¶2] [¶3]），让用户知道哪里有问题
- 说明具体问题和改进建议
- 满分时简要说明做得好的地方
- 长度 30-80 字中文

输出 JSON（直接输出，不要任何解释）：
{"faithfulness":0.85,"faithfulness_insight":"[¶3] 竞品分析数据（Notion AI、Jasper）缺乏引用来源，[¶5] 下一步计划中的时间线未标注依据","groundedness":0.9,"groundedness_insight":"[¶3] 竞品分析3处声明无引用支撑，[¶1][¶2][¶4] 均有引用","coherence":0.8,"coherence_insight":"[¶3] 竞品分析与工作汇报主题衔接稍突兀，建议在 [¶2] 末尾加过渡句","fluency":0.85,"fluency_insight":"[¶3] 第2句超过80字建议拆分，[¶5] 有2处口语化表达","completeness":0.75,"completeness_insight":"缺少风险分析章节，建议在 [¶4] 和 [¶5] 之间增加"}`;

  const sourceText = sources.map((s, i) => `[${i + 1}] ${s.content.slice(0, 200)}`).join("\n");

  // 给文档加段落标记：按 h2/h3 或段落分割，添加 [¶N] 标记
  const paragraphs = content.split(/(?=<(?:h[1-3]|p|div|section)[^>]*>)/i).filter(p => p.trim());
  const markedContent = paragraphs.map((p, i) => `[¶${i + 1}] ${p}`).join("\n");

  const user = `## 参考来源
${sourceText || "（无参考来源）"}

## 待评估文档
${markedContent.slice(0, 8000)}

请评估以上文档。`;

  return { system, user };
}

/** 执行在线评估 */
export async function evaluateOnline(req: EvalRequest): Promise<TrustMetrics> {
  const { system, user } = buildEvalPrompt(req.content, req.sources);

  try {
    const providerApiKeys: Record<string, string> = {};
    for (const pid of req.providerPreference ?? []) {
      const key = req.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const { response } = await registry.runWithFallback(
      req.providerPreference!,
      {
        modelId: req.modelId!,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        apiKey: "",
        temperature: 0,
      },
      undefined, undefined,
      providerApiKeys,
      req.providerBaseUrls,
    );

    if (response.error) {
      throw new Error(`LLM error: ${response.error.message}`);
    }

    const parsed = JSON.parse(response.text);
    return {
      faithfulness: clamp(parsed.faithfulness),
      groundedness: clamp(parsed.groundedness),
      coherence: clamp(parsed.coherence),
      fluency: clamp(parsed.fluency),
      completeness: clamp(parsed.completeness),
      faithfulness_insight: String(parsed.faithfulness_insight ?? ""),
      groundedness_insight: String(parsed.groundedness_insight ?? ""),
      coherence_insight: String(parsed.coherence_insight ?? ""),
      fluency_insight: String(parsed.fluency_insight ?? ""),
      completeness_insight: String(parsed.completeness_insight ?? ""),
    };
  } catch (err) {
    logger.error(`[EvalMetrics] 评估失败: ${err instanceof Error ? err.message : String(err)}`);
    return {
      faithfulness: 0, groundedness: 0, coherence: 0, fluency: 0, completeness: 0,
      faithfulness_insight: "", groundedness_insight: "", coherence_insight: "",
      fluency_insight: "", completeness_insight: "",
    };
  }
}

function clamp(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

/** 计算综合信任度分数 */
export function computeTrustScore(metrics: TrustMetrics): number {
  const weights = {
    faithfulness: 0.3,
    groundedness: 0.3,
    coherence: 0.15,
    fluency: 0.1,
    completeness: 0.15,
  };

  return (
    metrics.faithfulness * weights.faithfulness +
    metrics.groundedness * weights.groundedness +
    metrics.coherence * weights.coherence +
    metrics.fluency * weights.fluency +
    metrics.completeness * weights.completeness
  );
}
