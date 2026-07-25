import { describe, expect, it } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import { createDirectorFrameCascadeActions } from "./director-frame-cascade-actions";
import { buildSplitScenesFromScript } from "./director-script-scene-builder";
import type { DirectorStore } from "./director-store";

describe("director frame cascade actions", () => {
  it("moves the previous first frame to the end frame and invalidates video", () => {
    const project = createDefaultDirectorProjectData();
    project.splitScenes = buildSplitScenesFromScript([{ promptZh: "原提示" }], 3);
    project.splitScenes[0] = {
      ...project.splitScenes[0],
      videoUrl: "https://video.test/old.mp4",
      videoStatus: "completed",
      videoMediaId: "video-1",
    };
    let state = {
      activeProjectId: "project-1",
      projects: { "project-1": project },
    } as unknown as DirectorStore;
    const actions = createDirectorFrameCascadeActions(
      (partial) => { state = { ...state, ...partial }; },
      () => state,
    );

    actions.cascadeFramesToNextScene({
      nextSceneId: 3,
      origFirstFrameImage: "local-image://old.png",
      origFirstFrameHttpUrl: "https://image.test/old.png",
      origFirstFramePrompt: "旧首帧",
      origFirstFramePromptZh: "旧首帧中文",
      newFirstFrameImage: "local-image://new.png",
      newFirstFrameHttpUrl: "https://image.test/new.png",
      newFirstFramePrompt: "new frame",
      newFirstFramePromptZh: "新首帧",
    });

    expect(state.projects["project-1"].splitScenes[0]).toMatchObject({
      endFrameImageUrl: "local-image://old.png",
      endFrameSource: "prev-scene-cascade",
      imageDataUrl: "local-image://new.png",
      imageStatus: "completed",
      videoStatus: "idle",
      videoUrl: null,
      videoMediaId: null,
    });
  });
});
