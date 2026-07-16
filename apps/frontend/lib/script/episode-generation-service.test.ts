import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyzeEpisodeViewpoints: vi.fn(),
  generateShotsForEpisode: vi.fn(),
  getState: vi.fn(),
}));

vi.mock("@/stores/script-store", () => ({
  useScriptStore: { getState: mocks.getState },
}));
vi.mock("./episode-shot-generation", () => ({
  generateShotsForEpisode: mocks.generateShotsForEpisode,
}));
vi.mock("./episode-viewpoint-analysis", () => ({
  analyzeEpisodeViewpoints: mocks.analyzeEpisodeViewpoints,
}));

import {
  generateEpisodeShots,
  getEpisodeGenerationSummary,
  regenerateAllEpisodeShots,
} from "./episode-generation-service";
import {
  generateEpisodeShots as generateEpisodeShotsFromFacade,
  getEpisodeGenerationSummary as getEpisodeGenerationSummaryFromFacade,
  regenerateAllEpisodeShots as regenerateAllEpisodeShotsFromFacade,
} from "./full-script-service";

const options = {
  apiKey: "key-1",
  provider: "openai",
  styleId: "ink",
  targetDuration: "60s",
};

function createProject() {
  return {
    episodeRawScripts: [{
      episodeIndex: 1,
      title: "第一集",
      rawContent: "第一集内容",
      scenes: [{
        sceneHeader: "1-1 日 内 山门",
        characters: [],
        content: "角色进入山门",
        dialogues: [],
        actions: ["进入"],
        subtitles: [],
      }],
      shotGenerationStatus: "idle",
    }],
    scriptData: {
      title: "项目",
      language: "中文",
      characters: [],
      scenes: [{ id: "scene-1", location: "山门", time: "日", atmosphere: "肃静" }],
      episodes: [{ id: "episode-1", index: 1, title: "第一集", sceneIds: ["scene-1"] }],
      storyParagraphs: [],
    },
    projectBackground: null,
    shots: [
      { id: "old-shot", episodeId: "episode-1" },
      { id: "other-shot", episodeId: "episode-2" },
    ],
  };
}

function configureStore(project = createProject()) {
  const state = {
    projects: { "project-1": project },
    setScriptData: vi.fn(),
    setShots: vi.fn(),
    updateEpisodeRawScript: vi.fn(),
  };
  mocks.getState.mockReturnValue(state);
  return state;
}

describe("episode generation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateShotsForEpisode.mockResolvedValue([
      { id: "new-shot", episodeId: "episode-1", sceneRefId: "scene-1" },
    ]);
    mocks.analyzeEpisodeViewpoints.mockResolvedValue({ viewpointAnalyzed: true });
  });

  it("preserves the generation state, replacement, and viewpoint contracts", async () => {
    const state = configureStore();
    const onProgress = vi.fn();

    await expect(generateEpisodeShots(1, "project-1", options, onProgress)).resolves.toEqual({
      shots: [{ id: "new-shot", episodeId: "episode-1", sceneRefId: "scene-1" }],
      viewpointAnalyzed: true,
      viewpointSkippedReason: undefined,
    });

    expect(state.updateEpisodeRawScript).toHaveBeenNthCalledWith(1, "project-1", 1, {
      shotGenerationStatus: "generating",
    });
    expect(state.setShots).toHaveBeenCalledWith("project-1", [
      { id: "other-shot", episodeId: "episode-2" },
      { id: "new-shot", episodeId: "episode-1", sceneRefId: "scene-1" },
    ]);
    expect(mocks.analyzeEpisodeViewpoints).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      options,
      setScriptData: state.setScriptData,
    }));
    expect(state.updateEpisodeRawScript).toHaveBeenLastCalledWith("project-1", 1, expect.objectContaining({
      shotGenerationStatus: "completed",
      lastGeneratedAt: expect.any(Number),
    }));
    expect(onProgress).toHaveBeenCalledWith("正在为第 1 集生成分镜...");
    expect(onProgress).toHaveBeenLastCalledWith("第 1 集分镜生成完成！共 1 个分镜");
  });

  it("records the established error status and rejects empty batch generation", async () => {
    const state = configureStore();
    mocks.generateShotsForEpisode.mockRejectedValueOnce(new Error("provider down"));

    await expect(generateEpisodeShots(1, "project-1", options)).rejects.toThrow("provider down");
    expect(state.updateEpisodeRawScript).toHaveBeenLastCalledWith("project-1", 1, {
      shotGenerationStatus: "error",
    });

    configureStore({ ...createProject(), episodeRawScripts: [] });
    await expect(regenerateAllEpisodeShots("project-1", options)).rejects.toThrow("没有可生成的集");
  });

  it("keeps the facade identity and missing-project summary", () => {
    configureStore({ ...createProject(), episodeRawScripts: [] });

    expect(generateEpisodeShotsFromFacade).toBe(generateEpisodeShots);
    expect(regenerateAllEpisodeShotsFromFacade).toBe(regenerateAllEpisodeShots);
    expect(getEpisodeGenerationSummaryFromFacade).toBe(getEpisodeGenerationSummary);
    mocks.getState.mockReturnValue({ projects: {} });
    expect(getEpisodeGenerationSummary("missing")).toEqual({
      total: 0,
      completed: 0,
      generating: 0,
      idle: 0,
      error: 0,
    });
  });
});
