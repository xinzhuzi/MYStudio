// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChapterAutoVideo } from "@/lib/studio/chapter-auto-video";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
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
