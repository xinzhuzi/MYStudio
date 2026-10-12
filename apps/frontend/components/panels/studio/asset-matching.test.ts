import { describe, expect, it } from "vitest";
import {
  assetRecordMatches,
  descMatches,
  isGenericNPC,
  nameMatches,
  normalizeAssetText,
} from "./asset-matching";

describe("asset matching", () => {
  it("normalizes punctuation and matches names by containment", () => {
    expect(normalizeAssetText(" 沈·青岚（少年） ")).toBe("沈青岚少年");
    expect(nameMatches("沈青岚", "沈·青岚")).toBe(true);
    expect(nameMatches("道口镇夜市", "道口镇")).toBe(true);
  });

  it("matches aliases against the extracted name, not the library name", () => {
    // 1013 修 RC-6①:旧断言 nameMatches("青衣少年","沈青岚",["沈·青岚"])===true
    // 锁定的正是别名层 bug 行为(靠 an===ln 通过,提取名与别名无字面关系)——
    // 修复后别名层=提取名 vs 别名,按新语义重写
    expect(nameMatches("铁山", "断臂散修", ["铁山"])).toBe(true);
    expect(nameMatches("青衣少年", "沈青岚", ["青衣少年"])).toBe(true);
    expect(nameMatches("青衣少年", "沈青岚", ["道口镇"])).toBe(false);
    // 别名是主名子串(赵四⊂监工赵四)不再让任意提取名恒命中(批次错绑根源)
    expect(nameMatches("客栈", "监工赵四", ["赵四"])).toBe(false);
    // 提取名包含别名(老苦力⊃苦力)仍命中——别名层保留包含语义
    expect(nameMatches("老苦力", "年轻苦力", ["苦力"])).toBe(true);
  });

  it("matches descriptions when enough extracted note keywords appear", () => {
    expect(descMatches("雨夜、断剑、冷光", "雨夜巷口有冷光和断剑")).toBe(true);
    expect(descMatches("雨夜、断剑、冷光", "雨夜巷口")).toBe(false);
  });

  it("detects generic NPC names for shared character fallback assets", () => {
    expect(isGenericNPC("孩童甲")).toBe(true);
    expect(isGenericNPC("守卫")).toBe(true);
    expect(isGenericNPC("沈青岚")).toBe(false);
  });

  it("finds local, center, description, and generic NPC fallback matches", () => {
    expect(
      assetRecordMatches({
        name: "沈青岚",
        localItems: [{ name: "沈·青岚", aliases: [], desc: "" }],
        centerItems: [],
      }),
    ).toBe(true);

    expect(
      assetRecordMatches({
        name: "道口镇",
        localItems: [],
        centerItems: [{ name: "道口镇夜市", desc: "" }],
      }),
    ).toBe(true);

    expect(
      assetRecordMatches({
        name: "断剑",
        note: "雨夜、断剑、冷光",
        localItems: [],
        centerItems: [{ name: "旧剑", desc: "雨夜巷口有冷光和断剑" }],
      }),
    ).toBe(true);

    expect(
      assetRecordMatches({
        name: "孩童甲",
        localItems: [],
        centerItems: [{ name: "全体NPC", desc: "" }],
        fallbackGeneric: true,
      }),
    ).toBe(true);

    expect(
      assetRecordMatches({
        name: "不存在",
        localItems: [],
        centerItems: [],
      }),
    ).toBe(false);
  });

  it("assetRecordMatches honors non-empty aliases via the extracted-name comparison", () => {
    // 1013 修 RC-6①定向:别名通道命中靠「提取名 vs 别名」(铁山===别名铁山)
    expect(
      assetRecordMatches({
        name: "铁山",
        localItems: [{ name: "断臂散修", aliases: ["铁山"], desc: "断臂老修士" }],
        centerItems: [],
      }),
    ).toBe(true);
    // 别名是主名子串(赵四⊂监工赵四)不再对无关提取名(客栈)恒命中
    expect(
      assetRecordMatches({
        name: "客栈",
        localItems: [{ name: "监工赵四", aliases: ["赵四"], desc: "" }],
        centerItems: [],
      }),
    ).toBe(false);
  });
});
