import { describe, expect, it } from "vitest";
import { buildStudioFlowData } from "./studio-flow-data";

describe("studio Toonflow FlowData projection", () => {
  it("projects MYStudio data into script, scriptPlan, assets, storyboardTable, storyboard, and workbench fields", () => {
    const flowData = buildStudioFlowData({
      agentWorkData: [
        {
          id: "script-1",
          key: "scriptDraft",
          episodeId: "chapter-001",
          data: "第一章剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "table-1",
          key: "storyboardTable",
          episodeId: "chapter-001",
          data: "|镜头|画面|台词|",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "export-1",
          key: "productionPlan",
          episodeId: "chapter-001",
          data: "本地成片输出: /tmp/final.mp4",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [
        {
          id: "assets-1",
          episodeId: "chapter-001",
          characters: [{ characterId: "c1", name: "独孤剑尘", aliases: [] }],
          scenes: [{ sceneId: "s1", name: "道口镇" }],
          props: [{ assetId: "p1", name: "断剑" }],
        },
      ],
      scriptPlans: [
        {
          id: "plan-1",
          episodeId: "chapter-001",
          theme: "夜访道口镇",
          visualStyle: "水墨暗夜",
          narrativeRhythm: "缓慢压迫",
          sceneIntents: [
            {
              sceneId: "Sc1",
              emotion: "压迫→隐忍",
              shotIntent: "低机位推进独孤剑尘入场",
              spatial: "道口镇街巷纵深",
            },
          ],
          soundDirection: "低频雨声",
          transitions: "雨声转场",
          derivedAssetPlan: [
            {
              parentAssetId: "c1",
              state: "雨夜湿衣",
              reason: "夜访道口镇多镜复用",
            },
          ],
        },
      ],
      storyboards: [
        {
          id: "shot-1",
          episodeId: "chapter-001",
          index: 1,
          trackKey: "scene-1",
          trackId: "track-1",
          duration: 5,
          prompt: "雨夜道口镇",
          videoDesc: "雨中推进",
          assetIds: ["c1", "s1", "p1"],
          mediaRef: { kind: "image", path: "/tmp/shot.png" },
          audioRef: { kind: "audio", path: "/tmp/shot.wav" },
          state: "ready",
          lines: "他终于到了。",
        },
      ],
      productionTracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "scene-1",
          storyboardIds: ["shot-1"],
          prompt: "track prompt",
          duration: 5,
          candidateVideoIds: ["video-1"],
          selectedVideoId: "video-1",
          state: "ready",
        },
      ],
      videoCandidates: [
        {
          id: "video-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/track.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
    });

    expect(flowData.script).toBe("第一章剧本");
    expect(flowData.scriptPlan).toContain("夜访道口镇");
    expect(flowData.scriptPlan).toContain("低机位推进独孤剑尘入场");
    expect(flowData.scriptPlan).toContain("雨夜湿衣");
    expect(flowData.assets).toHaveLength(3);
    expect(flowData.storyboardTable).toContain("|镜头|画面|台词|");
    expect(flowData.storyboard).toMatchObject([
      {
        id: "shot-1",
        videoDesc: "雨中推进",
        prompt: "雨夜道口镇",
        duration: 5,
        associateAssetsIds: ["c1", "s1", "p1"],
        shouldGenerateImage: false,
      },
    ]);
    expect(flowData.workbench.finalExportPath).toBe("/tmp/final.mp4");
    expect(flowData.workbench.tracks[0]?.selectedVideoPath).toBe("/tmp/track.mp4");
    expect(flowData.workbench.tracks[0]).toMatchObject({
      id: "track-1",
      state: "ready",
      selectVideoId: "video-1",
      medias: [
        {
          id: "shot-1",
          sources: "storyboard",
          fileType: "image",
          path: "/tmp/shot.png",
        },
        {
          id: "shot-1",
          sources: "storyboard",
          fileType: "audio",
          path: "/tmp/shot.wav",
        },
      ],
      videoList: [
        {
          id: "video-1",
          state: "ready",
          filePath: "/tmp/track.mp4",
          provider: "ffmpeg-local",
        },
      ],
    });
  });

  it("prefers the saved raw director plan text when it exists", () => {
    const flowData = buildStudioFlowData({
      agentWorkData: [
        {
          id: "director-raw",
          key: "directorPlan",
          episodeId: "chapter-001",
          data: "<scriptPlan>\n### 完整导演规划原文\n- 保留逐场注意事项和 Toonflow 表格。\n</scriptPlan>",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      entityExtractions: [],
      scriptPlans: [
        {
          id: "plan-1",
          episodeId: "chapter-001",
          theme: "结构化摘要",
          visualStyle: "",
          narrativeRhythm: "",
          sceneIntents: [],
          soundDirection: "",
          transitions: "",
          derivedAssetPlan: [],
        },
      ],
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(flowData.scriptPlan).toContain("完整导演规划原文");
    expect(flowData.scriptPlan).toContain("逐场注意事项");
    expect(flowData.scriptPlan).not.toContain("结构化摘要");
  });

  it("uses latest non-empty work data and marks storyboard image generation needs", () => {
    const flowData = buildStudioFlowData({
      agentWorkData: [
        {
          id: "old-script",
          key: "scriptDraft",
          data: "旧剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "new-script",
          key: "scriptDraft",
          data: "新剧本",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: "blank-table",
          key: "storyboardTable",
          data: "   ",
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      entityExtractions: [],
      scriptPlans: [],
      storyboards: [
        {
          id: "shot-no-image",
          episodeId: "chapter-001",
          index: 1,
          trackKey: "scene-1",
          trackId: "track-1",
          duration: 5,
          prompt: "需要生成画面",
          videoDesc: "无图",
          assetIds: [],
          mediaRef: { kind: "audio", path: "/tmp/not-visual.wav" },
          state: "idle",
        },
      ],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(flowData.script).toBe("新剧本");
    expect(flowData.storyboardTable).toBe("");
    expect(flowData.storyboard[0]?.shouldGenerateImage).toBe(true);
  });

  it("filters missing local media and exports from Toonflow workbench data", () => {
    const flowData = buildStudioFlowData({
      agentWorkData: [
        {
          id: "export-1",
          key: "productionPlan",
          episodeId: "chapter-001",
          data: "本地成片输出: /tmp/missing-final.mp4",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [],
      scriptPlans: [],
      storyboards: [
        {
          id: "shot-1",
          episodeId: "chapter-001",
          index: 1,
          trackKey: "scene-1",
          trackId: "track-1",
          duration: 5,
          prompt: "雨夜道口镇",
          videoDesc: "雨中推进",
          assetIds: [],
          mediaRef: { kind: "image", path: "/tmp/existing-shot.png" },
          audioRef: { kind: "audio", path: "/tmp/missing-shot.wav" },
          state: "ready",
        },
      ],
      productionTracks: [
        {
          id: "track-1",
          episodeId: "chapter-001",
          trackKey: "scene-1",
          storyboardIds: ["shot-1"],
          prompt: "track prompt",
          duration: 5,
          candidateVideoIds: ["video-1"],
          selectedVideoId: "video-1",
          state: "ready",
        },
      ],
      videoCandidates: [
        {
          id: "video-1",
          trackId: "track-1",
          provider: "ffmpeg-local",
          filePath: "/tmp/missing-track.mp4",
          state: "ready",
          createdAt: 1,
        },
      ],
      fileExists: (filePath) => filePath === "/tmp/existing-shot.png",
    });

    expect(flowData.storyboard[0]?.mediaPath).toBe("/tmp/existing-shot.png");
    expect(flowData.storyboard[0]?.audioPath).toBeUndefined();
    expect(flowData.workbench.finalExportPath).toBeUndefined();
    expect(flowData.workbench.tracks[0]?.selectedVideoPath).toBeUndefined();
    expect(flowData.workbench.tracks[0]?.medias).toEqual([
      {
        id: "shot-1",
        sources: "storyboard",
        fileType: "image",
        path: "/tmp/existing-shot.png",
      },
    ]);
    expect(flowData.workbench.tracks[0]?.videoList[0]).toMatchObject({
      id: "video-1",
      state: "ready",
      filePath: undefined,
    });
  });
});
