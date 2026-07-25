import { describe, expect, it } from "vitest";
import type { DirectorStore } from "./director-store";
import {
  selectActiveDirectorProject,
  selectCompletedDirectorScenesCount,
  selectDirectorIsGenerating,
  selectDirectorOverallProgress,
  selectDirectorSceneProgress,
  selectFailedDirectorScenesCount,
} from "./director-selectors";

function stateFixture(): DirectorStore {
  return {
    activeProjectId: "project-1",
    projects: {
      "project-1": {
        screenplay: { scenes: [{ sceneId: 1 }, { sceneId: 2 }] },
      },
    },
    sceneProgress: new Map([
      [1, { status: "completed", progress: 100 }],
      [2, { status: "generating", progress: 50 }],
      [3, { status: "failed", progress: 0 }],
    ]),
  } as unknown as DirectorStore;
}

describe("director selectors", () => {
  it("selects project and scene progress from the unchanged store shape", () => {
    const state = stateFixture();
    expect(selectActiveDirectorProject(state)).toBe(state.projects["project-1"]);
    expect(selectDirectorSceneProgress(2)(state)?.status).toBe("generating");
  });

  it("derives aggregate progress and terminal counts", () => {
    const state = stateFixture();
    expect(selectDirectorOverallProgress(state)).toBe(75);
    expect(selectDirectorIsGenerating(state)).toBe(true);
    expect(selectCompletedDirectorScenesCount(state)).toBe(1);
    expect(selectFailedDirectorScenesCount(state)).toBe(1);
  });

  it("survives legacy hydration that serialized the transient Map as an object", () => {
    const state = { ...stateFixture(), sceneProgress: {} } as unknown as DirectorStore;
    expect(selectDirectorSceneProgress(1)(state)).toBeUndefined();
    expect(selectDirectorOverallProgress(state)).toBe(0);
    expect(selectDirectorIsGenerating(state)).toBe(false);
    expect(selectCompletedDirectorScenesCount(state)).toBe(0);
    expect(selectFailedDirectorScenesCount(state)).toBe(0);
  });
});
