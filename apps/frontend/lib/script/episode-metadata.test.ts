import { describe, expect, it } from "vitest";
import {
  detectGenre,
  extractThemes,
  extractTimelineInfo,
  extractWorldSetting,
} from "./episode-metadata";

describe("episode metadata helpers", () => {
  it("extracts year ranges and lets concrete years classify the era", () => {
    expect(extractTimelineInfo("1990-2020年，城市商战横跨三十年。", "")).toEqual({
      era: "现代（新中国）",
      timelineSetting: "1990年 - 2020年",
      storyStartYear: 1990,
      storyEndYear: 2020,
    });
  });

  it("extracts a single year with season text and infers ancient settings from high-confidence terms", () => {
    expect(extractTimelineInfo("2022年夏天，县城青年回乡创业。", "")).toMatchObject({
      era: "现代",
      timelineSetting: "2022年夏天",
      storyStartYear: 2022,
    });

    expect(extractTimelineInfo("城主命太守封锁城门，王爷调来部将。", "")).toEqual({
      era: "古代",
      timelineSetting: undefined,
      storyStartYear: undefined,
      storyEndYear: undefined,
    });
  });

  it("detects genre by documented priority and returns empty for unknown input", () => {
    expect(detectGenre("江湖门派中有人修仙渡劫。", "")).toBe("武侠");
    expect(detectGenre("未来世界里，AI警察巡逻星际港口。", "")).toBe("科幻");
    expect(detectGenre("一段没有明显类型词的生活片段。", "")).toBe("");
  });

  it("extracts explicit world-setting text only when the configured pattern matches", () => {
    expect(extractWorldSetting(
      "世界观：灵气复苏后的沿海都市暗藏修仙门派与公司联盟。",
      "",
    )).toBe("灵气复苏后的沿海都市暗藏修仙门派与公司联盟。");

    expect(extractWorldSetting("普通人物介绍，没有世界观字段。", "")).toBe("");
  });

  it("extracts unique themes in priority order and limits the result to five", () => {
    expect(extractThemes(
      "主角逆袭后复仇，也面对爱情、亲情、兄弟义气、权谋、正义、自由。",
      "",
    )).toEqual(["奋斗", "复仇", "爱情", "亲情", "友情"]);
  });
});
