// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  importFullScript: vi.fn(),
  getMissingTitleEpisodes: vi.fn(),
  calibrateEpisodeTitles: vi.fn(),
  generateEpisodeSynopses: vi.fn(),
  getMissingSynopsisEpisodes: vi.fn(),
  calibrateCharacters: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: mocks.featureConfig } }));
vi.mock("@/lib/script/full-script-service", () => ({
  importFullScript: mocks.importFullScript,
  getMissingTitleEpisodes: mocks.getMissingTitleEpisodes,
  calibrateEpisodeTitles: mocks.calibrateEpisodeTitles,
  generateEpisodeSynopses: mocks.generateEpisodeSynopses,
  getMissingSynopsisEpisodes: mocks.getMissingSynopsisEpisodes,
}));
vi.mock("@/lib/script/character-calibrator", () => ({
  calibrateCharacters: mocks.calibrateCharacters,
  convertToScriptCharacters: vi.fn((characters) => characters),
  resolveSafeScriptCharacters: vi.fn((characters) => ({ characters, source: "calibrated" })),
  sortByImportance: vi.fn((characters) => characters),
}));
vi.mock("@/stores/script-store", () => ({
  useScriptStore: { getState: () => ({ projects: {} }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useScriptFullImport } from "./use-script-full-import";

function createOptions() {
  return {
    projectId: "project-1",
    styleId: "ink",
    promptLanguage: "zh" as const,
    handleGenerateEpisodeShots: vi.fn(async () => ({ viewpointAnalyzed: true })),
    setImportStatus: vi.fn(),
    setImportError: vi.fn(),
    setMissingTitleCount: vi.fn(),
    setCalibrationStatus: vi.fn(),
    setProjectSynopsisStatus: vi.fn(),
    setMissingSynopsisCount: vi.fn(),
    setCharacterCalibrationStatus: vi.fn(),
    setCharacterCalibrationResult: vi.fn(),
    setScriptData: vi.fn(),
  };
}

describe("useScriptFullImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureConfig.mockReturnValue(null);
    mocks.getMissingTitleEpisodes.mockReturnValue([]);
    mocks.getMissingSynopsisEpisodes.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("guards empty input without entering import state", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptFullImport(options));
    await act(async () => result.current("   "));
    expect(mocks.toast.error).toHaveBeenCalledWith("请输入剧本内容");
    expect(options.setImportStatus).not.toHaveBeenCalled();
  });

  it("records terminal import failures", async () => {
    const options = createOptions();
    mocks.importFullScript.mockResolvedValue({ success: false, error: "格式错误" });
    const { result } = renderHook(() => useScriptFullImport(options));
    await act(async () => result.current("剧本"));
    expect(options.setImportStatus.mock.calls).toEqual([["importing"], ["error"]]);
    expect(options.setImportError).toHaveBeenLastCalledWith("格式错误");
  });

  it("preserves AI title, synopsis, and first-episode generation order", async () => {
    vi.useFakeTimers();
    const options = createOptions();
    mocks.featureConfig.mockReturnValue({
      allApiKeys: ["key"],
      platform: "openai",
      baseUrl: "https://api.test",
      models: ["model"],
    });
    mocks.importFullScript.mockResolvedValue({
      success: true,
      episodes: [{ episodeIndex: 1 }],
      scriptData: { characters: [], scenes: [] },
      projectBackground: null,
    });
    mocks.getMissingTitleEpisodes.mockReturnValue([{ episodeIndex: 1 }]);
    mocks.calibrateEpisodeTitles.mockResolvedValue({ success: true, calibratedCount: 1 });
    mocks.generateEpisodeSynopses.mockResolvedValue({ success: true, generatedCount: 1 });

    const { result } = renderHook(() => useScriptFullImport(options));
    let importPromise: Promise<void> | undefined;
    act(() => {
      importPromise = result.current("剧本");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await importPromise;
    });

    expect(options.setImportStatus.mock.calls).toEqual([["importing"], ["ready"]]);
    expect(mocks.calibrateEpisodeTitles).toHaveBeenCalled();
    expect(mocks.generateEpisodeSynopses).toHaveBeenCalled();
    expect(options.handleGenerateEpisodeShots).toHaveBeenCalledWith(1);
    expect(options.setCalibrationStatus).toHaveBeenLastCalledWith("completed");
    expect(options.setProjectSynopsisStatus).toHaveBeenLastCalledWith("completed");
  });
});
