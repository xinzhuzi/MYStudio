// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStoryboardResolutionToastHandlers } from "./use-storyboard-resolution-toast-handlers";

const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useStoryboardResolutionToastHandlers", () => {
  it("updates image resolution and reports the selected value", () => {
    const setStoryboardConfig = vi.fn();
    const { result } = renderHook(() => useStoryboardResolutionToastHandlers(setStoryboardConfig));

    act(() => result.current.handleImageResolutionChange("2K"));

    expect(setStoryboardConfig).toHaveBeenCalledWith({ resolution: "2K" });
    expect(toast.success).toHaveBeenCalledWith("图片分辨率已切换为 2K");
  });

  it("updates video resolution and reports the selected value", () => {
    const setStoryboardConfig = vi.fn();
    const { result } = renderHook(() => useStoryboardResolutionToastHandlers(setStoryboardConfig));

    act(() => result.current.handleVideoResolutionChange("1080p"));

    expect(setStoryboardConfig).toHaveBeenCalledWith({ videoResolution: "1080p" });
    expect(toast.success).toHaveBeenCalledWith("视频分辨率已切换为 1080p");
  });
});
