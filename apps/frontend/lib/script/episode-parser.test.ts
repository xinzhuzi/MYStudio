import { describe, expect, it } from "vitest";
import { parseFullScript } from "./episode-parser";

describe("parseFullScript metadata compatibility", () => {
  it("keeps defaults for unnamed scripts and parses outline to EOF", () => {
    const result = parseFullScript("大纲：这是一个关于成长与友情的故事");
    expect(result.background.title).toBe("未命名剧本");
    expect(result.background.outline).toBe("这是一个关于成长与友情的故事");
    expect(result.background.characterBios).toBe("");
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].episodeIndex).toBe(1);
  });

  it("uses character bios EOF fallback without an episode marker", () => {
    const result = parseFullScript("《测试》\n人物小传：\n张明：一个勇敢的孩子");
    expect(result.background.title).toBe("测试");
    expect(result.background.characterBios).toBe("张明：一个勇敢的孩子");
    expect(result.episodes[0].title).toBe("第一集");
  });
});
