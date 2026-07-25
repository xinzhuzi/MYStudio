import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import type { DirectorStore, SplitScene } from "./director-store";
import { createDirectorSplitSceneActions } from "./director-split-scene-actions";

function scene(id: number, overrides: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    imagePrompt: "image-en",
    imagePromptZh: "首帧中文",
    videoPrompt: "video-en",
    videoPromptZh: "视频中文",
    endFramePrompt: "end-en",
    endFramePromptZh: "尾帧中文",
    imageDataUrl: "project://old.png",
    imageHttpUrl: "https://old.test/image.png",
    imageSource: "ai-generated",
    imageStatus: "completed",
    imageProgress: 100,
    imageError: null,
    endFrameImageUrl: "project://old-end.png",
    endFrameHttpUrl: "https://old.test/end.png",
    endFrameSource: "ai-generated",
    endFrameStatus: "completed",
    endFrameProgress: 100,
    endFrameError: null,
    ...overrides,
  } as SplitScene;
}

describe("director split scene actions", () => {
  let state: DirectorStore;
  const setState = vi.fn<[Partial<DirectorStore>], void>();

  beforeEach(() => {
    state = {
      activeProjectId: "project-1",
      projects: {
        "project-1": { ...createDefaultDirectorProjectData(), splitScenes: [scene(2), scene(5)] },
        "project-2": { ...createDefaultDirectorProjectData(), splitScenes: [scene(9)] },
      },
    } as unknown as DirectorStore;
    setState.mockReset();
    setState.mockImplementation((partial) => {
      state = { ...state, ...partial };
    });
  });

  it("does nothing without an active project", () => {
    state.activeProjectId = null;
    const actions = createDirectorSplitSceneActions(setState, () => state);

    actions.updateSplitSceneImagePrompt(2, "new prompt");

    expect(setState).not.toHaveBeenCalled();
  });

  it("updates only the active project and preserves omitted localized prompts", () => {
    const actions = createDirectorSplitSceneActions(setState, () => state);

    actions.updateSplitSceneImagePrompt(2, "new image prompt");

    expect(state.projects["project-1"].splitScenes[0]).toMatchObject({
      imagePrompt: "new image prompt",
      imagePromptZh: "首帧中文",
    });
    expect(state.projects["project-2"].splitScenes[0].imagePrompt).toBe("image-en");
  });

  it("clears stale HTTP sources and synchronizes frame terminal state", () => {
    const actions = createDirectorSplitSceneActions(setState, () => state);

    actions.updateSplitSceneImage(2, "project://new.png");
    actions.updateSplitSceneEndFrame(2, null);

    expect(state.projects["project-1"].splitScenes[0]).toMatchObject({
      imageDataUrl: "project://new.png",
      imageHttpUrl: null,
      imageSource: undefined,
      imageStatus: "completed",
      imageProgress: 100,
      endFrameImageUrl: null,
      endFrameHttpUrl: null,
      endFrameSource: null,
      endFrameStatus: "idle",
      endFrameProgress: 0,
    });
  });

  it("appends angle history and renumbers remaining scenes after deletion", () => {
    const actions = createDirectorSplitSceneActions(setState, () => state);
    const history = { imageUrl: "project://angle.png", angleLabel: "侧面", timestamp: 123 };

    actions.addAngleSwitchHistory(5, "end", history);
    actions.deleteSplitScene(2);

    expect(state.projects["project-1"].splitScenes).toHaveLength(1);
    expect(state.projects["project-1"].splitScenes[0]).toMatchObject({
      id: 0,
      endFrameAngleSwitchHistory: [history],
    });
  });
});
