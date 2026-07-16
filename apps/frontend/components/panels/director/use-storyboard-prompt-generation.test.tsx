// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";

const featureConfig = vi.hoisted(() => vi.fn());
const generateScenePrompts = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig } }));
vi.mock("@/lib/storyboard/scene-prompt-generator", () => ({ generateScenePrompts }));
vi.mock("sonner", () => ({ toast }));

import { useStoryboardPromptGeneration } from "./use-storyboard-prompt-generation";

const scene = {
  id: 4,
  row: 1,
  col: 2,
  actionSummary: "谢乘风推门",
  cameraMovement: "dolly-in",
  dialogue: "开门。",
  sceneName: "雨夜城门",
  sceneLocation: "城门外",
} as SplitScene;

function createOptions(overrides: Partial<Parameters<typeof useStoryboardPromptGeneration>[0]> = {}) {
  return {
    storyboardImage: "project://storyboard.png",
    scenes: [scene],
    storyboardConfig: {
      aspectRatio: "9:16" as const,
      resolution: "2K" as const,
      videoResolution: "480p" as const,
      sceneCount: 1,
      storyPrompt: "雨夜叩城",
    },
    setIsGeneratingPrompts: vi.fn(),
    updateSplitSceneImagePrompt: vi.fn(),
    updateSplitSceneVideoPrompt: vi.fn(),
    updateSplitSceneEndFramePrompt: vi.fn(),
    updateSplitSceneNeedsEndFrame: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  featureConfig.mockReturnValue({
    apiKey: "key",
    platform: "openai",
    baseUrl: "https://example.test/v1/",
    models: ["vision-model"],
  });
});

describe("useStoryboardPromptGeneration", () => {
  it("rejects missing storyboard input before starting generation", async () => {
    const options = createOptions({ storyboardImage: null });
    const { result } = renderHook(() => useStoryboardPromptGeneration(options));

    await act(async () => result.current());

    expect(toast.error).toHaveBeenCalledWith("无法生成提示词：缺失故事板或分镜");
    expect(generateScenePrompts).not.toHaveBeenCalled();
    expect(options.setIsGeneratingPrompts).not.toHaveBeenCalled();
  });

  it("maps generated three-tier prompts to the existing store actions", async () => {
    generateScenePrompts.mockResolvedValue([{
      id: 4,
      imagePrompt: "first-en",
      imagePromptZh: "首帧中文",
      videoPrompt: "video-en",
      videoPromptZh: "视频中文",
      needsEndFrame: true,
      endFramePrompt: "end-en",
      endFramePromptZh: "尾帧中文",
    }]);
    const options = createOptions();
    const { result } = renderHook(() => useStoryboardPromptGeneration(options));

    await act(async () => result.current());

    expect(generateScenePrompts).toHaveBeenCalledWith(expect.objectContaining({
      storyboardImage: "project://storyboard.png",
      storyPrompt: "雨夜叩城",
      baseUrl: "https://example.test/v1",
      scenes: [expect.objectContaining({ id: 4, sceneDescription: "城门外" })],
    }));
    expect(options.updateSplitSceneImagePrompt).toHaveBeenCalledWith(4, "first-en", "首帧中文");
    expect(options.updateSplitSceneVideoPrompt).toHaveBeenCalledWith(4, "video-en", "视频中文");
    expect(options.updateSplitSceneNeedsEndFrame).toHaveBeenCalledWith(4, true);
    expect(options.updateSplitSceneEndFramePrompt).toHaveBeenCalledWith(4, "end-en", "尾帧中文");
    expect(options.setIsGeneratingPrompts).toHaveBeenNthCalledWith(1, true);
    expect(options.setIsGeneratingPrompts).toHaveBeenNthCalledWith(2, false);
  });
});
