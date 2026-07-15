import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseScenes: vi.fn(),
  preprocessLineBreaks: vi.fn(),
  featureText: vi.fn(),
  store: {
    projects: {} as Record<string, any>,
    updateEpisodeRawScript: vi.fn(),
    setScriptData: vi.fn(),
    setShots: vi.fn(),
  },
}));

vi.mock("./episode-parser", () => ({ parseScenes: mocks.parseScenes }));
vi.mock("./script-normalizer", () => ({ preprocessLineBreaks: mocks.preprocessLineBreaks }));
vi.mock("./series-meta-sync", () => ({ buildSeriesContextSummary: () => "" }));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureText: mocks.featureText } }));
vi.mock("@/stores/script-store", () => ({ useScriptStore: { getState: () => mocks.store } }));

import { importSingleEpisodeContent } from "./single-episode-import-service";

function project() {
  return {
    scriptData: {
      title: "剧名",
      scenes: [{ id: "old-scene", location: "旧址", time: "day", atmosphere: "平静" }],
      episodes: [{ id: "ep-1", index: 1, title: "第一集", sceneIds: ["old-scene"] }],
    },
    shots: [{ id: "shot-1", sceneRefId: "old-scene" }, { id: "shot-2", sceneRefId: "other" }],
    episodeRawScripts: [{ episodeIndex: 1, title: "第1集", rawContent: "原内容", scenes: [] }],
    projectBackground: null,
    seriesMeta: null,
  };
}

describe("importSingleEpisodeContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.projects = {};
    mocks.preprocessLineBreaks.mockReturnValue({ text: "processed" });
    mocks.featureText.mockResolvedValue(null);
  });

  it("reports missing project state", async () => {
    await expect(importSingleEpisodeContent("raw", 1, "p1")).resolves.toEqual({
      success: false,
      sceneCount: 0,
      error: "项目或剧本数据不存在",
    });
  });

  it("updates raw content without replacing scenes when parsing finds none", async () => {
    mocks.store.projects.p1 = project();
    mocks.parseScenes.mockReturnValue([]);

    const result = await importSingleEpisodeContent("raw", 1, "p1");

    expect(result).toEqual({ success: true, sceneCount: 0 });
    expect(mocks.store.updateEpisodeRawScript).toHaveBeenCalledWith("p1", 1, { rawContent: "raw", scenes: [] });
    expect(mocks.store.setScriptData).not.toHaveBeenCalled();
  });

  it("replaces the episode scenes and removes shots tied to old scene ids", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    mocks.store.projects.p1 = project();
    mocks.parseScenes.mockReturnValue([{
      sceneHeader: "1-1 日 内 新院",
      characters: [],
      content: "危险冲突",
      dialogues: [],
      actions: [],
      subtitles: [],
    }]);

    const result = await importSingleEpisodeContent("raw", 1, "p1");

    expect(result).toEqual({ success: true, sceneCount: 1 });
    expect(mocks.store.setScriptData).toHaveBeenCalledWith("p1", expect.objectContaining({
      scenes: [expect.objectContaining({ id: "scene_ep1_123_1", location: "新院", atmosphere: "紧张" })],
      episodes: [expect.objectContaining({ sceneIds: ["scene_ep1_123_1"] })],
    }));
    expect(mocks.store.setShots).toHaveBeenCalledWith("p1", [{ id: "shot-2", sceneRefId: "other" }]);
  });
});
