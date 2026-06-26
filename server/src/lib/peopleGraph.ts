/**
 * People Graph — 组织架构 + 人际关系图谱
 * Feature #4: 高权重信号影响文档生成
 *
 * 人员与 Sample 数据（EML 邮件）对齐
 */
import { getDb } from "./db.js";
import { logAudit } from "./auditLog.js";
import { logger } from "./logger.js";

export interface Person {
  id: string;
  name: string;
  title?: string;
  department?: string;
  email?: string;
  attributes?: PersonAttributes;
  createdAt: string;
}

export interface PersonAttributes {
  relationships?: Relationship[];
  communicationStyle?: string;   // "formal" | "casual" | "technical"
  preferences?: Record<string, unknown>;
}

export interface Relationship {
  targetPersonId: string;
  type: "manager" | "peer" | "direct_report" | "cross_team" | "external";
  strength?: number; // 0-1
  context?: string;
}

// ── CRUD ────────────────────────────────────────────

export function addPerson(person: {
  id: string; name: string; title?: string; department?: string;
  email?: string; attributes?: PersonAttributes;
}): void {
  const db = getDb();
  // 查询旧数据用于审计
  const oldRow = db.prepare("SELECT * FROM people WHERE id = ?").get(person.id) as any;

  db.prepare(`INSERT OR REPLACE INTO people
    (id, name, title, department, email, attributes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
    .run(person.id, person.name, person.title ?? null,
      person.department ?? null, person.email ?? null,
      person.attributes ? JSON.stringify(person.attributes) : null);

  logAudit({
    table: "people",
    operation: oldRow ? "UPDATE" : "INSERT",
    recordId: person.id,
    oldData: oldRow,
    newData: person,
    source: "people",
  });
}

export function getPersonById(id: string): Person | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM people WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return {
    ...row,
    attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
  };
}

export function getAllPeople(): Person[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM people ORDER BY department, name").all() as any[];
  return rows.map((r) => ({
    ...r,
    attributes: r.attributes ? JSON.parse(r.attributes) : undefined,
  }));
}

export function getPeopleByDepartment(department: string): Person[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM people WHERE department = ? ORDER BY name").all(department) as any[];
  return rows.map((r) => ({
    ...r,
    attributes: r.attributes ? JSON.parse(r.attributes) : undefined,
  }));
}

export function deletePerson(id: string): void {
  const db = getDb();
  // 查询旧数据用于审计
  const oldRow = db.prepare("SELECT * FROM people WHERE id = ?").get(id) as any;

  // 清理其他人员中指向该人员的反向关系
  const allPeople = getAllPeople();
  for (const p of allPeople) {
    if (p.id === id || !p.attributes?.relationships) continue;
    const filtered = p.attributes.relationships.filter((r) => r.targetPersonId !== id);
    if (filtered.length < p.attributes.relationships.length) {
      const attrs = { ...p.attributes, relationships: filtered };
      db.prepare("UPDATE people SET attributes = ? WHERE id = ?").run(JSON.stringify(attrs), p.id);
    }
  }

  db.prepare("DELETE FROM people WHERE id = ?").run(id);

  logAudit({
    table: "people",
    operation: "DELETE",
    recordId: id,
    oldData: oldRow,
    source: "people",
  });
}

// ── 关系管理 ────────────────────────────────────────

/** 反向关系映射 */
const REVERSE_TYPE: Record<string, Relationship["type"]> = {
  manager: "direct_report",
  direct_report: "manager",
  peer: "peer",
  cross_team: "cross_team",
  external: "external",
};

/** 单向添加关系（内部实现，不触发反向） */
function _addRelationshipOneWay(rel: {
  sourceId: string;
  targetId: string;
  type: string;
  context?: string;
}): void {
  const db = getDb();
  const source = getPersonById(rel.sourceId);
  if (!source) return;

  const relationships: Relationship[] = source.attributes?.relationships || [];
  // 去重
  if (relationships.some((r) => r.targetPersonId === rel.targetId && r.type === rel.type)) return;

  relationships.push({
    targetPersonId: rel.targetId,
    type: rel.type as Relationship["type"],
    context: rel.context,
  });

  const attrs = { ...source.attributes, relationships };
  db.prepare("UPDATE people SET attributes = ? WHERE id = ?").run(JSON.stringify(attrs), rel.sourceId);
}

/** 添加关系（自动创建反向关系，保证图的双向语义） */
export function addRelationship(rel: {
  sourceId: string;
  targetId: string;
  type: string;
  context?: string;
}): void {
  // 正向关系
  _addRelationshipOneWay(rel);

  // 反向关系
  const reverseType = REVERSE_TYPE[rel.type];
  if (reverseType) {
    _addRelationshipOneWay({
      sourceId: rel.targetId,
      targetId: rel.sourceId,
      type: reverseType,
      context: rel.context,
    });
  }
}

// ── 关系查询 ────────────────────────────────────────

/** 获取某人的所有关系 */
export function getRelationships(personId: string): Array<{
  person: Person; relationship: Relationship;
}> {
  const person = getPersonById(personId);
  if (!person?.attributes?.relationships) return [];

  return person.attributes.relationships
    .map((rel) => {
      const target = getPersonById(rel.targetPersonId);
      if (!target) return null;
      return { person: target, relationship: rel };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** 获取组织架构树 */
export function getOrgTree(): Map<string, Person[]> {
  const people = getAllPeople();
  const tree = new Map<string, Person[]>();
  for (const p of people) {
    const dept = p.department ?? "未分配";
    if (!tree.has(dept)) tree.set(dept, []);
    tree.get(dept)!.push(p);
  }
  return tree;
}

/** 获取某人的上下文信息（用于文档生成） */
export function getPersonContext(personId: string): string {
  const person = getPersonById(personId);
  if (!person) return "";

  const parts = [person.name];
  if (person.title) parts.push(person.title);
  if (person.department) parts.push(`${person.department}部门`);
  if (person.email) parts.push(`邮箱: ${person.email}`);

  const relationships = getRelationships(personId);
  if (relationships.length > 0) {
    const relStrs = relationships.map((r) => {
      const typeMap: Record<string, string> = {
        manager: "上级",
        peer: "同事",
        direct_report: "下属",
        cross_team: "跨部门协作",
        external: "外部合作",
      };
      return `${r.person.name}(${typeMap[r.relationship.type] ?? r.relationship.type})`;
    });
    parts.push(`关系网络: ${relStrs.join(", ")}`);
  }

  if (person.attributes?.communicationStyle) {
    const styleMap: Record<string, string> = {
      formal: "正式风格",
      casual: "轻松风格",
      technical: "技术风格",
    };
    parts.push(`沟通风格: ${styleMap[person.attributes.communicationStyle] ?? person.attributes.communicationStyle}`);
  }

  return parts.join(" | ");
}
