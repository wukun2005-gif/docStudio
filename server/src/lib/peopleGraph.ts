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

  db.prepare("DELETE FROM people WHERE id = ?").run(id);

  logAudit({
    table: "people",
    operation: "DELETE",
    recordId: id,
    oldData: oldRow,
    source: "people",
  });
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

/**
 * 注入 demo People Graph 数据
 * 18 人完整团队，覆盖管理层、产品、技术、设计、市场、法务、客户成功
 * 与 sampleDataGenerator.ts、generateSamples.ts 完全对齐
 */
export function injectDemoPeople(): void {
  const people = getAllPeople();
  if (people.length > 0) return;

  logger.info("[PeopleGraph] 注入 demo 组织架构数据（18 人）...");

  const peopleData = [
    // ── 管理层 ──────────────────────────────────
    {
      id: "p-chenyu", name: "陈宇", title: "CEO", department: "管理层",
      email: "chenyu@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-wanglin",  type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-zhaojun",  type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-wangli",   type: "direct_report" as const, strength: 0.7 },
        ],
      },
    },
    {
      id: "p-wanglin", name: "王琳", title: "COO", department: "管理层",
      email: "wanglin@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-chenyu",   type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-sunan",    type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-tangmin",  type: "cross_team" as const, strength: 0.6 },
        ],
      },
    },
    {
      id: "p-zhaojun", name: "赵军", title: "VP Engineering", department: "管理层",
      email: "zhaojun@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-chenyu",   type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-chenqiang", type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-xujun",    type: "direct_report" as const, strength: 0.7 },
          { targetPersonId: "p-sunan",    type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },

    // ── 产品部 ──────────────────────────────────
    {
      id: "p-sunan", name: "苏楠", title: "产品总监", department: "产品部",
      email: "sunan@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-wanglin",  type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-huangwei", type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-chenqiang", type: "cross_team" as const, strength: 0.8 },
          { targetPersonId: "p-luoxi",    type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },
    {
      id: "p-huangwei", name: "黄薇", title: "高级产品经理", department: "产品部",
      email: "huangwei@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-sunan",    type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-zhaoli",   type: "cross_team" as const, strength: 0.6 },
          { targetPersonId: "p-lixin",    type: "cross_team" as const, strength: 0.5 },
        ],
      },
    },

    // ── 技术部 ──────────────────────────────────
    {
      id: "p-chenqiang", name: "陈强", title: "技术负责人", department: "技术部",
      email: "chenqiang@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-zhaojun",  type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-liuwei",   type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-zhaoli",   type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-sunna",    type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-wangchao", type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-zhoumin",  type: "direct_report" as const, strength: 0.8 },
          { targetPersonId: "p-yangfei",  type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-sunan",    type: "cross_team" as const, strength: 0.8 },
        ],
      },
    },
    {
      id: "p-liuwei", name: "刘伟", title: "高级后端工程师", department: "技术部",
      email: "liuwei@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-zhaoli",    type: "peer" as const, strength: 0.8 },
          { targetPersonId: "p-sunna",     type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-wangchao",  type: "peer" as const, strength: 0.8 },
        ],
      },
    },
    {
      id: "p-zhaoli", name: "赵丽", title: "高级前端工程师", department: "技术部",
      email: "zhaoli@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-liuwei",    type: "peer" as const, strength: 0.8 },
          { targetPersonId: "p-zhoumin",   type: "peer" as const, strength: 0.9 },
          { targetPersonId: "p-luoxi",     type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },
    {
      id: "p-sunna", name: "孙娜", title: "数据科学家", department: "技术部",
      email: "sunna@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-liuwei",    type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-wangchao",  type: "peer" as const, strength: 0.6 },
        ],
      },
    },
    {
      id: "p-wangchao", name: "王超", title: "后端工程师", department: "技术部",
      email: "wangchao@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-liuwei",    type: "peer" as const, strength: 0.8 },
          { targetPersonId: "p-sunna",     type: "peer" as const, strength: 0.6 },
        ],
      },
    },
    {
      id: "p-zhoumin", name: "周敏", title: "前端工程师", department: "技术部",
      email: "zhoumin@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "manager" as const, strength: 0.8 },
          { targetPersonId: "p-zhaoli",    type: "peer" as const, strength: 0.9 },
        ],
      },
    },
    {
      id: "p-xujun", name: "徐骏", title: "DevOps 工程师", department: "技术部",
      email: "xujun@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-zhaojun",  type: "manager" as const, strength: 0.7 },
          { targetPersonId: "p-chenqiang", type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },
    {
      id: "p-yangfei", name: "杨飞", title: "QA 负责人", department: "技术部",
      email: "yangfei@nexora-tech.com",
      attributes: {
        communicationStyle: "technical" as const,
        relationships: [
          { targetPersonId: "p-chenqiang", type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-liuwei",    type: "cross_team" as const, strength: 0.5 },
          { targetPersonId: "p-zhaoli",    type: "cross_team" as const, strength: 0.5 },
        ],
      },
    },

    // ── 设计部 ──────────────────────────────────
    {
      id: "p-luoxi", name: "罗茜", title: "UX 设计主管", department: "设计部",
      email: "luoxi@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-sunan",    type: "cross_team" as const, strength: 0.7 },
          { targetPersonId: "p-hecheng",  type: "direct_report" as const, strength: 0.9 },
          { targetPersonId: "p-zhaoli",   type: "cross_team" as const, strength: 0.7 },
        ],
      },
    },
    {
      id: "p-hecheng", name: "何成", title: "UI 设计师", department: "设计部",
      email: "hecheng@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-luoxi",    type: "manager" as const, strength: 0.9 },
          { targetPersonId: "p-zhoumin",  type: "cross_team" as const, strength: 0.5 },
        ],
      },
    },

    // ── 市场/销售 ────────────────────────────────
    {
      id: "p-wangli", name: "王莉", title: "市场总监", department: "市场部",
      email: "wangli@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-chenyu",   type: "manager" as const, strength: 0.7 },
          { targetPersonId: "p-zhangwei", type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-sunan",    type: "cross_team" as const, strength: 0.6 },
        ],
      },
    },
    {
      id: "p-zhangwei", name: "张伟", title: "企业销售经理", department: "销售部",
      email: "zhangwei@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-wangli",   type: "peer" as const, strength: 0.7 },
          { targetPersonId: "p-lixin",    type: "cross_team" as const, strength: 0.6 },
          { targetPersonId: "p-huangwei", type: "cross_team" as const, strength: 0.4 },
        ],
      },
    },

    // ── 法务 ────────────────────────────────────
    {
      id: "p-tangmin", name: "唐敏", title: "法务顾问", department: "法务部",
      email: "tangmin@nexora-tech.com",
      attributes: {
        communicationStyle: "formal" as const,
        relationships: [
          { targetPersonId: "p-wanglin",  type: "cross_team" as const, strength: 0.6 },
          { targetPersonId: "p-chenyu",   type: "cross_team" as const, strength: 0.4 },
        ],
      },
    },

    // ── 客户成功 ─────────────────────────────────
    {
      id: "p-lixin", name: "李鑫", title: "客户成功经理", department: "客户成功部",
      email: "lixin@nexora-tech.com",
      attributes: {
        communicationStyle: "casual" as const,
        relationships: [
          { targetPersonId: "p-huangwei", type: "cross_team" as const, strength: 0.5 },
          { targetPersonId: "p-zhangwei", type: "cross_team" as const, strength: 0.6 },
          { targetPersonId: "p-yangfei",  type: "cross_team" as const, strength: 0.4 },
        ],
      },
    },
  ];

  for (const p of peopleData) {
    addPerson(p);
  }

  logger.info(`[PeopleGraph] 注入完成: ${peopleData.length} 人`);
}
