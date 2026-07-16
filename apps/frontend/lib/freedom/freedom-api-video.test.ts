import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetFeatureRoundRobin } from "@/lib/ai/feature-router";
import { clearAllManagers } from "@/lib/api-key-manager";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { generateFreedomVideo } from "./freedom-api";
import { runFreedomVideoRoute } from "./freedom-video-dispatch";

const mocks = vi.hoisted(() => ({
  addMediaFromUrl: vi.fn(() => "media-1"),
}));

vi.mock("@/stores/media-store", () => ({
  useMediaStore: {
    getState: () => ({ addMediaFromUrl: mocks.addMediaFromUrl }),
  },
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({ activeProjectId: "project-1" }),
  },
}));

vi.mock("./freedom-video-dispatch", () => ({
  runFreedomVideoRoute: vi.fn(),
}));

const provider = {
  id: "torchai",
  platform: "custom",
  name: "torchai",
  baseUrl: "https://torchai.ai/v1",
  apiKey: "sk-test",
  model: ["sora-2"],
};

describe("generateFreedomVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllManagers();
    resetFeatureRoundRobin();
    useAPIConfigStore.setState({
      providers: [provider],
      featureBindings: {
        freedom_video: ["torchai:sora-2"],
      },
      modelEndpointTypes: {
        "sora-2": ["openAI官方视频格式"],
      },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes the configured model and saves the generated video", async () => {
    vi.mocked(runFreedomVideoRoute).mockResolvedValue({
      url: "https://video.test/out.mp4",
      taskId: "task-1",
    });
    const params = {
      prompt: "山门前的远景镜头",
      aspectRatio: "16:9",
      duration: 5,
    };

    const result = await generateFreedomVideo(params);

    expect(runFreedomVideoRoute).toHaveBeenCalledWith(
      "openai_official",
      expect.objectContaining({
        openai_official: expect.any(Function),
        unified: expect.any(Function),
        volc: expect.any(Function),
        wan: expect.any(Function),
        kling: expect.any(Function),
        replicate: expect.any(Function),
      }),
      params,
      "sora-2",
      "sk-test",
      "https://torchai.ai/v1",
    );
    expect(mocks.addMediaFromUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://video.test/out.mp4",
      type: "video",
      source: "ai-video",
      projectId: "project-1",
    }));
    expect(result).toEqual({
      url: "https://video.test/out.mp4",
      taskId: "task-1",
      mediaId: "media-1",
    });
  });

  it("falls back to the shared video generation mapping", async () => {
    useAPIConfigStore.setState({
      featureBindings: {
        freedom_video: [],
        video_generation: ["torchai:sora-2"],
      },
    } as never);
    vi.mocked(runFreedomVideoRoute).mockResolvedValue({ url: "https://video.test/fallback.mp4" });

    await generateFreedomVideo({ prompt: "fallback" });

    expect(runFreedomVideoRoute).toHaveBeenCalledWith(
      "openai_official",
      expect.any(Object),
      { prompt: "fallback" },
      "sora-2",
      "sk-test",
      "https://torchai.ai/v1",
    );
  });

  it("fails before dispatch when neither video mapping is configured", async () => {
    useAPIConfigStore.setState({
      providers: [],
      featureBindings: {
        freedom_video: [],
        video_generation: [],
      },
    } as never);

    await expect(generateFreedomVideo({ prompt: "unconfigured" })).rejects.toThrow();
    expect(runFreedomVideoRoute).not.toHaveBeenCalled();
    expect(mocks.addMediaFromUrl).not.toHaveBeenCalled();
  });

  it("retries route overloads and saves media only after success", async () => {
    vi.useFakeTimers();
    vi.mocked(runFreedomVideoRoute)
      .mockRejectedValueOnce(Object.assign(new Error("upstream 503"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("upstream 503"), { status: 503 }))
      .mockResolvedValue({ url: "https://video.test/retried.mp4" });

    const result = generateFreedomVideo({ prompt: "retry video" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(runFreedomVideoRoute).toHaveBeenCalledTimes(2);
    expect(mocks.addMediaFromUrl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);

    await expect(result).resolves.toEqual(expect.objectContaining({
      url: "https://video.test/retried.mp4",
      mediaId: "media-1",
    }));
    expect(runFreedomVideoRoute).toHaveBeenCalledTimes(3);
    expect(mocks.addMediaFromUrl).toHaveBeenCalledTimes(1);
  });

  it("uses the next configured key after a quota error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    useAPIConfigStore.setState({
      providers: [{ ...provider, apiKey: "sk-bad\nsk-good" }],
    } as never);
    vi.mocked(runFreedomVideoRoute)
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { status: 429 }))
      .mockResolvedValue({ url: "https://video.test/rotated.mp4" });

    const result = generateFreedomVideo({ prompt: "rotate key" });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toEqual(expect.objectContaining({ url: "https://video.test/rotated.mp4" }));

    expect(vi.mocked(runFreedomVideoRoute).mock.calls[0]?.[4]).toBe("sk-bad");
    expect(vi.mocked(runFreedomVideoRoute).mock.calls[1]?.[4]).toBe("sk-good");
    expect(mocks.addMediaFromUrl).toHaveBeenCalledTimes(1);
  });
});
