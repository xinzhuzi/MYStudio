import { describe, expect, it } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import { createDirectorSceneImportActions } from "./director-scene-import-actions";
import type { DirectorStore } from "./director-store-types";

function createHarness() {
  let state = {
    activeProjectId: "p1",
    projects: { p1: createDefaultDirectorProjectData() },
  } as unknown as DirectorStore;
  const actions = createDirectorSceneImportActions(
    (partial) => { state = { ...state, ...partial }; },
    () => state,
  );
  return { actions, getState: () => state };
}

describe("createDirectorSceneImportActions", () => {
  it("imports script scenes after existing ids and preserves calibrated style", () => {
    const { actions, getState } = createHarness();
    getState().projects.p1.storyboardConfig.visualStyleId = "ink";
    actions.addScenesFromScript([{ promptZh: "矿场全景", sceneName: "矿场" }]);

    const project = getState().projects.p1;
    expect(project.splitScenes).toHaveLength(1);
    expect(project.splitScenes[0]).toMatchObject({ id: 0, sceneName: "矿场", imagePromptZh: "矿场全景" });
    expect(project.storyboardConfig.calibratedStyleId).toBe("ink");
    expect(project.storyboardStatus).toBe("editing");
  });

  it("adds a blank scene with the established defaults and next id", () => {
    const { actions, getState } = createHarness();
    actions.addScenesFromScript([{ promptZh: "已有镜头" }]);
    actions.addBlankSplitScene();

    expect(getState().projects.p1.splitScenes[1]).toMatchObject({
      id: 1,
      sceneName: "空白分镜 2",
      duration: 5,
      imageStatus: "idle",
      videoStatus: "idle",
      audioBgmEnabled: false,
    });
  });
});
