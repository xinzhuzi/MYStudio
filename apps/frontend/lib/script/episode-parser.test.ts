import { describe, expect, it } from "vitest";
import { convertToScriptData, parseEpisodes, parseFullScript, parseScenes } from "./episode-parser";

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

describe("parseScenes characterization", () => {
  it("parses standard headers and content tokens", () => {
    const [scene] = parseScenes(
      "**1-1日 内 沪上 张家**\n人物：张明、张父\n张父：（低声）别怕。\n△窗外细雨落下\n【字幕：2002年夏】",
    );
    expect(scene.sceneHeader).toBe("1-1 日 内 沪上 张家");
    expect(scene.characters).toEqual(["张明", "张父", "人物"]);
    expect(scene.dialogues).toEqual([{ character: "张父", parenthetical: "低声", line: "别怕。" }]);
    expect(scene.actions).toEqual(["窗外细雨落下"]);
    expect(scene.subtitles).toEqual(["字幕：2002年夏"]);
    expect(scene.weather).toBe("小雨");
    expect(scene.timeOfDay).toBe("日");
  });

  it("uses loose headers with default time and normalized location", () => {
    const [scene] = parseScenes("1-2 规则怪谈世界，集合广场\n△人群聚集");
    expect(scene.sceneHeader).toBe("1-2 日 规则怪谈世界 集合广场");
    expect(scene.timeOfDay).toBe("日");
    expect(scene.content).toBe("△人群聚集");
    expect(scene.actions).toEqual(["人群聚集"]);
  });

  it("supports alternative scene markers and single-scene fallback", () => {
    expect(parseScenes("【场景：地下室】\n甲：谁在那里？")[0]).toMatchObject({
      sceneHeader: "场景：地下室",
      dialogues: [{ character: "甲", line: "谁在那里？" }],
    });
    expect(parseScenes("△无场景头动作")[0].sceneHeader).toBe("主场景");
  });

  it("splits multiple standard headers without leaking content across scenes", () => {
    const result = parseScenes("1-1 日 内 张家\n△第一场动作\n1-2 夜 外 码头\n乙：到了。");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      sceneHeader: "1-1 日 内 张家",
      content: "△第一场动作",
      actions: ["第一场动作"],
      timeOfDay: "日",
    });
    expect(result[1]).toMatchObject({
      sceneHeader: "1-2 夜 外 码头",
      content: "乙：到了。",
      dialogues: [{ character: "乙", line: "到了。" }],
      timeOfDay: "夜",
    });
  });

  it("normalizes loose time-only headers to an unknown location", () => {
    const [scene] = parseScenes("1-3 夜\n△灯灭");

    expect(scene.sceneHeader).toBe("1-3 夜 未知地点");
    expect(scene.timeOfDay).toBe("夜");
    expect(scene.actions).toEqual(["灯灭"]);
  });
});

describe("parseEpisodes characterization", () => {
  it("falls back to a single idle episode when no episode marker exists", () => {
    const result = parseEpisodes("△无集标记动作\n甲：继续走。");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      episodeIndex: 1,
      title: "第一集",
      rawContent: "△无集标记动作\n甲：继续走。",
      shotGenerationStatus: "idle",
    });
    expect(result[0].scenes[0].sceneHeader).toBe("主场景");
  });

  it("parses Chinese and Arabic episode numbers while trimming marker titles and raw content", () => {
    const result = parseEpisodes(
      "序言不会进入任何一集\n**第十集：破局**\n1-1 夜 外 码头\n△船灯亮起\n第12集：尾声**\n【场景：大厅】\n乙：收尾。",
    );

    expect(result.map(({ episodeIndex, title }) => [episodeIndex, title])).toEqual([
      [10, "第10集：破局"],
      [12, "第12集：尾声"],
    ]);
    expect(result[0].rawContent).toBe("1-1 夜 外 码头\n△船灯亮起");
    expect(result[0].scenes[0].sceneHeader).toBe("1-1 夜 外 码头");
    expect(result[1].rawContent).toBe("【场景：大厅】\n乙：收尾。");
    expect(result[1].scenes[0]).toMatchObject({
      sceneHeader: "场景：大厅",
      dialogues: [{ character: "乙", line: "收尾。" }],
    });
  });

  it("extracts the first seasonal subtitle from parsed scenes", () => {
    const result = parseEpisodes("第1集：冬夜\n1-1 夜 外 码头\n【字幕：2002年冬】\n△雪落");

    expect(result[0].season).toBe("冬");
    expect(result[0].scenes[0].subtitles).toEqual(["字幕：2002年冬"]);
  });
});

describe("convertToScriptData characterization", () => {
  it("maps scene header time/location and atmosphere defaults", () => {
    const result = convertToScriptData(
      { title: "测试", outline: "", characterBios: "", era: "", timelineSetting: "", storyStartYear: undefined, storyEndYear: undefined, genre: "", worldSetting: "", themes: [] },
      [{ episodeIndex: 1, title: "第一集", rawContent: "", scenes: [{ sceneHeader: "1-1 夜 内 密室", characters: [], content: "", dialogues: [], actions: [], subtitles: [] }], shotGenerationStatus: "idle" }],
    );
    expect(result.scenes[0]).toMatchObject({ location: "密室", time: "night", atmosphere: "平静" });
  });

  it("defaults unknown time and detects atmosphere from content", () => {
    const result = convertToScriptData(
      { title: "测试", outline: "", characterBios: "", era: "", timelineSetting: "", storyStartYear: undefined, storyEndYear: undefined, genre: "", worldSetting: "", themes: [] },
      [{ episodeIndex: 1, title: "第一集", rawContent: "", scenes: [{ sceneHeader: "1-1 未知地点", characters: [], content: "危险的冲突爆发", dialogues: [], actions: [], subtitles: [] }], shotGenerationStatus: "idle" }],
    );
    expect(result.scenes[0].time).toBe("day");
    expect(result.scenes[0].atmosphere).toBe("紧张");
  });

  it("assigns stable sequential scene ids across episodes", () => {
    const result = convertToScriptData(
      { title: "测试", outline: "", characterBios: "", era: "", timelineSetting: "", storyStartYear: undefined, storyEndYear: undefined, genre: "", worldSetting: "", themes: [] },
      [
        { episodeIndex: 1, title: "第一集", rawContent: "第一集描述", scenes: [{ sceneHeader: "1-1 日 内 人物：甲", characters: [], content: "", dialogues: [], actions: [], subtitles: [] }], shotGenerationStatus: "idle" },
        { episodeIndex: 2, title: "第二集", rawContent: "第二集描述", scenes: [{ sceneHeader: "2-1 夜 外 码头", characters: [], content: "", dialogues: [], actions: [], subtitles: [] }], shotGenerationStatus: "idle" },
      ],
    );

    expect(result.episodes.map((episode) => [episode.id, episode.sceneIds])).toEqual([
      ["ep_1", ["scene_1"]],
      ["ep_2", ["scene_2"]],
    ]);
    expect(result.scenes.map((scene) => [scene.id, scene.location, scene.time])).toEqual([
      ["scene_1", "", "day"],
      ["scene_2", "码头", "night"],
    ]);
  });
});
