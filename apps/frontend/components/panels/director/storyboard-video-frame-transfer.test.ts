import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareReferenceImageForTransfer: vi.fn(),
  uploadToImageHost: vi.fn(),
  isImageHostConfigured: vi.fn(),
  readImageAsBase64: vi.fn(),
  currentHostConfigured: false,
}));

vi.mock("@/lib/ai/image-transfer", () => ({
  prepareReferenceImageForTransfer: mocks.prepareReferenceImageForTransfer,
}));
vi.mock("@/lib/image-host", () => ({
  uploadToImageHost: mocks.uploadToImageHost,
  isImageHostConfigured: mocks.isImageHostConfigured,
}));
vi.mock("@/lib/image-storage", () => ({
  readImageAsBase64: mocks.readImageAsBase64,
}));
vi.mock("@/stores/api-config-store", () => ({
  useAPIConfigStore: {
    getState: () => ({ isImageHostConfigured: () => mocks.currentHostConfigured }),
  },
}));

import { convertStoryboardFrameToHttpUrl } from "./storyboard-video-frame-transfer";

describe("storyboard video frame transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentHostConfigured = false;
    mocks.isImageHostConfigured.mockReturnValue(true);
  });

  it("passes through a usable remote URL when a refresh is not required", async () => {
    await expect(convertStoryboardFrameToHttpUrl("https://cdn.example.com/frame.png", {
      uploadName: "scene_1_frame_1",
    })).resolves.toBe("https://cdn.example.com/frame.png");

    expect(mocks.prepareReferenceImageForTransfer).not.toHaveBeenCalled();
    expect(mocks.uploadToImageHost).not.toHaveBeenCalled();
  });

  it("refreshes a remote URL through the current image host when a local fallback exists", async () => {
    mocks.currentHostConfigured = true;
    mocks.prepareReferenceImageForTransfer.mockResolvedValue("data:image/jpeg;base64,thumb");
    mocks.uploadToImageHost.mockResolvedValue({ success: true, url: "https://host.example.com/frame.jpg" });

    await expect(convertStoryboardFrameToHttpUrl("https://legacy.example.com/frame.png", {
      localFallback: "data:image/png;base64,source",
      frameLabel: "First frame",
      uploadName: "scene_1_frame_2",
    })).resolves.toBe("https://host.example.com/frame.jpg");

    expect(mocks.prepareReferenceImageForTransfer).toHaveBeenCalledWith("data:image/png;base64,source");
    expect(mocks.uploadToImageHost).toHaveBeenCalledWith(
      "data:image/jpeg;base64,thumb",
      expect.objectContaining({ name: "scene_1_frame_2", expiration: 15552000 }),
    );
  });

  it("reads local-image URLs before preparing and uploading the reference image", async () => {
    mocks.readImageAsBase64.mockResolvedValue("data:image/png;base64,source");
    mocks.prepareReferenceImageForTransfer.mockResolvedValue("data:image/jpeg;base64,thumb");
    mocks.uploadToImageHost.mockResolvedValue({ success: true, url: "https://host.example.com/frame.jpg" });

    await expect(convertStoryboardFrameToHttpUrl("local-image://project/frame.png", {
      uploadName: "scene_2_frame_3",
    })).resolves.toBe("https://host.example.com/frame.jpg");

    expect(mocks.readImageAsBase64).toHaveBeenCalledWith("local-image://project/frame.png");
    expect(mocks.prepareReferenceImageForTransfer).toHaveBeenCalledWith("data:image/png;base64,source");
  });
});
