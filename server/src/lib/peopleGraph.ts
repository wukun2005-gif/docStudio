/**
 * People Graph — 组织架构 + 人际关系图谱
 * Feature #4: 高权重信号影响文档生成
 *
 * 人员与 Sample 数据（EML 邮件）对齐
 */
import { getDb } from "./db.js";
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
}

// ── CRUD ────────────────────────────────────────────

export function addPerson(person: {
  id: string; name: string; title?: string; department?: string;
  email?: string; attributes?: PersonAttributes;
}): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO people
    (id, name, title, department, email, attributes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
    .run(person.id, person.name, person.title ?? null,
      person.department ?? null, person.email ?? null,
      person.attributes ? JSON.stringify(person.attributes) : null);
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
  db.prepare("DELETE FROM people WHERE id = ?").run(id);
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

/**
 * 注入 demo People Graph 数据
 * 人员与 EML 邮件、Sample 数据完全对齐
 */
export function injectDemoPeople(): void {
  const people = getAllPeople();
  if (people.length > 0) return;

  logger.info("[PeopleGraph] 注入 demo 组织架构数据...");

  // 与 EML 邮件人名一致
  const zhangsan = { id: "p-zhangsan", name: "张三", title: "技术负责人", department: "技术部" };
  const lisi     = { id: "p-lisi",     name: "李四", title: "后端工程师",   department: "技术部" };
  const wangwu   = { id: "p-wangwu",   name: "王五", title: "前端工程师",   department: "技术部" };
  const zhaoliu  = { id: "p-zhaoliu",  name: "赵六", title: "测试工程师",   department: "技术部" };
  const sunqi    = { id: "p-sunqi",    name: "孙七", title: "产品经理",     department: "产品部" };

  const peopleData = [
    {
      ...zhangsan,
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-lisi",   type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-wangwu", type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-zhaoliu", type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-sunqi",  type: "cross_team" as const,    strength: 0.7 },
        ],
      },
    },
    {
      ...lisi,
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-zhangsan", type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-wangwu",   type: "peer" as const,    strength: 0.8 },
        ],
      },
    },
    {
      ...wangwu,
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-zhangsan", type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-lisi",     type: "peer" as const,    strength: 0.9 },
          { targetPersonId: "p-zhaoliu",  type: "peer" as const,    strength: 0.7 },
        ],
      },
    },
    {
      ...zhaoliu,
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-zhangsan", type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-wangwu",   type: "peer" as const,    strength: 0.7 },
        ],
      },
    },
    {
      ...sunqi,
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-zhangsan", type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },
  ];

  for (const p of peopleData) {
    addPerson(p);
  }

  logger.info(`[PeopleGraph] 注入完成: ${peopleData.length} 人`);
}
