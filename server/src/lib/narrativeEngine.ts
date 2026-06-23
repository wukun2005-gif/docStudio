/**
 * 叙事引擎 — 大纲生成 + 叙事模板
 * Feature #6: 大纲生成与调整
 * Feature #7: 叙事模板
 */
import { registry } from "../providers/registry.js";
import { getApiKey } from "../security/keyStore.js";
import { logger } from "./logger.js";

// ── 叙事模板 ──────────────────────────────────────────

export interface NarrativeTemplate {
  id: string;
  name: string;
  description: string;
  outline: OutlineSection[];
}

export interface OutlineSection {
  id: string;
  title: string;
  level: number;
  children: OutlineSection[];
  description?: string;
}

/** 预置叙事模板 */
export const TEMPLATES: NarrativeTemplate[] = [
  {
    id: "weekly-report",
    name: "项目周报",
    description: "标准项目周报模板，包含本周完成、下周计划、风险与阻塞",
    outline: [
      { id: "s1", title: "本周完成", level: 1, children: [
        { id: "s1-1", title: "重点工作", level: 2, children: [], description: "本周完成的核心工作" },
        { id: "s1-2", title: "进展详情", level: 2, children: [], description: "各项工作的具体进展" },
      ]},
      { id: "s2", title: "下周计划", level: 1, children: [
        { id: "s2-1", title: "重点任务", level: 2, children: [], description: "下周的核心任务" },
        { id: "s2-2", title: "里程碑", level: 2, children: [], description: "关键里程碑和交付物" },
      ]},
      { id: "s3", title: "风险与阻塞", level: 1, children: [
        { id: "s3-1", title: "当前风险", level: 2, children: [], description: "需要关注的风险项" },
        { id: "s3-2", title: "需要支持", level: 2, children: [], description: "需要管理层支持的事项" },
      ]},
    ],
  },
  {
    id: "research-report",
    name: "研究报告",
    description: "技术/市场研究报告模板",
    outline: [
      { id: "s1", title: "摘要", level: 1, children: [], description: "报告核心发现总结" },
      { id: "s2", title: "背景与目标", level: 1, children: [
        { id: "s2-1", title: "研究背景", level: 2, children: [] },
        { id: "s2-2", title: "研究目标", level: 2, children: [] },
      ]},
      { id: "s3", title: "方法论", level: 1, children: [], description: "研究方法和数据来源" },
      { id: "s4", title: "发现与分析", level: 1, children: [
        { id: "s4-1", title: "关键发现", level: 2, children: [] },
        { id: "s4-2", title: "数据分析", level: 2, children: [] },
      ]},
      { id: "s5", title: "结论与建议", level: 1, children: [] },
    ],
  },
  {
    id: "meeting-notes",
    name: "会议纪要",
    description: "标准会议纪要模板",
    outline: [
      { id: "s1", title: "会议信息", level: 1, children: [], description: "时间、地点、参会人" },
      { id: "s2", title: "议题讨论", level: 1, children: [] },
      { id: "s3", title: "决议事项", level: 1, children: [] },
      { id: "s4", title: "行动项", level: 1, children: [], description: "负责人、截止日期" },
    ],
  },
  {
    id: "product-spec",
    name: "产品需求文档",
    description: "PRD 模板",
    outline: [
      { id: "s1", title: "概述", level: 1, children: [] },
      { id: "s2", title: "用户场景", level: 1, children: [] },
      { id: "s3", title: "功能需求", level: 1, children: [] },
      { id: "s4", title: "非功能需求", level: 1, children: [] },
      { id: "s5", title: "设计规范", level: 1, children: [] },
      { id: "s6", title: "里程碑", level: 1, children: [] },
    ],
  },
];

/** 获取所有模板 */
export function getTemplates(): NarrativeTemplate[] {
  return TEMPLATES;
}

/** 获取模板 by id */
export function getTemplateById(id: string): NarrativeTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// ── 大纲生成 ──────────────────────────────────────────

export interface GenerateOutlineRequest {
  userRequest: string;
  templateId?: string;
  providerPreference?: string[];
  modelId?: string;
  apiKey?: string;
  providerBaseUrls?: Record<string, string>;
}

