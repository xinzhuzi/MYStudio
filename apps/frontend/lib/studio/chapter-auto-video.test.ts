import { describe, expect, it, vi } from "vitest";
import {
  ChapterTtsCancellationController,
  prepareChapterMedia,
  runChapterAutoVideo,
  type ChapterAutoVideoDependencies,
} from "./chapter-auto-video";
import type {
  ContinuityAssetVersion,
  StoryboardItem,
  StoryboardTtsJobV1,
} from "@/types/studio";
import type { RemotionShotAudioBindingV2 } from "@/types/remotion-workspace";
import type { VoiceProfile } from "@/types/tts";
import {
  approvedVisualReview,
  createHumanContinuityAssetApproval,
  normalizeContinuityAssetVersion,
  storyboardShotSemanticsFingerprint,
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
    sourceId: "source-001",
    revision: 2,
    index,
    trackKey: "001", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
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
    shotSemantics: {
      sceneViewpointId: "dock:front",
      personFree: true,
      visibleCharacters: [],
      visibleProps: [],
      actionIn: index > 1 ? "承接前镜" : "建立场景",
      actionOut: "继续向右",
    },
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
      sourceSemanticsFingerprint: "",
      inputFingerprint: "",
    },
    ...overrides,
  };
  if (!overrides.continuityState) {
    item.continuityState!.sourceSemanticsFingerprint = storyboardShotSemanticsFingerprint(item.shotSemantics);
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

function generatedAudioResult(item: StoryboardItem) {
  const inputFingerprint = item.index.toString(16).padStart(64, "0");
  const contentSha256 = "c".repeat(64);
  const shotRevision = Math.max(1, item.outputVersion ?? 1);
  const ttsJob: StoryboardTtsJobV1 = {
    schemaVersion: 1,
    projectId: "project-1",
    chapterId: item.episodeId,
    shotId: item.id,
    shotRevision,
    inputFingerprint,
    status: "completed",
    attempt: 1,
    generationId: `generation-${item.id}`,
    createdAt: 1,
    updatedAt: 2,
  };
  const shotAudioBinding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `voice:${item.id}:${inputFingerprint}`,
    bindingFingerprint: item.index.toString(16).padStart(64, "a"),
    renderScope: "shot",
    projectId: "project-1",
    chapterId: item.episodeId,
    shotId: item.id,
    shotRevision,
    role: "voice",
    source: {
      kind: "project-file",
      projectId: "project-1",
      relativePath: `remotion/audio/${item.episodeId}/shots/${item.id}/voice/${contentSha256}.wav`,
      contentSha256,
      provenance: {
        sourceKind: "generated",
        sourceId: contentSha256,
        sourceVersion: `sha256:${contentSha256}`,
      },
    },
    sourceFingerprint: contentSha256,
    sourceDurationUs: 1_000_000,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: 1_000_000,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
    ttsInputFingerprint: inputFingerprint,
  };
  return {
    audioRef: {
      kind: "audio" as const,
      path: `project-file://project-1/${shotAudioBinding.source.relativePath}`,
      contentSha256,
    },
    shotAudioBinding,
    ttsJob,
    generationId: ttsJob.generationId,
    ttsBackend: "qwen-mlx",
    ttsMocked: false as const,
  };
}

