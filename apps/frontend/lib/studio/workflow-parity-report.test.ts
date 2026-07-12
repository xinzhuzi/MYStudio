import { describe, expect, it } from "vitest";
import { buildWorkflowParityReport } from "./workflow-parity-report";
import type { StudioManualCatalog } from "./manuals";
import type {
  AgentWorkData,
  EntityExtractionResult,
  MediaGenerationTask,
  ProductionTrack,
  ScriptPlan,
  StudioAgentRun,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

const manualCatalog: StudioManualCatalog = {
  visual: [
    {
      id: "visual-daojie",
      kind: "visual",
      name: "道劫水墨国风",
      modules: {
        director_planning_style: "导演规划视觉规则",
        director_storyboard_table_style: "分镜表视觉规则",
        director_storyboard: "分镜图提示词规则",
        art_storyboard_video: "视频提示词规则",
      },
      images: [],
      builtin: true,
      source: "toonflow-runtime",
      completenessScore: 4,
      moduleCount: 4,
      imageCount: 0,
    },
  ],
  director: [
    {
      id: "director-daojie",
      kind: "director",
      name: "道劫仙侠悬疑",
      modules: {
        director_planning_narrative: "导演规划叙事规则",
        director_storyboard_table_narrative: "分镜表叙事规则",
      },
      images: [],
      builtin: true,
      source: "toonflow-runtime",
      completenessScore: 2,
      moduleCount: 2,
      imageCount: 0,
    },
  ],
};

describe("workflow parity report", () => {
  it("summarizes complete Toonflow-style workflow contract evidence", () => {
    const report = buildWorkflowParityReport({
      agentWorkData: baseAgentWorkData(),
      agentRuns: baseAgentRuns(),
      mediaTasks: baseMediaTasks(),
      entityExtractions: baseEntityExtractions(),
      scriptPlans: baseScriptPlans(),
      storyboards: [completeStoryboard()],
      productionTracks: baseTracks(),
      videoCandidates: baseVideoCandidates(),
      workflowConfig: {
        visualManualId: "visual-daojie",
        directorManualId: "director-daojie",
      },
      manualCatalog,
      evidenceBoundary: {
        seededUiSmoke: true,
        visibleWorkflowSmoke: true,
        realDaojieVisibleSmoke: true,
        realMediaGeneration: true,
      },
    });

    expect(report.nodes).toHaveLength(6);
    expect(report.agentEvidence).toMatchObject({
      modelResponses: 6,
      toolWritebacks: 6,
      supervisionApprovals: 6,
      failedSupervisions: 0,
    });
    expect(report.nodes.every((node) => node.hasInputEvidence)).toBe(true);
    expect(report.mediaTaskEvidence).toMatchObject({
      storyboardImageSuccess: 1,
      ttsAudioSuccess: 1,
      videoSuccess: 2,
    });
    expect(report.nodes.every((node) => node.hasWritebackEvidence)).toBe(true);
    expect(report.nodes.every((node) => node.hasReportEvidence)).toBe(true);
    expect(report.storyboard).toMatchObject({
      total: 1,
      withIndex: 1,
      withVideoDesc: 1,
      withPrompt: 1,
      withTrack: 1,
      withDuration: 1,
      withAssociateAssetsIds: 1,
      withShouldGenerateImageExplicit: 1,
      withSourceEvidence: 1,
    });
    expect(report.references).toMatchObject({
      storyboardsWithOrderedManifest: 1,
      orderedReferenceCount: 2,
      missingReferenceCount: 0,
      rawAssetNameLeaks: 0,
    });
    expect(report.skills).toMatchObject({
      hasDirectorPlanContext: true,
      hasStoryboardTableContext: true,
      hasStoryboardPromptContext: true,
      hasVideoPromptContext: true,
    });
    expect(report.audio).toMatchObject({
      withLines: 1,
      withSpeakerId: 1,
      withAudioRef: 1,
    });
    expect(report.video).toMatchObject({
      tracks: 1,
      candidates: 1,
      readyCandidates: 1,
      selectedTracks: 1,
      hasFinalExport: true,
    });
    expect(report.issues).toEqual([]);
  });

  it("reports missing source, reference, audio, video, and smoke boundary evidence", () => {
    const report = buildWorkflowParityReport({
      agentWorkData: baseAgentWorkData({ productionPlan: false }),
      entityExtractions: baseEntityExtractions(),
      scriptPlans: baseScriptPlans(),
      storyboards: [
        {
          ...completeStoryboard(),
          prompt: "独孤剑尘站在雨里，没有绑定参考图标签。",
          mediaRef: undefined,
          imageWorkflowId: undefined,
          imageWorkflowNodeId: undefined,
          audioRef: undefined,
          sourceEvidence: undefined,
          orderedReferenceManifest: [
            {
              order: 1,
              assetId: "char-1",
              assetName: "独孤剑尘",
              assetKind: "character",
              missing: true,
            },
          ],
        },
      ],
      productionTracks: baseTracks({ selectedVideoId: undefined }),
      videoCandidates: [],
      workflowConfig: {
        visualManualId: "missing-visual",
        directorManualId: "missing-director",
      },
      manualCatalog,
      evidenceBoundary: {
        seededUiSmoke: true,
      },
    });

    expect(report.storyboard.withSourceEvidence).toBe(0);
    expect(report.references).toMatchObject({
      storyboardsWithOrderedManifest: 1,
      missingReferenceCount: 1,
      rawAssetNameLeaks: 1,
    });
    expect(report.images.withMediaRef).toBe(0);
    expect(report.audio.withLines).toBe(1);
    expect(report.audio.withAudioRef).toBe(0);
    expect(report.video.readyCandidates).toBe(0);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "node.storyboard.evidence",
        "node.workbench.evidence",
        "run.evidence.missing",
        "storyboard.sourceEvidence.missing",
        "references.image.missing",
        "references.rawAssetNameLeak",
        "skills.context.incomplete",
        "audio.missing",
        "video.output.missing",
        "evidence.seededOnly",
      ]),
    );
  });

  it("separates model response, tool writeback, and supervision failure evidence", () => {
    const report = buildWorkflowParityReport({
      agentWorkData: baseAgentWorkData(),
      agentRuns: [
        run("director-run", "directorPlan", "scriptPlan", "director"),
        {
          id: "blocked-run",
          key: "storyboardTable",
          phase: "storyboardTable",
          status: "failed",
          inputSummary: "storyboardTable input",
          errorReason: "supervision blocked writeback",
          startedAt: 1,
          finishedAt: 2,
        },
      ],
      entityExtractions: baseEntityExtractions(),
      scriptPlans: baseScriptPlans(),
      storyboards: [completeStoryboard()],
      productionTracks: baseTracks(),
      videoCandidates: baseVideoCandidates(),
    });

    expect(report.agentEvidence).toEqual({
      modelResponses: 2,
      toolWritebacks: 1,
      supervisionApprovals: 1,
      failedSupervisions: 1,
    });
  });

  it("reports Toonflow fixture parity and deferred golden image comparison", () => {
    const report = buildWorkflowParityReport({
      agentWorkData: baseAgentWorkData(),
      agentRuns: baseAgentRuns(),
      mediaTasks: baseMediaTasks(),
      entityExtractions: baseEntityExtractions(),
      scriptPlans: baseScriptPlans(),
      storyboards: [completeStoryboard()],
      productionTracks: baseTracks(),
      videoCandidates: baseVideoCandidates(),
      toonflowFixtureRows: [toonflowFixtureRow()],
      workflowConfig: {
        visualManualId: "visual-daojie",
        directorManualId: "director-daojie",
      },
      manualCatalog,
      evidenceBoundary: {
        seededUiSmoke: true,
        visibleWorkflowSmoke: true,
        realDaojieVisibleSmoke: true,
        realMediaGeneration: true,
      },
    });

    expect(report.toonflowFixture).toMatchObject({
      enabled: true,
      storyboardRows: 1,
      matchedRows: 1,
      promptMismatches: 0,
      videoDescMismatches: 0,
      referenceOrderMismatches: 0,
      imagePathMissing: 0,
      goldenImageComparisonStatus: "deferred",
    });
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "toonflow.goldenImage.deferred",
    ]);
  });
});

