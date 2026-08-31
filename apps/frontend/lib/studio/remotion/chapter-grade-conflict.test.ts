import { describe, expect, it } from "vitest";
import { detectChapterGradeTemperatureConflict } from "./chapter-grade-conflict";

// 08-28 两套色彩系统衔接:钉死成片调色卡与本章主导阵营盘温感反向 → 非阻塞提示。
// 一切数据缺席(未钉死/legacy 卡/neutral/未预热/无分镜)都必须 undefined,永不误报。
describe("detectChapterGradeTemperatureConflict", () => {
  const faction = {
    members: { 独孤剑尘: "万劫圣宗", 晏燎: "万劫圣宗", 金水河码头: "人族", 赵四: "人族" },
    palette: {
      // 万劫圣宗新盘:2 暖 2 冷 → neutral
      万劫圣宗: { person: "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛朱砂", scene: "底色雪灰+墨线浓墨+主色石青+辅色黛蓝+点睛赭石" },
      // 人族盘:主色赭石+点睛朱红/藤黄 → warm
      人族: { person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红", scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄" },
    },
  };
  const warmShots = [
    { associateAssetsNames: ["金水河码头", "赵四"] },
    { associateAssetsNames: ["金水河码头"] },
  ];
  const coolDominantShots = [
    { associateAssetsNames: ["独孤剑尘"] },
    { associateAssetsNames: ["独孤剑尘", "晏燎"] },
  ];

  it("钉冷卡(cn-daiqing)+人族暖主导 → 冲突详情与文案", () => {
    const conflict = detectChapterGradeTemperatureConflict("cn-daiqing", warmShots, faction);
    expect(conflict).toBeDefined();
    expect(conflict!.faction).toBe("人族");
    expect(conflict!.factionTemperature).toBe("warm");
    expect(conflict!.lutTemperature).toBe("cool");
    expect(conflict!.lutName).toBe("黛青");
    expect(conflict!.factionColorNames).toEqual(["赭石", "朱红", "藤黄"]);
    expect(conflict!.message).toContain("本章画面主色偏暖（人族·赭石/朱红/藤黄）");
    expect(conflict!.message).toContain("所选成片调色卡偏冷（黛青）");
    expect(conflict!.message).toContain("建议换暖调卡或调低强度");
  });

  it("钉暖卡(cn-tenghuang)+冷主导章(青蓝系阵营) → 冲突(反向同理)", () => {
    const coolFaction = {
      members: faction.members,
      palette: {
        ...faction.palette,
        万劫圣宗: { person: "底色雪灰+墨线浓墨+主色靛蓝+辅色烟紫+点睛石青", scene: "底色雪灰+墨线浓墨+主色黛青+辅色天青+点睛碧" },
      },
    };
    const conflict = detectChapterGradeTemperatureConflict("cn-tenghuang", coolDominantShots, coolFaction);
    expect(conflict).toBeDefined();
    expect(conflict!.factionTemperature).toBe("cool");
    expect(conflict!.lutTemperature).toBe("warm");
    expect(conflict!.message).toContain("偏冷");
    expect(conflict!.message).toContain("建议换冷调卡");
  });

  it("同向(暖卡+暖主导)不提示", () => {
    expect(detectChapterGradeTemperatureConflict("cn-tenghuang", warmShots, faction)).toBeUndefined();
  });

  it("neutral 卡 / film-* legacy 卡 / 未钉死 不提示", () => {
    expect(detectChapterGradeTemperatureConflict("cn-shuimo", warmShots, faction)).toBeUndefined();
    expect(detectChapterGradeTemperatureConflict("film-fuji-cool", warmShots, faction)).toBeUndefined();
    expect(detectChapterGradeTemperatureConflict(undefined, warmShots, faction)).toBeUndefined();
  });

  it("主导阵营盘 neutral(万劫圣宗新盘平票)不提示", () => {
    expect(detectChapterGradeTemperatureConflict("cn-daiqing", coolDominantShots, faction)).toBeUndefined();
  });

  it("数据未预热(空阵营表)/无分镜 不提示(fail-safe)", () => {
    expect(detectChapterGradeTemperatureConflict("cn-daiqing", warmShots, { members: {}, palette: {} })).toBeUndefined();
    expect(detectChapterGradeTemperatureConflict("cn-daiqing", [], faction)).toBeUndefined();
  });
});
