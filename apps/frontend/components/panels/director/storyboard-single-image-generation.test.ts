import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { createStoryboardSingleImageGenerator } from "./storyboard-single-image-generation";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  imageGrid: vi.fn(),
  poll: vi.fn(),
  persist: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: mocks.featureConfig, imageGrid: mocks.imageGrid },
}));
vi.mock("@/lib/storyboard/image-task-transport", () => ({ pollImageTaskUrl: mocks.poll }));
vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage: mocks.persist }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));

const scene = {
  id: 5,
  imagePromptZh: "首帧提示",
  width: 1920,
  height: 1080,
} as unknown as SplitScene;

function setup() {
  const updateStatus = vi.fn();
  const updateImage = vi.fn();
  const autoSaveImage = vi.fn();
  const setGenerating = vi.fn();
  const generate = createStoryboardSingleImageGenerator({
    getScene: () => scene,
    aspectRatio: "16:9",
    resolution: "2K",
    prepareRequest: vi.fn().mockResolvedValue({ prompt: "prepared", referenceImages: ["ref"] }),
    updateStatus,
    updateImage,
    autoSaveImage,
    setGenerating,
  });
  return { generate, updateStatus, updateImage, autoSaveImage, setGenerating };
}

describe("createStoryboardSingleImageGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({
      keyManager: { getCurrentKey: () => "key" },
      models: ["image-model"],
      baseUrl: "https://api.test/",
    });
    mocks.persist.mockResolvedValue({ localPath: "local-image", httpUrl: "http-image" });
  });

  it("writes direct results and preserves dimensions and library save", async () => {
    mocks.imageGrid.mockResolvedValue({ imageUrl: "remote-image" });
    const result = setup();
    await result.generate(5);

    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "prepared",
      referenceImages: ["ref"],
      baseUrl: "https://api.test",
      signal: undefined,
    }));
    expect(result.updateImage).toHaveBeenCalledWith(5, "local-image", 1920, 1080, "http-image");
    expect(result.autoSaveImage).toHaveBeenCalledWith(5, "local-image");
    expect(result.setGenerating).toHaveBeenLastCalledWith(false);
  });

  it("polls task results and marks transport errors as failed", async () => {
    mocks.imageGrid.mockResolvedValue({ taskId: "task-1" });
    mocks.poll.mockResolvedValue("polled-image");
    const result = setup();
    await result.generate(5);
    expect(mocks.poll).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", maxAttempts: 60 }));
    expect(mocks.persist).toHaveBeenCalledWith("polled-image", 5, "first");

    mocks.imageGrid.mockRejectedValue(new Error("offline"));
    await result.generate(5);
    expect(result.updateStatus).toHaveBeenLastCalledWith(5, {
      imageStatus: "failed",
      imageProgress: 0,
      imageError: "offline",
    });
    expect(mocks.error).toHaveBeenCalledWith("分镜 6 图片生成失败: offline");
  });
});
