// @vitest-environment jsdom

import { useRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { useStoryboardGenerationUi } from "./use-storyboard-generation-ui";
import { useStoryboardResultActions } from "./use-storyboard-result-actions";

const persistSceneImage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const scene = {
  id: 4,
  startFrameAngleSwitchHistory: [],
  endFrameAngleSwitchHistory: [{ imageUrl: "history-end", angleLabel: "侧面", timestamp: 1 }],
} as unknown as SplitScene;

function useHarness() {
  const controller = useStoryboardGenerationUi({ defaultImageGenMode: "merged" });
  const addMediaFromUrl = useRef(vi.fn(() => "media-1")).current;
  const updateSplitSceneImage = useRef(vi.fn()).current;
  const updateSplitSceneEndFrame = useRef(vi.fn()).current;
  const actions = useStoryboardResultActions({
    scenes: [scene],
    controller,
    mediaProjectId: "project-1",
    getImageFolderId: () => "folder-1",
    addMediaFromUrl,
    updateSplitSceneImage,
    updateSplitSceneEndFrame,
  });
  return { controller, actions, addMediaFromUrl, updateSplitSceneImage, updateSplitSceneEndFrame };
}

beforeEach(() => {
  vi.clearAllMocks();
  persistSceneImage.mockResolvedValue({ localPath: "local-image://saved.png", httpUrl: "https://saved.test/image.png" });
});

describe("useStoryboardResultActions", () => {
  it("persists and applies a selected quad-grid start frame", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => {
      result.current.controller.setQuadGridTarget({ sceneId: 4, type: "start" });
      result.current.controller.setQuadGridResult({
        originalImage: "original",
        images: ["quad-1", "quad-2"],
        variationType: "视角变体",
        variationLabels: ["正面", "侧面"],
      });
      result.current.controller.setQuadGridResultOpen(true);
    });

    await act(async () => result.current.actions.handleApplyQuadGrid(1));

    expect(persistSceneImage).toHaveBeenCalledWith("quad-2", 4, "first");
    expect(result.current.updateSplitSceneImage).toHaveBeenCalledWith(
      4,
      "local-image://saved.png",
      undefined,
      undefined,
      "https://saved.test/image.png",
    );
    expect(result.current.controller.quadGridResultOpen).toBe(false);
    expect(result.current.controller.quadGridResult).toBeNull();
  });

  it("saves every quad-grid image with the active project scope", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.controller.setQuadGridResult({
      originalImage: "original",
      images: ["quad-1", "quad-2"],
      variationType: "构图变体",
      variationLabels: ["居中", "三分"],
    }));

    act(() => result.current.actions.handleSaveAllQuadGridToLibrary());

    expect(result.current.addMediaFromUrl).toHaveBeenCalledTimes(2);
    expect(result.current.addMediaFromUrl).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "quad-1",
      folderId: "folder-1",
      projectId: "project-1",
    }));
  });

  it("applies the selected angle history image to the target end frame", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => {
      result.current.controller.setAngleSwitchTarget({ sceneId: 4, type: "end" });
      result.current.controller.setAngleSwitchResult({
        originalImage: "original",
        newImage: "latest-angle",
        angleLabel: "正面",
      });
      result.current.controller.setSelectedHistoryIndex(0);
      result.current.controller.setAngleSwitchResultOpen(true);
    });

    await act(async () => result.current.actions.handleApplyAngleSwitch());

    expect(persistSceneImage).toHaveBeenCalledWith("history-end", 4, "end");
    expect(result.current.updateSplitSceneEndFrame).toHaveBeenCalledWith(
      4,
      "local-image://saved.png",
      undefined,
      "https://saved.test/image.png",
    );
    expect(result.current.controller.selectedHistoryIndex).toBe(-1);
  });
});
