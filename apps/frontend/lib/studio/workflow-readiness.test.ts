import { describe, expect, it } from "vitest";
import { buildWorkflowReadiness } from "./workflow-readiness";
import type {
  EntityExtractionResult,
  ProductionTrack,
  StoryboardItem,
  StudioWorkflowConfig,
  VideoCandidate,
} from "@/types/studio";

describe("studio workflow readiness", () => {
  it("points a new project to manual selection before later workflow stages", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: {},
      novelChapters: [],
      agentWorkData: [],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(readiness.progress).toBe(0);
    expect(readiness.nextStageId).toBe("manuals");
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      stageId: "manuals",
      label: "选择视觉与导演手册",
      enabled: true,
    });
    expect(readiness.stages[0]).toMatchObject({
      id: "manuals",
      status: "active",
      missing: ["选择视觉手册", "选择导演手册"],
    });
    expect(readiness.stages[1]?.status).toBe("blocked");
  });

  it("recommends script planning after manuals and novel import are ready", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(readiness.nextStageId).toBe("script");
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      stageId: "script",
      label: "进入策划编剧",
      enabled: true,
    });
    expect(
      readiness.stages.find((stage) => stage.id === "novel"),
    ).toMatchObject({
      status: "ready",
      completed: ["已导入 1 章原文", "1 章已完成事件分析"],
    });
    expect(
      readiness.stages.find((stage) => stage.id === "script")?.missing,
    ).toContain("生成剧本草稿");
    expect(readiness.stages.map((stage) => stage.label)).toEqual([
      "风格与导演",
      "小说导入",
      "策划编剧",
      "剧本资产提取",
      "剧本资产管理",
      "分镜视频生成",
      "视频工作台",
    ]);
  });

  it("keeps novel import active until imported chapters have event analysis", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [
        {
          id: "chapter-1",
          index: 1,
          title: "第一章",
          sourceText: "入局",
          importedAt: 1,
        },
      ],
      agentWorkData: [],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(readiness.nextStageId).toBe("novel");
    expect(
      readiness.stages.find((stage) => stage.id === "novel"),
    ).toMatchObject({
      status: "active",
      completed: ["已导入 1 章原文"],
      missing: ["完成事件分析"],
    });
  });

  it("turns script output into an executable asset extraction action", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
    });

    expect(readiness.nextStageId).toBe("assets");
    expect(readiness.nextAction).toEqual({
      kind: "run-entity-extraction",
      stageId: "assets",
      label: "提取剧本资产",
      targetId: "chapter-1",
      enabled: false,
      disabledReason: "未检测到可用模型调用通道",
    });
  });

  it("enables asset extraction when model calls are available", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      capabilities: { textCompletion: true, studioRenderer: false },
    });

    expect(readiness.nextAction).toEqual({
      kind: "run-entity-extraction",
      stageId: "assets",
      label: "提取剧本资产",
      targetId: "chapter-1",
      enabled: true,
    });
  });

  it("moves from managed script assets to storyboard video generation", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [
        analyzedChapter(),
        analyzedChapter("chapter-2", 2, "第二章"),
      ],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "第一章剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-2",
          key: "scriptDraft",
          episodeId: "chapter-2",
          data: "第二章剧本",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      entityExtractions: [
        { ...entityBatch(), id: "entity-old", episodeId: "chapter-1" },
        { ...entityBatch(), id: "entity-new", episodeId: "chapter-2" },
      ],
      scriptPlans: [],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      capabilities: { textCompletion: true, studioRenderer: false },
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      label: "打开视频生产节点",
    });
    expect(
      readiness.stages.find((stage) => stage.id === "script")?.completed,
    ).toContain("当前剧本已就绪");
    expect(
      readiness.stages
        .find((stage) => stage.id === "script")
        ?.completed.join("\n"),
    ).not.toContain("份剧本");
  });

  it("opens the storyboard node workspace after director planning", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [
        analyzedChapter(),
        analyzedChapter("chapter-2", 2, "第二章"),
      ],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "第一章剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-2",
          key: "scriptDraft",
          episodeId: "chapter-2",
          data: "第二章剧本",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      entityExtractions: [
        { ...entityBatch(), id: "entity-old", episodeId: "chapter-1" },
        { ...entityBatch(), id: "entity-new", episodeId: "chapter-2" },
      ],
      scriptPlans: [
        { ...scriptPlan(), id: "plan-old", episodeId: "chapter-1" },
        { ...scriptPlan(), id: "plan-new", episodeId: "chapter-2" },
      ],
      seriesBible: seriesBible(),
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      capabilities: { textCompletion: true, studioRenderer: false },
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      label: "打开视频生产节点",
    });
  });

  it("keeps script asset management focused on extracted assets", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [
        {
          id: "plan-1",
          episodeId: "episode-1",
          theme: "入局",
          visualStyle: "水墨",
          narrativeRhythm: "紧",
          sceneIntents: [],
          soundDirection: "低声",
          transitions: "硬切",
          derivedAssetPlan: [],
        },
      ],
      seriesBible: null,
      storyboards: [],
      productionTracks: [],
      videoCandidates: [],
      capabilities: { textCompletion: true, studioRenderer: false },
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(
      readiness.stages.find((stage) => stage.id === "generation"),
    ).toMatchObject({
      status: "ready",
      completed: ["已管理 1 批剧本资产"],
      missing: [],
    });
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      label: "打开视频生产节点",
      enabled: true,
    });
  });

  it("recommends rebuilding tracks before merge when the workbench has no tracks", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [scriptPlan()],
      seriesBible: seriesBible(),
      storyboards: [
        storyboard("sb-1", { kind: "image", path: "/tmp/sb-1.png" }),
      ],
      productionTracks: [],
      videoCandidates: [],
      voiceBindings: [voiceBinding()],
      sceneVoiceLines: [voiceLine(1, "/tmp/sb-1.wav")],
      capabilities: { textCompletion: true, studioRenderer: true },
    });

    expect(readiness.nextStageId).toBe("workbench");
    expect(readiness.nextAction).toMatchObject({
      kind: "open-stage",
      stageId: "workbench",
      label: "重建制作轨",
      enabled: true,
    });
  });

  it("moves toward production when storyboards have visual media and selected candidates", () => {
    const storyboards: StoryboardItem[] = [
      storyboard("sb-1", { kind: "image", path: "/tmp/sb-1.png" }),
      storyboard("sb-2", { kind: "video", path: "/tmp/sb-2.mp4" }),
    ];
    const tracks: ProductionTrack[] = [
      {
        id: "track-1",
        episodeId: "episode-1",
        trackKey: "opening",
        storyboardIds: ["sb-1", "sb-2"],
        prompt: "opening",
        duration: 8,
        candidateVideoIds: ["video-1"],
        selectedVideoId: "video-1",
        state: "ready",
      },
    ];
    const candidates: VideoCandidate[] = [
      {
        id: "video-1",
        trackId: "track-1",
        provider: "ffmpeg-local",
        state: "ready",
        filePath: "/tmp/opening.mp4",
        createdAt: 1,
      },
    ];

    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [scriptPlan()],
      seriesBible: seriesBible(),
      storyboards,
      productionTracks: tracks,
      videoCandidates: candidates,
      voiceBindings: [voiceBinding()],
      sceneVoiceLines: [
        voiceLine(1, "/tmp/sb-1.wav"),
        voiceLine(2, "/tmp/sb-2.wav"),
      ],
    });

    expect(readiness.nextStageId).toBe("workbench");
    expect(
      readiness.stages.find((stage) => stage.id === "workbench")?.status,
    ).toBe("active");
    expect(readiness.nextAction).toEqual({
      kind: "merge-episode",
      stageId: "workbench",
      label: "导出最终成片",
      enabled: false,
      disabledReason: "当前环境不支持本地渲染",
    });
    expect(
      readiness.stages.find((stage) => stage.id === "storyboard"),
    ).toMatchObject({
      status: "ready",
      completed: [
        "已落地 2 条分镜",
        "2 条分镜已绑定画面素材",
        "已分配角色音色",
        "2 条分镜配音已生成",
      ],
    });
    expect(
      readiness.stages.find((stage) => stage.id === "workbench")?.missing,
    ).toContain("导出最终成片");
  });

  it("does not count missing local files as ready workflow outputs", () => {
    const existingFiles = new Set(["/tmp/sb-1.png", "/tmp/sb-1.wav"]);
    const storyboards: StoryboardItem[] = [
      storyboard("sb-1", { kind: "image", path: "/tmp/sb-1.png" }),
      storyboard("sb-2", { kind: "video", path: "/tmp/missing-sb-2.mp4" }),
    ];
    const tracks: ProductionTrack[] = [
      {
        id: "track-1",
        episodeId: "episode-1",
        trackKey: "opening",
        storyboardIds: ["sb-1", "sb-2"],
        prompt: "opening",
        duration: 8,
        candidateVideoIds: ["video-1"],
        selectedVideoId: "video-1",
        state: "ready",
      },
    ];
    const candidates: VideoCandidate[] = [
      {
        id: "video-1",
        trackId: "track-1",
        provider: "ffmpeg-local",
        state: "ready",
        filePath: "/tmp/missing-opening.mp4",
        createdAt: 1,
      },
    ];

    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-export",
          key: "productionPlan",
          data: "本地成片输出: /tmp/missing-final.mp4",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [scriptPlan()],
      seriesBible: seriesBible(),
      storyboards,
      productionTracks: tracks,
      videoCandidates: candidates,
      voiceBindings: [voiceBinding()],
      sceneVoiceLines: [
        voiceLine(1, "/tmp/sb-1.wav"),
        voiceLine(2, "/tmp/missing-sb-2.wav"),
      ],
      fileExists: (filePath) => existingFiles.has(filePath),
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(
      readiness.stages.find((stage) => stage.id === "storyboard"),
    ).toMatchObject({
      status: "active",
      missing: ["为所有分镜绑定画面素材", "生成分镜配音音频"],
    });
    expect(
      readiness.stages.find((stage) => stage.id === "workbench")?.status,
    ).toBe("blocked");
  });

  it("keeps storyboard active when visual media exists but role voice is not assigned", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [scriptPlan()],
      seriesBible: seriesBible(),
      storyboards: [
        storyboard("sb-1", { kind: "image", path: "/tmp/sb-1.png" }),
      ],
      productionTracks: [],
      videoCandidates: [],
      sceneVoiceLines: [voiceLine(1, "/tmp/sb-1.wav")],
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(
      readiness.stages.find((stage) => stage.id === "storyboard"),
    ).toMatchObject({
      status: "active",
      missing: ["分配角色音色"],
    });
  });

  it("keeps storyboard active when voice is assigned but scene voice audio is missing", () => {
    const readiness = buildWorkflowReadiness({
      workflowConfig: readyManuals(),
      novelChapters: [analyzedChapter()],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          data: "## S01",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      entityExtractions: [entityBatch()],
      scriptPlans: [scriptPlan()],
      seriesBible: seriesBible(),
      storyboards: [
        storyboard("sb-1", { kind: "image", path: "/tmp/sb-1.png" }),
      ],
      productionTracks: [],
      videoCandidates: [],
      voiceBindings: [voiceBinding()],
      sceneVoiceLines: [{ sceneId: 1, status: "completed" }],
    });

    expect(readiness.nextStageId).toBe("storyboard");
    expect(
      readiness.stages.find((stage) => stage.id === "storyboard"),
    ).toMatchObject({
      status: "active",
      missing: ["生成分镜配音音频"],
    });
  });
});