function createDependencies(options: { missingMedia?: boolean; storyboardCount?: number } = {}) {
  const calls: string[] = [];
  let storyboards = Array.from(
    { length: options.storyboardCount ?? 2 },
    (_, index) => storyboard(index + 1),
  );
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
      return generatedAudioResult(item);
    }),
    writeStoryboardAudio: (storyboardId, result) => {
      storyboards = storyboards.map((item) =>
        item.id === storyboardId
          ? {
            ...item,
            audioRef: result.audioRef,
            shotAudioBindings: [
              ...(item.shotAudioBindings?.filter((binding) => binding.role !== "voice") ?? []),
              result.shotAudioBinding,
            ],
            ttsJob: result.ttsJob,
          }
          : item,
      );
    },
    enqueueRemotionShots: vi.fn(async ({ projectId, chapterId, storyboards }) => {
      calls.push("remotion-queue");
      return {
        jobs: storyboards.map((item, index) => ({
          schemaVersion: 1 as const,
          projectId,
          target: {
            kind: "shot" as const,
            chapterId,
            shotId: item.id,
            shotRevision: 1,
          },
          inputHash: `${index}`.padStart(64, "a"),
          bundleContentHash: "b".repeat(64),
          renderSettingsHash: "c".repeat(64),
          jobId: `remotion-${item.id}`,
          templateVersion: "1.0.0",
          remotionVersion: "4.0.499",
          status: "queued" as const,
          attempt: 0,
          progress: 0,
          createdAt: 1,
        })),
        blockedShotIds: [],
      };
    }),
  };
  return { dependencies, calls };
}

