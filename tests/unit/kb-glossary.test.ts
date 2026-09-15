/**
 * 单元测试 — 知识库真实数据的英文术语表（kbGlossary）
 *
 * 覆盖两件事：
 * 1) 术语表本身正确：人名按邮箱前缀罗马化、职位/部门/文件名可确定映射
 * 2) **非回归**：language 不是 en 时必须原样返回（中文模式一个字符都不能动）
 *
 * 这层测试的意义：词表是纯函数映射，一旦有人误改「最长优先」顺序或
 * 加了会误伤短词的条目，这里会立刻失败，而不是等到界面上出现半中半英。
 */
import { describe, it, expect } from "vitest";
import {
  localizePersonName,
  localizeJobTitle,
  localizeDepartment,
  localizeFileName,
  localizePersonText,
  localizeOrgTree,
  localizeKnowledgeSource,
  SHARED_ZH_EN,
} from "../../server/src/lib/kbGlossary.js";

describe("kbGlossary — 人名罗马化（来源：邮箱前缀）", () => {
  it("中文名按拼音罗马化", () => {
    expect(localizePersonName("黄薇", "en")).toBe("Huang Wei");
    expect(localizePersonName("刘伟", "en")).toBe("Liu Wei");
    expect(localizePersonName("陈强", "en")).toBe("Chen Qiang");
    expect(localizePersonName("孙娜", "en")).toBe("Sun Na");
    expect(localizePersonName("何成", "en")).toBe("He Cheng");
  });

  it("罗茜 → Luo Xi（邮箱前缀 luoxi@，多音字必须跟着邮箱走）", () => {
    expect(localizePersonName("罗茜", "en")).toBe("Luo Xi");
  });

  it("已是拉丁名的原样返回", () => {
    expect(localizePersonName("Wu Kun", "en")).toBe("Wu Kun");
  });

  it("未知名字不臆造拼音，原样返回", () => {
    expect(localizePersonName("王芳", "en")).toBe("王芳");
  });

  it("长文本中的人名按最长优先替换", () => {
    expect(localizePersonText("苏楠、陈强", "en")).toBe("Su Nan、Chen Qiang");
    expect(localizePersonText("苏楠 <sunan@x.com>", "en")).toBe("Su Nan <sunan@x.com>");
  });
});

describe("kbGlossary — 职位 / 部门", () => {
  it("职位映射", () => {
    expect(localizeJobTitle("市场总监", "en")).toBe("Marketing Director");
    expect(localizeJobTitle("技术负责人", "en")).toBe("Head of Engineering");
    expect(localizeJobTitle("高级后端工程师", "en")).toBe("Senior Backend Engineer");
    expect(localizeJobTitle("QA 负责人", "en")).toBe("QA Lead");
  });

  it("本身是英文的职位保持不变", () => {
    expect(localizeJobTitle("CEO", "en")).toBe("CEO");
    expect(localizeJobTitle("VP Engineering", "en")).toBe("VP Engineering");
  });

  it("部门映射（含带/不带『部』两种写法）", () => {
    expect(localizeDepartment("技术部", "en")).toBe("Engineering");
    expect(localizeDepartment("客户成功部", "en")).toBe("Customer Success");
    expect(localizeDepartment("法务部", "en")).toBe("Legal");
    expect(localizeDepartment("法务", "en")).toBe("Legal");
  });
});

