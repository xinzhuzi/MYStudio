import { describe, expect, it, vi } from "vitest";

import type { SplitScene } from "@/stores/director-store";
import { writeStoryboardMergedImages } from "./storyboard-merged-image-writeback";

describe("writeStoryboardMergedImages", () => {
  it("persists and routes first and end frames to their existing writeback contracts", async () => {
    const firstScene = { id: 0, width: 1920, height: 1080 } as SplitScene;
    const endScene = { id: 1, width: 1080, height: 1920 } as SplitScene;
    const persistImage = vi.fn()
      .mockResolvedValueOnce({ localPath: "local-image://first.png", httpUrl: "https://host/first.png" })
      .mockResolvedValueOnce({ localPath: "local-image://end.png", httpUrl: null });
    const updateFirstFrame = vi.fn();
    const updateEndFrame = vi.fn();
    const addMedia = vi.fn();

    await writeStoryboardMergedImages({
      tasks: [
        { scene: firstScene, type: "first" },
        { scene: endScene, type: "end" },
      ],
      images: ["data:first", "data:end"],
      folderId: "folder-1",
      projectId: "project-1",
      persistImage,
      updateFirstFrame,
      updateEndFrame,
      addMedia,
    });

    expect(updateFirstFrame).toHaveBeenCalledWith(0, "local-image://first.png", 1920, 1080, "https://host/first.png");
    expect(updateEndFrame).toHaveBeenCalledWith(1, "local-image://end.png", "ai-generated", undefined);
    expect(addMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "分镜 1 - 首帧",
      source: "ai-image",
      projectId: "project-1",
    }));
    expect(addMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: "分镜 2 - 尾帧" }));
  });

  it("skips padded or missing sliced images", async () => {
    const persistImage = vi.fn();
    await writeStoryboardMergedImages({
      tasks: [{ scene: { id: 0 } as SplitScene, type: "first" }],
      images: [],
      folderId: "folder-1",
      persistImage,
      updateFirstFrame: vi.fn(),
      updateEndFrame: vi.fn(),
      addMedia: vi.fn(),
    });
    expect(persistImage).not.toHaveBeenCalled();
  });

  it("does not update scenes or media after cancellation during persistence", async () => {
    const controller = new AbortController();
    const persistImage = vi.fn(async () => {
      controller.abort();
      return { localPath: "local-image://aborted.png", httpUrl: null };
    });
    const updateFirstFrame = vi.fn();
    const addMedia = vi.fn();

    await expect(writeStoryboardMergedImages({
      tasks: [{ scene: { id: 0 } as SplitScene, type: "first" }],
      images: ["data:first"],
      signal: controller.signal,
      folderId: "folder-1",
      persistImage,
      updateFirstFrame,
      updateEndFrame: vi.fn(),
      addMedia,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(updateFirstFrame).not.toHaveBeenCalled();
    expect(addMedia).not.toHaveBeenCalled();
  });
});