function readyManuals(): StudioWorkflowConfig {
  return {
    visualManualId: "visual-1",
    directorManualId: "director-1",
    episodeDurationMin: 3,
  };
}

function analyzedChapter(id = "chapter-1", index = 1, title = "第一章") {
  return {
    id,
    index,
    title,
    sourceText: "入局",
    eventState: "主角入局，冲突建立。",
    importedAt: 1,
  };
}

function storyboard(
  id: string,
  mediaRef: StoryboardItem["mediaRef"],
): StoryboardItem {
  return {
    id,
    episodeId: "episode-1",
    index: 1,
    trackKey: "opening",
    trackId: "",
    duration: 4,
    prompt: "入局",
    videoDesc: "旁白：命运开始转动",
    assetIds: [],
    state: "ready",
    mediaRef,
  };
}

function voiceBinding() {
  return {
    speakerId: "character:char-1" as const,
    profileId: "profile-1",
  };
}

function voiceLine(sceneId: number, audioLocalPath: string) {
  return {
    sceneId,
    status: "completed" as const,
    audioLocalPath,
  };
}

function entityBatch(): EntityExtractionResult {
  return {
    id: "entity-1",
    episodeId: "episode-1",
    characters: [{ characterId: "char-1", name: "主角", aliases: [] }],
    scenes: [{ sceneId: "scene-1", name: "矿场" }],
    props: [],
  };
}

function scriptPlan() {
  return {
    id: "plan-1",
    episodeId: "episode-1",
    theme: "入局",
    visualStyle: "水墨",
    narrativeRhythm: "紧",
    sceneIntents: [],
    soundDirection: "低声",
    transitions: "硬切",
    derivedAssetPlan: [],
  };
}

function seriesBible() {
  return {
    id: "bible-1",
    projectId: "project-1",
    characterLocks: [],
    sceneLocks: [],
    visualManualId: "visual-1",
    directorManualId: "director-1",
    aspectRatio: "16:9",
    stylePositioning: "水墨",
  };
}
