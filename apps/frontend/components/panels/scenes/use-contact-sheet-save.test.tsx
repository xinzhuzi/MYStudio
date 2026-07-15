// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/scene-store";

const mocks = vi.hoisted(() => ({
  saveImageToLocal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  scenes: [] as Scene[],
}));

vi.mock("@/lib/image-storage", () => ({ saveImageToLocal: mocks.saveImageToLocal }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/stores/scene-store", () => ({
  useSceneStore: { getState: () => ({ scenes: mocks.scenes }) },
}));

import { useContactSheetSave } from "./use-contact-sheet-save";

const parent = {
  id: "parent",
  name: "书房",
  location: "书房",
  time: "day",
  atmosphere: "peaceful",
  createdAt: 1,
  updatedAt: 1,
} as Scene;

function options() {
  return {
    selectedScene: parent,
    splitViewpointImages: { v1: { imageUrl: "data:image/png;base64,cell", gridIndex: 0 } },
    contactSheetImage: "data:image/png;base64,sheet",
    extractedViewpoints: [{ id: "v1", name: "正面", nameEn: "Front", shotIds: [], keyProps: [], gridIndex: 0 } as never],
    pendingViewpoints: [],
    pendingContactSheetPrompts: [],
    currentPageIndex: 0,
    allShots: [],
    scriptScenes: [],
    name: "书房",
    location: "书房",
    time: "day",
    atmosphere: "peaceful",
    styleId: "ink",
    currentFolderId: null,
    resourceProjectId: "p1",
    addScene: vi.fn(() => "variant-1"),
    updateScene: vi.fn(),
    selectScene: vi.fn(),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(() => "ai-folder"),
    setSavedChildSceneIds: vi.fn(),
    setContactSheetPrompt: vi.fn(),
    setContactSheetPromptZh: vi.fn(),
    setContactSheetImage: vi.fn(),
    setSplitViewpointImages: vi.fn(),
    setExtractedViewpoints: vi.fn(),
    setPendingViewpoints: vi.fn(),
    setPendingContactSheetPrompts: vi.fn(),
  };
}

describe("useContactSheetSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scenes = [];
    mocks.saveImageToLocal
      .mockResolvedValueOnce("local-image://variant.png")
      .mockResolvedValueOnce("local-image://sheet.png");
  });

  it("creates a viewpoint scene, archives images, updates the parent, and clears temporary state", async () => {
    const input = options();
    const { result } = renderHook(() => useContactSheetSave(input));

    await act(async () => result.current());

    expect(input.addScene).toHaveBeenCalledWith(expect.objectContaining({
      name: "书房-正面",
      parentSceneId: "parent",
      viewpointId: "v1",
      isViewpointVariant: true,
    }));
    expect(input.addMediaFromUrl).toHaveBeenCalledTimes(2);
    expect(input.updateScene).toHaveBeenCalledWith("parent", expect.objectContaining({
      contactSheetImage: "local-image://sheet.png",
      viewpoints: [expect.objectContaining({ id: "v1", name: "正面" })],
    }));
    expect(input.setSavedChildSceneIds).toHaveBeenCalledWith(["variant-1"]);
    expect(input.setSplitViewpointImages).toHaveBeenCalledWith({});
  });

  it("guards empty split results", async () => {
    const input = { ...options(), splitViewpointImages: {} };
    const { result } = renderHook(() => useContactSheetSave(input));

    await act(async () => result.current());

    expect(mocks.toast.error).toHaveBeenCalledWith("没有可保存的视角图片");
    expect(input.addScene).not.toHaveBeenCalled();
  });
});
