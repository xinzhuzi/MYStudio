// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "@/types/script";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  selectTrailerShots: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: mocks.featureConfig, featureNotConfiguredMessage: () => "未配置剧本 AI" },
}));
vi.mock("@/lib/script/trailer-service", () => ({ selectTrailerShots: mocks.selectTrailerShots }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useScriptTrailerGeneration } from "./use-script-trailer-generation";

const shot = {
  id: "shot-1",
  index: 1,
  sceneRefId: "scene-1",
  actionSummary: "主角回头",
  imagePrompt: "hero turns",
  duration: 5,
} as Shot;

function options(shots: Shot[] = [shot]) {
  return {
    shots,
    background: null,
    splitScenes: [],
    setTrailerConfig: vi.fn(),
    addScenesFromScript: vi.fn(),
  };
}

describe("useScriptTrailerGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue({ allApiKeys: ["key"], platform: "openai", baseUrl: "https://api.test" });
    mocks.selectTrailerShots.mockResolvedValue({ success: true, selectedShots: [shot], shotIds: [shot.id] });
  });

  it("guards an empty shot list", async () => {
    const input = options([]);
    const { result } = renderHook(() => useScriptTrailerGeneration(input));
    await act(async () => result.current(30));
    expect(mocks.toast.error).toHaveBeenCalledWith("请先生成分镜");
    expect(input.setTrailerConfig).not.toHaveBeenCalled();
  });

  it("selects shots, maps scenes, and reaches completed state", async () => {
    const input = options();
    const { result } = renderHook(() => useScriptTrailerGeneration(input));
    await act(async () => result.current(30));
    expect(input.setTrailerConfig.mock.calls[0][0]).toMatchObject({ status: "generating", duration: 30 });
    expect(input.addScenesFromScript).toHaveBeenCalledWith([expect.objectContaining({
      promptZh: "主角回头",
      imagePrompt: "hero turns",
      sceneName: "预告片 #1",
    })]);
    expect(input.setTrailerConfig.mock.calls[1][0]).toMatchObject({ status: "completed", shotIds: ["shot-1"] });
  });

  it("stores a terminal error when selection fails", async () => {
    mocks.selectTrailerShots.mockRejectedValue(new Error("network"));
    const input = options();
    const { result } = renderHook(() => useScriptTrailerGeneration(input));
    await act(async () => result.current(10));
    expect(input.setTrailerConfig).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error", error: "network" }));
    expect(mocks.toast.error).toHaveBeenCalledWith("预告片生成失败: network");
  });
});
