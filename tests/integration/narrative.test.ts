/**
 * Phase 3 集成测试 — 叙事引擎 & Chat (#5-8)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDbForTesting, closeDb } from "../../server/src/lib/db.js";
import {
  getTemplates,
  getTemplateById,
  addSection,
  deleteSection,
  renameSection,
  moveSection,
  TEMPLATES,
} from "../../server/src/lib/narrativeEngine.js";
import { splitIntoSentences } from "../../server/src/lib/groundednessCheck.js";

describe("叙事模板 (#7)", () => {
  it("getTemplates 返回预置模板", () => {
    const templates = getTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.map((t) => t.id)).toContain("weekly-report");
    expect(templates.map((t) => t.id)).toContain("research-report");
    expect(templates.map((t) => t.id)).toContain("meeting-notes");
  });

  it("getTemplateById 获取指定模板", () => {
    const template = getTemplateById("weekly-report");
    expect(template).toBeDefined();
    expect(template!.name).toBe("项目周报");
    expect(template!.outline.length).toBeGreaterThan(0);
  });

  it("getTemplateById 不存在返回 undefined", () => {
    expect(getTemplateById("nonexistent")).toBeUndefined();
  });
});

describe("大纲操作 (#6)", () => {
  const sampleOutline = [
    { id: "s1", title: "第一章", level: 1, children: [
      { id: "s1-1", title: "子章节1.1", level: 2, children: [] },
    ]},
    { id: "s2", title: "第二章", level: 1, children: [] },
  ];

  it("addSection 添加顶级章节", () => {
    const result = addSection(sampleOutline, null, "新章节");
    expect(result.length).toBe(3);
    expect(result[2].title).toBe("新章节");
  });

  it("addSection 添加子章节", () => {
    const result = addSection(sampleOutline, "s1", "子章节1.2");
    expect(result[0].children.length).toBe(2);
  });

  it("deleteSection 删除章节", () => {
    const result = deleteSection(sampleOutline, "s2");
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("s1");
  });

  it("deleteSection 删除子章节", () => {
    const result = deleteSection(sampleOutline, "s1-1");
    expect(result[0].children.length).toBe(0);
  });

  it("renameSection 重命名章节", () => {
    const result = renameSection(sampleOutline, "s2", "新标题");
    expect(result[1].title).toBe("新标题");
  });

  it("moveSection 上移", () => {
    const result = moveSection(sampleOutline, "s2", "up");
    expect(result[0].id).toBe("s2");
    expect(result[1].id).toBe("s1");
  });

  it("moveSection 下移", () => {
    const result = moveSection(sampleOutline, "s1", "down");
    expect(result[0].id).toBe("s2");
    expect(result[1].id).toBe("s1");
  });
});

describe("Chat Router 基础 (#5)", () => {
  it("splitIntoSentences 用于声明拆分", () => {
    const sentences = splitIntoSentences("这是第一句。这是第二句！");
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });
});
