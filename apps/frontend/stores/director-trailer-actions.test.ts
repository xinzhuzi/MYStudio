import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import type { DirectorStore, SplitScene } from "./director-store";
import { createDirectorTrailerActions } from "./director-trailer-actions";

describe("director trailer actions", () => {
  let state: DirectorStore;
  const setSpy = vi.fn<[Partial<DirectorStore>], void>();

  beforeEach(() => {
    state = {
      activeProjectId: "project-1",
      projects: { "project-1": createDefaultDirectorProjectData() },
    } as unknown as DirectorStore;
    setSpy.mockReset();
    setSpy.mockImplementation((partial: Partial<DirectorStore>) => {
      state = { ...state, ...partial };
    });
  });

  it("does nothing without an active project", () => {
    state.activeProjectId = null;
    createDirectorTrailerActions(setSpy, () => state).setTrailerDuration(60);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("merges duration and arbitrary trailer config fields", () => {
    const actions = createDirectorTrailerActions(setSpy, () => state);
    actions.setTrailerDuration(60);
    actions.setTrailerConfig({ shotIds: ["2", "4"], status: "generating" });
    expect(state.projects["project-1"].trailerConfig).toMatchObject({
      duration: 60,
      shotIds: ["2", "4"],
      status: "generating",
    });
  });

  it("marks generated scenes completed and clears them back to defaults", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const actions = createDirectorTrailerActions(setSpy, () => state);
    const scenes = [{ id: 1 }] as SplitScene[];
    actions.setTrailerScenes(scenes);
    expect(state.projects["project-1"].trailerScenes).toBe(scenes);
    expect(state.projects["project-1"].trailerConfig).toMatchObject({
      generatedAt: 1234,
      status: "completed",
    });

    actions.clearTrailer();
    expect(state.projects["project-1"].trailerScenes).toEqual([]);
    expect(state.projects["project-1"].trailerConfig).toEqual({
      duration: 30,
      shotIds: [],
      status: "idle",
    });
  });
});
