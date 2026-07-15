// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditingStore } from "@/stores/editing-store";
import { useProjectStore } from "@/stores/project-store";
import type {
  TimelineRenderPlan,
  TimelineRenderProgress,
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
    const renderTimeline = vi.fn(async (plan: TimelineRenderPlan) => {
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
    const plan = renderTimeline.mock.calls[0]?.[0];
    expect(plan).toMatchObject({
      schemaVersion: 1,
      projectId: "project-1",
      episodeId: "episode-1",
    });
    expect(plan).not.toHaveProperty("args");
    expect(plan).not.toHaveProperty("outputPath");
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
});

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
