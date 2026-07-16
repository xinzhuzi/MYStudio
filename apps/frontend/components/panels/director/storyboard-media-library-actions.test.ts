import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { saveStoryboardSceneToLibrary } from "./storyboard-media-library-actions";

const { toast } = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast }));

const scene = {
  id: 1,
  imageDataUrl: "data:image/png;base64,image",
  videoUrl: "https://cdn.example/video.mp4",
  duration: 7,
} as SplitScene;

describe("saveStoryboardSceneToLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes generated videos to the video folder with image thumbnail", () => {
    const addMediaFromUrl = vi.fn(() => "media-video");

    saveStoryboardSceneToLibrary({
      scene,
      type: "video",
      projectId: "project-1",
      addMediaFromUrl,
      getImageFolderId: () => "images",
      getVideoFolderId: () => "videos",
    });

    expect(addMediaFromUrl).toHaveBeenCalledWith({
      url: scene.videoUrl,
      name: "分镜 2 - AI视频",
      type: "video",
      source: "ai-video",
      thumbnailUrl: scene.imageDataUrl,
      duration: 7,
      folderId: "videos",
      projectId: "project-1",
    });
    expect(toast.success).toHaveBeenCalledWith("分镜 2 视频已保存到素材库");
  });

  it("writes generated images to the image folder and reports missing media", () => {
    const addMediaFromUrl = vi.fn(() => "media-image");

    saveStoryboardSceneToLibrary({
      scene,
      type: "image",
      addMediaFromUrl,
      getImageFolderId: () => "images",
      getVideoFolderId: () => "videos",
    });
    expect(addMediaFromUrl).toHaveBeenCalledWith({
      url: scene.imageDataUrl,
      name: "分镜 2 - AI图片",
      type: "image",
      source: "ai-image",
      folderId: "images",
    });

    saveStoryboardSceneToLibrary({
      scene: { ...scene, imageDataUrl: "" } as SplitScene,
      type: "image",
      addMediaFromUrl,
      getImageFolderId: () => "images",
      getVideoFolderId: () => "videos",
    });
    expect(toast.error).toHaveBeenCalledWith("没有可保存的图片");
  });
});
