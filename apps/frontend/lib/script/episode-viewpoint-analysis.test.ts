import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/api-config-store";
import type { EpisodeRawScript, ScriptData, ScriptScene, Shot } from "@/types/script";
import { analyzeEpisodeViewpoints } from "./episode-viewpoint-analysis";
import { analyzeSceneViewpoints } from "./viewpoint-analyzer";

vi.mock("@/lib/utils/concurrency", () => ({
  runStaggered: vi.fn(async (tasks: Array<() => Promise<unknown>>) => (
    Promise.allSettled(tasks.map((task) => task()))
  )),
}));

vi.mock("./viewpoint-analyzer", () => ({
  analyzeSceneViewpoints: vi.fn(),
}));

const scene: ScriptScene = {
  id: "scene-1",
  name: "山门",
  location: "山门",
  time: "黄昏",
  atmosphere: "肃穆",
};

const shots: Shot[] = [
  {
    id: "shot-1",
    index: 1,
    sceneRefId: scene.id,
    actionSummary: "山门全景",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
  },
  {
    id: "shot-2",
    index: 2,
    sceneRefId: scene.id,
    actionSummary: "石阶上的脚步",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
  },
];

const scriptData: ScriptData = {
  title: "测试剧本",
  language: "zh",
  characters: [],
  scenes: [scene],
  episodes: [],
  storyParagraphs: [],
};

const episodeScript: EpisodeRawScript = {
  episodeIndex: 1,
  title: "第一集",
  synopsis: "主角抵达山门",
  keyEvents: ["抵达山门"],
  rawContent: "",
  scenes: [],
  shotGenerationStatus: "generating",
};

describe("analyzeEpisodeViewpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAPIConfigStore.setState({ concurrency: 20 });
  });

  it("persists analyzed viewpoints and assigns every generated shot", async () => {
    vi.mocked(analyzeSceneViewpoints).mockResolvedValue({
      viewpoints: [{
        id: "overview",
        name: "全景",
        nameEn: "Overview",
        description: "",
        descriptionEn: "",
        keyProps: [],
        keyPropsEn: [],
        shotIndexes: [1],
      }],
      analysisNote: "",
    });
    const setScriptData = vi.fn();

    const result = await analyzeEpisodeViewpoints({
      projectId: "project-1",
      scriptData,
      projectBackground: null,
      episodeScript,
      episodeScenes: [scene],
      newShots: shots,
      options: { apiKey: "sk-test", provider: "custom" },
      setScriptData,
    });

    expect(result).toEqual({ viewpointAnalyzed: true, viewpointSkippedReason: undefined });
    expect(analyzeSceneViewpoints).toHaveBeenCalledWith(
      scene,
      shots,
      expect.objectContaining({ episodeSynopsis: "主角抵达山门" }),
    );
    expect(setScriptData).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        scenes: [expect.objectContaining({
          id: "scene-1",
          viewpoints: [expect.objectContaining({ shotIds: ["shot-1", "shot-2"] })],
        })],
      }),
    );
  });

  it("reports the existing missing-key reason without analyzing or persisting", async () => {
    const setScriptData = vi.fn();

    const result = await analyzeEpisodeViewpoints({
      projectId: "project-1",
      scriptData,
      projectBackground: null,
      episodeScript,
      episodeScenes: [scene],
      newShots: shots,
      options: { apiKey: "", provider: "custom" },
      setScriptData,
    });

    expect(result).toEqual({ viewpointAnalyzed: false, viewpointSkippedReason: "apiKey 未配置" });
    expect(analyzeSceneViewpoints).not.toHaveBeenCalled();
    expect(setScriptData).not.toHaveBeenCalled();
  });

  it("persists unchanged scenes and reports no shots when no scene has generated shots", async () => {
    const setScriptData = vi.fn();

    const result = await analyzeEpisodeViewpoints({
      projectId: "project-1",
      scriptData,
      projectBackground: null,
      episodeScript,
      episodeScenes: [scene],
      newShots: [],
      options: { apiKey: "sk-test", provider: "custom" },
      setScriptData,
    });

    expect(result).toEqual({ viewpointAnalyzed: false, viewpointSkippedReason: "无分镜" });
    expect(setScriptData).toHaveBeenCalledWith("project-1", scriptData);
  });
});
