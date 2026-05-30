import { describe, expect, it } from "vitest";
import { buildSeriesBible, formatSeriesBibleSummary } from "./series-bible";

describe("studio series bible build", () => {
  it("locks character appearance/voice, scene names, manuals, aspect ratio and style positioning from config + libraries", () => {
    const bible = buildSeriesBible({
      projectId: "proj-1",
      characters: [
        { id: "char-001", appearance: "玄色长袍束发冷面", voiceId: "voice-a" },
        { id: "char-002", description: "少女桃红衫" }, // 无 appearance → 回退 description；无 voiceId → null
      ],
      scenes: [{ name: "客栈大堂" }, { name: "后山竹林" }],
      config: {
        visualManualId: "daojie_ink_guofeng",
        directorManualId: "Daojie_xianxia",
        platformSpec: "9:16",
        stylePositioning: "高级国风武侠短剧",
      },
    });

    expect(bible.projectId).toBe("proj-1");
    expect(bible.characterLocks).toEqual([
      { characterId: "char-001", appearance: "玄色长袍束发冷面", voiceId: "voice-a" },
      { characterId: "char-002", appearance: "少女桃红衫", voiceId: null },
    ]);
    expect(bible.sceneLocks).toEqual(["客栈大堂", "后山竹林"]);
    expect(bible.visualManualId).toBe("daojie_ink_guofeng");
    expect(bible.directorManualId).toBe("Daojie_xianxia");
    expect(bible.aspectRatio).toBe("9:16");
    expect(bible.stylePositioning).toBe("高级国风武侠短剧");
  });

  it("defaults aspect ratio to vertical 9:16 when platformSpec missing", () => {
    const bible = buildSeriesBible({
      projectId: "p",
      characters: [],
      scenes: [],
      config: {},
    });
    expect(bible.aspectRatio).toBe("9:16");
    expect(bible.characterLocks).toEqual([]);
    expect(bible.sceneLocks).toEqual([]);
  });
});

describe("studio series bible summary", () => {
  it("renders a global-injection block listing locked appearances, scenes, aspect ratio and style", () => {
    const summary = formatSeriesBibleSummary({
      id: "series-bible-proj-1",
      projectId: "proj-1",
      characterLocks: [
        { characterId: "char-001", appearance: "玄色长袍束发冷面", voiceId: "voice-a" },
      ],
      sceneLocks: ["客栈大堂"],
      visualManualId: "daojie_ink_guofeng",
      directorManualId: "Daojie_xianxia",
      aspectRatio: "9:16",
      stylePositioning: "高级国风武侠短剧",
    });

    expect(summary).toContain("剧集圣经");
    expect(summary).toContain("玄色长袍束发冷面");
    expect(summary).toContain("客栈大堂");
    expect(summary).toContain("9:16");
    expect(summary).toContain("高级国风武侠短剧");
  });

  it("returns empty string for null bible so context injection can skip cleanly", () => {
    expect(formatSeriesBibleSummary(null)).toBe("");
  });
});
