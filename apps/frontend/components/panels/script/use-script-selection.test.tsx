// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScriptData, Shot } from "@/types/script";
import { useScriptSelection } from "./use-script-selection";

const scriptData: ScriptData = {
  title: "道劫",
  language: "zh",
  characters: [{ id: "char-1", name: "独孤剑尘" }],
  scenes: [{ id: "scene-1", name: "雨夜街口", location: "街口", time: "night", atmosphere: "rainy" }],
  episodes: [{ id: "ep-1", index: 1, title: "入镇", sceneIds: ["scene-1"] }],
  storyParagraphs: [],
};
const shot = {
  id: "shot-1",
  index: 0,
  episodeId: "ep-1",
  sceneRefId: "scene-1",
  actionSummary: "走入雨幕",
  characterIds: [],
  characterVariations: {},
  imageStatus: "idle",
  imageProgress: 0,
  videoStatus: "idle",
  videoProgress: 0,
} as Shot;

describe("useScriptSelection", () => {
  it("selects episode scope and derives its raw script and shots", () => {
    const enterEpisode = vi.fn();
    const { result } = renderHook(() => useScriptSelection({
      scriptData,
      shots: [shot],
      episodeRawScripts: [{
        episodeIndex: 1,
        title: "入镇",
        rawContent: "雨夜入镇",
        scenes: [],
        shotGenerationStatus: "completed",
      }],
      activeEpisodeIndex: null,
      projectId: "project-1",
      enterEpisode,
    }));

    act(() => result.current.selectItem("episode_1", "episode"));

    expect(enterEpisode).toHaveBeenCalledWith(1, "project-1");
    expect(result.current.selectedEpisode?.rawContent).toBe("雨夜入镇");
    expect(result.current.selectedEpisodeShots).toEqual([shot]);
  });

  it("synchronizes selection when the active episode changes", () => {
    const { result } = renderHook(() => useScriptSelection({
      scriptData,
      shots: [],
      episodeRawScripts: [],
      activeEpisodeIndex: 1,
      projectId: "project-1",
      enterEpisode: vi.fn(),
    }));

    expect(result.current.selectedItemId).toBe("episode_1");
    expect(result.current.selectedItemType).toBe("episode");
  });
});
