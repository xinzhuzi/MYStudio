import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { runSClassSingleShotGeneration } from "./sclass-single-shot-generation";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  featureNotConfiguredMessage: vi.fn(() => "not configured"),
  video: vi.fn(),
  buildImageWithRoles: vi.fn(),
  saveVideoLocally: vi.fn(),
  runWithRotation: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: mocks.featureNotConfiguredMessage,
    video: mocks.video,
  },
}));
vi.mock("@/lib/ai/video-generator", () => ({
  buildImageWithRoles: mocks.buildImageWithRoles,
  saveVideoLocally: mocks.saveVideoLocally,
}));
vi.mock("@/stores/director-store", () => ({
  useDirectorStore: {
    getState: () => ({
      activeProjectId: "project-1",
      projects: { "project-1": { storyboardConfig: { aspectRatio: "9:16", videoResolution: "1080p" } } },
    }),
  },
}));
vi.mock("./sclass-video-retry", () => ({
  runSClassVideoWithKeyRotation: mocks.runWithRotation,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const scene = {
  id: 3,
  imageDataUrl: "frame",
  videoPrompt: "prompt",
  duration: 8,
} as unknown as SplitScene;

describe("runSClassSingleShotGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({
      platform: "provider",
      keyManager: { getCurrentKey: () => "key" },
    });
    mocks.buildImageWithRoles.mockResolvedValue([{ url: "frame", role: "first_frame" }]);
    mocks.runWithRotation.mockImplementation(({ invoke }: { invoke: (apiKey: string) => Promise<string> }) => invoke("rotated-key"));
    mocks.video.mockResolvedValue("remote-video");
    mocks.saveVideoLocally.mockResolvedValue("local-video");
  });

  it("preserves progress, shared config, save, and completion updates", async () => {
    const updateSingleShotVideo = vi.fn();

    await expect(runSClassSingleShotGeneration({
      scene,
      activeProjectId: "project-1",
      updateSingleShotVideo,
    })).resolves.toBe(true);

    expect(mocks.runWithRotation).toHaveBeenCalledWith(expect.objectContaining({
      label: "Single shot",
      context: { sceneId: 3 },
    }));
    expect(mocks.video).toHaveBeenCalledWith(
      "rotated-key",
      "prompt",
      8,
      "9:16",
      [{ url: "frame", role: "first_frame" }],
      expect.any(Function),
      expect.any(Object),
      "provider",
      "1080p",
    );
    expect(mocks.saveVideoLocally).toHaveBeenCalledWith("remote-video", 3);
    expect(updateSingleShotVideo).toHaveBeenLastCalledWith(3, {
      videoStatus: "completed",
      videoProgress: 100,
      videoUrl: "local-video",
      videoError: null,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("分镜 4 生成完成");
  });

  it("fails before status mutation when the feature is not configured", async () => {
    mocks.featureConfig.mockReturnValue(null);
    const updateSingleShotVideo = vi.fn();

    await expect(runSClassSingleShotGeneration({
      scene,
      activeProjectId: "project-1",
      updateSingleShotVideo,
    })).resolves.toBe(false);

    expect(updateSingleShotVideo).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("not configured");
  });
});
