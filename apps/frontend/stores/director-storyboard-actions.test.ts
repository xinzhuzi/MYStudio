import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import type { DirectorStore } from "./director-store";
import { createDirectorStoryboardActions } from "./director-storyboard-actions";

describe("director storyboard actions", () => {
  let state: DirectorStore;
  const setState = vi.fn<[Partial<DirectorStore>], void>();

  beforeEach(() => {
    state = {
      activeProjectId: "project-1",
      projects: { "project-1": createDefaultDirectorProjectData() },
    } as unknown as DirectorStore;
    setState.mockReset();
    setState.mockImplementation((partial) => {
      state = { ...state, ...partial };
    });
  });

  it("does nothing when no project is active", () => {
    state.activeProjectId = null;
    const actions = createDirectorStoryboardActions(setState, () => state);

    actions.setStoryboardImage("project://image.png", "media-1");
    actions.setStoryboardStatus("editing");
    actions.setStoryboardError("failed");
    actions.setProjectFolderId("folder-1");

    expect(setState).not.toHaveBeenCalled();
  });

  it("updates only the active project's storyboard fields", () => {
    const actions = createDirectorStoryboardActions(setState, () => state);

    actions.setStoryboardImage("project://image.png");
    actions.setStoryboardStatus("editing");
    actions.setProjectFolderId("folder-1");

    expect(state.projects["project-1"]).toMatchObject({
      storyboardImage: "project://image.png",
      storyboardImageMediaId: null,
      storyboardStatus: "editing",
      projectFolderId: "folder-1",
    });
  });

  it("sets error status and preserves the previous status when clearing the error", () => {
    const actions = createDirectorStoryboardActions(setState, () => state);
    actions.setStoryboardStatus("editing");
    actions.setStoryboardError("failed");
    expect(state.projects["project-1"]).toMatchObject({
      storyboardError: "failed",
      storyboardStatus: "error",
    });

    actions.setStoryboardError(null);
    expect(state.projects["project-1"]).toMatchObject({
      storyboardError: null,
      storyboardStatus: "error",
    });
  });
});
