// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import type { SplitScene } from "@/stores/director-store";

const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import {
  useSplitSceneVideoGeneration,
  type UseSplitSceneVideoGenerationOptions,
} from "./use-split-scene-video-generation";

function createOptions(
  overrides: Partial<UseSplitSceneVideoGenerationOptions> = {},
): UseSplitSceneVideoGenerationOptions {
  return {
    scenes: [],
    storyboardConfig: { aspectRatio: "16:9", videoResolution: "480p" },
    projectData: null,
    currentStyleId: null,
    concurrency: 1,
    setIsGenerating: vi.fn(),
    setCurrentGeneratingId: vi.fn(),
    updateSplitSceneVideo: vi.fn(),
    updateSplitSceneEndFrame: vi.fn(),
    autoSaveVideoToLibrary: vi.fn(() => "media-1"),
    getCharacterReferenceImages: vi.fn(() => []),
    ...overrides,
  };
}

describe("useSplitSceneVideoGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a stopped scene to idle and clears the shared generation UI state", () => {
    const options = createOptions();
    const { result } = renderHook(() => useSplitSceneVideoGeneration(options));

    act(() => result.current.stopVideoGeneration(4));

    expect(options.updateSplitSceneVideo).toHaveBeenCalledWith(4, {
      videoStatus: "idle",
      videoProgress: 0,
      videoError: "用户已取消",
    });
    expect(options.setIsGenerating).toHaveBeenCalledWith(false);
    expect(options.setCurrentGeneratingId).toHaveBeenCalledWith(null);
    expect(toast.info).toHaveBeenCalledWith("分镜 5 视频生成已停止");
  });

  it("rejects an empty batch before configuring or changing generation state", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSplitSceneVideoGeneration(options));

    await act(async () => result.current.generateVideos());

    expect(toast.error).toHaveBeenCalledWith("没有可生成的分镜");
    expect(options.setIsGenerating).not.toHaveBeenCalled();
    expect(options.updateSplitSceneVideo).not.toHaveBeenCalled();
  });

  it("keeps a scene untouched when video generation is not configured", async () => {
    const featureConfig = vi.spyOn(aiManager, "featureConfig").mockReturnValue(null);
    const featureMessage = vi.spyOn(aiManager, "featureNotConfiguredMessage").mockReturnValue("视频生成未配置");
    const options = createOptions({ scenes: [{ id: 0 } as SplitScene] });
    const { result } = renderHook(() => useSplitSceneVideoGeneration(options));

    await act(async () => result.current.generateSingleVideo(0));

    expect(toast.error).toHaveBeenCalledWith("视频生成未配置");
    expect(options.setIsGenerating).not.toHaveBeenCalled();
    expect(options.updateSplitSceneVideo).not.toHaveBeenCalled();
    featureConfig.mockRestore();
    featureMessage.mockRestore();
  });
});
