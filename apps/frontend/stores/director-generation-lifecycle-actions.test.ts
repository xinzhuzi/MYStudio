import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIScreenplay, SceneProgress } from "@opencut/ai-core";
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

  it("moves the active project through image-ready and completed terminal states", () => {
    const actions = createDirectorGenerationLifecycleActions(setState, () => state, {});

    actions.onAllImagesCompleted();
    expect(state.projects["project-1"].screenplayStatus).toBe("images_ready");

    actions.onAllCompleted();
    expect(state.projects["project-1"].screenplayStatus).toBe("completed");
  });

  it.todo("fences late image events after cancelAll once generation-id/AbortController semantics are approved");
});
