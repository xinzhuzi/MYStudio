// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "./studio-store";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

describe("studio workflow store", () => {
  it("keeps chapter ids when creating storyboards from imported chapters", () => {
    const store = useStudioStore.getState();

    store.replaceNovelText("第1章 断剑夜访\n独孤剑尘入镇。\n\n第2章 塾馆燃气\n晏燎掌心发热。");
    useStudioStore.getState().createStoryboardsFromChapters();

    const state = useStudioStore.getState();
    expect(state.storyboards.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
    expect(state.productionTracks.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
  });
});
