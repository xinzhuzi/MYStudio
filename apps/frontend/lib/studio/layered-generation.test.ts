import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PLATE_NEGATIVE_ANCHORS,
  MATTE_KEY_COLOR,
  SUBJECT_CUTOUT_NEGATIVE_ANCHORS,
  buildBackgroundPlatePrompt,
  buildSubjectCutoutPrompt,
  chapterLayerProductDir,
  matteSolidBackground,
  opaqueRatio,
} from "./layered-generation";

describe("layered-generation 提示词变体(08-19 multilayer Child3)", () => {
  it("背景板变体:去人物表述+保留场景约束,含【背景板】标记", () => {
    const prompt = buildBackgroundPlatePrompt("山崖边,白衣少女持剑而立,身后云海翻涌,晨光逆照");
    expect(prompt).toContain("【背景板】");
    expect(prompt).toContain("不出现任何人物");
    expect(prompt).toContain("光照方向");
    expect(prompt).not.toContain("少女持剑");
  });

  it("人物净底变体:角色描述+纯绿幕+姿态参照", () => {
    const prompt = buildSubjectCutoutPrompt("少女在山崖边持剑回望", "晏清霜:白衣剑修,青丝束发");
    expect(prompt).toContain("【人物净底图】");
    expect(prompt).toContain("#00b140");
    expect(prompt).toContain("晏清霜");
    expect(prompt).toContain("少女在山崖边持剑回望");
  });

  it("负向词锚与渲染约定路径", () => {
    expect(BACKGROUND_PLATE_NEGATIVE_ANCHORS).toContain("人物剪影");
    expect(SUBJECT_CUTOUT_NEGATIVE_ANCHORS).toContain("复杂背景");
    expect(chapterLayerProductDir("/p/remotion", "chapter-001", "clip-9"))
      .toBe("/p/remotion/layers/chapter-001/clip-9");
  });
});

describe("matteSolidBackground 色键抠底(纯函数)", () => {
  it("键色→透明;远离键色→不透明;已透明→保持", () => {
    const pixels = new Uint8ClampedArray([
      ...MATTE_KEY_COLOR, 255,        // 键色
      255, 244, 218, 255,            // 暖白(远离)
      0, 0, 0, 0,                    // 已透明
    ]);
    const out = matteSolidBackground(pixels);
    expect(out[3]).toBe(0);                 // 键色透明
    expect(out[7]).toBe(255);               // 主体不透明
    expect(out[11]).toBe(0);                // 原透明保持
    expect(out[0]).toBe(MATTE_KEY_COLOR[0]); // RGB 保留
  });

  it("过渡带半透:近键色像素 alpha 介于 0..255", () => {
    // 键色邻域但落在容差带外(dr110/dg-10/db10→distSq 12300,介于 9216 与过渡带沿)
    const near = [110, MATTE_KEY_COLOR[1] - 10, MATTE_KEY_COLOR[2] + 10];
    const out = matteSolidBackground(new Uint8ClampedArray([...near, 255]));
    expect(out[3]).toBeGreaterThan(0);
    expect(out[3]).toBeLessThan(255);
  });

  it("opaqueRatio 健康带判定:全键色≈0,全主体=1", () => {
    const allKey = new Uint8ClampedArray(4 * 10);
    for (let i = 0; i < allKey.length; i += 4) {
      allKey[i] = MATTE_KEY_COLOR[0]!; allKey[i + 1] = MATTE_KEY_COLOR[1]!; allKey[i + 2] = MATTE_KEY_COLOR[2]!; allKey[i + 3] = 255;
    }
    expect(opaqueRatio(matteSolidBackground(allKey))).toBeLessThan(0.05);
    const allBody = new Uint8ClampedArray(4 * 10).fill(200);
    for (let i = 3; i < allBody.length; i += 4) allBody[i] = 255;
    expect(opaqueRatio(matteSolidBackground(allBody))).toBe(1);
  });
});
