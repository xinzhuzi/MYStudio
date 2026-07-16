// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { detectMultiStageHints } from "@/lib/script/character-stage-analyzer";
import { resolveSafeScriptCharacters } from "@/lib/script/character-calibrator";
import { useScriptStore } from "@/stores/script-store";
import { useScriptCharacterReviewActions } from "./use-script-character-review-actions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/script/character-stage-analyzer", () => ({ detectMultiStageHints: vi.fn() }));
vi.mock("@/lib/script/character-calibrator", () => ({ resolveSafeScriptCharacters: vi.fn() }));
vi.mock("@/lib/script/full-script-service", () => ({ exportProjectMetadata: vi.fn(() => "metadata") }));
vi.mock("@/lib/script/series-meta-sync", () => ({ syncToSeriesMeta: vi.fn(() => ({ characters: [] })) }));
vi.mock("@/stores/script-store", () => ({ useScriptStore: { getState: vi.fn() } }));

describe("useScriptCharacterReviewActions", () => {
  const setScriptData = vi.fn();
  const setLastFilteredCharacters = vi.fn();
  const setCalibrationState = vi.fn();
  const setCalibrationStrictness = vi.fn();
  const setMultiStageHints = vi.fn();
  const setSuggestMultiStage = vi.fn();
  const calibrateCharacters = vi.fn(async () => undefined);
  const scriptData = { episodes: [], characters: [{ id: "old", name: "旧角色" }], scenes: [] };
  const updateSeriesMeta = vi.fn();
  const setMetadataMarkdown = vi.fn();

  function renderActions(overrides: Partial<Parameters<typeof useScriptCharacterReviewActions>[0]> = {}) {
    return renderHook(() => useScriptCharacterReviewActions({
      projectId: "p1", importStatus: "idle", episodeCount: 1, calibrateCharacters,
      setMultiStageHints, setSuggestMultiStage, setScriptData, setLastFilteredCharacters,
      setCalibrationState, setCalibrationStrictness, ...overrides,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScriptStore.getState).mockReturnValue({
      projects: { p1: { scriptData, seriesMeta: { characters: [] }, lastFilteredCharacters: [{ name: "路人", reason: "未出场" }] } },
      updateSeriesMeta, setMetadataMarkdown,
    } as never);
  });

  it("commits kept characters and closes the calibration dialog", () => {
    const kept = [{ id: "c1", name: "阿青" }];
    const filtered = [{ name: "路人", reason: "未出场" }];
    const { result } = renderActions();
    act(() => result.current.handleConfirmCalibration(kept, filtered));

    expect(setScriptData).toHaveBeenCalledWith("p1", { ...scriptData, characters: kept });
    expect(setLastFilteredCharacters).toHaveBeenCalledWith("p1", filtered);
    expect(setCalibrationState).toHaveBeenCalledWith("p1", {
      calibrationDialogOpen: false, pendingCalibrationCharacters: null, pendingFilteredCharacters: [],
    });
    expect(updateSeriesMeta).toHaveBeenCalled();
    expect(setMetadataMarkdown).toHaveBeenCalledWith("p1", "metadata");
    expect(toast.success).toHaveBeenCalledWith("角色校准确认: 1 个角色已保存");
  });

  it("uses the safe fallback when calibration keeps no character", () => {
    const fallback = [{ id: "safe", name: "安全角色" }];
    vi.mocked(resolveSafeScriptCharacters).mockReturnValue({ characters: fallback, source: "existing" } as never);
    const { result } = renderActions();
    act(() => result.current.handleConfirmCalibration([], []));
    expect(resolveSafeScriptCharacters).toHaveBeenCalledWith([], {
      existingCharacters: scriptData.characters, seriesMetaCharacters: [],
    });
    expect(setScriptData).toHaveBeenCalledWith("p1", { ...scriptData, characters: fallback });
  });

  it("restores a filtered character and exposes the established controls", () => {
    const { result } = renderActions();
    act(() => {
      result.current.handleRestoreFilteredCharacter("路人");
      result.current.handleCalibrationStrictnessChange("strict");
      result.current.handleCancelCalibration();
    });
    expect(setScriptData).toHaveBeenCalledWith("p1", expect.objectContaining({
      characters: expect.arrayContaining([expect.objectContaining({ name: "路人", tags: ["extra", "restored"] })]),
    }));
    expect(setLastFilteredCharacters).toHaveBeenCalledWith("p1", []);
    expect(setCalibrationStrictness).toHaveBeenCalledWith("p1", "strict");
    expect(result.current.handleAnalyzeCharacterStages).toBe(calibrateCharacters);
    expect(toast.info).toHaveBeenCalledWith("已取消角色校准");
  });

  it("derives multi-stage hints only after import is ready", () => {
    vi.mocked(detectMultiStageHints).mockReturnValue({
      hasTimeSpan: true, hasAgeChange: true, hints: ["少年→成年"], suggestMultiStage: true,
    });
    const { rerender } = renderHook(
      ({ importStatus }) => useScriptCharacterReviewActions({
        projectId: "p1", importStatus, outline: "第一幕", episodeCount: 2, calibrateCharacters,
        setMultiStageHints, setSuggestMultiStage, setScriptData, setLastFilteredCharacters,
        setCalibrationState, setCalibrationStrictness,
      }),
      { initialProps: { importStatus: "idle" } },
    );
    expect(detectMultiStageHints).not.toHaveBeenCalled();
    rerender({ importStatus: "ready" });
    expect(detectMultiStageHints).toHaveBeenCalledWith("第一幕", 2);
    expect(setMultiStageHints).toHaveBeenCalledWith(["少年→成年"]);
    expect(setSuggestMultiStage).toHaveBeenCalledWith(true);
  });
});
