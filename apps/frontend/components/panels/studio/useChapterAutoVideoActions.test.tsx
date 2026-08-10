// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChapterAutoVideo } from "@/lib/studio/chapter-auto-video";
import { runStoryboardTtsGeneration } from "@/lib/studio/storyboard-tts-runner";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { serializeStoryboardTable } from "@/lib/studio/storyboard-table";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";
import type { RemotionShotAudioBindingV2 } from "@/types/remotion-workspace";
import type { VoiceProfile } from "@/types/tts";
import { useChapterAutoVideoActions } from "./useChapterAutoVideoActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/studio/editing/source-snapshot", () => ({
  buildEditingSourceSnapshotHash: vi.fn(async () => "b".repeat(64)),
}));

vi.mock("@/lib/studio/chapter-auto-video", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/studio/chapter-auto-video")
  >("@/lib/studio/chapter-auto-video");
  return { ...actual, runChapterAutoVideo: vi.fn() };
});

vi.mock("@/lib/studio/storyboard-tts-runner", () => ({
  runStoryboardTtsGeneration: vi.fn(),
}));

const initialProjectState = useProjectStore.getState();
const initialStudioState = useStudioStore.getState();

beforeEach(() => {
  let sequence = 0;
  const subtle = globalThis.crypto?.subtle;
  vi.stubGlobal("crypto", {
    subtle,
    randomUUID: vi.fn(() => `test-uuid-${++sequence}`),
  });
  useProjectStore.setState({
    projects: [projectSummary()],
    activeProjectId: "project-1",
    activeProject: projectSummary(),
  });
  useStudioStore.setState({
    ...initialStudioState,
    scriptPlans: [scriptPlan()],
    seriesBible: {
      id: "bible-1",
      projectId: "project-1",
      characterLocks: [],
      sceneLocks: [],
      visualManualId: "visual-1",
      directorManualId: "director-1",
      aspectRatio: "9:16",
      stylePositioning: "水墨动画",
    },
    storyboards: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as { studioRenderer?: unknown }).studioRenderer;
  delete (window as { studioAssets?: unknown }).studioAssets;
  delete (window as { ttsRuntime?: unknown }).ttsRuntime;
  delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  useProjectStore.setState(initialProjectState, true);
  useStudioStore.setState(initialStudioState, true);
});

describe("useChapterAutoVideoActions", () => {
  it("does not start auto-video without an active project", async () => {
    const autoVideo = vi.mocked(runChapterAutoVideo);
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: undefined,
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(autoVideo).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("未选择项目，无法自动成片");
    expect(result.current.chapterAutoVideoStatus).toEqual({
      stage: "idle",
      detail: "尚未运行第一章自动成片",
    });
  });

  it("keeps the runner failed status and surfaces the thrown error", async () => {
    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ onStatus }) => {
      onStatus?.({
        stage: "failed",
        detail: "第一章自动成片失败",
        error: "render boom",
      });
      throw new Error("render boom");
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(autoVideo).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("render boom");
    expect(result.current.chapterAutoVideoStatus).toMatchObject({
      stage: "failed",
      detail: "第一章自动成片失败",
      error: "render boom",
    });
  });

  it("hands the video-use review transition to the runner and preserves awaiting-review", async () => {
    const autoVideo = vi.mocked(runChapterAutoVideo);
    const onVideoUseReviewRequired = vi.fn();
    autoVideo.mockImplementationOnce(async ({ dependencies, onStatus }) => {
      expect(dependencies.onVideoUseReviewRequired).toBe(onVideoUseReviewRequired);
      dependencies.onVideoUseReviewRequired?.();
      onStatus?.({
        stage: "awaiting-review",
        detail: "video-use preview 已生成，等待用户确认",
      });
      return {
        storyboards: 1,
        queueStatus: "awaiting-review",
        videoUseState: "pending",
        videoUseRevision: 1,
      };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
        onVideoUseReviewRequired,
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(onVideoUseReviewRequired).toHaveBeenCalledOnce();
    expect(result.current.chapterAutoVideoStatus).toMatchObject({
      stage: "awaiting-review",
      detail: "video-use preview 已生成，等待用户确认",
    });
  });

  it("builds video-use preview input only from the current Remotion slot", async () => {
    const storyboard = {
      id: "sb-preview-001",
      episodeId: "chapter-001",
      index: 1,
      duration: 2,
      durationTarget: 2,
      outputVersion: 1,
      state: "ready",
      stale: false,
      ttsSpokenText: "雨落。",
      audioRef: {
        kind: "audio" as const,
        path: "project-file://project-1/remotion/audio/chapter-001/sb-preview-001.wav",
        contentSha256: "c".repeat(64),
      },
    } as StoryboardItem;
    const initialSlot = makeCurrentSlot();
    const target = {
      kind: "shot" as const,
      chapterId: "chapter-001",
      shotId: storyboard.id,
      shotRevision: 1,
    };
    const job = {
      ...initialSlot.job,
      projectId: "project-1",
      target,
      outputPath: `outputs/shots/chapter-001/${storyboard.id}/current.mp4`,
      evidencePath: `evidence/shots/chapter-001/${storyboard.id}/current.json`,
    };
    job.jobId = await createRemotionRenderJobId(job);
    const evidence = {
      ...initialSlot.evidence,
      projectId: "project-1",
      target,
      jobId: job.jobId,
      inputHash: job.inputHash,
      outputPath: job.outputPath,
    };
    const slot = {
      ...initialSlot,
      projectId: "project-1",
      target,
      jobPath: `jobs/shot/chapter-001/${storyboard.id}/current.json`,
      evidencePath: job.evidencePath,
      outputPath: job.outputPath,
      job,
      evidence,
    };
    const queueGet = vi.fn(async () => ({
      projectId: "project-1",
      chapterId: "chapter-001",
      jobs: [slot.job],
      currentShotSlots: [slot],
    }));
    const runChapter = vi.fn(async (request: { revision: number }) => ({
      schemaVersion: 1 as const,
      success: true,
      projectId: "project-1",
      chapterId: "chapter-001",
      revision: request.revision,
      state: "pending" as const,
      artifact: { evidence: { inputSha256: "d".repeat(64) } },
    }));
    window.remotionQueue = {
      get: queueGet,
    } as unknown as NonNullable<Window["remotionQueue"]>;
    window.videoWorkflowPlugins = {
      readChapter: vi.fn(async () => ({
        schemaVersion: 1 as const,
        projectId: "project-1",
        chapterId: "chapter-001",
        videoUseState: "idle",
        hyperFramesState: "idle",
      })),
      runChapter,
    } as unknown as NonNullable<Window["videoWorkflowPlugins"]>;
    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ dependencies, onStatus }) => {
      const preview = await dependencies.runVideoUseChapter?.({
        projectId: "project-1",
        chapterId: "chapter-001",
        storyboards: [storyboard],
        submission: { jobs: [slot.job], blockedShotIds: [] },
      });
      onStatus?.({ stage: "awaiting-review", detail: "video-use preview 已生成" });
      expect(preview).toMatchObject({ state: "pending", revision: 1 });
      return { storyboards: 1, queueStatus: "awaiting-review", videoUseState: "pending", videoUseRevision: 1 };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(queueGet).toHaveBeenCalledOnce();
    expect(runChapter).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      chapterId: "chapter-001",
      revision: 1,
      mode: "editable-edl",
      shots: [expect.objectContaining({ shotId: storyboard.id })],
    }));
  });

  it("keeps the fixed-voice validation error when the TTS bridge is unavailable", async () => {
    (window as { studioAssets?: { list: ReturnType<typeof vi.fn> } }).studioAssets = {
      list: vi.fn(),
    };
    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.ensureFixedVoiceProfiles(
        useStudioStore.getState().storyboards,
      );
      throw new Error("测试未收到固定音色 bridge 错误");
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(toast.error).toHaveBeenCalledWith("固定音色文件校验接口不可用");
  });

  it("reuses canonical storyboards instead of parsing the synchronized source record as JSON", async () => {
    const canonicalStoryboard = {
      id: "sb-chapter-001-001",
      episodeId: "chapter-001",
      index: 1,
      trackKey: "001", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "",
      duration: 2,
      prompt: "雨夜码头",
      videoDesc: "镜头推进",
      assetIds: [],
      state: "ready",
    } as StoryboardItem;
    useStudioStore.setState({
      storyboards: [canonicalStoryboard],
      agentWorkData: [{
        id: "work-1",
        key: "storyboardTable",
        episodeId: "chapter-001",
        data: "[{\"id\":\"sb-chapter-001-001\"}]",
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.ensurePlanning();
      return { storyboards: 1 };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(autoVideo).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("动态导演分镜表不可用"),
    );
  });

  it("binds TTS to the captured project/chapter and persists job plus canonical voice binding", async () => {
    const item = {
      id: "sb-chapter-001-001",
      episodeId: "chapter-001",
      index: 1,
      trackKey: "001", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "track-1",
      duration: 2,
      prompt: "雨夜码头",
      videoDesc: "镜头推进",
      assetIds: [],
      state: "ready",
      outputVersion: 3,
      speaker: "旁白",
      speakerId: "narrator",
      line: "雨落。",
      ttsSpokenText: "雨落。",
      durationTarget: 2,
      emotion: "克制",
      voiceStyle: "克制",
      requiresFixedVoice: true,
      shotAudioBindings: [makeShotAudioBinding("sfx")],
    } satisfies StoryboardItem;
    useStudioStore.setState({ storyboards: [item] });
    const queuedJob = {
      schemaVersion: 1 as const,
      projectId: "project-1",
      chapterId: "chapter-001",
      shotId: item.id,
      shotRevision: 3,
      inputFingerprint: "f".repeat(64),
      status: "queued" as const,
      attempt: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const completedJob = {
      ...queuedJob,
      status: "completed" as const,
      attempt: 1,
      generationId: "generation-1",
      updatedAt: 2,
    };
    const voiceBinding = makeShotAudioBinding("voice");
    const audioRef = {
      kind: "audio" as const,
      path: `project-file://project-1/${voiceBinding.source.relativePath}`,
      contentSha256: voiceBinding.sourceFingerprint,
    };
    vi.mocked(runStoryboardTtsGeneration).mockImplementationOnce(async (input) => {
      await input.onJob?.(queuedJob);
      return {
        audioRef,
        shotAudioBinding: voiceBinding,
        ttsJob: completedJob,
        generationId: "generation-1",
        ttsBackend: "qwen-mlx",
        ttsMocked: false,
        ttsEmotionCapability: "applied" as const,
      };
    });
    vi.mocked(runChapterAutoVideo).mockImplementationOnce(async (input) => {
      expect(input.projectId).toBe("project-1");
      expect(input.dependencies.ttsConcurrency).toBe(2);
      const generated = await input.dependencies.generateAudio(
        item,
        { id: "profile-1" } as VoiceProfile,
      );
      input.dependencies.writeStoryboardAudio(item.id, generated);
      return { storyboards: 1, queueStatus: "queued", blockedShotIds: [] };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(runStoryboardTtsGeneration).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      chapterId: "chapter-001",
      storyboard: item,
    }));
    const written = useStudioStore.getState().storyboards[0];
    expect(written.ttsJob).toEqual(completedJob);
    expect(written.audioRef).toEqual(audioRef);
    expect(written.shotAudioBindings?.map((binding) => binding.role)).toEqual(["sfx", "voice"]);
    expect(written.ttsGenerationId).toBe("generation-1");
    expect(written.emotion).toBe("克制");
    expect(written.voiceStyle).toBe("克制");
    expect(written.outputVersion).toBe(3);
  });

  it("does not consume another chapter's storyboard source record", async () => {
    const otherChapterStoryboard = {
      id: "sb-chapter-002-001",
      episodeId: "chapter-002",
      index: 1,
      trackKey: "002", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "",
      duration: 2,
      prompt: "另一章的雨夜码头",
      videoDesc: "镜头向前推进",
      assetIds: [],
      state: "ready",
      shotSemantics: {
        sceneViewpointId: "chapter-002-dock",
        personFree: true,
        visibleCharacters: [],
        visibleProps: [],
        actionIn: "雨落",
        actionOut: "雨声延续",
      },
    } as StoryboardItem;
    useStudioStore.setState({
      storyboards: [],
      agentWorkData: [{
        id: "work-chapter-002",
        key: "storyboardTable",
        episodeId: "chapter-002",
        data: serializeStoryboardTable([otherChapterStoryboard]),
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const handleProductionNodeAction = vi.fn(async () => undefined);
    vi.mocked(runChapterAutoVideo).mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.ensurePlanning();
      return { storyboards: 1 };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction,
      }),
    );

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });

    expect(handleProductionNodeAction).toHaveBeenCalledWith({
      id: "generate-storyboard-table",
      targetStage: "storyboard",
    });
    expect(useStudioStore.getState().storyboards).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "动态导演分镜表生成失败，自动成片已停止",
    );
  });

  it("does not start a second run while the current run is non-terminal", async () => {
    const autoVideo = vi.mocked(runChapterAutoVideo);
    let resolveRun: () => void = () => undefined;
    const runGate = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    autoVideo.mockImplementationOnce(async ({ onStatus }) => {
      onStatus?.({
        stage: "planning",
        detail: "准备导演分镜和角色语音",
      });
      await runGate;
      onStatus?.({
        stage: "completed",
        detail: "第一章自动成片完成",
        finalPath: "/tmp/chapter-001-final.mp4",
      });
      return {
        storyboards: 2,
      };
    });
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    let firstRun: Promise<void> | undefined;
    await act(async () => {
      firstRun = result.current.handleRunChapterAutoVideo();
      await Promise.resolve();
    });
    expect(result.current.chapterAutoVideoRunning).toBe(true);

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });
    expect(autoVideo).toHaveBeenCalledOnce();

    resolveRun();
    await act(async () => {
      await firstRun;
    });
    expect(result.current.chapterAutoVideoStatus).toMatchObject({
      stage: "completed",
      finalPath: "/tmp/chapter-001-final.mp4",
    });
  });

  it("opens the final video only when a completed path is available", async () => {
    const openPath = vi.fn(async () => ({
      success: false,
      error: "open failed",
    }));
    (window as unknown as { electronAPI?: { openPath: typeof openPath } }).electronAPI = {
      openPath,
    };
    const { result } = renderHook(() =>
      useChapterAutoVideoActions({
        activeProjectId: "project-1",
        productionEpisodeId: "chapter-001",
        handleProductionNodeAction: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleOpenFinalVideo();
    });
    expect(openPath).not.toHaveBeenCalled();

    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ onStatus }) => {
      onStatus?.({
        stage: "completed",
        detail: "第一章自动成片完成",
        finalPath: "/tmp/chapter-001-final.mp4",
      });
      return {
        storyboards: 2,
      };
    });

    await act(async () => {
      await result.current.handleRunChapterAutoVideo();
    });
    await act(async () => {
      await result.current.handleOpenFinalVideo();
    });

    expect(openPath).toHaveBeenCalledWith("/tmp/chapter-001-final.mp4");
    expect(toast.error).toHaveBeenCalledWith("open failed");
  });
});

