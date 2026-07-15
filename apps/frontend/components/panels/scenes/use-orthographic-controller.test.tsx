// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/scene-store";

const mocks = vi.hoisted(() => ({
  scenes: [] as Scene[],
  featureConfig: vi.fn(),
  image: vi.fn(),
  splitStoryboardImage: vi.fn(),
  saveImageToLocal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  writeText: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: mocks.featureConfig, featureNotConfiguredMessage: () => "未配置", image: mocks.image },
}));
vi.mock("@/lib/storyboard/image-splitter", () => ({ splitStoryboardImage: mocks.splitStoryboardImage }));
vi.mock("@/lib/image-storage", () => ({ readImageAsBase64: vi.fn(), saveImageToLocal: mocks.saveImageToLocal }));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: { defaultResolution: "2K" } }) },
}));
vi.mock("@/stores/scene-store", () => ({ useSceneStore: { getState: () => ({ scenes: mocks.scenes }) } }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useOrthographicController } from "./use-orthographic-controller";

const scene = {
  id: "scene-1",
  name: "书房",
  location: "书房",
  time: "day",
  atmosphere: "quiet",
  createdAt: 1,
  updatedAt: 1,
} as Scene;

function options() {
  return {
    selectedScene: scene,
    styleId: "ink",
    aspectRatio: "16:9" as const,
    prompt: "orthographic prompt",
    promptZh: "四视图提示词",
    image: "data:image/png;base64,sheet",
    views: { front: "front.png", back: null, left: null, right: null },
    resourceProjectId: "p1",
    addScene: vi.fn(() => "variant-1"),
    updateScene: vi.fn(),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(() => "ai-folder"),
    setPrompt: vi.fn(),
    setPromptZh: vi.fn(),
    setImage: vi.fn(),
    setViews: vi.fn(),
    setIsGenerating: vi.fn(),
    setProgress: vi.fn(),
    setIsSplitting: vi.fn(),
  };
}

describe("useOrthographicController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
    mocks.featureConfig.mockReturnValue({ apiKey: "key" });
    mocks.image.mockResolvedValue({ imageUrl: "generated.png" });
    mocks.splitStoryboardImage.mockResolvedValue([{ row: 0, col: 0, dataUrl: "front.png" }]);
    mocks.saveImageToLocal.mockResolvedValue("local-image://front.png");
    mocks.writeText.mockResolvedValue(undefined);
    mocks.scenes = [];
  });

  it("generates and cleans up orthographic progress", async () => {
    const input = options();
    const { result } = renderHook(() => useOrthographicController(input));
    await act(async () => result.current.handleGenerateOrthographicImage());
    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "orthographic prompt",
      aspectRatio: "16:9",
      styleId: "ink",
    }));
    expect(input.setImage).toHaveBeenCalledWith("generated.png");
    expect(input.setIsGenerating.mock.calls).toEqual([[true], [false]]);
  });

  it("splits the established 2x2 cardinal layout", async () => {
    const input = options();
    const { result } = renderHook(() => useOrthographicController(input));
    await act(async () => result.current.handleSplitOrthographic());
    expect(mocks.splitStoryboardImage).toHaveBeenCalledWith(input.image, expect.objectContaining({ sceneCount: 4 }));
    expect(input.setViews).toHaveBeenCalledWith({ front: "front.png", back: null, left: null, right: null });
  });

  it("saves available views and updates the parent", async () => {
    const input = options();
    const { result } = renderHook(() => useOrthographicController(input));
    await act(async () => result.current.handleSaveOrthographicViews());
    expect(input.addScene).toHaveBeenCalledWith(expect.objectContaining({
      parentSceneId: "scene-1",
      viewpointId: "front",
      isViewpointVariant: true,
    }));
    expect(input.updateScene).toHaveBeenCalledWith("scene-1", { orthographicImage: input.image });
    expect(input.setViews).toHaveBeenLastCalledWith({ front: null, back: null, left: null, right: null });
  });

  it("uses a base64-only current scene reference", async () => {
    const input = options();
    input.selectedScene = { ...scene, referenceImageBase64: "data:image/png;base64,current" };
    const { result } = renderHook(() => useOrthographicController(input));

    await act(async () => result.current.handleGenerateOrthographicImage());

    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: ["data:image/png;base64,current"],
    }));
  });

  it("uses a base64-only overview sibling reference", async () => {
    const input = options();
    input.selectedScene = { ...scene, parentSceneId: "parent-1" };
    mocks.scenes = [{
      ...scene,
      id: "overview-1",
      parentSceneId: "parent-1",
      viewpointId: "overview",
      referenceImageBase64: "data:image/png;base64,overview",
    }];
    const { result } = renderHook(() => useOrthographicController(input));

    await act(async () => result.current.handleGenerateOrthographicImage());

    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: ["data:image/png;base64,overview"],
    }));
  });
});