describe("kbGlossary — 文件名", () => {
  it("联系人文件名走人名罗马化", () => {
    expect(localizeFileName("黄薇.txt", "en")).toBe("Huang-Wei.txt");
    expect(localizeFileName("周敏.txt", "en")).toBe("Zhou-Min.txt");
  });

  it("会议类文件名按构件翻译", () => {
    expect(localizeFileName("01-周一-standup-会议纪要.docx", "en")).toBe(
      "01-Mon-standup-Meeting-Notes.docx",
    );
    expect(localizeFileName("03-周三-设计评审会议.docx", "en")).toBe(
      "03-Wed-Design-Review-Meeting.docx",
    );
  });

  it("邮件文件名：人名 + 主题", () => {
    expect(localizeFileName("14-李鑫-黄薇-客户反馈汇总.eml", "en")).toBe(
      "14-Li-Xin-Huang-Wei-Customer-Feedback-Summary.eml",
    );
    expect(localizeFileName("15-徐骏-团队-CI-CD优化.eml", "en")).toBe(
      "15-Xu-Jun-Team-CI-CD-Optimization.eml",
    );
  });

  it("报告类文件名", () => {
    expect(localizeFileName("Q3-质量指标报告.docx", "en")).toBe("Q3-Quality-Metrics-Report.docx");
    expect(localizeFileName("项目进度表.xlsx", "en")).toBe("Project-Schedule.xlsx");
    expect(localizeFileName("投资人更新-2026-06.pptx", "en")).toBe("Investor-Update-2026-06.pptx");
  });

  it("邮件主题（不带扩展名）命中 .eml 条目时要剥掉后缀", () => {
    expect(localizeFileName("欢迎使用你的新 Outlook.com 帐户", "en")).toBe(
      "Welcome-to-your-new-Outlook.com-account",
    );
  });

  it("长词优先：客户反馈汇总 不被 客户 拆坏", () => {
    expect(localizeFileName("14-李鑫-黄薇-客户反馈汇总.eml", "en")).not.toContain("Customer-反馈");
  });

  it("已拉丁化的文件名不受影响", () => {
    expect(localizeFileName("Book.xlsx", "en")).toBe("Book.xlsx");
    expect(localizeFileName("Teams-Chat-History-dev-team.json", "en")).toBe(
      "Teams-Chat-History-dev-team.json",
    );
  });
});

describe("kbGlossary — 非回归：中文模式必须原样返回", () => {
  const cases = [
    "黄薇", "黄薇.txt", "01-周一-standup-会议纪要.docx",
    "14-李鑫-黄薇-客户反馈汇总.eml", "Q3-质量指标报告.docx",
  ];

  it("localizeFileName 在 zh-CN / undefined 下逐字不变", () => {
    for (const c of cases) {
      expect(localizeFileName(c, "zh-CN")).toBe(c);
      expect(localizeFileName(c, undefined)).toBe(c);
    }
  });

  it("localizePersonName / JobTitle / Department 在 zh-CN 下逐字不变", () => {
    expect(localizePersonName("黄薇", "zh-CN")).toBe("黄薇");
    expect(localizeJobTitle("市场总监", "zh-CN")).toBe("市场总监");
    expect(localizeDepartment("技术部", "zh-CN")).toBe("技术部");
  });

  it("知识源在 zh-CN 下对象引用不变（不做无谓拷贝）", () => {
    const src = { id: "s1", name: "黄薇.txt", type: "outlook_contact" };
    expect(localizeKnowledgeSource(src, "zh-CN")).toBe(src);
  });

  it("github_file 是代码路径，任何语言下都不翻译", () => {
    const src = { id: "s1", name: "server/中文目录/file.ts", type: "github_file" };
    expect(localizeKnowledgeSource(src, "en")).toBe(src);
  });
});

describe("kbGlossary — 组织架构树", () => {
  const tree = [
    {
      id: "root",
      name: "陈宇",
      title: "CEO",
      department: "管理层",
      children: [{ id: "me", name: "黄薇", title: "高级产品经理", department: "产品部", children: [] }],
    },
  ];

  it("递归本地化并保留结构", () => {
    const en = localizeOrgTree(tree, "en");
    expect(en[0].name).toBe("Chen Yu");
    expect(en[0].department).toBe("Management");
    expect(en[0].children[0].name).toBe("Huang Wei");
    expect(en[0].children[0].title).toBe("Senior Product Manager");
  });

  it("按 id 标注 isCurrentUser（不再依赖人名比较）", () => {
    const en = localizeOrgTree(tree, "en", new Set(["me"]));
    expect(en[0].isCurrentUser).toBe(false);
    expect(en[0].children[0].isCurrentUser).toBe(true);
  });

  it("不修改输入对象", () => {
    localizeOrgTree(tree, "en", new Set(["me"]));
    expect(tree[0].name).toBe("陈宇");
    expect(tree[0].children[0].name).toBe("黄薇");
  });
});

describe("kbGlossary — 与演示 fixture 共用同一套罗马化", () => {
  it("SHARED_ZH_EN 覆盖人名/部门/职位", () => {
    expect(SHARED_ZH_EN["罗茜"]).toBe("Luo Xi");
    expect(SHARED_ZH_EN["技术部"]).toBe("Engineering");
    expect(SHARED_ZH_EN["市场总监"]).toBe("Marketing Director");
  });
});
