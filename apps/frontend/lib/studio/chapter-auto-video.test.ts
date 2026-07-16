import { describe, expect, it, vi } from "vitest";
import {
  prepareChapterMedia,
  runChapterAutoVideo,
  type ChapterAutoVideoDependencies,
} from "./chapter-auto-video";
import type { ContinuityAssetVersion, ProductionTrack, StoryboardItem, VideoCandidate } from "@/types/studio";
import type { EditingProjectV1, TimelineRenderEvidence } from "@/types/editing";
import type { VoiceProfile } from "@/types/tts";
import {
  approvedVisualReview,
  createHumanContinuityAssetApproval,
  normalizeContinuityAssetVersion,
  visualContinuityFingerprint,
  visualReviewInputFingerprint,
} from "./visual-continuity";

function approvedSceneVersion(): ContinuityAssetVersion {
  return createHumanContinuityAssetApproval(normalizeContinuityAssetVersion({
    assetId: "scene:dock",
    versionId: "dock:main",
    assetKind: "scene",
    label: "码头正向主轴",
    referenceImagePaths: ["/dock.png"],
    reviewEvidencePaths: ["/reviews/dock_thumb.png"],
    reviewEvidenceSha256: ["a".repeat(64)],
    reviewEvidenceVerifiedAt: 1,
    sceneViewpointId: "dock:front",
    spatialLayout: "河岸、栈桥与仓棚位置固定",
    lightingDesign: "冷青晨雾",
    colorPalette: "墨青灰蓝",
    structurallyComplete: true,
    contentFingerprint: "",
    approved: false,
    source: "test-scene-bible",
  }), {
    status: "approved",
    evidencePaths: ["/reviews/dock_thumb.png"],
    reviewedAt: 10,
  });
}

function storyboard(index: number, overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  const sceneVersion = approvedSceneVersion();
  const item: StoryboardItem = {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: "chapter-001-scene-1",
    trackId: "track-1",
    duration: 4,
    prompt: `画面 ${index}`,
    videoDesc: `动作 ${index}`,
    assetIds: [],
    mediaRef: { kind: "image", path: `/frame-${index}.png` },
    audioRef: index === 1 ? { kind: "audio", path: "/audio-1.wav" } : undefined,
    state: "ready",
    speaker: index === 1 ? "旁白" : "独孤剑尘",
    speakerId: index === 1 ? "narrator" : "character:dugu",
    line: `台词 ${index}`,
    ttsSpokenText: `台词 ${index}`,
    durationTarget: 4,
    voiceStyle: "克制",
    requiresFixedVoice: true,
    orderedReferenceManifest: [
      {
        order: 1,
        assetId: "scene:dock",
        versionId: "dock:main",
        imagePath: "/dock.png",
        assetKind: "scene",
        referenceRole: "scene-viewpoint",
        sceneViewpointId: "dock:front",
        contentFingerprint: sceneVersion.contentFingerprint,
        approvalFingerprint: sceneVersion.approvalFingerprint,
        approved: sceneVersion.approved,
      },
    ],
    continuityState: {
      groupId: "dock",
      previousStoryboardId: index > 1 ? `sb-${index - 1}` : undefined,
      sceneVersionId: "dock:main",
      sceneViewpointId: "dock:front",
      lighting: "冷青晨雾",
      palette: "墨青灰蓝",
      actionIn: index > 1 ? "承接前镜" : "建立场景",
      actionOut: "继续向右",
      characters: [],
      inputFingerprint: "",
    },
    ...overrides,
  };
  if (!overrides.continuityState) {
    item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "visualReview")) {
    item.visualReview = approvedVisualReview({
      reviewedAt: 1,
      evidencePaths: [`/frame-${index}.png`],
      sceneChecks: [{ sceneVersionId: "dock:main", passed: true }],
      propChecks: [],
      transitionChecks: index > 1 ? [{ previousStoryboardId: `sb-${index - 1}`, passed: true }] : [],
      textWatermarkCheck: { passed: true },
      inputFingerprint: visualReviewInputFingerprint(item),
    });
  }
  return item;
}

const profiles = {
  narrator: {
    id: "profile-narrator",
    name: "旁白",
    type: "reference" as const,
    language: "zh",
    defaultEngine: "qwen" as const,
    referenceAudioPath: "/voice/narrator.wav",
    referenceText: "旁白参考",
    createdAt: 1,
    updatedAt: 1,
  },
  "character:dugu": {
    id: "profile-dugu",
    name: "独孤剑尘",
    type: "reference" as const,
    language: "zh",
    defaultEngine: "qwen" as const,
    referenceAudioPath: "/voice/dugu.wav",
    referenceText: "角色参考",
    createdAt: 1,
    updatedAt: 1,
  },
} satisfies Record<string, VoiceProfile>;

