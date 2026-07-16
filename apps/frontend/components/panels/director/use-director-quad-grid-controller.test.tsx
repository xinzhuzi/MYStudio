// @vitest-environment jsdom

import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";
import { useDirectorQuadGridController } from "./use-director-quad-grid-controller";

const executeStoryboardGridGeneration = vi.hoisted(() => vi.fn());
const featureConfig = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig } }));
vi.mock("./storyboard-grid-generation-executor", () => ({ executeStoryboardGridGeneration }));
vi.mock("sonner", () => ({ toast }));

const scene = {
  id: 7,
  imageDataUrl: "source-start",
  endFrameImageUrl: "source-end",
  imagePromptZh: "角色走进雨夜街道",
  actionSummary: "角色从静止开始奔跑",
  sceneName: "雨夜街道",
  sceneLocation: "城南",
  sceneReferenceImage: "scene-ref",
  characterIds: ["character-1"],
  emotionTags: [],
} as unknown as SplitScene;

function useHarness(scenes: SplitScene[] = [scene]) {
  const controller = useStoryboardGenerationUi({ defaultImageGenMode: "single" });
  const addMediaFromUrl = useRef(vi.fn(() => "media-id")).current;
  const actions = useDirectorQuadGridController({
    scenes,
    storyboardConfig: {
      aspectRatio: "9:16",
      resolution: "2K",
      videoResolution: "480p",
      sceneCount: 5,
      storyPrompt: "",
      styleTokens: ["ink wash"],
    },
    defaultAspectRatio: "16:9",
    defaultResolution: "1K",
    controller,
    mediaProjectId: "project-1",
    getImageFolderId: () => "folder-1",
    addMediaFromUrl,
    buildEmotionDescription: () => "tense rain",
    getSceneCharacterContexts: () => [{
      characterId: "character-1",
      name: "Hero",
      identityNotes: [],
      referenceImages: ["character-ref"],
    }],
    getCharacterReferenceImages: () => ["character-ref"],
    buildPromptWithIdentityLock: (prompt) => `${prompt}\nidentity-lock`,
    optimizeReferenceImagesForModel: (_model, groups) => groups.flatMap((group) => group.images),
    processReferenceImagesForApi: async (references) => references,
  });
  return { controller, actions, addMediaFromUrl };
}

describe("useDirectorQuadGridController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureConfig.mockReturnValue({
      platform: "openai",
      models: ["image-model"],
      baseUrl: "https://api.test/",
      keyManager: { getCurrentKey: () => "key-1" },
    });
    executeStoryboardGridGeneration.mockResolvedValue({
      gridImageUrl: "grid-url",
      slicedImages: ["tile-1", "tile-2", "tile-3", "tile-4"],
    });
  });

  it("keeps the Director identity-lock/reference adapter and media writeback", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.handleQuadGridClick(7, "start"));

    await act(async () => result.current.actions.handleQuadGridGenerate("moment", true));

    expect(executeStoryboardGridGeneration).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        model: "image-model",
        baseUrl: "https://api.test",
        referenceImages: ["source-start", "character-ref", "scene-ref"],
        prompt: expect.stringContaining("identity-lock"),
      }),
    }));
    expect(result.current.controller.quadGridResult).toEqual(expect.objectContaining({
      originalImage: "source-start",
      images: ["tile-1", "tile-2", "tile-3", "tile-4"],
      variationType: "时刻变体",
    }));
    expect(result.current.addMediaFromUrl).toHaveBeenCalledTimes(4);
    expect(result.current.controller.quadGridOpen).toBe(false);
    expect(result.current.controller.quadGridResultOpen).toBe(true);
  });

  it("does not open a picker for a missing frame", () => {
    const { result } = renderHook(() => useHarness([{ id: 8 } as SplitScene]));
    act(() => result.current.actions.handleQuadGridClick(8, "end"));

    expect(toast.error).toHaveBeenCalledWith("请先生成尾帧");
    expect(result.current.controller.quadGridOpen).toBe(false);
  });
});
