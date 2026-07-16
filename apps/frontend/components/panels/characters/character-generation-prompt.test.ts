import { describe, expect, it } from "vitest";
import type { CharacterIdentityAnchors } from "@/types/script";
import {
  buildCharacterSheetPrompt,
  buildPromptFromAnchors,
} from "./character-generation-prompt";

const zhAnchors: CharacterIdentityAnchors = {
  faceShape: "椭圆",
  jawline: "锐利",
  cheekbones: "高",
  eyeShape: "杏仁",
  eyeDetails: "双眼皮",
  noseShape: "直鼻",
  lipShape: "厚唇",
  uniqueMarks: ["左眼下方小痣"],
  colorAnchors: { iris: "褐色", hair: "黑色", skin: "小麦色", lips: "朱红" },
  skinTexture: "细纹",
  hairStyle: "及肩",
  hairlineDetails: "美人尖",
};

describe("character generation prompt", () => {
  it("uses all six identity layers without references", () => {
    const prompt = buildPromptFromAnchors(zhAnchors, false, "zh");

    expect(prompt).toContain("椭圆脸，锐利下颌，高颧骨");
    expect(prompt).toContain("杏仁眼，双眼皮，直鼻，厚唇");
    expect(prompt).toContain("辨识标记：左眼下方小痣");
    expect(prompt).toContain("色彩锚点：瞳色褐色，发色黑色，肤色小麦色，唇色朱红");
    expect(prompt).toContain("皮肤纹理：细纹");
    expect(prompt).toContain("发型：及肩，美人尖");
  });

  it("keeps only strongest identity anchors when references exist", () => {
    const prompt = buildPromptFromAnchors(zhAnchors, true, "zh");

    expect(prompt).toContain("辨识标记：左眼下方小痣");
    expect(prompt).toContain("瞳色褐色，发色黑色，肤色小麦色");
    expect(prompt).not.toContain("椭圆脸");
    expect(prompt).not.toContain("发型：");
  });

  it("preserves English anchor wording and empty input behavior", () => {
    expect(buildPromptFromAnchors(undefined, false, "en")).toBe("");
    const prompt = buildPromptFromAnchors({
      faceShape: "oval",
      jawline: "sharp",
      eyeShape: "almond",
      uniqueMarks: ["mole"],
      colorAnchors: { iris: "brown", hair: "black" },
    }, false, "en");

    expect(prompt).toContain("oval face, sharp jawline");
    expect(prompt).toContain("almond eyes");
    expect(prompt).toContain("distinctive marks: mole");
    expect(prompt).toContain("color anchors: iris brown, hair black");
  });

  it("selects the requested visual language and keeps the white-background contract", () => {
    const zh = buildCharacterSheetPrompt("基础描述", "阿岚", ["three-view"], undefined, "English master", "中文大师", "zh");
    const en = buildCharacterSheetPrompt("base", "Alan", ["expressions"], undefined, "English master", "中文大师", "en");

    expect(zh).toContain("中文大师");
    expect(zh).not.toContain("English master");
    expect(en).toContain("English master");
    expect(en).not.toContain("中文大师");
    expect(zh).toContain("pure solid white background");
    expect(en).toContain("pure solid white background");
  });

  it("maps realistic sheet elements and era anchors without changing layout semantics", () => {
    const prompt = buildCharacterSheetPrompt(
      "侠客",
      "沈砚",
      ["three-view", "expressions"],
      "real_movie",
      undefined,
      undefined,
      "zh",
      undefined,
      false,
      1990,
    );

    expect(prompt).toContain("专业角色参考图");
    expect(prompt).toContain("1990年代中国时尚，转型期服饰");
    expect(prompt).toContain("multiple photographic angles");
    expect(prompt).toContain("collage of different facial expressions");
    expect(prompt).toContain("摄影角色参考图版式");
    expect(prompt).toContain("照片写实");
  });

  it("ignores unknown sheet elements while preserving the base prompt", () => {
    const prompt = buildCharacterSheetPrompt("勇敢剑士", "阿岚", ["unknown" as never], undefined, undefined, undefined, "zh", undefined, false, undefined, "民国");

    expect(prompt).toContain("勇敢剑士");
    expect(prompt).toContain("民国时期服饰风格");
    expect(prompt).toContain("pure solid white background");
  });
});