function createDependencies(options: { missingMedia?: boolean } = {}) {
  const calls: string[] = [];
  let storyboards = [
    storyboard(1),
    storyboard(2),
  ];
  const track: ProductionTrack = {
    id: "track-1",
    episodeId: "chapter-001",
    trackKey: "chapter-001-scene-1",
    storyboardIds: storyboards.map((item) => item.id),
    prompt: "第一场",
    duration: 8,
    candidateVideoIds: [],
    state: "ready",
  };
  const rendered: VideoCandidate = {
    id: "candidate-1",
    trackId: track.id,
    provider: "ffmpeg-local",
    filePath: "/track.mp4",
    state: "ready",
    createdAt: 1,
  };
  const editingProject: EditingProjectV1 = {
    schemaVersion: 1,
    id: "editing-chapter-001",
    projectId: "project-1",
    episodeId: "chapter-001",
    name: "第一章自动剪辑",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [],
    clips: [],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const evidence: TimelineRenderEvidence = {
    jobId: "timeline-render-1",
    path: "/final.mp4",
    sizeBytes: 1024,
    mtimeMs: 1_700_000_000_000,
    sha256: "a".repeat(64),
    duration: 120,
    width: 1080,
    height: 1920,
    streams: ["video", "audio"],
    snapshotHash: "b".repeat(64),
    snapshotPath: "/editing-project.json",
    renderPlanPath: "/render-plan.json",
    inputManifestPath: "/input-manifest.json",
    filterGraphPath: "/filter-graph.txt",
    logPath: "/ffmpeg.log",
    ffprobePath: "/ffprobe.json",
  };
  const dependencies: ChapterAutoVideoDependencies = {
    ensurePlanning: vi.fn(async () => {
      calls.push("planning");
    }),
    loadStoryboards: () => storyboards,
    loadContinuityAssetVersions: () => [approvedSceneVersion()],
    ensureFixedVoiceProfiles: vi.fn(async () => {
      calls.push("binding");
      return profiles;
    }),
    resolveMediaPath: vi.fn(async (path) => (
      options.missingMedia && path === "/frame-2.png" ? "" : path
    )),
    generateAudio: vi.fn(async (item) => {
      calls.push(`tts:${item.id}`);
      return {
        audioRef: { kind: "audio" as const, path: `/generated-${item.id}.wav` },
        generationId: `generation-${item.id}`,
        ttsBackend: "qwen-mlx",
        ttsMocked: false as const,
      };
    }),
    writeStoryboardAudio: (storyboardId, result) => {
      storyboards = storyboards.map((item) =>
        item.id === storyboardId ? { ...item, audioRef: result.audioRef } : item,
      );
    },
    rebuildTracks: vi.fn(() => calls.push("rebuild")),
    loadTracks: () => [track],
    loadCandidates: () => [],
    renderTrack: vi.fn(async () => {
      calls.push("render");
      return rendered;
    }),
    createEditingProject: vi.fn(async () => {
      calls.push("editing");
      return editingProject;
    }),
    renderEditingProject: vi.fn(async () => {
      calls.push("timeline-render");
      return evidence;
    }),
    writeFinalEvidence: vi.fn(() => calls.push("write-final")),
  };
  return { dependencies, calls };
}

describe("chapter auto video orchestration", () => {
  it("prepares reusable storyboard media without rendering or merging", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];

    const result = await prepareChapterMedia({
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result.storyboards.map((item) => item.id)).toEqual(["sb-1", "sb-2"]);
    expect(result.storyboards.every((item) => item.audioRef?.path)).toBe(true);
    expect(calls).toEqual(["planning", "binding", "tts:sb-2"]);
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
    ]);
    expect(dependencies.rebuildTracks).not.toHaveBeenCalled();
    expect(dependencies.renderTrack).not.toHaveBeenCalled();
    expect(dependencies.createEditingProject).not.toHaveBeenCalled();
  });

  it("runs planning, fixed voice, candidates, editing, timeline render, and evidence in order", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];
    const result = await runChapterAutoVideo({
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result).toMatchObject({
      finalPath: "/final.mp4",
      editingProjectId: "editing-chapter-001",
      editingRevision: 1,
      storyboards: 2,
    });
    expect(calls).toEqual([
      "planning",
      "binding",
      "tts:sb-2",
      "rebuild",
      "render",
      "editing",
      "timeline-render",
      "write-final",
    ]);
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
      "render",
      "editing",
      "rendering",
      "probing",
      "completed",
    ]);
  });

  it("stops before rendering when a storyboard image is missing", async () => {
    const { dependencies, calls } = createDependencies({ missingMedia: true });
    const statuses: string[] = [];
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies,
        onStatus: (status) => statuses.push(status.stage),
      }),
    ).rejects.toThrow("缺少可读分镜图");
    expect(calls).not.toContain("render");
    expect(calls).not.toContain("editing");
    expect(statuses.at(-1)).toBe("failed");
  });

  it("stops before rendering when visual continuity is pending, rejected, or stale", async () => {
    for (const invalid of [
      { visualReview: undefined },
      { visualReview: approvedVisualReview({ status: "rejected", reasons: ["独孤剑尘换脸"] }) },
      { stale: true, staleReason: "上一镜已变化" },
    ] satisfies Partial<StoryboardItem>[]) {
      const run = createDependencies();
      run.dependencies.loadStoryboards = () => [storyboard(1, invalid)];
      await expect(runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies: run.dependencies,
      })).rejects.toThrow("视觉连续性未通过");
      expect(run.dependencies.ensureFixedVoiceProfiles).not.toHaveBeenCalled();
      expect(run.dependencies.generateAudio).not.toHaveBeenCalled();
      expect(run.dependencies.renderTrack).not.toHaveBeenCalled();
      expect(run.dependencies.createEditingProject).not.toHaveBeenCalled();
    }
  });

  it("blocks incomplete voiceover and missing fixed profile before TTS", async () => {
    const incomplete = createDependencies();
    incomplete.dependencies.loadStoryboards = () => [
      storyboard(1, { ttsSpokenText: "" }),
    ];
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies: incomplete.dependencies,
      }),
    ).rejects.toThrow("缺少 ttsSpokenText");
    expect(incomplete.dependencies.generateAudio).not.toHaveBeenCalled();

    const missingProfile = createDependencies();
    missingProfile.dependencies.ensureFixedVoiceProfiles = async () => ({
      narrator: profiles.narrator,
    });
    await expect(
      runChapterAutoVideo({
        episodeId: "chapter-001",
        dependencies: missingProfile.dependencies,
      }),
    ).rejects.toThrow("character:dugu 缺少固定 voice profile");
    expect(missingProfile.dependencies.generateAudio).not.toHaveBeenCalled();
  });
});
