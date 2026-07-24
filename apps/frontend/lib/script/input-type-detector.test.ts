import { describe, expect, it } from "vitest";
import { detectInputType } from "./input-type-detector";

describe("detectInputType", () => {
  it("prioritizes explicit storyboard markers over category keywords", () => {
    expect(detectInputType("[镜头 12]\nMV music video commercial")).toBe("详细分镜脚本");
    expect(detectInputType("**第一个镜头：码头夜景**\n宣传片")).toBe("详细分镜脚本");
  });

  it.each([
    ["为新歌设计一个 music video", "MV概念"],
    ["品牌新品广告 brief", "广告简报"],
    ["电影 trailer 脚本", "预告片脚本"],
    ["抖音 reels 短视频创意", "短视频创意"],
  ])("classifies keyword input %#", (input, expected) => {
    expect(detectInputType(input)).toBe(expected);
  });

  it("uses nonblank line count and length thresholds for generic input", () => {
    expect(detectInputType("一句话创意")).toBe("一句话创意");
    expect(detectInputType(["开端", "", "发展", "转折", "结尾"].join("\n"))).toBe("故事大纲");
    expect(detectInputType(Array.from({ length: 11 }, (_, index) => `段落${index + 1}`).join("\n"))).toBe("详细故事描述");
  });
});
