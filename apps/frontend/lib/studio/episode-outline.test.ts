import { describe, expect, it } from "vitest";
import {
  buildEpisodeOutlineMessages,
  parseEpisodeOutline,
} from "./episode-outline";

describe("studio episode outline parsing", () => {
  it("merges <episodeOutline> segments, parses 4-col beats, skips header/separator/illegal rows", () => {
    const output = [
      "<episodeOutline>",
      "| 场次序号 | 地点 | beat内容 | 预估时长秒 |",
      "| --- | --- | --- | --- |",
      "| 1 | 客栈大堂 | 林逸推门而入，环视众人后径直走向柜台 | 40 |",
      "</episodeOutline>",
      "<episodeOutline>",
      "| 2 | 后山竹林 | 白衣人现身递出密信，林逸拆信脸色骤变 | 50 |",
      "| 缺列行 | 只有两列 |",
      "</episodeOutline>",
    ].join("\n");

    const { outline, errors } = parseEpisodeOutline(output, "ep1");

    expect(outline.episodeId).toBe("ep1");
    expect(outline.beats).toHaveLength(2);
    expect(outline.beats[0]).toMatchObject({
      sceneIndex: 1,
      location: "客栈大堂",
      durationSec: 40,
    });
    expect(outline.beats[0]?.beat).toContain("径直走向柜台");
    expect(outline.beats[1]?.sceneIndex).toBe(2);
    expect(outline.beats[1]?.durationSec).toBe(50);
    expect(errors).toHaveLength(1);
  });

  it("strips lighting/color-temperature words from beat content and warns (§2.4)", () => {
    const output = [
      "<episodeOutline>",
      "| 1 | 雨夜街口 | 逆光下身影伫立，暖光自窗内透出，他缓步上前 | 45 |",
      "</episodeOutline>",
    ].join("\n");

    const { outline, warnings } = parseEpisodeOutline(output, "ep1");
    expect(outline.beats[0]?.beat).not.toMatch(/逆光|暖光/);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("studio episode outline messages", () => {
  it("injects the outline skill and embeds skeleton/strategy context", () => {
    const messages = buildEpisodeOutlineMessages({
      episodeId: "ep1",
      skeletonContext: "三幕：缺页悬案→层层追查→真相反转",
      strategyContext: "删支线，强化主角主动性",
    });
    expect(messages.system).toContain("分集细纲");
    expect(messages.user).toContain("缺页悬案");
    expect(messages.user).toContain("强化主角主动性");
  });
});
