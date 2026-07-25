// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useProjectStore } from "@/stores/project/project-store";
import type {
  TimelineRenderProgress,
  TimelineRenderRequest,
} from "@/types/editing";
import type { StoryboardItem } from "@/types/studio";
import {
  type UseEditingWorkbenchActionsInput,
  useEditingWorkbenchActions,
} from "./useEditingWorkbenchActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/studio/editing/source-snapshot", () => ({
  buildEditingSourceSnapshotHash: vi.fn(async () => "snapshot-test"),
}));

beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `test-uuid-${++sequence}`),
  });
  useProjectStore.setState({
    projects: [
      { id: "project-1", name: "道劫", createdAt: 1, updatedAt: 1 },
      { id: "project-2", name: "第二项目", createdAt: 2, updatedAt: 2 },
    ],
    activeProjectId: "project-1",
    activeProject: { id: "project-1", name: "道劫", createdAt: 1, updatedAt: 1 },
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
  vi.unstubAllGlobals();
  delete (window as any).studioRenderer;
  delete (window as any).projectFiles;
  delete (window as any).electronAPI;
});

describe("useEditingWorkbenchActions", () => {
  it("reports exact storyboard IDs when draft media is missing", async () => {
    const input = editingInput({
      storyboards: [storyboard({ id: "sb-missing", mediaRef: undefined })],
    });
    const { result } = renderHook(() => useEditingWorkbenchActions(input));
    await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-1"));

    let failure = "";
    await act(async () => {
      try {
        await result.current.createDraft();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });

    expect(failure).toContain("缺画面: sb-missing");
    expect(result.current.error).toContain("缺画面: sb-missing");
    expect(useEditingStore.getState().currentEditingProjectIdByEpisode["episode-1"]).toBeUndefined();
  });

  it("creates a project-scoped draft and hides it after the application project switches", async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useEditingWorkbenchActions(input),
      { initialProps: { input: editingInput() } },
    );
    await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-1"));

    await act(async () => {
      await result.current.createDraft();
    });
    expect(result.current.currentProject).toMatchObject({
      projectId: "project-1",
      episodeId: "episode-1",
      sourceSnapshotHash: "snapshot-test",
    });

    useProjectStore.setState({
      activeProjectId: "project-2",
      activeProject: { id: "project-2", name: "第二项目", createdAt: 2, updatedAt: 2 },
    });
    rerender({ input: editingInput({ projectId: "project-2", projectName: "第二项目" }) });
    await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-2"));
    expect(result.current.currentProject).toBeUndefined();
  });

  it("uses the typed timeline renderer, filters progress and cleans the listener", async () => {
    let progressListener: ((progress: TimelineRenderProgress) => void) | undefined;
    const unsubscribe = vi.fn();
    const renderTimeline = vi.fn(async (request: TimelineRenderRequest) => {
      const plan = request.plan;
      progressListener?.({ jobId: "other-job", stage: "rendering", ratio: 0.9 });
      progressListener?.({ jobId: plan.jobId, stage: "rendering", ratio: 0.5 });
      return {
        success: true as const,
        evidence: {
          jobId: plan.jobId,
          path: "/tmp/final.mp4",
          sizeBytes: 2048,
          mtimeMs: 10,
          sha256: "a".repeat(64),
          duration: 4,
          width: 1080,
          height: 1920,
          streams: ["video", "audio"],
          snapshotHash: "a".repeat(64),
          snapshotPath: "/tmp/snapshot.json",
          renderPlanPath: "/tmp/render-plan.json",
          inputManifestPath: "/tmp/input-manifest.json",
          filterGraphPath: "/tmp/filter-graph.txt",
          logPath: "/tmp/ffmpeg.log",
          ffprobePath: "/tmp/ffprobe.json",
        },
      };
    });
    (window as any).studioRenderer = {
      renderTimeline,
      cancelTimelineRender: vi.fn(),
      onTimelineRenderProgress: vi.fn((listener: typeof progressListener) => {
        progressListener = listener;
        return unsubscribe;
      }),
    };

    const { result, unmount } = renderHook(() =>
      useEditingWorkbenchActions(editingInput()),
    );
    await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-1"));

    await act(async () => {
      await result.current.renderCurrent();
    });

    expect(renderTimeline).toHaveBeenCalledOnce();
    const request = renderTimeline.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      schemaVersion: 1,
      requestedRenderer: "ffmpeg",
      plan: {
        schemaVersion: 1,
        projectId: "project-1",
        episodeId: "episode-1",
      },
    });
    expect(request).not.toHaveProperty("args");
    expect(request).not.toHaveProperty("outputPath");
    const plan = request?.plan;
    if (!plan) throw new Error("测试未收到时间线渲染计划");
    expect(result.current.renderEvidence).toMatchObject({
      path: "/tmp/final.mp4",
      width: 1080,
      height: 1920,
    });
    expect(
      useEditingStore.getState().timelineRenderRecordsByEditingProjectId[
        plan.editingProjectId
      ],
    ).toMatchObject({
      editingRevision: plan.editingRevision,
      evidence: { jobId: plan.jobId, path: "/tmp/final.mp4" },
    });
    expect(result.current.renderProgress).toBeUndefined();
    expect(result.current.rendering).toBe(false);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("imports ASS through one subtitle command and exports current cues as SRT", async () => {
    const writeText = vi.fn(async () => ({ success: true, filePath: "/tmp/subtitle.srt" }));
    const saveFileDialog = vi.fn(async () => ({ success: true, filePath: "/tmp/exported.srt" }));
    (window as any).projectFiles = { writeText };
    (window as any).electronAPI = { saveFileDialog };
    const { result } = renderHook(() => useEditingWorkbenchActions(editingInput()));
    await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-1"));
    await act(async () => {
      await result.current.createDraft();
    });
    await act(async () => {
      await result.current.importSubtitles({
        name: "chapter.ass",
        size: 100,
        lastModified: 10,
        text: vi.fn(async () => [
          "[Events]",
          "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
          "Dialogue: 0,0:00:00.50,0:00:02.00,Fancy,,0,0,0,,{\\b1}导入字幕",
        ].join("\n")),
      } as unknown as File);
    });

    const project = useEditingStore.getState().getCurrentEditingProject("episode-1");
    expect(project?.clips.filter((clip) => clip.source.kind === "text")).toEqual([
      expect.objectContaining({
        startUs: 500_000,
        durationUs: 1_500_000,
        source: expect.objectContaining({ text: "导入字幕" }),
        subtitle: expect.objectContaining({ sourceFormat: "ass" }),
      }),
    ]);

    await act(async () => {
      await result.current.exportSubtitles();
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/exports/episode-1.srt"),
      expect.stringContaining("00:00:00,500 --> 00:00:02,000\n导入字幕"),
    );
    expect(saveFileDialog).toHaveBeenCalledWith(expect.objectContaining({
      localPath: "/tmp/subtitle.srt",
      filters: [{ name: "SubRip Subtitle", extensions: ["srt"] }],
    }));
  });

  it("surfaces projectFiles.writeText failures while exporting subtitles", async () => {
    const writeText = vi.fn().mockResolvedValue({
      success: false,
      error: "字幕临时文件写入失败：项目目录只读",
    });
    const saveFileDialog = vi.fn();
    (window as any).projectFiles = { writeText };
    (window as any).electronAPI = { saveFileDialog };
    const { result } = await renderExportReadyHook();

    const failure = await captureActionFailure(
      () => result.current.exportSubtitles(),
    );

    expect(failure).toBe("字幕临时文件写入失败：项目目录只读");
    expect(result.current.error).toBe("字幕临时文件写入失败：项目目录只读");
    expect(saveFileDialog).not.toHaveBeenCalled();
  });

  it("surfaces projectFiles.writeText rejections while exporting subtitles", async () => {
    const writeText = vi.fn().mockRejectedValue(
      new Error("projectFiles.writeText IPC rejected"),
    );
    const saveFileDialog = vi.fn();
    (window as any).projectFiles = { writeText };
    (window as any).electronAPI = { saveFileDialog };
    const { result } = await renderExportReadyHook();

    const failure = await captureActionFailure(
      () => result.current.exportSubtitles(),
    );

    expect(failure).toBe("projectFiles.writeText IPC rejected");
    expect(result.current.error).toBe("projectFiles.writeText IPC rejected");
    expect(saveFileDialog).not.toHaveBeenCalled();
  });

  it("stops before saveFileDialog when the active project switches during writeText", async () => {
    const pendingWrite = deferred<{ success: true; filePath: string }>();
    const writeText = vi.fn(() => pendingWrite.promise);
    const saveFileDialog = vi.fn();
    (window as any).projectFiles = { writeText };
    (window as any).electronAPI = { saveFileDialog };
    const { result } = await renderExportReadyHook();

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.exportSubtitles();
      await Promise.resolve();
    });
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    act(activateSecondProject);

    let failure = "";
    await act(async () => {
      pendingWrite.resolve({ success: true, filePath: "/tmp/subtitle.srt" });
      try {
        await exportPromise;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });

    expect(failure).toBe("项目已切换，剪辑操作已停止写回");
    expect(result.current.error).toBe("项目已切换，剪辑操作已停止写回");
    expect(saveFileDialog).not.toHaveBeenCalled();
  });

  it("reports a project switch after saveFileDialog resolves", async () => {
    const pendingDialog = deferred<{ success: true; filePath: string }>();
    const writeText = vi.fn().mockResolvedValue({
      success: true,
      filePath: "/tmp/subtitle.srt",
    });
    const saveFileDialog = vi.fn(() => pendingDialog.promise);
    (window as any).projectFiles = { writeText };
    (window as any).electronAPI = { saveFileDialog };
    const { result } = await renderExportReadyHook();

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.exportSubtitles();
      await Promise.resolve();
    });
    await waitFor(() => expect(saveFileDialog).toHaveBeenCalledOnce());
    act(activateSecondProject);

    let failure = "";
    await act(async () => {
      pendingDialog.resolve({ success: true, filePath: "/tmp/exported.srt" });
      try {
        await exportPromise;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(failure).toBe("项目已切换，剪辑操作已停止写回");
    expect(result.current.error).toBe("项目已切换，剪辑操作已停止写回");
  });
});

