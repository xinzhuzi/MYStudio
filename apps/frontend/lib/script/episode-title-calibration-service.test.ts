import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processBatched: vi.fn(),
  state: { projects: {} as Record<string, unknown> },
  updateEpisodeRawScript: vi.fn(),
  setScriptData: vi.fn(),
}));

vi.mock("@/lib/ai/batch-processor", () => ({ processBatched: mocks.processBatched }));
vi.mock("@/stores/script-store", () => ({
  useScriptStore: {
    getState: () => ({
      ...mocks.state,
      updateEpisodeRawScript: mocks.updateEpisodeRawScript,
      setScriptData: mocks.setScriptData,
    }),
  },
}));

import {
  calibrateEpisodeTitles,
  getMissingTitleEpisodes,
} from "./episode-title-calibration-service";

describe("episode title calibration service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.projects = {};
  });

  it("returns explicit terminal results for missing projects and complete titles", async () => {
    await expect(calibrateEpisodeTitles("missing")).resolves.toEqual({
      success: false,
      calibratedCount: 0,
      totalMissing: 0,
      error: "项目不存在",
    });

    mocks.state.projects.project = {
      episodeRawScripts: [{ episodeIndex: 1, title: "第1集：归来", scenes: [] }],
    };
    expect(getMissingTitleEpisodes("project")).toEqual([]);
    await expect(calibrateEpisodeTitles("project")).resolves.toEqual({
      success: true,
      calibratedCount: 0,
      totalMissing: 0,
    });
    expect(mocks.processBatched).not.toHaveBeenCalled();
  });

  it("preserves batch parsing, progress, and both title writebacks", async () => {
    const scriptData = {
      title: "测试剧",
      logline: "测试大纲",
      episodes: [{ index: 1, title: "第1集" }],
    };
    mocks.state.projects.project = {
      episodeRawScripts: [{ episodeIndex: 1, title: "第1集", scenes: [] }],
      projectBackground: { title: "测试剧", outline: "测试大纲", characterBios: "人物" },
      scriptData,
      seriesMeta: null,
    };
    mocks.processBatched.mockImplementation(async (options: {
      items: Array<{ index: number; contentSummary: string }>;
      buildPrompts: (items: Array<{ index: number; contentSummary: string }>) => { system: string; user: string };
      parseResult: (raw: string) => Map<string, string>;
    }) => {
      const prompts = options.buildPrompts(options.items);
      expect(prompts.system).toContain("测试剧");
      expect(prompts.user).toContain("第1集内容摘要");
      return {
        results: options.parseResult('```json\n{"titles":{"1":"雨夜归来"}}\n```'),
        failedBatches: 0,
        totalBatches: 1,
      };
    });
    const onProgress = vi.fn();

    await expect(calibrateEpisodeTitles("project", {}, onProgress)).resolves.toEqual({
      success: true,
      calibratedCount: 1,
      totalMissing: 1,
    });
    expect(mocks.updateEpisodeRawScript).toHaveBeenCalledWith("project", 1, {
      title: "第1集：雨夜归来",
    });
    expect(scriptData.episodes[0].title).toBe("第1集：雨夜归来");
    expect(mocks.setScriptData).toHaveBeenCalledWith("project", { ...scriptData });
    expect(onProgress).toHaveBeenLastCalledWith(1, 1, "已校准 1/1 集");
  });
});
