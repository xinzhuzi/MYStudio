import { describe, expect, it } from "vitest";
import type { EpisodeRawScript } from "@/types/script";
import { extractEpisodeSummary, isMissingTitle } from "./episode-calibration-utils";

describe("episode calibration utils", () => {
  it("recognizes blank and number-only episode titles", () => {
    expect(isMissingTitle("")).toBe(true);
    expect(isMissingTitle("第十二集")).toBe(true);
    expect(isMissingTitle("第12集 夜雨")).toBe(false);
  });

  it("builds the established bounded summary from the first three scenes", () => {
    const episode = {
      scenes: [{
        sceneHeader: "旧书房 夜 内",
        dialogues: [{ character: "独孤剑尘", line: "风从破窗吹进来。" }],
        actions: ["他按住桌上的旧信，听见门外脚步声。"],
      }],
    } as EpisodeRawScript;
    expect(extractEpisodeSummary(episode)).toBe([
      "场景：旧书房 夜 内",
      "独孤剑尘：风从破窗吹进来。",
      "他按住桌上的旧信，听见门外脚步声。",
    ].join("\n"));
  });

  it("keeps the empty-content fallback", () => {
    expect(extractEpisodeSummary({ scenes: [] } as unknown as EpisodeRawScript)).toBe("（无内容）");
  });
});
