// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeRawScript, ProjectBackground, ScriptData } from "@/types/script";

const mocks = vi.hoisted(() => ({
  featureConfig: vi.fn(),
  calibrateScenes: vi.fn(),
  calibrateEpisodeScenes: vi.fn(),
  convertToScriptScenes: vi.fn(),
  syncToSeriesMeta: vi.fn(),
  exportProjectMetadata: vi.fn(),
  updateSeriesMeta: vi.fn(),
  setMetadataMarkdown: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: () => "未配置",
  },
}));
vi.mock("@/lib/script/scene-calibrator", () => ({
  calibrateScenes: mocks.calibrateScenes,
  calibrateEpisodeScenes: mocks.calibrateEpisodeScenes,
  convertToScriptScenes: mocks.convertToScriptScenes,
}));
vi.mock("@/lib/script/series-meta-sync", () => ({ syncToSeriesMeta: mocks.syncToSeriesMeta }));
vi.mock("@/lib/script/full-script-service", () => ({ exportProjectMetadata: mocks.exportProjectMetadata }));
vi.mock("@/stores/script-store", () => ({
  useScriptStore: {
    getState: () => ({
      projects: { p1: { seriesMeta: { title: "剧名" } } },
      updateSeriesMeta: mocks.updateSeriesMeta,
      setMetadataMarkdown: mocks.setMetadataMarkdown,
    }),
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useScriptSceneCalibration } from "./use-script-scene-calibration";

const background = { title: "剧名", outline: "大纲", characterBios: "人物" } as ProjectBackground;
const episodes: EpisodeRawScript[] = [{
  episodeIndex: 1,
  title: "第一集",
  rawContent: "内容",
  scenes: [],
  shotGenerationStatus: "idle",
}];
const scriptData = {
  title: "剧名",
  language: "中文",
  characters: [],
  episodes: [],
  storyParagraphs: [],
  scenes: [
    { id: "s1", name: "旧场景", location: "旧址", time: "day", atmosphere: "旧氛围", viewpoints: [{ id: "v1" }] },
    { id: "s2", name: "保留场景", location: "别处", time: "night", atmosphere: "安静" },
  ],
} as ScriptData;

function createOptions() {
  return {
    projectId: "p1",
    background,
    episodeRawScripts: episodes,
    scriptData,
    promptLanguage: "zh" as const,
    setScriptData: vi.fn(),
    setSceneCalibrationStatus: vi.fn(),
    addSecondPass: vi.fn(),
    removeSecondPass: vi.fn(),
  };
}

describe("useScriptSceneCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.featureConfig.mockReturnValue({
      allApiKeys: ["k1", "k2"],
      platform: "openai",
      baseUrl: "https://api.example",
    });
    mocks.syncToSeriesMeta.mockReturnValue({ scenes: scriptData.scenes });
    mocks.exportProjectMetadata.mockReturnValue("# metadata");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves scene identity and viewpoints while updating visual fields", async () => {
    mocks.calibrateScenes.mockResolvedValue({
      scenes: [{
        id: "s1",
        atmosphere: "新氛围",
        importance: "main",
        architectureStyle: "水墨楼阁",
        visualPromptZh: "新提示词",
      }],
      mergeRecords: [],
      analysisNotes: "完成",
    });
    const options = createOptions();
    const { result } = renderHook(() => useScriptSceneCalibration(options));

    await result.current.handleCalibrateScenes();

    const updated = options.setScriptData.mock.calls[0][1] as ScriptData;
    expect(updated.scenes).toHaveLength(2);
    expect(updated.scenes[0]).toEqual(expect.objectContaining({
      id: "s1",
      atmosphere: "新氛围",
      architectureStyle: "水墨楼阁",
      visualPrompt: "新提示词",
      viewpoints: [{ id: "v1" }],
    }));
    expect(options.setSceneCalibrationStatus.mock.calls.map(([status]) => status)).toEqual(["calibrating", "completed"]);
    expect(mocks.updateSeriesMeta).toHaveBeenCalledWith("p1", expect.any(Object));
    expect(mocks.setMetadataMarkdown).toHaveBeenCalledWith("p1", "# metadata");
  });

  it("keeps unrelated scenes when calibrating one episode", async () => {
    mocks.calibrateEpisodeScenes.mockResolvedValue({ scenes: [{ id: "s1" }], mergeRecords: [], analysisNotes: "" });
    mocks.convertToScriptScenes.mockReturnValue([{ id: "s1", location: "新址", time: "day", atmosphere: "新" }]);
    const options = createOptions();
    const { result } = renderHook(() => useScriptSceneCalibration(options));

    await result.current.handleCalibrateEpisodeScenes(1);

    const updated = options.setScriptData.mock.calls[0][1] as ScriptData;
    expect(updated.scenes.map((scene) => scene.id)).toEqual(["s2", "s1"]);
    expect(mocks.updateSeriesMeta).not.toHaveBeenCalled();
  });

  it("cleans up second-pass state and exposes failures", async () => {
    mocks.calibrateScenes.mockRejectedValue(new Error("provider down"));
    const options = createOptions();
    const { result } = renderHook(() => useScriptSceneCalibration(options));

    await result.current.handleCalibrateScenes();

    expect(options.setSceneCalibrationStatus.mock.calls.map(([status]) => status)).toEqual(["calibrating", "error"]);
    expect(options.removeSecondPass).toHaveBeenCalledWith("scenes");
    expect(mocks.toast.error).toHaveBeenCalledWith("场景校准失败: provider down");
  });
});
