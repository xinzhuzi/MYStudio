// @vitest-environment jsdom

import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { useStoryboardGenerationUi } from "../director/use-storyboard-generation-ui";
import { useSClassQuadGridController } from "./use-sclass-quad-grid-controller";

const executeStoryboardGridGeneration = vi.hoisted(() => vi.fn());
const normalizeStoryboardReferenceImages = vi.hoisted(() => vi.fn());
const featureConfig = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig } }));
vi.mock("../director/storyboard-grid-generation-executor", () => ({ executeStoryboardGridGeneration }));
vi.mock("../director/storyboard-reference-image-normalizer", () => ({ normalizeStoryboardReferenceImages }));
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
  const actions = useSClassQuadGridController({
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
  });
  return { controller, actions, addMediaFromUrl };
}

describe("useSClassQuadGridController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureConfig.mockReturnValue({
      platform: "openai",
      models: ["image-model"],
      baseUrl: "https://api.test/",
      keyManager: { getCurrentKey: () => "key-1" },
    });
    normalizeStoryboardReferenceImages.mockImplementation(async (references: string[]) => references);
    executeStoryboardGridGeneration.mockResolvedValue({
      gridImageUrl: "grid-url",
      slicedImages: ["tile-1", "tile-2", "tile-3", "tile-4"],
    });
  });

  it("opens only frames that already have a source image", () => {
    const { result } = renderHook(() => useHarness([{ id: 9 } as SplitScene]));

    act(() => result.current.actions.handleQuadGridClick(9, "start"));

    expect(toast.error).toHaveBeenCalledWith("请先生成首帧");
    expect(result.current.controller.quadGridOpen).toBe(false);
  });

  it("keeps prompt, reference, result, and media-save behavior", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.handleQuadGridClick(7, "start"));

    await act(async () => result.current.actions.handleQuadGridGenerate("moment"));

    expect(executeStoryboardGridGeneration).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        model: "image-model",
        baseUrl: "https://api.test",
        aspectRatio: "9:16",
        resolution: "2K",
        referenceImages: ["source-start", "scene-ref"],
        prompt: expect.stringContaining("Action sequence context: 角色从静止开始奔跑"),
      }),
      layout: { columns: 2, rows: 2, actualCount: 4 },
    }));
    expect(result.current.controller.quadGridResult).toEqual(expect.objectContaining({
      originalImage: "source-start",
      images: ["tile-1", "tile-2", "tile-3", "tile-4"],
      variationType: "时刻变体",
    }));
    expect(result.current.addMediaFromUrl).toHaveBeenCalledTimes(4);
    expect(result.current.addMediaFromUrl).toHaveBeenCalledWith(expect.objectContaining({
      folderId: "folder-1",
      projectId: "project-1",
    }));
    expect(result.current.controller.quadGridOpen).toBe(false);
    expect(result.current.controller.quadGridResultOpen).toBe(true);
    expect(result.current.controller.isQuadGridGenerating).toBe(false);
  });

  it("closes the picker when image generation is not configured", async () => {
    featureConfig.mockReturnValue(undefined);
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.handleQuadGridClick(7, "end"));

    await act(async () => result.current.actions.handleQuadGridGenerate("angle"));

    expect(toast.error).toHaveBeenCalledWith("请先在设置中配置图片生成 API");
    expect(executeStoryboardGridGeneration).not.toHaveBeenCalled();
    expect(result.current.controller.quadGridOpen).toBe(false);
  });
});
