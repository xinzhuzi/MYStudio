import { describe, expect, it } from "vitest";
import {
  buildDirectorPlanMessages,
  parseDirectorPlan,
  detectLightingTerms,
  stripLightingTerms,
} from "./director-plan";

describe("studio director plan — lighting separation (§2.4)", () => {
  it("detects and strips light/color-temperature words", () => {
    const text = "中景正反打，暖光从逆光方向打来，色温偏冷，人物靠向椅背";
    const found = detectLightingTerms(text);
    expect(found).toContain("暖光");
    expect(found).toContain("逆光");
    expect(found).toContain("色温");

    const cleaned = stripLightingTerms(text);
    expect(cleaned).not.toMatch(/暖光|逆光|色温/);
    expect(cleaned).toContain("中景正反打");
    expect(cleaned).toContain("靠向椅背");
  });
});

describe("studio director plan parsing", () => {
  it("merges multiple <scriptPlan> segments, maps sections to prose fields, parses ⑦ table to derivedAssetPlan, collects lighting warnings", () => {
    const output = [
      "好的，以下是规划：",
      "<scriptPlan>",
      "#### ① 主题立意与叙事核心",
      "核心主题：救赎。情感主线从愧疚到释怀。",
      "#### ② 视觉风格与画面基调",
      "对称构图传达压迫；缓推靠近角色内心；逆光轮廓登场。",
      "</scriptPlan>",
      "<scriptPlan>",
      "#### ③ 叙事结构与节奏规划",
      "原著保真型，按场景边界划分，情绪曲线渐进。",
      "#### ⑤ 声音方向",
      "环境音：蝉鸣、溪水。关键瞬间留白。",
      "#### ⑥ 转场与视觉连续性",
      "同场硬切，场间空镜缓冲。锚点：服装状态一致。",
      "</scriptPlan>",
      "<scriptPlan>",
      "#### ⑦ 衍生资产预划清单",
      "| 资产名 | 衍生状态 | 原因/出现段落 |",
      "| --- | --- | --- |",
      "| 林逸 | 受伤带血 | 第3段决斗后多镜复用 |",
      "| 客栈大堂 | 夜景版 | Sc7 夜戏定场 |",
      "| | 缺名 | 非法行应跳过 |",
      "</scriptPlan>",
    ].join("\n");

    const { plan, warnings } = parseDirectorPlan(output, "episode-1");

    expect(plan.episodeId).toBe("episode-1");
    expect(plan.id).toBeTruthy();
    expect(plan.theme).toContain("救赎");
    expect(plan.visualStyle).toContain("对称构图");
    // lighting term in ② must be stripped from the stored field
    expect(plan.visualStyle).not.toContain("逆光");
    expect(plan.narrativeRhythm).toContain("原著保真型");
    expect(plan.soundDirection).toContain("蝉鸣");
    expect(plan.transitions).toContain("硬切");

    // ⑦ table → derivedAssetPlan (2 valid rows, illegal row skipped)
    expect(plan.derivedAssetPlan).toHaveLength(2);
    expect(plan.derivedAssetPlan[0]).toMatchObject({
      parentAssetId: "林逸",
      state: "受伤带血",
      reason: "第3段决斗后多镜复用",
    });
    expect(plan.derivedAssetPlan[1]).toMatchObject({
      parentAssetId: "客栈大堂",
      state: "夜景版",
    });

    // lighting warning surfaced
    expect(warnings.some((w) => w.includes("逆光"))).toBe(true);
  });

  it("returns empty derivedAssetPlan when the plan states no derivation is needed", () => {
    const output = [
      "<scriptPlan>",
      "#### ① 主题立意与叙事核心",
      "核心主题：日常。",
      "#### ⑦ 衍生资产预划清单",
      "无需衍生资产",
      "</scriptPlan>",
    ].join("\n");

    const { plan } = parseDirectorPlan(output, "ep1");
    expect(plan.theme).toContain("日常");
    expect(plan.derivedAssetPlan).toEqual([]);
  });
});

describe("studio director plan messages", () => {
  it("injects the director-plan skill content and embeds script text", () => {
    const messages = buildDirectorPlanMessages({
      episodeId: "ep1",
      scriptText: "林逸走进客栈大堂，掏出account账册。",
      manualContext: "## 视觉手册\n写意国风",
    });

    expect(messages.system).toContain("导演规划");
    expect(messages.system).toContain("写意国风");
    expect(messages.user).toContain("林逸走进客栈大堂");
  });
});
