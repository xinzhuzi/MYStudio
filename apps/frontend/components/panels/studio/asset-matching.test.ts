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

  it("matches aliases with the existing library-name comparison behavior", () => {
    expect(nameMatches("青衣少年", "沈青岚", ["沈·青岚"])).toBe(true);
    expect(nameMatches("青衣少年", "沈青岚", ["道口镇"])).toBe(false);
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
});