function baseAgentRuns(): StudioAgentRun[] {
  return [
    run("script-run", "scriptDraft", "script", "script"),
    run("director-run", "directorPlan", "scriptPlan", "director"),
    run("assets-run", "entityExtraction", "assets", "assets"),
    run("table-run", "storyboardTable", "storyboardTable", "table"),
    run("image-run", "storyboardImage", "storyboard", "image-flow-1"),
    run("workbench-run", "productionPlan", "workbench", "export"),
  ];
}

function baseMediaTasks(): MediaGenerationTask[] {
  return [
    mediaTask("image-task", "storyboardImage", "shot-1", "success", "/tmp/shot.png"),
    mediaTask("audio-task", "ttsAudio", "shot-1", "success", "/tmp/shot.wav"),
    mediaTask("video-task", "ffmpegTrack", "video-1", "success", "/tmp/track.mp4"),
    mediaTask("export-task", "finalExport", "chapter-001", "success", "/tmp/final.mp4"),
  ];
}

function mediaTask(
  id: string,
  kind: MediaGenerationTask["kind"],
  targetId: string,
  status: MediaGenerationTask["status"],
  outputRef?: string,
): MediaGenerationTask {
  return {
    id,
    kind,
    targetId,
    status,
    outputRef,
    createdAt: 1,
    updatedAt: 2,
    finishedAt: status === "success" || status === "failed" ? 2 : undefined,
  };
}