function makeShotAudioBinding(role: "voice" | "sfx"): RemotionShotAudioBindingV2 {
  const contentSha256 = role === "voice" ? "a".repeat(64) : "b".repeat(64);
  return {
    schemaVersion: 2,
    bindingId: `${role}:sb-chapter-001-001`,
    bindingFingerprint: role === "voice" ? "c".repeat(64) : "d".repeat(64),
    renderScope: "shot",
    projectId: "project-1",
    chapterId: "chapter-001",
    shotId: "sb-chapter-001-001",
    shotRevision: 3,
    role,
    source: {
      kind: "project-file",
      projectId: "project-1",
      relativePath: `remotion/audio/chapter-001/shots/sb-chapter-001-001/${role}/${contentSha256}.wav`,
      contentSha256,
      provenance: {
        sourceKind: role === "voice" ? "generated" : "imported",
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
    ...(role === "voice" ? { ttsInputFingerprint: "f".repeat(64) } : {}),
  };
}

function projectSummary() {
  return { id: "project-1", name: "道劫", createdAt: 1, updatedAt: 1 };
}

function scriptPlan() {
  return {
    id: "plan-1",
    episodeId: "chapter-001",
    theme: "劫起微尘",
    visualStyle: "水墨",
    narrativeRhythm: "紧凑",
    sceneIntents: [],
    soundDirection: "雨声",
    transitions: "cut",
    derivedAssetPlan: [],
  };
}
