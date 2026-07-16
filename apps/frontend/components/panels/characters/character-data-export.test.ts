import { describe, expect, it } from "vitest";
import { buildCharacterDataText } from "./character-data-export";

describe("character data export", () => {
  it("preserves every populated export section in the existing display order", () => {
    const text = buildCharacterDataText({
      name: "沈砚",
      gender: "male",
      age: "adult",
      personality: "克制",
      description: "一名行走江湖的剑客。",
      identityAnchors: {
        faceShape: "长",
        jawline: "分明",
        cheekbones: "高",
        eyeShape: "凤眼",
        eyeDetails: "眼尾上挑",
        noseShape: "直鼻",
        lipShape: "薄唇",
        uniqueMarks: ["眉间剑痕"],
        colorAnchors: { iris: "褐色", hair: "黑色", skin: "小麦色", lips: "淡红" },
        skinTexture: "风霜纹理",
        hairStyle: "高束发",
        hairlineDetails: "额前碎发",
      },
      charNegativePrompt: { avoid: ["模糊"], styleExclusions: ["卡通"] },
      visualPromptEn: "stoic swordsman",
      visualPromptZh: "冷峻剑客",
      isManuallyModified: true,
      storyYear: 1990,
      era: "现代",
      styleId: "2d_animation",
      referenceImageCount: 2,
      selectedElements: ["three-view", "expressions"],
    });

    expect(text).toContain("角色名称: 沈砚");
    expect(text).toContain("性别: 男");
    expect(text).toContain("年龄段: 中年");
    expect(text).toContain("性格特征: 克制");
    expect(text).toContain("角色描述:\n一名行走江湖的剑客。");
    expect(text).toContain("AI 校准信息: 已修改");
    expect(text).toContain("① 骨相层: 长, 分明, 高");
    expect(text).toContain("② 五官层: 凤眼, 眼尾上挑, 直鼻, 薄唇");
    expect(text).toContain("③ 辨识标记层: 眉间剑痕");
    expect(text).toContain("④ 色彩锚点层: 瞳色:褐色, 发色:黑色, 肤色:小麦色, 唇色:淡红");
    expect(text).toContain("⑤ 皮肤纹理层: 风霜纹理");
    expect(text).toContain("⑥ 发型锚点层: 高束发, 额前碎发");
    expect(text).toContain("避免: 模糊");
    expect(text).toContain("风格排除: 卡通");
    expect(text).toContain("EN: stoic swordsman");
    expect(text).toContain("ZH: 冷峻剑客");
    expect(text).toContain("故事年份: 1990年");
    expect(text).toContain("时代背景: 现代");
    expect(text).toContain("视觉风格: 2D动画");
    expect(text).toContain("风格提示词:");
    expect(text).toContain("参考图片: 2 张");
    expect(text).toContain("生成内容: 三视图, 表情设定");
    expect(text).toContain("内容提示词: front view, side view, back view, turnaround, expression sheet");
  });

  it("keeps the basic and style sections when optional data is absent", () => {
    const text = buildCharacterDataText({
      name: "",
      gender: "unknown",
      age: "unknown",
      personality: "",
      description: "",
      isManuallyModified: false,
      styleId: "missing-style",
      referenceImageCount: 0,
      selectedElements: [],
    });

    expect(text).toBe("角色名称: (未填写)\n\n视觉风格: missing-style");
    expect(text).not.toContain("AI 校准信息");
    expect(text).not.toContain("参考图片");
  });

  it("filters an unknown sheet element without changing valid exported content", () => {
    const text = buildCharacterDataText({
      name: "阿岚",
      gender: "female",
      age: "teen",
      personality: "",
      description: "测试",
      isManuallyModified: false,
      styleId: "",
      referenceImageCount: 0,
      selectedElements: ["poses", "unknown" as never],
    });

    expect(text).toContain("生成内容: 动作设定");
    expect(text).toContain("内容提示词: pose sheet, various action poses, standing, sitting, running");
    expect(text).not.toContain("unknown");
  });
});
