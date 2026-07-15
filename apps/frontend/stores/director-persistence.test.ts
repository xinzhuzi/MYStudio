import { describe, expect, it } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import { mergeDirectorStore, partializeDirectorStore } from "./director-persistence";
import type { DirectorStore } from "./director-store";

function currentState(): DirectorStore {
  return {
    activeProjectId: "p1",
    projects: { p1: createDefaultDirectorProjectData() },
    config: { aspectRatio: "9:16" },
    sceneProgress: new Map(),
  } as unknown as DirectorStore;
}

describe("director persistence", () => {
  it("persists only the active project and strips embedded image data", () => {
    const state = currentState();
    state.projects.p2 = createDefaultDirectorProjectData();
    state.projects.p1.storyboardImage = "data:image/png;base64,sheet";
    state.projects.p1.splitScenes = [{
      sceneId: 1,
      imageDataUrl: "data:image/png;base64,frame",
      endFrameImageUrl: "local-image://end.png",
    } as never];

    const persisted = partializeDirectorStore(state);
    expect(persisted.projectData?.storyboardImage).toBe("");
    expect(persisted.projectData?.splitScenes[0]).toMatchObject({
      imageDataUrl: "",
      endFrameImageUrl: "local-image://end.png",
    });
    expect(JSON.stringify(persisted)).not.toContain("p2");
  });

  it("merges legacy project records and the current single-project format", () => {
    const current = currentState();
    const legacy = mergeDirectorStore({ projects: { legacy: { splitScenes: [] } } }, current);
    expect(legacy.projects.legacy.splitScenes).toEqual([]);
    const modern = mergeDirectorStore({
      activeProjectId: "p2",
      projectData: { splitScenes: [], storyboardImage: "kept.png" },
      config: { aspectRatio: "16:9" },
    }, current);
    expect(modern.activeProjectId).toBe("p2");
    expect(modern.projects.p2.storyboardImage).toBe("kept.png");
    expect(modern.config.aspectRatio).toBe("16:9");
  });
});