/** 基于用户需求生成大纲 */
export async function generateOutline(req: GenerateOutlineRequest): Promise<OutlineSection[]> {
  // 如果指定了模板，使用模板作为基础
  const template = req.templateId ? getTemplateById(req.templateId) : undefined;

  const systemPrompt = `你是一个文档大纲生成助手。根据用户的需求，生成结构化的文档大纲。

输出 JSON 格式：
{
  "outline": [
    {
      "id": "s1",
      "title": "章节标题",
      "level": 1,
      "description": "章节描述（可选）",
      "children": [
        { "id": "s1-1", "title": "子章节", "level": 2, "children": [], "description": "描述" }
      ]
    }
  ]
}

要求：
- 大纲层次清晰，一般 2-3 层
- 每个章节有简短描述
- id 使用 s1, s1-1, s1-2 格式
- 直接输出 JSON，不要 markdown 代码块`;

  const userPrompt = template
    ? `基于以下模板，为用户需求生成大纲。

模板：${template.name}
模板结构：${JSON.stringify(template.outline, null, 2)}

用户需求：${req.userRequest}

请根据用户需求调整模板，生成最终大纲。`
    : `用户需求：${req.userRequest}

请根据需求生成文档大纲。`;

  try {
    const providerApiKeys: Record<string, string> = {};
    for (const pid of req.providerPreference ?? []) {
      const key = req.apiKey ?? getApiKey(pid);
      if (key) providerApiKeys[pid] = key;
    }

    const { response } = await registry.runWithFallback(
      req.providerPreference ?? ["openai", "deepseek"],
      {
        modelId: req.modelId ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        apiKey: "",
        temperature: 0.3,
      },
      providerApiKeys,
      req.providerBaseUrls,
    );

    if (response.error) {
      throw new Error(`LLM error: ${response.error.message}`);
    }

    const parsed = JSON.parse(response.text) as { outline: OutlineSection[] };
    return parsed.outline;
  } catch (err) {
    logger.error(`[NarrativeEngine] 大纲生成失败: ${err instanceof Error ? err.message : String(err)}`);
    // 返回默认大纲
    return [
      { id: "s1", title: "概述", level: 1, children: [], description: "文档概述" },
      { id: "s2", title: "主要内容", level: 1, children: [], description: "核心内容" },
      { id: "s3", title: "总结", level: 1, children: [], description: "总结与展望" },
    ];
  }
}

// ── 大纲操作 ──────────────────────────────────────────

/** 添加章节 */
export function addSection(outline: OutlineSection[], parentId: string | null, title: string): OutlineSection[] {
  const newId = `s${Date.now()}`;
  const newSection: OutlineSection = { id: newId, title, level: 1, children: [] };

  if (!parentId) {
    return [...outline, newSection];
  }

  return outline.map((s) => addSectionRecursive(s, parentId, newSection));
}

function addSectionRecursive(section: OutlineSection, parentId: string, newSection: OutlineSection): OutlineSection {
  if (section.id === parentId) {
    return {
      ...section,
      children: [...section.children, { ...newSection, level: section.level + 1 }],
    };
  }
  return {
    ...section,
    children: section.children.map((c) => addSectionRecursive(c, parentId, newSection)),
  };
}

/** 删除章节 */
export function deleteSection(outline: OutlineSection[], sectionId: string): OutlineSection[] {
  return outline
    .filter((s) => s.id !== sectionId)
    .map((s) => ({
      ...s,
      children: deleteSection(s.children, sectionId),
    }));
}

/** 重命名章节 */
export function renameSection(outline: OutlineSection[], sectionId: string, newTitle: string): OutlineSection[] {
  return outline.map((s) => {
    if (s.id === sectionId) {
      return { ...s, title: newTitle };
    }
    return { ...s, children: renameSection(s.children, sectionId, newTitle) };
  });
}

/** 移动章节（调整顺序） */
export function moveSection(outline: OutlineSection[], sectionId: string, direction: "up" | "down"): OutlineSection[] {
  const idx = outline.findIndex((s) => s.id === sectionId);
  if (idx === -1) {
    return outline.map((s) => ({
      ...s,
      children: moveSection(s.children, sectionId, direction),
    }));
  }

  const newOutline = [...outline];
  if (direction === "up" && idx > 0) {
    [newOutline[idx - 1], newOutline[idx]] = [newOutline[idx], newOutline[idx - 1]];
  } else if (direction === "down" && idx < newOutline.length - 1) {
    [newOutline[idx], newOutline[idx + 1]] = [newOutline[idx + 1], newOutline[idx]];
  }
  return newOutline;
}
