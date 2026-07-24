import { describe, expect, it } from "vitest";
import type { Shot } from "@/types/script";
import { getShotSearchableText } from "./scene-shot-text";

function shot(overrides: Partial<Shot>): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneRefId: "scene-1",
    actionSummary: "",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
    ...overrides,
  };
}

describe("getShotSearchableText", () => {
  it("joins the viewpoint-search fields in their matching order", () => {
    expect(
      getShotSearchableText(
        shot({
          actionSummary: "推门进入",
          dialogue: "甲：小心",
          visualDescription: "窗边冷光",
          characterBlocking: "甲在门口，乙在窗边",
        }),
      ),
    ).toBe("推门进入 甲：小心 窗边冷光 甲在门口，乙在窗边");
  });

  it("preserves empty field positions without pulling unrelated shot metadata", () => {
    expect(
      getShotSearchableText(
        shot({
          actionSummary: "穿过码头",
          shotPurpose: "寻找线索",
          visualFocus: "远处船灯",
        }),
      ),
    ).toBe("穿过码头   ");
  });
});
