import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildShotColorMoodLine,
  buildStoryboardFactionColorSection,
  chapterFactionTemperature,
  classifyFactionPaletteTemperature,
  dominantChapterFaction,
} from "./storyboard-frame-prompt";

// 1116 换线正典(PRD 11-16-storyboard-canonical-line §4.4):帧装配路(模板解析/
// 选型/【画面】+【构图】装配/行进镜与人数自适应/画外音过滤)随旧链退役,对应
// describe 移除;保留件=色彩/温感工具(正典主体句落点色锚来源+成片调色冲突
// 检测/章自动成片消费面)。

describe("storyboard faction color section", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 晏燎: "万劫圣宗", 金水河码头: "人族", 赵四: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金", scene: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("maps scene and person names to their faction tracks", () => {
    const section = buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"] },
      faction,
    );
    expect(section).toContain("(万劫圣宗·人物)底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金");
    expect(section).toContain("(人族·场景)底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄");
    expect(section.startsWith("【色彩】阵营色彩职责")).toBe(true);
  });

  it("returns empty for unknown names or empty data (fail-empty)", () => {
    expect(buildStoryboardFactionColorSection({ sceneNames: ["无名之地"] }, faction)).toBe("");
    expect(buildStoryboardFactionColorSection({ personNames: ["独孤剑尘"] }, { members: {}, palette: {} })).toBe("");
  });

  it("resolves compound asset names by splitting on semicolons (08-28 无色根修)", () => {
    // 复合资产标题「李先生;管事」「监工赵四;赵四」须按分号拆段命中阵营表单名
    const section = buildStoryboardFactionColorSection(
      { personNames: ["李先生;管事", "监工赵四;赵四"] },
      { ...faction, members: { ...faction.members, 管事: "人族", 监工赵四: "人族", 赵四: "人族" } },
    );
    expect(section).toContain("(人族·人物)");
    expect(section).not.toContain("万劫圣宗");
  });
  it("defaults prop faction color to not_applicable and only injects for explicit applicable prop-focused input", () => {
    const withProp = { ...faction, palette: { ...faction.palette, 万劫圣宗: { ...faction.palette.万劫圣宗, prop: "底色宣纸白+墨线浓墨+主色铁灰+辅色银灰+点睛旧金" } } };
    // 未提供道具名 → 无道具轨输出(不为三轨齐全无条件补齐)
    expect(buildStoryboardFactionColorSection(
      { sceneNames: ["金水河码头"], personNames: ["独孤剑尘"] },
      withProp,
    )).not.toContain("道具");
    // 仅有道具名仍是默认 not_applicable;不得因参考资产存在就自动开启 prop 色。
    expect(buildStoryboardFactionColorSection(
      { propNames: ["戒律碑"] },
      { ...withProp, members: { ...withProp.members, 戒律碑: "万劫圣宗" } },
    )).not.toContain("道具");
    // 明确的 prop-focused + applicable 规则才允许注入。(阵营·道具)为弱倾向配方。
    const section = buildStoryboardFactionColorSection(
      {
        sceneNames: ["金水河码头"],
        personNames: ["独孤剑尘"],
        propNames: ["戒律碑"],
        propFactionColorApplicability: "applicable",
        propFocus: true,
      },
      { ...withProp, members: { ...withProp.members, 戒律碑: "万劫圣宗" } },
    );
    expect(section).toContain("(万劫圣宗·道具)底色宣纸白");
    // 源码层声明条件注入政策(合同声明与实现互锁)
    const source = readFileSync(new URL("./storyboard-frame-prompt.ts", import.meta.url), "utf8");
    expect(source).toContain("not_applicable");
  });
});

