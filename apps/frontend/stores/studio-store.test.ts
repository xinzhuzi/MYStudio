// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "./studio-store";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
  useCharacterLibraryStore.getState().reset();
  useSceneStore.getState().reset();
  usePropsLibraryStore.setState({
    items: [],
    folders: [],
    selectedFolderId: "all",
  });
});

describe("studio workflow store", () => {
  it("persists agent run lifecycle evidence and creates retry runs", () => {
    const store = useStudioStore.getState();

    const runId = store.startAgentRun({
      key: "directorPlan",
      phase: "scriptPlan",
      inputSummary: "director plan input",
      inputFingerprint: "fingerprint-1",
      checkpointRef: "op-1",
    });
    store.failAgentRun(runId, "model timeout", "checkpoint-1");
    const retryId = store.retryAgentRun(runId);
    expect(retryId).toBeTruthy();
    store.finishAgentRun(retryId!, {
      outputRef: "work-director",
      outputRefs: ["work-director", "plan-1"],
      checkpointRef: "checkpoint-2",
    });

    const runs = useStudioStore.getState().agentRuns;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      id: runId,
      key: "directorPlan",
      status: "failed",
      errorReason: "model timeout",
      checkpointRef: "checkpoint-1",
    });
    expect(runs[1]).toMatchObject({
      id: retryId,
      retryOf: runId,
      retryCount: 1,
      status: "success",
      outputRef: "work-director",
      outputRefs: ["work-director", "plan-1"],
    });
  });

  it("rebuilds scoped project memory from chapter events and purges it by project", () => {
    const store = useStudioStore.getState();
    store.replaceNovelText("第1章 雨夜入镇\n独孤剑尘救下晏燎。\n\n第2章 塾馆燃气\n晏燎掌心发热。");
    store.updateNovelChapter("chapter-001", {
      eventAnalysis: {
        chapterLabel: "第1章 雨夜入镇",
        characters: ["独孤剑尘", "晏燎"],
        coreEvent: "独孤剑尘入镇并救下晏燎",
        mainlineRelation: "强（传承启动）",
        informationDensity: "高",
        estimatedDurationSec: 50,
        emotionTags: ["冲突", "悬疑"],
        rawLine: "",
      },
    });
    store.updateNovelChapter("chapter-002", {
      eventAnalysis: {
        chapterLabel: "第2章 塾馆燃气",
        characters: ["晏燎"],
        coreEvent: "晏燎掌心发热并牵出残卷线索",
        mainlineRelation: "强（线索推进）",
        informationDensity: "高",
        estimatedDurationSec: 45,
        emotionTags: ["转折"],
        rawLine: "",
      },
    });

    useStudioStore.getState().rebuildProjectMemoryFromChapters("project-a");
    const context = useStudioStore.getState().retrieveProjectMemory({
      projectId: "project-a",
      episodeId: "chapter-002",
      chapterIndex: 2,
      entities: ["独孤剑尘"],
      purpose: "production",
    });

    expect(context.records.map((record) => record.episodeId)).toEqual(["chapter-002", "chapter-001"]);
    expect(context.markdown).toContain("项目记忆（制作阶段范围检索）");

    useStudioStore.getState().purgeProjectMemory("project-a");
    expect(useStudioStore.getState().eventGraph).toHaveLength(0);
    expect(useStudioStore.getState().projectMemoryRecords).toHaveLength(0);
  });

  it("keeps chapter ids when creating storyboards from imported chapters", () => {
    const store = useStudioStore.getState();

    store.replaceNovelText("第1章 断剑夜访\n独孤剑尘入镇。\n\n第2章 塾馆燃气\n晏燎掌心发热。");
    useStudioStore.getState().createStoryboardsFromChapters();

    const state = useStudioStore.getState();
    expect(state.storyboards.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
    expect(state.productionTracks.map((item) => item.episodeId)).toEqual(["chapter-001", "chapter-002"]);
  });

  it("persists image workflows and applies generated node output to storyboard media", () => {
    const store = useStudioStore.getState();
    const storyboardId = store.addStoryboard({ id: "shot-1", prompt: "雨夜街巷" });
    let graph = createImageWorkflowGraph({
      id: "flow-1",
      name: "shot image flow",
      target: { kind: "storyboard", id: storyboardId },
      createdAt: 3000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-1",
      prompt: "雨夜街巷，水墨风",
      position: { x: 120, y: 80 },
      createdAt: 3001,
    });
    graph = setGeneratedImageResult(graph, "gen-1", {
      imageUrl: "project-file://daojie/workflow-images/flow-1/shot-1.png",
      mediaId: "media-1",
      generatedAt: 3002,
    });

    useStudioStore.getState().upsertImageWorkflow(graph);
    useStudioStore.getState().applyImageWorkflowResultToStoryboard(storyboardId, "flow-1", "gen-1");

    const state = useStudioStore.getState();
    expect(state.imageWorkflows).toHaveLength(1);
    expect(state.storyboards.find((item) => item.id === storyboardId)).toMatchObject({
      mediaRef: {
        kind: "image",
        path: "project-file://daojie/workflow-images/flow-1/shot-1.png",
        imageWorkflowId: "flow-1",
        imageWorkflowNodeId: "gen-1",
      },
      imageWorkflowId: "flow-1",
      imageWorkflowNodeId: "gen-1",
      state: "ready",
    });
    expect(state.mediaTasks).toEqual([
      expect.objectContaining({
        kind: "storyboardImage",
        status: "success",
        targetId: storyboardId,
        outputRef: "project-file://daojie/workflow-images/flow-1/shot-1.png",
        checkpointRef: "flow-1:gen-1",
      }),
    ]);
  });

  it("records audio, video candidate, retry, and final export media task evidence", () => {
    const store = useStudioStore.getState();
    const storyboardId = store.addStoryboard({
      id: "shot-audio",
      episodeId: "chapter-001",
      prompt: "雨夜街巷",
      mediaRef: { kind: "image", path: "project-file://dao/shot.png" },
    });

    store.bindStoryboardMedia(storyboardId, {
      kind: "audio",
      path: "project-file://dao/audio/shot.wav",
    });
    store.rebuildTracks();
    const trackId = useStudioStore.getState().productionTracks[0]!.id;
    const failedVideoId = store.addVideoCandidate({
      id: "video-failed",
      trackId,
      provider: "ffmpeg-local",
      state: "failed",
      errorReason: "ffmpeg crashed",
    });
    const retryIds = store.retryFailedMediaTasks("ffmpegTrack");
    const videoId = store.addVideoCandidate({
      id: "video-ready",
      trackId,
      provider: "ffmpeg-local",
      state: "rendering",
    });
    store.updateVideoCandidate(videoId, {
      state: "ready",
      filePath: "project-file://dao/video/track.mp4",
    });
    store.saveAgentWorkData(
      "productionPlan",
      "本地成片输出: project-file://dao/exports/final.mp4",
      "chapter-001",
    );

    const tasks = useStudioStore.getState().mediaTasks;
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "ttsAudio",
          status: "success",
          targetId: storyboardId,
          outputRef: "project-file://dao/audio/shot.wav",
        }),
        expect.objectContaining({
          kind: "ffmpegTrack",
          status: "failed",
          targetId: failedVideoId,
          errorReason: "ffmpeg crashed",
        }),
        expect.objectContaining({
          kind: "ffmpegTrack",
          status: "success",
          targetId: videoId,
          outputRef: "project-file://dao/video/track.mp4",
        }),
        expect.objectContaining({
          kind: "finalExport",
          status: "success",
          targetId: "chapter-001",
        }),
      ]),
    );
    expect(retryIds).toHaveLength(1);
    expect(tasks.find((task) => task.id === retryIds[0])).toMatchObject({
      kind: "ffmpegTrack",
      status: "running",
      retryOf: expect.any(String),
      retryCount: 1,
    });
  });

  it("applies generated image workflow output to a character derived asset", () => {
    const characterId = useCharacterLibraryStore.getState().addCharacter({
      name: "晏燎",
      description: "少年修士",
      visualTraits: "ink wash xianxia teen",
      views: [],
      variations: [
        {
          id: "var-battle",
          name: "战损",
          visualPrompt: "破衣血痕",
        },
      ],
    });
    let graph = createImageWorkflowGraph({
      id: "asset-flow-character",
      name: "角色衍生图",
      target: {
        kind: "asset",
        assetType: "character",
        parentId: characterId,
        id: "var-battle",
      },
      createdAt: 4000,
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-character",
      prompt: "战损状态",
      position: { x: 620, y: 120 },
      createdAt: 4001,
    });
    graph = setGeneratedImageResult(graph, "gen-character", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-character/var-battle.png",
      generatedAt: 4002,
    });

    useStudioStore.getState().upsertImageWorkflow(graph);
    useStudioStore.getState().applyImageWorkflowResultToAsset(graph.target, graph.id, "gen-character");

    expect(useCharacterLibraryStore.getState().getVariationById(characterId, "var-battle")).toMatchObject({
      referenceImage: "project-file://daojie/workflow-images/asset-flow-character/var-battle.png",
      imageWorkflowId: "asset-flow-character",
      imageWorkflowNodeId: "gen-character",
      generatedAt: 4002,
    });
  });

  it("applies generated image workflow output to scene and prop derived assets", () => {
    const sceneId = useSceneStore.getState().addScene({
      name: "义庄夜景",
      location: "义庄",
      time: "夜",
      atmosphere: "阴冷",
      visualPrompt: "义庄夜景",
    });
    const prop = usePropsLibraryStore.getState().addProp({
      name: "裂纹木牌",
      description: "道具衍生",
      imageUrl: "",
      folderId: null,
      isDerivative: true,
      parentId: "prop-parent",
    });
    let sceneGraph = createImageWorkflowGraph({
      id: "asset-flow-scene",
      name: "场景衍生图",
      target: {
        kind: "asset",
        assetType: "scene",
        id: sceneId,
      },
      createdAt: 5000,
    });
    sceneGraph = addGeneratedImageNode(sceneGraph, {
      id: "gen-scene",
      prompt: "义庄夜景",
      position: { x: 620, y: 120 },
      createdAt: 5001,
    });
    sceneGraph = setGeneratedImageResult(sceneGraph, "gen-scene", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-scene/night.png",
      generatedAt: 5002,
    });
    let propGraph = createImageWorkflowGraph({
      id: "asset-flow-prop",
      name: "道具衍生图",
      target: {
        kind: "asset",
        assetType: "prop",
        parentId: "prop-parent",
        id: prop.id,
      },
      createdAt: 6000,
    });
    propGraph = addGeneratedImageNode(propGraph, {
      id: "gen-prop",
      prompt: "裂纹木牌",
      position: { x: 620, y: 120 },
      createdAt: 6001,
    });
    propGraph = setGeneratedImageResult(propGraph, "gen-prop", {
      imageUrl: "project-file://daojie/workflow-images/asset-flow-prop/prop.png",
      generatedAt: 6002,
    });

    useStudioStore.getState().upsertImageWorkflow(sceneGraph);
    useStudioStore.getState().upsertImageWorkflow(propGraph);
    useStudioStore.getState().applyImageWorkflowResultToAsset(sceneGraph.target, sceneGraph.id, "gen-scene");
    useStudioStore.getState().applyImageWorkflowResultToAsset(propGraph.target, propGraph.id, "gen-prop");

    expect(useSceneStore.getState().getSceneById(sceneId)).toMatchObject({
      referenceImage: "project-file://daojie/workflow-images/asset-flow-scene/night.png",
      imageWorkflowId: "asset-flow-scene",
      imageWorkflowNodeId: "gen-scene",
    });
    expect(usePropsLibraryStore.getState().getPropById(prop.id)).toMatchObject({
      imageUrl: "project-file://daojie/workflow-images/asset-flow-prop/prop.png",
      imageWorkflowId: "asset-flow-prop",
      imageWorkflowNodeId: "gen-prop",
    });
  });

  it("replaces stale storyboard rows for the same episode without losing existing media", () => {
    const store = useStudioStore.getState();

    store.addStoryboard({
      id: "sb-ep1-1",
      episodeId: "ep1",
      index: 1,
      trackKey: "old-1",
      prompt: "旧分镜一",
      mediaRef: { kind: "image", path: "project-file://frames/old-1.png" },
      audioRef: { kind: "audio", path: "project-file://audio/old-1.wav" },
      state: "ready",
    });
    store.addStoryboard({
      id: "sb-ep1-2",
      episodeId: "ep1",
      index: 2,
      trackKey: "old-2",
      prompt: "旧分镜二",
    });
    store.addStoryboard({
      id: "sb-ep2-1",
      episodeId: "ep2",
      index: 1,
      trackKey: "other-episode",
      prompt: "其他集分镜",
    });

    useStudioStore.getState().replaceStoryboardsForEpisode("ep1", [
      {
        id: "sb-ep1-1",
        episodeId: "ep1",
        index: 1,
        trackKey: "segment-001",
        trackId: "",
        duration: 8,
        prompt: "当前片段一",
        videoDesc: "当前片段一的画面",
        assetIds: ["role-1"],
        state: "idle",
      },
    ]);

    const state = useStudioStore.getState();
    expect(state.storyboards.map((item) => item.id)).toEqual([
      "sb-ep2-1",
      "sb-ep1-1",
    ]);
    expect(state.storyboards.find((item) => item.id === "sb-ep1-2")).toBeUndefined();
    expect(state.storyboards.find((item) => item.id === "sb-ep1-1")).toMatchObject({
      prompt: "当前片段一",
      trackKey: "segment-001",
      mediaRef: { kind: "image", path: "project-file://frames/old-1.png" },
      audioRef: { kind: "audio", path: "project-file://audio/old-1.wav" },
      stale: true,
      staleReason: "storyboard source changed",
    });
    expect(
      state.productionTracks.flatMap((track) => track.storyboardIds),
    ).not.toContain("sb-ep1-2");
  });

  it("marks tracks and video candidates stale when storyboard source changes", () => {
    const store = useStudioStore.getState();
    const storyboardId = store.addStoryboard({
      id: "shot-stale",
      episodeId: "ep1",
      trackKey: "track-a",
      prompt: "旧分镜",
      videoDesc: "旧画面",
      mediaRef: { kind: "image", path: "project-file://frames/old.png" },
      state: "ready",
    });
    const trackId = useStudioStore.getState().productionTracks[0]!.id;
    const candidateId = store.addVideoCandidate({
      id: "candidate-stale",
      trackId,
      provider: "ffmpeg-local",
      filePath: "project-file://video/old.mp4",
      state: "ready",
    });
    store.selectVideoCandidate(trackId, candidateId);

    useStudioStore.getState().updateStoryboard(storyboardId, {
      prompt: "新分镜",
      videoDesc: "新画面",
    });

    const state = useStudioStore.getState();
    expect(state.storyboards[0]).toMatchObject({
      stale: true,
      staleReason: "storyboard source changed",
    });
    expect(state.productionTracks[0]).toMatchObject({
      stale: true,
      staleReason: "storyboard source changed",
    });
    expect(state.videoCandidates[0]).toMatchObject({
      stale: true,
      staleReason: "track source changed",
    });
  });
});
