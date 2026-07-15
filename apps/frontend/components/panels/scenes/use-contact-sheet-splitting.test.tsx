// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  splitStoryboardImage: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/storyboard/image-splitter", () => ({ splitStoryboardImage: mocks.splitStoryboardImage }));
vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: { defaultResolution: "2K" } }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useContactSheetSplitting } from "./use-contact-sheet-splitting";

function options() {
  return {
    contactSheetImage: "data:image/png;base64,image",
    contactSheetPrompt: "prompt",
    contactSheetLayout: "3x3" as const,
    contactSheetAspectRatio: "16:9" as const,
    extractedViewpoints: [{ id: "v1", gridIndex: 0 } as never],
    pendingViewpoints: [],
    pendingContactSheetPrompts: [],
    currentPageIndex: 0,
    selectScene: vi.fn(),
    setName: vi.fn(),
    setLocation: vi.fn(),
    setContactSheetLayout: vi.fn(),
    setContactSheetPrompt: vi.fn(),
    setContactSheetPromptZh: vi.fn(),
    setContactSheetImage: vi.fn(),
    setExtractedViewpoints: vi.fn(),
    setPendingViewpoints: vi.fn(),
    setPendingContactSheetPrompts: vi.fn(),
    setCurrentPageIndex: vi.fn(),
    setSplitViewpointImages: vi.fn(),
    setIsSplitting: vi.fn(),
  };
}

describe("useContactSheetSplitting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.splitStoryboardImage.mockResolvedValue([{ row: 0, col: 0, dataUrl: "cell-1" }]);
  });

  it("uses the prompt page layout instead of the global layout when splitting", async () => {
    const input = options();
    input.pendingContactSheetPrompts = [{ gridLayout: { rows: 2, cols: 2 } } as never];
    const { result } = renderHook(() => useContactSheetSplitting(input));

    await act(async () => result.current.handleSplitContactSheet());

    expect(mocks.splitStoryboardImage).toHaveBeenCalledWith("data:image/png;base64,image", expect.objectContaining({
      sceneCount: 4,
      options: expect.objectContaining({ expectedRows: 2, expectedCols: 2 }),
    }));
    expect(input.setSplitViewpointImages).toHaveBeenCalledWith({ v1: { imageUrl: "cell-1", gridIndex: 0 } });
    expect(input.setIsSplitting.mock.calls).toEqual([[true], [false]]);
  });

  it("rebuilds direct-upload viewpoints when the layout changes", () => {
    const input = options();
    input.contactSheetPrompt = "[直接上传 - 无提示词]";
    const { result } = renderHook(() => useContactSheetSplitting(input));

    act(() => result.current.handleContactSheetLayoutChange("2x2"));

    expect(input.setContactSheetLayout).toHaveBeenCalledWith("2x2");
    expect(input.setExtractedViewpoints).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "viewpoint-1", gridIndex: 0 }),
    ]));
    expect(input.setPendingViewpoints.mock.calls[0][0]).toHaveLength(4);
    expect(input.setSplitViewpointImages).toHaveBeenCalledWith({});
  });

  it("guards splitting without an image", async () => {
    const input = { ...options(), contactSheetImage: null };
    const { result } = renderHook(() => useContactSheetSplitting(input));

    await act(async () => result.current.handleSplitContactSheet());

    expect(mocks.toast.error).toHaveBeenCalledWith("请先上传联合图并生成提示词");
    expect(mocks.splitStoryboardImage).not.toHaveBeenCalled();
  });
});