describe("buildShotColorMoodLine (08-28 两套色彩系统衔接)", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 晏燎: "万劫圣宗", 金水河码头: "人族", 赵四: "人族", 管事: "人族", 李先生: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛旧金", scene: "底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("人物轨=visibleCharacterNames;assetNames 中的角色名不重复进场景轨", () => {
    const line = buildShotColorMoodLine(
      { assetNames: ["金水河码头", "独孤剑尘"], visibleCharacterNames: ["独孤剑尘"] },
      faction,
    );
    expect(line).toContain("(万劫圣宗·人物)主色铁灰+辅色烟紫+点睛旧金");
    expect(line).toContain("(人族·场景)主色赭石+辅色栗褐+点睛藤黄");
    // 紧凑三职责:底色/墨线零区分度不进锚(08-28 蓝图紧凑口径)
    expect(line).not.toContain("底色");
    expect(line).not.toContain("墨线");
    // 紧凑串不带【色彩】段头
    expect(line.startsWith("【色彩】")).toBe(false);
  });

  it("复合名按分号拆段:人物段的分段同时挡掉 assetNames 同名段(互斥)", () => {
    const line = buildShotColorMoodLine(
      { assetNames: ["金水河码头;管事"], visibleCharacterNames: ["李先生;管事"] },
      faction,
    );
    expect(line).toContain("(人族·人物)");
    // 「管事」已按人物轨命中,复合场景名里的同名段不得再走场景轨
    expect(line).not.toContain("(人族·场景)");
  });

  it("纯场景(无可见角色)只出场景轨", () => {
    expect(buildShotColorMoodLine({ assetNames: ["金水河码头"] }, faction))
      .toBe("(人族·场景)主色赭石+辅色栗褐+点睛藤黄");
  });

  it("无命中/数据未预热 → 空串(fail-empty,prompt 零变化)", () => {
    expect(buildShotColorMoodLine({ assetNames: ["无名之地"] }, faction)).toBe("");
    expect(buildShotColorMoodLine(
      { assetNames: ["金水河码头"], visibleCharacterNames: ["独孤剑尘"] },
      { members: {}, palette: {} },
    )).toBe("");
  });
});

describe("classifyFactionPaletteTemperature (温感关键词投票)", () => {
  it("人族盘(主色赭石+点睛藤黄/朱红)=warm", () => {
    expect(classifyFactionPaletteTemperature([
      "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红",
      "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄",
    ])).toBe("warm");
  });

  it("冷词盘(靛蓝/黛青/碧)=cool", () => {
    expect(classifyFactionPaletteTemperature([
      "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛石青",
      "底色雪灰+墨线浓墨+主色黛青+辅色天青+点睛碧",
    ])).toBe("cool");
  });

  it("万劫圣宗新盘(靛蓝+朱砂+石青+赭石 各半)=neutral(平票)", () => {
    expect(classifyFactionPaletteTemperature([
      "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛朱砂",
      "底色雪灰+墨线浓墨+主色石青+辅色黛蓝+点睛赭石",
    ])).toBe("neutral");
  });

  it("零票(灰/紫/黑白不计)=neutral;辅色段不参与投票", () => {
    expect(classifyFactionPaletteTemperature(["底色雪灰+墨线浓墨+主色铁灰+辅色烟紫+点睛银灰"])).toBe("neutral");
    // 辅色烟紫不计票;主色靛蓝单票即 cool
    expect(classifyFactionPaletteTemperature(["主色靛蓝+辅色藤黄"])).toBe("cool");
  });
});

describe("dominantChapterFaction / chapterFactionTemperature", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 金水河码头: "人族", 赵四: "人族" },
    palette: {
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛朱砂", scene: "底色雪灰+墨线浓墨+主色石青+辅色黛蓝+点睛赭石" },
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };

  it("主导阵营=逐镜命中阵营的众数(每镜每阵营至多一票)", () => {
    const shots = [
      { associateAssetsNames: ["金水河码头", "赵四"] },
      { associateAssetsNames: ["金水河码头"] },
      { associateAssetsNames: ["独孤剑尘"] },
    ];
    expect(dominantChapterFaction(shots, faction)).toBe("人族");
  });

  it("无分镜/无命中 → undefined(fail-safe)", () => {
    expect(dominantChapterFaction([], faction)).toBeUndefined();
    expect(dominantChapterFaction([{ associateAssetsNames: ["无名之地"] }], faction)).toBeUndefined();
  });

  it("人族主导章温感=warm;万劫圣宗新盘主导(平票)=neutral", () => {
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["金水河码头"] }, { associateAssetsNames: ["金水河码头", "赵四"] }],
      faction,
    )).toEqual({ faction: "人族", temperature: "warm" });
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["独孤剑尘"] }, { associateAssetsNames: ["独孤剑尘"] }],
      faction,
    )).toEqual({ faction: "万劫圣宗", temperature: "neutral" });
  });

  it("数据未预热 → neutral 不带阵营(永不误报)", () => {
    expect(chapterFactionTemperature(
      [{ associateAssetsNames: ["金水河码头"] }],
      { members: {}, palette: {} },
    )).toEqual({ temperature: "neutral" });
  });
});