function run(id: string, key: StudioAgentRun["key"], phase: string, outputRef: string): StudioAgentRun {
  return {
    id,
    key,
    phase,
    status: "success",
    inputSummary: `${key} input`,
    inputFingerprint: `${key} fingerprint`,
    outputRef,
    startedAt: 1,
    finishedAt: 2,
  };
}

function baseAgentWorkData(options: { productionPlan?: boolean } = {}): AgentWorkData[] {
  const includeProductionPlan = options.productionPlan !== false;
  return [
    {
      id: "script",
      key: "scriptDraft",
      data: "第一章剧本正文",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "director",
      key: "directorPlan",
      data: "## 导演规划\n- 保持水墨风格。",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "table",
      key: "storyboardTable",
      data: "| 序号 | 画面描述 |",
      createdAt: 1,
      updatedAt: 3,
    },
    ...(includeProductionPlan
      ? [
          {
            id: "export",
            key: "productionPlan" as const,
            data: "本地成片输出: /tmp/final.mp4",
            createdAt: 1,
            updatedAt: 4,
          },
        ]
      : []),
  ];
}

function baseEntityExtractions(): EntityExtractionResult[] {
  return [
    {
      id: "assets",
      episodeId: "chapter-001",
      characters: [{ characterId: "char-1", name: "独孤剑尘", aliases: [] }],
      scenes: [{ sceneId: "scene-1", name: "道口镇" }],
      props: [{ assetId: "prop-1", name: "断剑" }],
    },
  ];
}

function baseScriptPlans(): ScriptPlan[] {
  return [
    {
      id: "plan-1",
      episodeId: "chapter-001",
      theme: "夜访道口镇",
      visualStyle: "水墨国风",
      narrativeRhythm: "压迫推进",
      sceneIntents: [
        {
          sceneId: "Sc1",
          emotion: "隐忍",
          shotIntent: "低机位推进",
          spatial: "街巷纵深",
        },
      ],
      soundDirection: "低频雨声",
      transitions: "雨声转场",
      derivedAssetPlan: [],
    },
  ];
}

function completeStoryboard(): StoryboardItem {
  return {
    id: "shot-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 5,
    prompt: "@图1 为独孤剑尘角色参考，@图2 为道口镇场景参考。【画面】@图1 站在 @图2 雨巷尽头。",
    videoDesc: "独孤剑尘雨夜入镇",
    assetIds: ["char-1", "scene-1"],
    shouldGenerateImage: true,
    mediaRef: {
      kind: "image",
      path: "/tmp/shot.png",
      imageWorkflowId: "image-flow-1",
      imageWorkflowNodeId: "generated-1",
    },
    imageWorkflowId: "image-flow-1",
    imageWorkflowNodeId: "generated-1",
    audioRef: {
      kind: "audio",
      path: "/tmp/shot.wav",
    },
    state: "ready",
    lines: "旁白：雨声压住道口镇。",
    speakerId: "narrator",
    sourceEvidence: {
      source: "toonflow-import",
      sourceProjectId: 1779271590876,
      sourceStoryboardId: 1,
      sourceTable: "o_storyboard",
    },
    orderedReferenceManifest: [
      {
        order: 1,
        assetId: "char-1",
        assetName: "独孤剑尘",
        assetKind: "character",
        imageId: 101,
        imagePath: "/toonflow/char-1.jpg",
        source: "o_assets2Storyboard.rowid",
      },
      {
        order: 2,
        assetId: "scene-1",
        assetName: "道口镇",
        assetKind: "scene",
        imageId: 102,
        imagePath: "/toonflow/scene-1.jpg",
        source: "o_assets2Storyboard.rowid",
      },
    ],
  };
}

function toonflowFixtureRow() {
  return {
    id: 1,
    index: 1,
    prompt: "@图1 为独孤剑尘角色参考，@图2 为道口镇场景参考。【画面】@图1 站在 @图2 雨巷尽头。",
    videoDesc: "独孤剑尘雨夜入镇",
    referenceAssetIds: ["char-1", "scene-1"],
    referenceImagePaths: ["/toonflow/char-1.jpg", "/toonflow/scene-1.jpg"],
    shouldGenerateImage: true,
  };
}

function baseTracks(options: { selectedVideoId?: string } = {}): ProductionTrack[] {
  return [
    {
      id: "track-1",
      episodeId: "chapter-001",
      trackKey: "track-1",
      storyboardIds: ["shot-1"],
      prompt: "track prompt",
      duration: 5,
      candidateVideoIds: ["video-1"],
      selectedVideoId: options.selectedVideoId ?? "video-1",
      state: "ready",
    },
  ];
}

function baseVideoCandidates(): VideoCandidate[] {
  return [
    {
      id: "video-1",
      trackId: "track-1",
      provider: "ffmpeg-local",
      filePath: "/tmp/track.mp4",
      state: "ready",
      createdAt: 1,
    },
  ];
}
