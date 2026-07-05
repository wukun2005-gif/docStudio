/**
 * People Graph — 组织架构 + 人际关系图谱
 * Feature #4: 高权重信号影响文档生成
 *
 * 人员与 Sample 数据（EML 邮件）对齐
 *
 * 所有 DB 访问通过 lib/dbQuery.ts，自动审计。
 */
import { dbRun, dbGet, dbAll, dbTransaction } from "./dbQuery.js";
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
  dbRun(
    `INSERT OR REPLACE INTO people
      (id, name, title, department, email, attributes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
    [
      person.id,
      person.name,
      person.title ?? null,
      person.department ?? null,
      person.email ?? null,
      person.attributes ? JSON.stringify(person.attributes) : null,
    ],
    { table: "people", recordId: person.id, source: "people", newData: person },
  );
}

export function getPersonById(id: string): Person | undefined {
  const row = dbGet<Person & { attributes: string | null }>(
    "SELECT * FROM people WHERE id = ?",
    [id],
  );
  if (!row) return undefined;
  return {
    ...row,
    attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
  };
}

export function getAllPeople(): Person[] {
  const rows = dbAll<Person & { attributes: string | null }>(
    "SELECT * FROM people ORDER BY department, name",
  );
  return rows.map((r) => ({
    ...r,
    attributes: r.attributes ? JSON.parse(r.attributes) : undefined,
  }));
}

export function getPeopleByDepartment(department: string): Person[] {
  const rows = dbAll<Person & { attributes: string | null }>(
    "SELECT * FROM people WHERE department = ? ORDER BY name",
    [department],
  );
  return rows.map((r) => ({
    ...r,
    attributes: r.attributes ? JSON.parse(r.attributes) : undefined,
  }));
}

/** 按职位关键词查找人员（三级模糊匹配，用于将用户 prompt 中的职位映射到 People Graph 人物） */
export function findPersonByTitle(keyword: string): Person | undefined {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return undefined;

  const people = getAllPeople();

  // 1. 完整关键词包含在 title 中
  for (const p of people) {
    if (p.title && p.title.toLowerCase().includes(kw)) return p;
  }

  // 2. 拆分关键词，逐个 token 匹配（处理 "VP 工程" vs "VP Engineering" 跨语言情况）
  const tokens = kw.split(/\s+/).filter(t => t.length >= 2);
  for (const token of tokens) {
    for (const p of people) {
      if (p.title && p.title.toLowerCase().includes(token)) return p;
    }
  }

  // 3. 回退：关键词包含 person.title（适用于缩写如 "VP"）
  for (const p of people) {
    if (p.title && kw.includes(p.title.toLowerCase())) return p;
  }

  return undefined;
}

export function deletePerson(id: string): void {
  // 清理其他人员中指向该人员的反向关系
  const allPeople = getAllPeople();
  dbTransaction(() => {
    for (const p of allPeople) {
      if (p.id === id || !p.attributes?.relationships) continue;
      const filtered = p.attributes.relationships.filter((r) => r.targetPersonId !== id);
      if (filtered.length < p.attributes.relationships.length) {
        const attrs = { ...p.attributes, relationships: filtered };
        dbRun(
          "UPDATE people SET attributes = ? WHERE id = ?",
          [JSON.stringify(attrs), p.id],
          { table: "people", recordId: p.id, source: "people", newData: attrs },
        );
      }
    }
    dbRun(
      "DELETE FROM people WHERE id = ?",
      [id],
      { table: "people", recordId: id, source: "people", operation: "DELETE" },
    );
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
  dbRun(
    "UPDATE people SET attributes = ? WHERE id = ?",
    [JSON.stringify(attrs), rel.sourceId],
    { table: "people", recordId: rel.sourceId, source: "people", newData: attrs },
  );
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

/** 获取组织架构树（按部门分组） */
export function getOrgTree(): Map<string, Person[]> {
  const people = getAllPeople();
  const tree = new Map<string, Person[]>();
  for (const p of people) {
    const dept = p.department || "未分配";
    if (!tree.has(dept)) tree.set(dept, []);
    tree.get(dept)!.push(p);
  }
  return tree;
}

export interface OrgNode {
  id: string;
  name: string;
  title?: string;
  email?: string;
  department?: string;
  children: OrgNode[];
}

/** 获取组织架构层级树（基于 manager/direct_report 关系） */
export function getOrgHierarchy(): OrgNode[] {
  const allPeople = getAllPeople();
  const personMap = new Map(allPeople.map((p) => [p.id, p]));

  const hasManager = new Set<string>();
  for (const p of allPeople) {
    for (const rel of p.attributes?.relationships || []) {
      if (rel.type === "manager") {
        hasManager.add(p.id);
      }
    }
  }

  const visited = new Set<string>();

  function buildNode(person: Person): OrgNode {
    if (visited.has(person.id)) {
      return { id: person.id, name: person.name, title: person.title, email: person.email, department: person.department, children: [] };
    }
    visited.add(person.id);

    const children: OrgNode[] = [];
    // 方式1：该人员的 direct_report 关系 → 直接下属
    for (const rel of person.attributes?.relationships || []) {
      if (rel.type === "direct_report") {
        const child = personMap.get(rel.targetPersonId);
        if (child && !visited.has(child.id)) {
          children.push(buildNode(child));
        }
      }
    }
    // 方式2：反向推断 — 找出所有 manager 关系指向本人员的人
    for (const p of allPeople) {
      if (p.id === person.id) continue;
      for (const rel of p.attributes?.relationships || []) {
        if (rel.type === "manager" && rel.targetPersonId === person.id) {
          if (!children.some((c) => c.id === p.id) && !visited.has(p.id)) {
            children.push(buildNode(p));
          }
        }
      }
    }

    return {
      id: person.id,
      name: person.name,
      title: person.title,
      email: person.email,
      department: person.department,
      children,
    };
  }

  return (hasManager.size === 0 ? allPeople : allPeople.filter((p) => !hasManager.has(p.id))).map(buildNode).filter((n) => n.children.length > 0 || hasManager.size === 0);
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