async function renderExportReadyHook() {
  const rendered = renderHook(() => useEditingWorkbenchActions(editingInput()));
  await waitFor(() => expect(useEditingStore.getState().activeProjectId).toBe("project-1"));
  await act(async () => {
    await rendered.result.current.createDraft();
  });
  await act(async () => {
    await rendered.result.current.importSubtitles(subtitleFile());
  });
  return rendered;
}

async function captureActionFailure(action: () => Promise<void>) {
  let failure = "";
  await act(async () => {
    try {
      await action();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  });
  return failure;
}

function subtitleFile() {
  return {
    name: "chapter.srt",
    size: 80,
    lastModified: 10,
    text: vi.fn(async () => [
      "1",
      "00:00:00,500 --> 00:00:02,000",
      "导出字幕",
    ].join("\n")),
  } as unknown as File;
}

function activateSecondProject() {
  useProjectStore.setState({
    activeProjectId: "project-2",
    activeProject: { id: "project-2", name: "第二项目", createdAt: 2, updatedAt: 2 },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function editingInput(
  overrides: Partial<UseEditingWorkbenchActionsInput> = {},
): UseEditingWorkbenchActionsInput {
  return {
    projectId: "project-1",
    projectName: "道劫",
    episodeId: "episode-1",
    aspectRatio: "9:16",
    storyboards: [storyboard()],
    productionTracks: [],
    videoCandidates: [],
    ...overrides,
  };
}

function storyboard(updates: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    episodeId: "episode-1",
    index: 1,
    trackKey: "opening",
    trackId: "track-1",
    duration: 4,
    durationTarget: 4,
    prompt: "水墨雨夜",
    videoDesc: "雨夜推进",
    assetIds: [],
    mediaRef: { kind: "image", path: "/tmp/shot.png" },
    audioRef: { kind: "audio", path: "/tmp/voice.wav" },
    line: "风从河面来。",
    ttsSpokenText: "风从河面来。",
    state: "ready",
    ...updates,
  };
}
