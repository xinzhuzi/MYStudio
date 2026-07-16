// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { calibrateEpisodeShots, calibrateSingleShot } from "@/lib/script/full-script-service";
import { toast } from "sonner";
import { useScriptShotCalibration } from "./use-script-shot-calibration";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureConfig: vi.fn(), featureNotConfiguredMessage: vi.fn(() => "未配置") },
}));
vi.mock("@/lib/script/full-script-service", () => ({
  calibrateEpisodeShots: vi.fn(),
  calibrateSingleShot: vi.fn(),
  exportProjectMetadata: vi.fn(() => "metadata"),
}));
vi.mock("@/lib/script/series-meta-sync", () => ({ syncToSeriesMeta: vi.fn(() => ({})) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

function renderCalibration(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    setViewpointAnalysisStatus: vi.fn(),
    setSingleShotCalibrationStatus: vi.fn(),
    addSecondPass: vi.fn(),
    removeSecondPass: vi.fn(),
  };
  const options = {
    projectId: "project-1",
    scriptData: {
      episodes: [{ id: "episode-1", index: 2, sceneIds: ["scene-1"] }],
      scenes: [{ id: "scene-1", name: "医院", location: "医院", time: "夜", atmosphere: "安静" }],
      characters: [],
    },
    shots: [{ id: "shot-1", actionSummary: "角色推门进入" }],
    styleId: "ink",
    promptLanguage: "zh" as const,
    ...callbacks,
    ...overrides,
  };
  return { ...renderHook(() => useScriptShotCalibration(options as never)), callbacks };
}

describe("useScriptShotCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("preserves the missing configuration exit", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    const { result, callbacks } = renderCalibration();

    await result.current.handleCalibrateShots(1);

    expect(toast.error).toHaveBeenCalledWith("未配置");
    expect(calibrateEpisodeShots).not.toHaveBeenCalled();
    expect(callbacks.addSecondPass).not.toHaveBeenCalled();
  });

  it("preserves episode success status and provider options", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ["k1", "k2"], platform: "zhipu", baseUrl: "https://api.test", models: ["model-1"],
    } as never);
    vi.mocked(calibrateEpisodeShots).mockResolvedValue({ success: true, calibratedCount: 3, totalShots: 4 });
    const { result, callbacks } = renderCalibration();

    await result.current.handleCalibrateShots(2);

    expect(calibrateEpisodeShots).toHaveBeenCalledWith(2, "project-1", expect.objectContaining({
      apiKey: "k1,k2", provider: "zhipu", model: "model-1", styleId: "ink",
    }), expect.any(Function));
    expect(callbacks.setViewpointAnalysisStatus.mock.calls.map(([status]) => status)).toEqual(["analyzing", "completed"]);
    expect(callbacks.removeSecondPass).toHaveBeenCalledWith("shots");
  });

  it("passes the scene filter without metadata side effects", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ["k"], platform: "openai" } as never);
    vi.mocked(calibrateEpisodeShots).mockResolvedValue({ success: true, calibratedCount: 1, totalShots: 1 });
    const { result } = renderCalibration();

    await result.current.handleCalibrateScenesShots("scene-1");

    expect(calibrateEpisodeShots).toHaveBeenCalledWith(
      2, "project-1", expect.any(Object), expect.any(Function), "scene-1",
    );
  });

  it("preserves single-shot calibrating and failure states", async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ["k"], platform: "openai" } as never);
    vi.mocked(calibrateSingleShot).mockResolvedValue({ success: false, error: "provider down" } as never);
    const { result, callbacks } = renderCalibration();

    await result.current.handleCalibrateSingleShot("shot-1");

    expect(callbacks.setSingleShotCalibrationStatus.mock.calls.map(([, , status]) => status)).toEqual(["calibrating", "error"]);
    expect(toast.error).toHaveBeenCalledWith("分镜校准失败: provider down");
  });
});
