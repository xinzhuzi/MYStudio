import { describe, expect, it } from "vitest";
import { normalizeScriptData, normalizeTimeValue } from "./script-data-normalizer";

describe("normalizeTimeValue", () => {
  it("normalizes Chinese and English time aliases with day fallback", () => {
    expect(normalizeTimeValue("夜间")).toBe("night");
    expect(normalizeTimeValue("日落")).toBe("dusk");
    expect(normalizeTimeValue("DUSK")).toBe("dusk");
    expect(normalizeTimeValue("未知")).toBe("day");
    expect(normalizeTimeValue(undefined)).toBe("day");
  });
});

describe("normalizeScriptData", () => {
  it("fills stable defaults for loose script data", () => {
    const result = normalizeScriptData({
      title: "测试剧本",
      scenes: [
        { location: "码头", time: "深夜" },
        { id: "scene-custom", name: "客栈", location: "客栈", time: "清晨" },
      ],
      characters: [{ name: "甲" }, {}],
    });

    expect(result.title).toBe("测试剧本");
    expect(result.scenes.map(({ id, name, time }) => [id, name, time])).toEqual([
      ["scene_1", "码头", "midnight"],
      ["scene-custom", "客栈", "dawn"],
    ]);
    expect(result.characters.map(({ id, name, tags, notes }) => [id, name, tags, notes])).toEqual([
      ["char_1", "甲", [], ""],
      ["char_2", "角色2", [], ""],
    ]);
  });

  it("creates a default episode that owns every scene when episodes are absent", () => {
    const result = normalizeScriptData({
      title: "孤章",
      logline: "一句话简介",
      scenes: [{ id: "s1", location: "山门" }, { id: "s2", location: "内殿" }],
    });

    expect(result.episodes).toEqual([
      {
        id: "ep_1",
        index: 1,
        title: "孤章",
        description: "一句话简介",
        sceneIds: ["s1", "s2"],
      },
    ]);
  });

  it("appends unassigned scenes to the last existing episode", () => {
    const result = normalizeScriptData({
      scenes: [
        { id: "s1", location: "山门" },
        { id: "s2", location: "内殿" },
        { id: "s3", location: "密室" },
      ],
      episodes: [
        { id: "ep-a", index: 1, title: "开端", sceneIds: ["s1"] },
        { id: "ep-b", index: 2, title: "深入", sceneIds: [] },
      ],
    });

    expect(result.episodes.map(({ id, sceneIds }) => [id, sceneIds])).toEqual([
      ["ep-a", ["s1"]],
      ["ep-b", ["s2", "s3"]],
    ]);
  });
});
