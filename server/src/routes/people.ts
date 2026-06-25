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
  type PersonAttributes,
} from "../lib/peopleGraph.js";
import { logger } from "../lib/logger.js";

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
