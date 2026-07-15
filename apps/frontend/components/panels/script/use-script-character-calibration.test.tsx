// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeRawScript, ProjectBackground, ScriptData } from "@/types/script";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  extractAllCharactersFromEpisodes: vi.fn(),
  calibrateCharacters: vi.fn(),
  sortByImportance: vi.fn(),
  convertToScriptCharacters: vi.fn(),
  resolveSafeScriptCharacters: vi.fn(),
  detectMultiStageHints: vi.fn(),
  analyzeCharacterStages: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: () => "未配置",
  },
}));
vi.mock("@/lib/script/character-calibrator", () => ({
  extractAllCharactersFromEpisodes: mocks.extractAllCharactersFromEpisodes,
  calibrateCharacters: mocks.calibrateCharacters,
  sortByImportance: mocks.sortByImportance,
  convertToScriptCharacters: mocks.convertToScriptCharacters,
  resolveSafeScriptCharacters: mocks.resolveSafeScriptCharacters,
}));
vi.mock("@/lib/script/character-stage-analyzer", () => ({
  detectMultiStageHints: mocks.detectMultiStageHints,
  analyzeCharacterStages: mocks.analyzeCharacterStages,
}));
vi.mock("@/stores/script-store", () => ({
  useScriptStore: { getState: () => ({ projects: {} }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useScriptCharacterCalibration } from "./use-script-character-calibration";

const background = { title: "剧名", outline: "大纲", characterBios: "人物" } as ProjectBackground;
const episodes: EpisodeRawScript[] = [{
  episodeIndex: 1,
  title: "第一集",
  rawContent: "角色：阿青",
  scenes: [],
  shotGenerationStatus: "idle",
}];
const scriptData = { characters: [{ id: "old", name: "旧角色" }] } as ScriptData;

function createOptions() {
  return {
    projectId: "project-1",
    scriptData,
    background,
    calibrationStrictness: "normal" as const,
    episodeRawScripts: episodes,
    promptLanguage: "zh" as const,
    setCalibrationState: vi.fn(),
    setCharacterCalibrationStatus: vi.fn(),
    setStageAnalysisStatus: vi.fn(),
    setMultiStageHints: vi.fn(),
    setSuggestMultiStage: vi.fn(),
    setCharacterCalibrationResult: vi.fn(),
    addSecondPass: vi.fn(),
    removeSecondPass: vi.fn(),
  };
}

describe("useScriptCharacterCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.featureConfig.mockReturnValue({ apiKey: "key" });
    mocks.extractAllCharactersFromEpisodes.mockReturnValue([{ name: "阿青" }]);
    mocks.calibrateCharacters.mockResolvedValue({
      characters: [{ name: "阿青" }],
      filteredCharacters: [],
      filteredWords: [],
      mergeRecords: [],
      analysisNotes: "完成",
    });
    mocks.sortByImportance.mockImplementation((characters) => characters);
    mocks.convertToScriptCharacters.mockReturnValue([{ id: "hero", name: "阿青" }]);
    mocks.detectMultiStageHints.mockReturnValue({ suggestMultiStage: false, hints: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the confirmation state after successful calibration", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useScriptCharacterCalibration(options));

    await act(async () => result.current.handleCalibrateCharacters());

    expect(options.addSecondPass).toHaveBeenCalledWith("characters");
    expect(options.setCalibrationState).toHaveBeenLastCalledWith("project-1", {
      pendingCalibrationCharacters: [{ id: "hero", name: "阿青" }],
      pendingFilteredCharacters: [],
      calibrationDialogOpen: true,
    });
    expect(options.setCharacterCalibrationStatus).toHaveBeenCalledWith("completed");
    expect(options.removeSecondPass).toHaveBeenCalledWith("characters");
  });

  it("guards missing feature configuration", async () => {
    mocks.featureConfig.mockReturnValue(null);
    const options = createOptions();
    const { result } = renderHook(() => useScriptCharacterCalibration(options));

    await act(async () => result.current.handleCalibrateCharacters());

    expect(mocks.toast.error).toHaveBeenCalledWith("未配置");
    expect(options.addSecondPass).not.toHaveBeenCalled();
  });

  it("cleans up state after calibration failure", async () => {
    mocks.calibrateCharacters.mockRejectedValue(new Error("provider down"));
    const options = createOptions();
    const { result } = renderHook(() => useScriptCharacterCalibration(options));

    await act(async () => result.current.handleCalibrateCharacters());

    expect(options.setCharacterCalibrationStatus).toHaveBeenCalledWith("error");
    expect(options.removeSecondPass).toHaveBeenCalledWith("characters");
    expect(mocks.toast.error).toHaveBeenCalledWith("角色校准失败: provider down");
  });
});
