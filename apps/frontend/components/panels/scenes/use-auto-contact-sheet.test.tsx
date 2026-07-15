// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/scene-store";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  imageGrid: vi.fn(),
  splitStoryboardImage: vi.fn(),
  saveImageToLocal: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
  scenes: [] as Scene[],
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: () => "未配置图片生成",
    imageGrid: mocks.imageGrid,
  },
}));
vi.mock("@/lib/storyboard/image-splitter", () => ({ splitStoryboardImage: mocks.splitStoryboardImage }));
vi.mock("@/lib/image-storage", () => ({ saveImageToLocal: mocks.saveImageToLocal }));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: { defaultResolution: "2K" } }) },
}));
vi.mock("@/stores/scene-store", () => ({
  useSceneStore: { getState: () => ({ scenes: mocks.scenes }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useAutoContactSheet } from "./use-auto-contact-sheet";

const parent = {
  id: "parent",
  name: "书房",
  location: "书房",
  time: "day",
  atmosphere: "quiet",
  folderId: "scene-folder",
  projectId: "project-1",
  createdAt: 1,
  updatedAt: 1,
} as Scene;

function options() {
  return {
    selectedScene: parent,
    contactSheetPrompt: "four viewpoints",
    styleId: "ink",
    contactSheetAspectRatio: "16:9" as const,
    contactSheetLayout: "2x2" as const,
    pendingViewpoints: [],
    extractedViewpoints: [{
      id: "front",
      name: "正面",
      nameEn: "Front",
      shotIds: [],
      keyProps: [],
      keyPropsEn: [],
      description: "书房正面",
      descriptionEn: "Front of the study",
      gridIndex: 0,
    }],
    pendingContactSheetPrompts: [],
    currentPageIndex: 0,
    name: "书房",
    location: "书房",
    time: "day",
    atmosphere: "quiet",
    visualPrompt: "old study",
    tags: ["wood"],
    notes: "",
    currentFolderId: "scene-folder",
    resourceProjectId: "project-1",
    allShots: [],
    scriptScenes: [],
    addScene: vi.fn(() => "variant-1"),
    updateScene: vi.fn(),
    selectScene: vi.fn(),
    setContactSheetTask: vi.fn(),
    onSceneCreated: vi.fn(),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(() => "ai-folder"),
    setContactSheetPrompt: vi.fn(),
    setContactSheetPromptZh: vi.fn(),
    setContactSheetImage: vi.fn(),
    setSplitViewpointImages: vi.fn(),
    setIsGeneratingContactSheet: vi.fn(),
  };
}

describe("useAutoContactSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scenes = [parent];
    mocks.featureConfig.mockReturnValue({
      apiKey: "key",
      baseUrl: "https://images.example.test/v1",
      models: ["grid-model"],
    });
    mocks.imageGrid.mockResolvedValue({ imageUrl: "data:image/png;base64,sheet" });
    mocks.splitStoryboardImage.mockResolvedValue([
      { row: 0, col: 0, dataUrl: "data:image/png;base64,front" },
    ]);
    mocks.saveImageToLocal
      .mockResolvedValueOnce("local-image://front.png")
      .mockResolvedValueOnce("local-image://sheet.png");
  });

  it("guards missing prompt and missing feature configuration", async () => {
    const noPrompt = { ...options(), contactSheetPrompt: null };
    const first = renderHook(() => useAutoContactSheet(noPrompt));
    await act(async () => first.result.current());
    expect(mocks.toast.error).toHaveBeenCalledWith("请先生成提示词");
    expect(noPrompt.setContactSheetTask).not.toHaveBeenCalled();

    mocks.featureConfig.mockReturnValue(null);
    const noConfig = options();
    const second = renderHook(() => useAutoContactSheet(noConfig));
    await act(async () => second.result.current());
    expect(mocks.toast.error).toHaveBeenCalledWith("未配置图片生成");
    expect(noConfig.setContactSheetTask).not.toHaveBeenCalled();
  });

  it("runs the detached generate, split, save, and archive pipeline", async () => {
    const input = options();
    const { result } = renderHook(() => useAutoContactSheet(input));

    await act(async () => result.current());
    expect(input.setContactSheetPrompt).toHaveBeenCalledWith(null);
    expect(input.setSplitViewpointImages).toHaveBeenCalledWith({});

    await waitFor(() => expect(input.updateScene).toHaveBeenCalled());
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      model: "grid-model",
      aspectRatio: "16:9",
      resolution: "2K",
    }));
    expect(mocks.splitStoryboardImage).toHaveBeenCalledWith(
      "data:image/png;base64,sheet",
      expect.objectContaining({ sceneCount: 4 }),
    );
    expect(input.addScene).toHaveBeenCalledWith(expect.objectContaining({
      name: "书房-正面",
      parentSceneId: "parent",
      viewpointId: "front",
      isViewpointVariant: true,
    }));
    expect(input.addMediaFromUrl).toHaveBeenCalledTimes(2);
    expect(input.updateScene).toHaveBeenCalledWith("parent", expect.objectContaining({
      contactSheetImage: "local-image://sheet.png",
      viewpoints: [expect.objectContaining({ id: "front" })],
    }));
    expect(input.setContactSheetTask.mock.calls.map((call) => call[1]?.progress)).toEqual([10, 30, 60, 80, 100]);
  });
});
