import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { createSClassEndFrameGenerator } from "./sclass-end-frame-generation";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  imageGrid: vi.fn(),
  poll: vi.fn(),
  persist: vi.fn(),
  normalize: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: mocks.featureConfig, imageGrid: mocks.imageGrid },
}));
vi.mock("@/lib/constants/visual-styles", () => ({ getStylePrompt: () => "ink style" }));
vi.mock("@/lib/storyboard/image-task-transport", () => ({ pollImageTaskUrl: mocks.poll }));
vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage: mocks.persist }));
vi.mock("../director/storyboard-reference-image-normalizer", () => ({
  normalizeStoryboardReferenceImages: mocks.normalize,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));

const scene = {
  id: 2,
  endFramePromptZh: "走到门口",
  endFrameSceneReferenceImage: "scene-ref",
  imageDataUrl: "first-frame",
  characterIds: ["char-1"],
} as unknown as SplitScene;

function setup(currentScene: SplitScene | undefined = scene) {
  const updateStatus = vi.fn();
  const updateEndFrame = vi.fn();
  const setGenerating = vi.fn();
  const addMedia = vi.fn();
  const generate = createSClassEndFrameGenerator({
    getScene: () => currentScene,
    currentStyleId: "ink",
    aspectRatio: "16:9",
    resolution: "2K",
    readImage: vi.fn(),
    getCharacterReferenceImages: () => ["char-ref"],
    updateStatus,
    updateEndFrame,
    setGenerating,
    folderId: () => "folder",
    projectId: "project",
    addMedia,
  });
  return { generate, updateStatus, updateEndFrame, setGenerating, addMedia };
}

describe("createSClassEndFrameGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({
      keyManager: { getCurrentKey: () => "key" },
      models: ["image-model"],
      baseUrl: "https://api.test/",
      platform: "openai",
    });
    mocks.normalize.mockImplementation(async (references: string[]) => references);
    mocks.persist.mockResolvedValue({ localPath: "local-image", httpUrl: "http-image" });
  });

  it("validates prompt and provider configuration before entering generating state", async () => {
    const noPrompt = setup({ id: 2 } as SplitScene);
    await noPrompt.generate(2);
    expect(mocks.warning).toHaveBeenCalledWith("请先填写尾帧提示词后再生成");
    expect(noPrompt.setGenerating).not.toHaveBeenCalled();

    mocks.featureConfig.mockReturnValue(undefined);
    const missingConfig = setup();
    await missingConfig.generate(2);
    expect(mocks.error).toHaveBeenCalledWith("请先在设置中配置图片生成服务映射");
  });

  it("persists a direct image result and writes it to the project media folder", async () => {
    mocks.imageGrid.mockResolvedValue({ imageUrl: "remote-image" });
    const result = setup();
    await result.generate(2);

    expect(mocks.normalize).toHaveBeenCalledWith(
      ["scene-ref", "first-frame", "char-ref"],
      expect.objectContaining({ max: 14 }),
    );
    expect(mocks.imageGrid).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "走到门口. Style: ink style",
      baseUrl: "https://api.test",
      aspectRatio: "16:9",
      resolution: "2K",
    }));
    expect(result.updateEndFrame).toHaveBeenCalledWith(2, "local-image", "ai-generated", "http-image");
    expect(result.addMedia).toHaveBeenCalledWith(expect.objectContaining({
      url: "local-image",
      name: "分镜 3 - 尾帧",
      folderId: "folder",
      projectId: "project",
    }));
    expect(result.setGenerating).toHaveBeenLastCalledWith(false);
  });

  it("polls async tasks with the existing progress and retry contract", async () => {
    mocks.imageGrid.mockResolvedValue({ taskId: "task-1" });
    mocks.poll.mockImplementation(async ({ onProgress }) => {
      onProgress(45);
      return "polled-image";
    });
    const result = setup();
    await result.generate(2);

    expect(mocks.poll).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      maxAttempts: 60,
      pollIntervalMs: 2000,
      noCache: true,
    }));
    expect(result.updateStatus).toHaveBeenCalledWith(2, { endFrameProgress: 45 });
    expect(mocks.persist).toHaveBeenCalledWith("polled-image", 2, "end");
  });

  it("converts generation failures into the existing failed state and toast", async () => {
    mocks.imageGrid.mockRejectedValue(new Error("offline"));
    const result = setup();
    await result.generate(2);

    expect(result.updateStatus).toHaveBeenLastCalledWith(2, {
      endFrameStatus: "failed",
      endFrameProgress: 0,
      endFrameError: "offline",
    });
    expect(mocks.error).toHaveBeenCalledWith("分镜 3 尾帧生成失败: offline");
    expect(result.setGenerating).toHaveBeenLastCalledWith(false);
  });
});
