import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { createStoryboardEndFrameGenerator } from "./storyboard-end-frame-generation";

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
  id: 4,
  endFramePromptZh: "走到门口",
} as unknown as SplitScene;

function setup(currentScene: SplitScene | undefined = scene) {
  const updateStatus = vi.fn();
  const updateEndFrame = vi.fn();
  const setGenerating = vi.fn();
  const addMedia = vi.fn();
  const prepareRequest = vi.fn().mockResolvedValue({
    prompt: "走到门口. identity lock",
    referenceImages: ["scene-ref", "character-ref"],
  });
  const generate = createStoryboardEndFrameGenerator({
    getScene: () => currentScene,
    aspectRatio: "16:9",
    resolution: "2K",
    prepareRequest,
    updateStatus,
    updateEndFrame,
    setGenerating,
    folderId: () => "folder",
    projectId: "project",
    addMedia,
  });
  return { generate, prepareRequest, updateStatus, updateEndFrame, setGenerating, addMedia };
}

describe("createStoryboardEndFrameGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({
      keyManager: { getCurrentKey: () => "key" },
      models: ["image-model"],
      baseUrl: "https://api.test/",
      platform: "openai",
    });
    mocks.persist.mockResolvedValue({ localPath: "local-image", httpUrl: "http-image" });
  });

  it("keeps request preparation outside the transport controller", async () => {
    mocks.imageGrid.mockResolvedValue({ imageUrl: "remote-image" });
    const result = setup();
    await result.generate(4);

    expect(result.prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
      scene,
      model: "image-model",
      promptToUse: "走到门口",
    }));
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "走到门口. identity lock",
      referenceImages: ["scene-ref", "character-ref"],
      signal: undefined,
    }));
    expect(result.updateEndFrame).toHaveBeenCalledWith(4, "local-image", "ai-generated", "http-image");
    expect(result.setGenerating).toHaveBeenLastCalledWith(false);
  });

  it("preserves polling progress and the failed terminal state", async () => {
    mocks.imageGrid.mockResolvedValue({ taskId: "task-1" });
    mocks.poll.mockImplementation(async ({ onProgress }) => {
      onProgress(45);
      return "polled-image";
    });
    const result = setup();
    await result.generate(4);

    expect(mocks.poll).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", maxAttempts: 60 }));
    expect(result.updateStatus).toHaveBeenCalledWith(4, { endFrameProgress: 45 });
    expect(mocks.persist).toHaveBeenCalledWith("polled-image", 4, "end");

    mocks.imageGrid.mockRejectedValue(new Error("offline"));
    await result.generate(4);
    expect(result.updateStatus).toHaveBeenLastCalledWith(4, {
      endFrameStatus: "failed",
      endFrameProgress: 0,
      endFrameError: "offline",
    });
    expect(mocks.error).toHaveBeenCalledWith("分镜 5 尾帧生成失败: offline");
  });

  it("does not mark an aborted request as failed", async () => {
    mocks.imageGrid.mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    const result = setup();
    await result.generate(4);

    expect(result.updateStatus).toHaveBeenCalledWith(4, {
      endFrameStatus: "generating",
      endFrameProgress: 0,
      endFrameError: null,
    });
    expect(result.updateStatus).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ endFrameStatus: "failed" }));
    expect(result.setGenerating).toHaveBeenLastCalledWith(false);
  });
});
