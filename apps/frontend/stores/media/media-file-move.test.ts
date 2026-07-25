import { describe, expect, it } from "vitest";
import type { MediaFile, MediaFolder } from "@/types/media";
import {
  getLocalMediaUrlCategory,
  getMediaFileStorageMoveCategory,
  getMediaStorageCategoryForNewUrl,
  withMovedMediaUrl,
} from "./media-file-move";

const imageFile: MediaFile = {
  id: "media-1",
  name: "frame",
  type: "image",
  url: "local-image://shots/frame.png",
};

describe("media file physical folder move helpers", () => {
  it("maps an image moved to the AI image system folder onto the ai-image storage folder", () => {
    const aiImageFolder: MediaFolder = {
      id: "folder-ai-image",
      name: "AI图片",
      parentId: null,
      isSystem: true,
      category: "ai-image",
      createdAt: 1,
    };

    expect(getMediaFileStorageMoveCategory(imageFile, aiImageFolder)).toBe("ai-image");
  });

  it("does not physically move files for custom organization folders", () => {
    const customFolder: MediaFolder = {
      id: "folder-custom",
      name: "参考图",
      parentId: null,
      category: "custom",
      createdAt: 1,
    };

    expect(getMediaFileStorageMoveCategory(imageFile, customFolder)).toBe(null);
  });

  it("updates the media url after the local file has moved", () => {
    expect(withMovedMediaUrl(imageFile, "folder-ai-image", "local-image://ai-image/frame.png")).toEqual({
      ...imageFile,
      folderId: "folder-ai-image",
      url: "local-image://ai-image/frame.png",
    });
  });

  it("extracts the physical storage category from local media urls", () => {
    expect(getLocalMediaUrlCategory("local-image://shots/frame.png")).toBe("shots");
    expect(getLocalMediaUrlCategory("local-video://videos/take.mp4")).toBe("videos");
    expect(getLocalMediaUrlCategory("https://example.test/frame.png")).toBe(null);
  });

  it("stores new AI images in the ai-image physical folder", () => {
    const aiImageFolder: MediaFolder = {
      id: "folder-ai-image",
      name: "AI图片",
      parentId: null,
      isSystem: true,
      category: "ai-image",
      createdAt: 1,
    };

    expect(getMediaStorageCategoryForNewUrl("image", "ai-image", aiImageFolder)).toBe("ai-image");
    expect(getMediaStorageCategoryForNewUrl("image", "ai-image", null)).toBe("ai-image");
  });
});
