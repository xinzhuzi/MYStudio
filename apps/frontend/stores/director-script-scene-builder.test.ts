import { describe, expect, it } from "vitest";
import { buildSplitScenesFromScript } from "./director-script-scene-builder";

describe("buildSplitScenesFromScript", () => {
  it("preserves ids, prompt fallbacks, and generation defaults", () => {
    const [scene] = buildSplitScenesFromScript([{
      promptZh: "中文旧提示",
      promptEn: "legacy prompt",
      imagePrompt: "first frame",
      needsEndFrame: true,
      characterIds: ["char-1"],
      sceneLibraryId: "library-1",
      sourceEpisodeIndex: 2,
      sourceEpisodeId: "episode-2",
    }], 7);

    expect(scene).toEqual(expect.objectContaining({
      id: 7,
      imagePrompt: "first frame",
      imagePromptZh: "中文旧提示",
      videoPrompt: "legacy prompt",
      videoPromptZh: "中文旧提示",
      needsEndFrame: true,
      duration: 5,
      imageStatus: "idle",
      endFrameStatus: "idle",
      videoStatus: "idle",
      characterIds: ["char-1"],
      sceneLibraryId: "library-1",
      sourceEpisodeIndex: 2,
      sourceEpisodeId: "episode-2",
    }));
  });

  it("increments ids and keeps explicit three-layer prompts", () => {
    const scenes = buildSplitScenesFromScript([
      { promptZh: "一", imagePromptZh: "首帧一", videoPromptZh: "视频一", endFramePromptZh: "尾帧一" },
      { promptZh: "二", imagePromptZh: "首帧二", videoPromptZh: "视频二", endFramePromptZh: "尾帧二" },
    ], 3);

    expect(scenes.map((scene) => scene.id)).toEqual([3, 4]);
    expect(scenes[1]).toEqual(expect.objectContaining({
      imagePromptZh: "首帧二",
      videoPromptZh: "视频二",
      endFramePromptZh: "尾帧二",
      audioAmbientEnabled: true,
      audioSfxEnabled: true,
      audioDialogueEnabled: true,
      audioBgmEnabled: false,
    }));
  });
});
