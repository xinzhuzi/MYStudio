import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { createSClassSingleVideoGenerator } from "./sclass-single-video-generation";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  featureNotConfiguredMessage: vi.fn(() => "未配置视频服务"),
  video: vi.fn(),
  convertToHttpUrl: vi.fn(),
  saveVideoToLocal: vi.fn(),
  buildVideoPrompt: vi.fn(),
  getStylePrompt: vi.fn(),
  getMediaType: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: mocks.featureNotConfiguredMessage,
    video: mocks.video,
  },
}));
vi.mock("@/lib/ai/video-generator", () => ({
  convertToHttpUrl: mocks.convertToHttpUrl,
  extractLastFrameFromVideo: vi.fn(),
  isContentModerationError: vi.fn(() => false),
}));
vi.mock("@/lib/image-storage", () => ({ saveVideoToLocal: mocks.saveVideoToLocal }));
vi.mock("@/lib/utils/image-persist", () => ({ persistSceneImage: vi.fn() }));
vi.mock("@/lib/constants/visual-styles", () => ({
  getStylePrompt: mocks.getStylePrompt,
  getMediaType: mocks.getMediaType,
}));
vi.mock("@/lib/constants/cinematography-profiles", () => ({ getCinematographyProfile: vi.fn() }));
vi.mock("@/lib/generation/prompt-builder", () => ({ buildVideoPrompt: mocks.buildVideoPrompt }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));

const scene = {
  id: 3,
  imageDataUrl: "local-first-frame",
  imageSource: "uploaded",
  needsEndFrame: false,
  duration: 3,
  characterIds: [],
} as unknown as SplitScene;

function setup(currentScenes: readonly SplitScene[] = [scene]) {
  const updateSplitSceneVideo = vi.fn();
  const updateSplitSceneEndFrame = vi.fn();
  const setIsGenerating = vi.fn();
  const setCurrentGeneratingId = vi.fn();
  const autoSaveVideoToLibrary = vi.fn(() => "media-1");
  const generate = createSClassSingleVideoGenerator({
    scenes: currentScenes,
    storyboardConfig: { aspectRatio: "16:9", videoResolution: "480p" },
    projectData: undefined,
    currentStyleId: "ink",
    setIsGenerating,
    setCurrentGeneratingId,
    updateSplitSceneVideo,
    updateSplitSceneEndFrame,
    autoSaveVideoToLibrary,
    getCharacterReferenceImages: vi.fn(() => []),
  });
  return { generate, updateSplitSceneVideo, updateSplitSceneEndFrame, setIsGenerating, setCurrentGeneratingId, autoSaveVideoToLibrary };
}

describe("createSClassSingleVideoGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({
      platform: "openai",
      models: ["video-model"],
      baseUrl: "https://video.test/",
      keyManager: { getCurrentKey: () => "key" },
    });
    mocks.convertToHttpUrl.mockResolvedValue("https://images.test/frame.png");
    mocks.saveVideoToLocal.mockResolvedValue("local-video");
    mocks.buildVideoPrompt.mockReturnValue("video prompt");
    mocks.getStylePrompt.mockReturnValue("ink style");
    mocks.getMediaType.mockReturnValue("animation");
    mocks.video.mockResolvedValue("remote-video");
  });

  it("rejects a scene without a first frame before calling the provider", async () => {
    const result = setup([{ id: 3 } as SplitScene]);
    await result.generate(3);

    expect(mocks.error).toHaveBeenCalledWith("分镜 4 没有首帧图片，请先生成图片");
    expect(mocks.video).not.toHaveBeenCalled();
    expect(result.setIsGenerating).toHaveBeenLastCalledWith(false);
  });

  it("keeps the first-frame video contract and persists the completed result", async () => {
    const result = setup();
    await result.generate(3);

    expect(mocks.video).toHaveBeenCalledWith(
      "key",
      "video prompt",
      4,
      "16:9",
      [{ url: "https://images.test/frame.png", role: "first_frame" }],
      expect.any(Function),
      expect.any(Object),
      "openai",
      "480p",
    );
    expect(result.autoSaveVideoToLibrary).toHaveBeenCalledWith(3, "local-video", "local-first-frame", 4);
    expect(result.updateSplitSceneVideo).toHaveBeenLastCalledWith(3, {
      videoStatus: "completed",
      videoProgress: 100,
      videoUrl: "local-video",
      videoMediaId: "media-1",
    });
    expect(mocks.success).toHaveBeenCalledWith("分镜 4 视频生成完成，已保存到素材库");
  });
});