describe("chapter auto video orchestration", () => {
  it("prepares reusable storyboard media without rendering or merging", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result.storyboards.map((item) => item.id)).toEqual(["sb-1", "sb-2"]);
    expect(result.storyboards.every((item) => item.audioRef?.path)).toBe(true);
    expect(calls).toEqual(["planning", "binding", "tts:sb-1", "tts:sb-2"]);
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
      "tts",
    ]);
  });

  it("rejects storyboards with a stale source revision before TTS", async () => {
    const { dependencies } = createDependencies();
    await expect(prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      expectedIdentity: { sourceId: "source-001", revision: 3 },
      dependencies,
    })).rejects.toThrow("revision 与期望不一致: 2/3");
  });

  it("allows missing source identity when storyboards predate identity tracking", async () => {
    const { dependencies, calls } = createDependencies();
    const originalLoad = dependencies.loadStoryboards;
    dependencies.loadStoryboards = () => originalLoad().map(({ sourceId: _sourceId, revision: _revision, ...item }) => item);
    const result = await runChapterAutoVideo({
      projectId: "project-1",
      episodeId: "chapter-001",
      expectedIdentity: { sourceId: "source-001", revision: 2 },
      dependencies,
      onStatus: () => {},
    });
    expect(result).toMatchObject({ storyboards: 2, queueStatus: "queued" });
  });

  it("runs planning, fixed voice, and every storyboard through the Remotion shot queue", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];
    const result = await runChapterAutoVideo({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result).toMatchObject({
      storyboards: 2,
      queueStatus: "queued",
      blockedShotIds: [],
    });
    expect(result.remotionJobs).toHaveLength(2);
    expect(calls).toEqual([
      "planning",
      "binding",
      "tts:sb-1",
      "tts:sb-2",
      "remotion-queue",
    ]);
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
      "tts",
      "render",
      "queued",
    ]);
  });

  it("waits for Remotion shots, runs video-use preview, and pauses for human review", async () => {
    const { dependencies, calls } = createDependencies();
    const statuses: string[] = [];
    const reviewRequired = vi.fn();
    dependencies.runVideoUseChapter = vi.fn(async ({ storyboards: queuedStoryboards, submission }) => {
      calls.push("video-use");
      expect(queuedStoryboards).toHaveLength(2);
      expect(submission.jobs).toHaveLength(2);
      return { state: "pending" as const, revision: 1, inputSha256: "d".repeat(64) };
    });
    dependencies.onVideoUseReviewRequired = reviewRequired;

    const result = await runChapterAutoVideo({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies,
      onStatus: (status) => statuses.push(status.stage),
    });

    expect(result).toMatchObject({
      storyboards: 2,
      queueStatus: "awaiting-review",
      videoUseState: "pending",
      videoUseRevision: 1,
    });
    expect(calls).toEqual([
      "planning",
      "binding",
      "tts:sb-1",
      "tts:sb-2",
      "remotion-queue",
      "video-use",
    ]);
    expect(reviewRequired).toHaveBeenCalledOnce();
    expect(statuses).toEqual([
      "planning",
      "voiceover",
      "binding",
      "tts",
      "media",
      "tts",
      "render",
      "probing",
      "awaiting-review",
    ]);
  });

  it("stops before rendering when a storyboard image is missing", async () => {
    const { dependencies, calls } = createDependencies({ missingMedia: true });
    const statuses: string[] = [];
    await expect(
      runChapterAutoVideo({
        projectId: "project-1",
        episodeId: "chapter-001",
        dependencies,
        onStatus: (status) => statuses.push(status.stage),
      }),
    ).rejects.toThrow("缺少可读分镜图");
    expect(statuses.at(-1)).toBe("failed");
  });

  it("blocks chapters with no dynamic storyboards before fixed voice binding", async () => {
    const run = createDependencies();
    const statuses: string[] = [];
    run.dependencies.loadStoryboards = () => [];

    await expect(
      runChapterAutoVideo({
        projectId: "project-1",
        episodeId: "chapter-001",
        dependencies: run.dependencies,
        onStatus: (status) => statuses.push(status.stage),
      }),
    ).rejects.toThrow("chapter-001 没有可用于成片的动态分镜");

    expect(run.dependencies.ensureFixedVoiceProfiles).not.toHaveBeenCalled();
    expect(run.dependencies.generateAudio).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("failed");
  });

  it("isolates TTS results without a real audio path and blocks the chapter", async () => {
    const run = createDependencies();
    run.dependencies.generateAudio = vi.fn(async (item) => ({
      ...generatedAudioResult(item),
      audioRef: { kind: "audio" as const, path: "" },
    }));
    run.dependencies.writeStoryboardAudio = vi.fn();

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.blockedShotIds).toEqual(["sb-1", "sb-2"]);
    expect(result.ttsErrors["sb-1"]).toContain("未返回真实音频路径");
    expect(run.dependencies.writeStoryboardAudio).not.toHaveBeenCalled();
  });

  it("isolates generated audio that cannot be resolved after TTS writeback", async () => {
    const run = createDependencies();
    run.dependencies.resolveMediaPath = vi.fn(async (path) => (
      path.startsWith("project-file://") ? "" : path
    ));

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.blockedShotIds).toEqual(["sb-1", "sb-2"]);
    expect(result.ttsErrors["sb-2"]).toContain("缺少可读真实音频");
    expect(run.dependencies.generateAudio).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sb-2" }),
      profiles["character:dugu"],
    );
  });

  it("blocks the whole chapter after one TTS failure and never queues a partial shot set", async () => {
    const run = createDependencies();
    const baseGenerate = run.dependencies.generateAudio;
    run.dependencies.generateAudio = vi.fn(async (item, voiceProfile) => {
      if (item.id === "sb-1") throw new Error("provider terminal failure");
      return baseGenerate(item, voiceProfile);
    });

    const result = await runChapterAutoVideo({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.queueStatus).toBe("blocked");
    expect(result.blockedShotIds).toEqual(["sb-1"]);
    expect(result.remotionJobs).toEqual([]);
    expect(run.dependencies.enqueueRemotionShots).not.toHaveBeenCalled();
  });

  it("limits the per-shot worker pool to the configured concurrency", async () => {
    const run = createDependencies({ storyboardCount: 4 });
    const baseGenerate = run.dependencies.generateAudio;
    let active = 0;
    let maximumActive = 0;
    run.dependencies.ttsConcurrency = 2;
    run.dependencies.generateAudio = vi.fn(async (item, voiceProfile) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      const result = await baseGenerate(item, voiceProfile);
      active -= 1;
      return result;
    });

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.blockedShotIds).toEqual([]);
    expect(maximumActive).toBe(2);
    expect(run.dependencies.generateAudio).toHaveBeenCalledTimes(4);
  });

  it("cancels queued shots immediately without canceling later independent work", async () => {
    const run = createDependencies({ storyboardCount: 3 });
    const cancellation = new ChapterTtsCancellationController();
    cancellation.cancelShot("sb-2");
    run.dependencies.ttsConcurrency = 1;
    run.dependencies.isTtsCanceled = (storyboardId) => cancellation.isCanceled(storyboardId);

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.blockedShotIds).toEqual(["sb-2"]);
    expect(run.dependencies.generateAudio).toHaveBeenCalledTimes(2);
    expect(run.dependencies.generateAudio).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "sb-2" }),
      expect.anything(),
    );
  });

  it("discards a running shot result canceled before writeback", async () => {
    const run = createDependencies();
    const cancellation = new ChapterTtsCancellationController();
    const baseGenerate = run.dependencies.generateAudio;
    const baseWrite = run.dependencies.writeStoryboardAudio;
    run.dependencies.isTtsCanceled = (storyboardId) => cancellation.isCanceled(storyboardId);
    run.dependencies.generateAudio = vi.fn(async (item, voiceProfile) => {
      const result = await baseGenerate(item, voiceProfile);
      if (item.id === "sb-1") cancellation.cancelShot(item.id);
      return result;
    });
    run.dependencies.writeStoryboardAudio = vi.fn(baseWrite);

    const result = await prepareChapterMedia({
      projectId: "project-1",
      episodeId: "chapter-001",
      dependencies: run.dependencies,
    });

    expect(result.blockedShotIds).toEqual(["sb-1"]);
    expect(run.dependencies.writeStoryboardAudio).toHaveBeenCalledTimes(1);
    expect(run.dependencies.writeStoryboardAudio).toHaveBeenCalledWith(
      "sb-2",
      expect.objectContaining({ generationId: "generation-sb-2" }),
    );
  });

  it.each([
    {
      name: "non-positive duration target",
      buildStoryboards: () => [storyboard(1, { durationTarget: 0 })],
      message: "分镜 sb-1 durationTarget 必须大于 0",
    },
    {
      name: "missing fixed voice requirement",
      buildStoryboards: () => [{
        ...storyboard(1),
        requiresFixedVoice: false,
      } as unknown as StoryboardItem],
      message: "分镜 sb-1 requiresFixedVoice 必须为 true",
    },
  ] satisfies Array<{
    name: string;
    buildStoryboards: () => StoryboardItem[];
    message: string;
  }>)("blocks $name before voice binding and TTS", async ({ buildStoryboards, message }) => {
    const run = createDependencies();
    run.dependencies.loadStoryboards = buildStoryboards;

    await expect(
      runChapterAutoVideo({
        projectId: "project-1",
        episodeId: "chapter-001",
        dependencies: run.dependencies,
      }),
    ).rejects.toThrow(message);

    expect(run.dependencies.ensureFixedVoiceProfiles).not.toHaveBeenCalled();
    expect(run.dependencies.generateAudio).not.toHaveBeenCalled();
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
        projectId: "project-1",
        episodeId: "chapter-001",
        dependencies: run.dependencies,
      })).rejects.toThrow("视觉连续性未通过");
      expect(run.dependencies.ensureFixedVoiceProfiles).not.toHaveBeenCalled();
      expect(run.dependencies.generateAudio).not.toHaveBeenCalled();
    }
  });

  it("blocks incomplete voiceover and missing fixed profile before TTS", async () => {
    const incomplete = createDependencies();
    incomplete.dependencies.loadStoryboards = () => [
      storyboard(1, { ttsSpokenText: "" }),
    ];
    await expect(
      runChapterAutoVideo({
        projectId: "project-1",
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
        projectId: "project-1",
        episodeId: "chapter-001",
        dependencies: missingProfile.dependencies,
      }),
    ).rejects.toThrow("character:dugu 缺少固定 voice profile");
    expect(missingProfile.dependencies.generateAudio).not.toHaveBeenCalled();
  });
});
