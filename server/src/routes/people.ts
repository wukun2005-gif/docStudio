/**
 * People Graph API 路由
 */
import { Router } from "express";
import crypto from "crypto";
import {
  addPerson,
  getAllPeople,
  getPersonById,
  deletePerson,
  getPeopleByDepartment,
  getOrgTree,
  getRelationships,
  getPersonContext,
  addRelationship,
  type PersonAttributes,
} from "../lib/peopleGraph.js";
import { logger } from "../lib/logger.js";
import { syncPeopleFromGraph } from "../lib/connectors/msGraphPeople.js";

export const peopleRouter = Router();

/** GET /api/people — 获取所有人 */
peopleRouter.get("/", (_req, res) => {
  try {
    const people = getAllPeople();
    res.json({ ok: true, people });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/people/org-tree — 组织架构树 */
peopleRouter.get("/org-tree", (_req, res) => {
  try {
    const tree = getOrgTree();
    const result: Record<string, Array<{ id: string; name: string; title?: string; email?: string }>> = {};
    for (const [dept, people] of tree) {
      result[dept] = people.map((p) => ({ id: p.id, name: p.name, title: p.title, email: p.email }));
    }
    res.json({ ok: true, tree: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/people/export — 导出组织架构 JSON */
peopleRouter.get("/export", (_req, res) => {
  try {
    const people = getAllPeople();
    res.json({ ok: true, people });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/people/import — 导入组织架构 JSON（替换现有数据）
 * 支持三种格式：
 * 1. { people: [...] } — 标准格式
 * 2. { nodes: [...], edges: [...] } — people-graph.json 格式
 * 3. [...] — 纯数组
 */
peopleRouter.post("/import", (req, res) => {
  try {
    const body = req.body;

    // 支持多种格式
    let people: any[] = [];
    let edges: any[] = [];

    if (Array.isArray(body)) {
      // 格式 3: 纯数组
      people = body;
    } else if (Array.isArray(body.people)) {
      // 格式 1: { people: [...] }
      people = body.people;
    } else if (Array.isArray(body.nodes)) {
      // 格式 2: { nodes: [...], edges: [...] }
      people = body.nodes;
      edges = body.edges || [];
    } else {
      res.status(400).json({
        ok: false,
        error: "JSON 格式错误：需要 { people: [...] }、{ nodes: [...] } 或 [...] 数组",
      });
      return;
    }

    // 清空现有数据
    const existing = getAllPeople();
    for (const p of existing) {
      deletePerson(p.id);
    }

    // 导入人员
    let imported = 0;
    for (const p of people) {
      if (!p.name) continue;
      const id = p.id || crypto.randomUUID();
      addPerson({
        id,
        name: p.name,
        title: p.title || "",
        department: p.department || "",
        email: p.email || "",
        attributes: p.attributes,
      });
      imported++;
    }

    // 导入关系
    let relCount = 0;
    if (edges.length > 0) {
      // 映射边类型到 Relationship 类型
      const typeMap: Record<string, string> = {
        reporting: "manager",
        manages: "manager",
        peer: "peer",
        collaborates: "cross_team",
        cross_team: "cross_team",
        external: "external",
      };

      for (const edge of edges) {
        // source/target 可能是 ID 或 name
        const relType = typeMap[edge.type] || "cross_team";
        addRelationship({
          sourceId: edge.source,
          targetId: edge.target,
          type: relType,
          context: edge.label || edge.context,
        });
        relCount++;
      }
    }

    logger.info(`[People] 导入组织架构: ${imported} 人, ${relCount} 关系`);
    res.json({ ok: true, imported, relationships: relCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/people/sync-msgraph — 从 Microsoft Entra ID 同步组织架构 */
peopleRouter.post("/sync-msgraph", async (_req, res) => {
  try {
    const result = await syncPeopleFromGraph();
    logger.info(`[People] 从 Entra ID 同步: ${result.imported} 人, ${result.relationships} 关系`);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[People] Entra ID 同步失败: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/people/:id — 获取单人详情 */
peopleRouter.get("/:id", (req, res) => {
  try {
    const person = getPersonById(req.params.id);
    if (!person) {
      res.status(404).json({ ok: false, error: "Person not found" });
      return;
    }
    res.json({ ok: true, person });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/people/:id/relationships — 获取关系 */
peopleRouter.get("/:id/relationships", (req, res) => {
  try {
    const relationships = getRelationships(req.params.id);
    res.json({ ok: true, relationships });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** GET /api/people/:id/context — 获取上下文（用于文档生成） */
peopleRouter.get("/:id/context", (req, res) => {
  try {
    const context = getPersonContext(req.params.id);
    res.json({ ok: true, context });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** POST /api/people — 添加人员 */
peopleRouter.post("/", (req, res) => {
  try {
    const { name, title, department, email, attributes } = req.body;
    if (!name) {
      res.status(400).json({ ok: false, error: "name is required" });
      return;
    }
    const id = crypto.randomUUID();
    addPerson({ id, name, title, department, email, attributes: attributes as PersonAttributes });
    logger.info(`[People] 添加人员: ${name}`);
    res.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** PUT /api/people/:id — 更新人员信息 */
peopleRouter.put("/:id", (req, res) => {
  try {
    const existing = getPersonById(req.params.id);
    if (!existing) {
      res.status(404).json({ ok: false, error: "Person not found" });
      return;
    }
    const { name, title, department, email } = req.body;
    addPerson({
      id: req.params.id,
      name: name ?? existing.name,
      title: title ?? existing.title,
      department: department ?? existing.department,
      email: email ?? existing.email,
      attributes: existing.attributes,
    });
    logger.info(`[People] 更新人员: ${name ?? existing.name}`);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** DELETE /api/people/:id — 删除人员 */
peopleRouter.delete("/:id", (req, res) => {
  try {
    deletePerson(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});
