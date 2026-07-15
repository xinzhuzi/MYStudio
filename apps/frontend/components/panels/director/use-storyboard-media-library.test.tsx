// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaStore = vi.hoisted(() => ({
  addMediaFromUrl: vi.fn().mockReturnValue("media-1"),
  getOrCreateCategoryFolder: vi.fn((kind: string) => `${kind}-folder`),
}));

vi.mock("@/stores/media-store", () => ({
  useMediaStore: (selector: (state: typeof mediaStore) => unknown) => selector(mediaStore),
}));

import { useStoryboardMediaLibrary } from "./use-storyboard-media-library";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStoryboardMediaLibrary", () => {
  it("preserves project-scoped image and video library payloads", () => {
    const { result } = renderHook(() => useStoryboardMediaLibrary("project-1"));
    act(() => {
      expect(result.current.saveImage(2, "image.png")).toBe("media-1");
      expect(result.current.saveVideo(2, "video.mp4", "thumb.png", 8)).toBe("media-1");
    });

    expect(mediaStore.addMediaFromUrl).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "分镜 3 - AI图片",
      folderId: "ai-image-folder",
      projectId: "project-1",
    }));
    expect(mediaStore.addMediaFromUrl).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: "分镜 3 - AI视频",
      duration: 8,
      folderId: "ai-video-folder",
      projectId: "project-1",
    }));
  });
});
