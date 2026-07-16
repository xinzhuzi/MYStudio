// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { regenerateAllEpisodeShots } from "@/lib/script/full-script-service";
import { toast } from "sonner";
import { useScriptBatchShotRegeneration } from "./use-script-batch-shot-regeneration";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: vi.fn() },
}));
vi.mock("@/lib/script/full-script-service", () => ({
  regenerateAllEpisodeShots: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

function useRegenerationHook(episodeCount: number) {
  return useScriptBatchShotRegeneration({
    projectId: "project-1",
    episodeCount,
    styleId: "ink",
    targetDuration: "60s",
    promptLanguage: "zh",
  });
}

describe("useScriptBatchShotRegeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty episode set without calling the service", async () => {
    const { result } = renderHook(() => useRegenerationHook(0));

    await result.current();

    expect(toast.error).toHaveBeenCalledWith("没有可生成的集");
    expect(regenerateAllEpisodeShots).not.toHaveBeenCalled();
  });

  it("preserves the configured provider options and terminal toasts", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ["key-1", "key-2"],
      platform: "zhipu",
    } as never);
    vi.mocked(regenerateAllEpisodeShots).mockResolvedValue(undefined);
    const { result } = renderHook(() => useRegenerationHook(2));

    await result.current();

    expect(regenerateAllEpisodeShots).toHaveBeenCalledWith("project-1", {
      apiKey: "key-1,key-2",
      provider: "zhipu",
      styleId: "ink",
      targetDuration: "60s",
      promptLanguage: "zh",
    }, expect.any(Function));
    expect(toast.info).toHaveBeenCalledWith("正在为全部 2 集生成分镜...（可能需要较长时间）");
    expect(toast.success).toHaveBeenCalledWith("全部 2 集分镜生成完成！");
  });

  it("keeps the existing unconfigured fallback contract", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    vi.mocked(regenerateAllEpisodeShots).mockResolvedValue(undefined);
    const { result } = renderHook(() => useRegenerationHook(1));

    await result.current();

    expect(regenerateAllEpisodeShots).toHaveBeenCalledWith("project-1", {
      apiKey: "",
      provider: "openai",
      styleId: "ink",
      targetDuration: "60s",
      promptLanguage: "zh",
    }, expect.any(Function));
  });

  it("keeps the failure toast contract", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(regenerateAllEpisodeShots).mockRejectedValue(new Error("provider down"));
    const { result } = renderHook(() => useRegenerationHook(3));

    await result.current();

    expect(toast.error).toHaveBeenCalledWith("分镜生成失败: provider down");
  });
});
