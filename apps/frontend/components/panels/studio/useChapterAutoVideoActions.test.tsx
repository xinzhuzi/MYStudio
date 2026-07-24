// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChapterAutoVideo } from "@/lib/studio/chapter-auto-video";
import { useEditingStore } from "@/stores/editing-store";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import type {
  TimelineRenderEvidence,
  TimelineRenderPlan,
} from "@/types/editing";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
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

const initialProjectState = useProjectStore.getState();
const initialStudioState = useStudioStore.getState();

beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal("crypto", {
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
    storyboards: [storyboard(1), storyboard(2)],
    productionTracks: [track(1), track(2, "candidate-2")],
    videoCandidates: [candidate()],
  });
  useEditingStore.setState({
    activeProjectId: null,
    editingProjects: {},
    currentEditingProjectIdByEpisode: {},
    autoEditingRuns: {},
    autoEditingRunIdsByEpisode: {},
    timelineRenderRecordsByEditingProjectId: {},
    historyByEditingProjectId: {},
    persistenceWarnings: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as { studioRenderer?: unknown }).studioRenderer;
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
        finalPath: "/tmp/chapter-001-final.mp4",
        evidence: timelineEvidenceFromIds("render-1"),
        editingProjectId: "editing-1",
        editingRevision: 1,
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

  it("persists the rendered current EditingProject evidence from the auto-video action", async () => {
    const renderTimeline = vi.fn(async (plan: TimelineRenderPlan) => ({
      success: true as const,
      evidence: timelineEvidence(plan),
    }));
    (window as { studioRenderer?: { renderTimeline: typeof renderTimeline } }).studioRenderer = {
      renderTimeline,
    };
    const autoVideo = vi.mocked(runChapterAutoVideo);
    autoVideo.mockImplementationOnce(async ({ dependencies, onStatus }) => {
      const state = useStudioStore.getState();
      const project = await dependencies.createEditingProject(
        state.storyboards,
        state.videoCandidates,
      );
      const evidence = await dependencies.renderEditingProject(project);
      dependencies.writeFinalEvidence(project, evidence);
      onStatus?.({
        stage: "completed",
        detail: "第一章自动成片完成",
        finalPath: evidence.path,
      });
      return {
        finalPath: evidence.path,
        evidence,
        editingProjectId: project.id,
        editingRevision: project.revision,
        storyboards: state.storyboards.length,
      };
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
    expect(toast.error).not.toHaveBeenCalled();
    expect(renderTimeline).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      episodeId: "chapter-001",
      editingProjectId: expect.stringMatching(/^editing-chapter-001-/),
      editingRevision: 1,
    }));
    const plan = renderTimeline.mock.calls[0]?.[0];
    if (!plan) throw new Error("测试未收到时间线渲染计划");
    expect(
      useEditingStore.getState().timelineRenderRecordsByEditingProjectId[
        plan.editingProjectId
      ],
    ).toMatchObject({
      projectId: "project-1",
      episodeId: "chapter-001",
      editingProjectId: plan.editingProjectId,
      editingRevision: plan.editingRevision,
      evidence: {
        jobId: plan.jobId,
        path: "/tmp/chapter-001-final.mp4",
      },
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
        finalPath: "/tmp/chapter-001-final.mp4",
        evidence: timelineEvidenceFromIds("render-1"),
        editingProjectId: "editing-1",
        editingRevision: 1,
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

function storyboard(index: number): StoryboardItem {
  return {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: `track-key-${index}`,
    trackId: `track-${index}`,
    duration: 4,
    durationTarget: 4,
    prompt: `prompt ${index}`,
    videoDesc: `video ${index}`,
    assetIds: [],
    mediaRef: { kind: "image", path: `/shot-${index}.png` },
    audioRef: { kind: "audio", path: `/voice-${index}.wav` },
    state: "ready",
    line: `台词 ${index}`,
    ttsSpokenText: `口播 ${index}`,
    sourceFingerprint: `storyboard-fingerprint-${index}`,
    outputVersion: 1,
  };
}

function track(index: number, selectedVideoId?: string): ProductionTrack {
  return {
    id: `track-${index}`,
    episodeId: "chapter-001",
    trackKey: `track-key-${index}`,
    storyboardIds: [`sb-${index}`],
    prompt: `track prompt ${index}`,
    duration: 4,
    candidateVideoIds: selectedVideoId ? [selectedVideoId] : [],
    selectedVideoId,
    state: "ready",
    stale: false,
  };
}

function candidate(): VideoCandidate {
  return {
    id: "candidate-2",
    trackId: "track-2",
    provider: "ffmpeg-local",
    filePath: "/track-2.mp4",
    state: "ready",
    stale: false,
    sourceFingerprint: "candidate-fingerprint-2",
    outputVersion: 1,
    createdAt: 1,
  };
}

function timelineEvidence(plan: TimelineRenderPlan): TimelineRenderEvidence {
  return timelineEvidenceFromIds(plan.jobId);
}

function timelineEvidenceFromIds(jobId: string): TimelineRenderEvidence {
  const hash = "a".repeat(64);
  return {
    jobId,
    path: "/tmp/chapter-001-final.mp4",
    sizeBytes: 2048,
    mtimeMs: 10,
    sha256: hash,
    duration: 8,
    width: 1080,
    height: 1920,
    streams: ["video", "audio"],
    snapshotHash: hash,
    snapshotPath: "/tmp/editing-project.json",
    renderPlanPath: "/tmp/render-plan.json",
    inputManifestPath: "/tmp/input-manifest.json",
    filterGraphPath: "/tmp/filter-graph.txt",
    logPath: "/tmp/ffmpeg.log",
    ffprobePath: "/tmp/ffprobe.json",
  };
}
