import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIScreenplay, SceneProgress } from "@/lib/ai/core";
import { createDefaultDirectorProjectData } from "./director-project-defaults";
import type { DirectorStore } from "./director-store";
import { createDirectorGenerationLifecycleActions } from "./director-generation-lifecycle-actions";

const screenplay = {
  title: "道劫",
  scenes: [{ sceneId: 1 }, { sceneId: 2 }],
} as AIScreenplay;

describe("director generation lifecycle actions", () => {
  let state: DirectorStore;
  const setState = vi.fn<[Partial<DirectorStore>], void>();

  beforeEach(() => {
    state = {
      activeProjectId: "project-1",
      projects: {
        "project-1": { ...createDefaultDirectorProjectData(), screenplay, screenplayStatus: "ready" },
      },
      sceneProgress: new Map<number, SceneProgress>(),
    } as unknown as DirectorStore;
    setState.mockReset();
    setState.mockImplementation((partial) => {
      state = { ...state, ...partial };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes project-scoped image generation progress", () => {
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.startImageGeneration();

    expect(state.projects["project-1"].screenplayStatus).toBe("generating_images");
    expect(Array.from(state.sceneProgress.values())).toEqual([
      expect.objectContaining({ sceneId: 1, status: "pending", stage: "image", progress: 0 }),
      expect.objectContaining({ sceneId: 2, status: "pending", stage: "image", progress: 0 }),
    ]);
  });

  it("preserves generated image URLs when video generation starts", () => {
    state.sceneProgress.set(1, {
      sceneId: 1,
      status: "completed",
      stage: "image",
      progress: 100,
      imageUrl: "project://scene-1.png",
    });
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.startVideoGeneration();

    expect(state.projects["project-1"].screenplayStatus).toBe("generating_videos");
    expect(state.sceneProgress.get(1)).toMatchObject({
      stage: "video",
      progress: 50,
      imageUrl: "project://scene-1.png",
    });
  });

  it("does not start image or video generation without a screenplay", () => {
    state.projects["project-1"] = {
      ...state.projects["project-1"],
      screenplay: null,
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.startImageGeneration();
    actions.startVideoGeneration();

    expect(setState).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenNthCalledWith(1, "[DirectorStore] No screenplay to generate images");
    expect(errorSpy).toHaveBeenNthCalledWith(2, "[DirectorStore] No screenplay to generate videos");
  });

  it("moves the active project through image-ready and completed terminal states", () => {
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.onAllImagesCompleted();
    expect(state.projects["project-1"].screenplayStatus).toBe("images_ready");

    actions.onAllCompleted();
    expect(state.projects["project-1"].screenplayStatus).toBe("completed");
  });

  it("marks active scene work failed when local cancellation state is applied", () => {
    state.sceneProgress = new Map<number, SceneProgress>([
      [1, { sceneId: 1, status: "generating", stage: "image", progress: 40 }],
      [2, { sceneId: 2, status: "completed", stage: "image", progress: 100 }],
    ]);
    state.updateSceneProgress = vi.fn((sceneId: number, updates: Partial<SceneProgress>) => {
      const current = state.sceneProgress.get(sceneId);
      if (!current) return;
      state.sceneProgress = new Map(state.sceneProgress).set(sceneId, {
        ...current,
        ...updates,
      });
    });
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.cancelAll();

    expect(state.projects["project-1"].screenplayStatus).toBe("ready");
    expect(state.sceneProgress.get(1)).toMatchObject({
      status: "failed",
      error: "Cancelled by user",
    });
    expect(state.sceneProgress.get(2)).toMatchObject({
      status: "completed",
      progress: 100,
    });
  });
});
