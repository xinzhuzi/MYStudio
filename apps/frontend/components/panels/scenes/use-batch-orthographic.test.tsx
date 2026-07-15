// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/scene-store";

const mocks = vi.hoisted(() => ({
  scenes: [] as Scene[],
  featureConfig: vi.fn(),
  image: vi.fn(),
  splitStoryboardImage: vi.fn(),
  readImageAsBase64: vi.fn(),
  saveImageToLocal: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/stores/scene-store", () => ({ useSceneStore: { getState: () => ({ scenes: mocks.scenes }) } }));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: { defaultResolution: "2K" } }) },
}));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: mocks.featureConfig, featureNotConfiguredMessage: () => "未配置", image: mocks.image },
}));
vi.mock("@/lib/storyboard/image-splitter", () => ({ splitStoryboardImage: mocks.splitStoryboardImage }));
vi.mock("@/lib/image-storage", () => ({
  readImageAsBase64: mocks.readImageAsBase64,
  saveImageToLocal: mocks.saveImageToLocal,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useBatchOrthographic } from "./use-batch-orthographic";

const child = {
  id: "child-1",
  name: "书房-全景",
  location: "书房",
  time: "day",
  atmosphere: "quiet",
  referenceImage: "https://cdn.test/overview.png",
  projectId: "project-1",
  createdAt: 1,
  updatedAt: 1,
} as Scene;

function options(ids = [child.id]) {
  return {
    savedChildSceneIds: ids,
    styleId: "ink",
    aspectRatio: "16:9" as const,
    resourceProjectId: "project-1",
    addScene: vi.fn(() => "view-1"),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(() => "ai-folder"),
    setSavedChildSceneIds: vi.fn(),
  };
}

describe("useBatchOrthographic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scenes = [child];
    mocks.featureConfig.mockReturnValue({ apiKey: "key" });
    mocks.image.mockResolvedValue({ imageUrl: "sheet.png" });
    mocks.splitStoryboardImage.mockResolvedValue([
      { row: 0, col: 0, dataUrl: "front" }, { row: 0, col: 1, dataUrl: "back" },
      { row: 1, col: 0, dataUrl: "left" }, { row: 1, col: 1, dataUrl: "right" },
    ]);
    mocks.saveImageToLocal.mockImplementation(async (value: string) => `local-image://${value}.png`);
  });

  it("generates, slices, saves, archives, and clears a child scene batch", async () => {
    const input = options();
    const { result } = renderHook(() => useBatchOrthographic(input));
    await act(async () => result.current.handleBatchGenerateOrthographic());
    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "16:9" }));
    expect(mocks.splitStoryboardImage).toHaveBeenCalledWith("sheet.png", expect.objectContaining({ sceneCount: 4 }));
    expect(input.addScene).toHaveBeenCalledTimes(4);
    expect(input.addMediaFromUrl).toHaveBeenCalledTimes(4);
    expect(input.setSavedChildSceneIds).toHaveBeenCalledWith([]);
    expect(mocks.toast.success).toHaveBeenCalledWith("批量四视图完成！成功 1 个，失败 0 个");
  });

  it("guards an empty batch", async () => {
    const input = options([]);
    const { result } = renderHook(() => useBatchOrthographic(input));
    await act(async () => result.current.handleBatchGenerateOrthographic());
    expect(mocks.toast.error).toHaveBeenCalledWith("没有可处理的子场景");
    expect(mocks.image).not.toHaveBeenCalled();
  });

  it("uses a base64-only current scene reference", async () => {
    mocks.scenes = [{
      ...child,
      referenceImage: undefined,
      referenceImageBase64: "data:image/png;base64,current",
    }];
    const { result } = renderHook(() => useBatchOrthographic(options()));

    await act(async () => result.current.handleBatchGenerateOrthographic());

    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: ["data:image/png;base64,current"],
    }));
  });

  it("uses a base64-only overview sibling reference", async () => {
    const childWithParent = { ...child, referenceImage: undefined, parentSceneId: "parent-1" } as Scene;
    const overview = {
      ...child,
      id: "overview-1",
      parentSceneId: "parent-1",
      viewpointId: "overview",
      referenceImage: undefined,
      referenceImageBase64: "data:image/png;base64,overview",
    } as Scene;
    mocks.scenes = [childWithParent, overview];
    const { result } = renderHook(() => useBatchOrthographic(options()));

    await act(async () => result.current.handleBatchGenerateOrthographic());

    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: ["data:image/png;base64,overview"],
    }));
  });
});
