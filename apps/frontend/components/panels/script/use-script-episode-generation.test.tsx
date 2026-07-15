// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { generateEpisodeShots } from "@/lib/script/full-script-service";
import { toast } from "sonner";
import { useScriptEpisodeGeneration } from "./use-script-episode-generation";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: vi.fn() },
}));
vi.mock("@/lib/script/full-script-service", () => ({
  generateEpisodeShots: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

describe("useScriptEpisodeGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves configured provider options and completed viewpoint status", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      platform: "zhipu",
      allApiKeys: ["key-1", "key-2"],
      baseUrl: "https://api.example.com",
    } as ReturnType<typeof aiManager.featureConfig>);
    vi.mocked(generateEpisodeShots).mockResolvedValue({
      shots: [{ id: "shot-1" } as never],
      viewpointAnalyzed: true,
    });
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptEpisodeGeneration({
      projectId: "project-1",
      styleId: "ink",
      targetDuration: "60s",
      promptLanguage: "zh",
      setViewpointAnalysisStatus: setStatus,
    }));

    const response = await result.current(2);

    expect(response.viewpointAnalyzed).toBe(true);
    expect(generateEpisodeShots).toHaveBeenCalledWith(
      2,
      "project-1",
      expect.objectContaining({
        apiKey: "key-1,key-2",
        provider: "zhipu",
        baseUrl: "https://api.example.com",
        styleId: "ink",
        targetDuration: "60s",
        promptLanguage: "zh",
      }),
      expect.any(Function),
    );
    expect(setStatus.mock.calls.map(([status]) => status)).toEqual(["analyzing", "completed"]);
  });

  it("keeps missing-config generation and viewpoint failure semantics", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    vi.mocked(generateEpisodeShots).mockResolvedValue({
      shots: [],
      viewpointAnalyzed: false,
      viewpointSkippedReason: "未配置模型",
    });
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptEpisodeGeneration({
      projectId: "project-1",
      styleId: "ink",
      targetDuration: "60s",
      promptLanguage: "zh",
      setViewpointAnalysisStatus: setStatus,
    }));

    const response = await result.current(1);

    expect(response.viewpointSkippedReason).toBe("未配置模型");
    expect(toast.warning).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("AI 视角分析未执行：未配置模型");
    expect(setStatus.mock.calls.map(([status]) => status)).toEqual(["analyzing", "error"]);
  });

  it("returns the established empty result when generation throws", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    vi.mocked(generateEpisodeShots).mockRejectedValue(new Error("provider down"));
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptEpisodeGeneration({
      projectId: "project-1",
      styleId: "ink",
      targetDuration: "60s",
      promptLanguage: "zh",
      setViewpointAnalysisStatus: setStatus,
    }));

    await expect(result.current(1)).resolves.toEqual({
      shots: [],
      viewpointAnalyzed: false,
      viewpointSkippedReason: "provider down",
    });
    expect(setStatus).toHaveBeenLastCalledWith("error");
  });
});
