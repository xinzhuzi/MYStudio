// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useProjectStore } from "@/stores/project/project-store";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { StoryboardItem } from "@/types/studio";
import { useEditingWorkbenchActions } from "./useEditingWorkbenchActions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/studio/editing/source-snapshot", () => ({
  buildEditingSourceSnapshotHash: vi.fn(async () => "snapshot-test"),
}));
vi.mock("@/lib/studio/video-workflow/chapter-run-request", () => ({
  buildVideoWorkflowChapterRunRequest: vi.fn(async (input: { projectId: string; chapterId: string; revision: number; mode?: string; derivedInputPolicy?: string }) => ({
    schemaVersion: 1 as const,
    projectId: input.projectId,
    chapterId: input.chapterId,
    revision: input.revision,
    mode: input.mode ?? "editable-edl",
    ...(input.derivedInputPolicy ? { derivedInputPolicy: input.derivedInputPolicy } : {}),
    shots: [],
    sourceSha256: "a".repeat(64),
    audioSha256: "b".repeat(64),
    textSha256: "c".repeat(64),
    featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
  })),
}));

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "test-uuid") });
  useProjectStore.setState({
    projects: [{ id: "project-a", name: "道劫", createdAt: 1, updatedAt: 1 }],
    activeProjectId: "project-a",
    activeProject: { id: "project-a", name: "道劫", createdAt: 1, updatedAt: 1 },
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
  Reflect.deleteProperty(window, "videoWorkflowPlugins");
  vi.unstubAllGlobals();
});

describe("useEditingWorkbenchActions", () => {
  it("fails closed when the chapter has no Remotion current shot outputs", async () => {
    const { result } = renderHook(() => useEditingWorkbenchActions(input()));
    await expect(act(async () => result.current.createDraft())).rejects.toThrow("缺少已完成的 Remotion 分镜输出");
    expect(result.current.currentProject).toBeUndefined();
  });

  it("creates a project-scoped draft from Remotion current shot outputs only", async () => {
    const { result } = renderHook(() => useEditingWorkbenchActions(input({ remotionShotSlots: [makeCurrentSlot()] })));
    await act(async () => { await result.current.createDraft(); });
    expect(result.current.currentProject).toMatchObject({
      projectId: "project-a",
      episodeId: "chapter-001",
      sourceSnapshotHash: "snapshot-test",
    });
    expect(result.current.currentProject?.clips[0]?.source.kind).toBe("storyboardVideo");
  });

  it("runs video-use before creating an EditingProject", async () => {
    const runChapter = vi.fn(async (request: { revision: number }) => ({
      schemaVersion: 1 as const,
      success: true,
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: request.revision,
      state: "ready" as const,
      artifact: { evidence: { inputSha256: "a".repeat(64) } },
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { runChapter } });
    const slot = makeCurrentSlot();
    const { result } = renderHook(() => useEditingWorkbenchActions(input({
      remotionShotSlots: [slot],
      storyboards: [{
        ...input().storyboards[0],
        audioRef: { kind: "audio", path: "project-file://voice.wav", contentSha256: "b".repeat(64) },
      }],
    })));
    await act(async () => { await result.current.runVideoUse(); });
    expect(runChapter).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, mode: "editable-edl", derivedInputPolicy: "reject" }));
    expect(result.current.currentProject).toBeUndefined();
    expect(result.current.videoUseState).toBe("pending");
    expect(result.current.videoUseRevision).toBe(2);
  });

  it("passes explicit padding consent without enabling it by default", async () => {
    const runChapter = vi.fn(async (request: { revision: number; derivedInputPolicy?: string }) => ({
      schemaVersion: 1 as const,
      success: true,
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: request.revision,
      state: "pending" as const,
      artifact: { evidence: { inputSha256: "a".repeat(64) } },
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { runChapter } });
    const { result } = renderHook(() => useEditingWorkbenchActions(input({ remotionShotSlots: [makeCurrentSlot()] })));
    await act(async () => { await result.current.runVideoUse("editable-edl", "pad-video-to-audio"); });
    expect(runChapter).toHaveBeenCalledWith(expect.objectContaining({ derivedInputPolicy: "pad-video-to-audio" }));
  });

  it("restores the newest persisted pending revision after a renderer reload", async () => {
    const readChapter = vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 4,
      videoUseState: "pending" as const,
      hyperFramesState: "idle" as const,
      inputSha256: "a".repeat(64),
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { readChapter } });
    const { result } = renderHook(() => useEditingWorkbenchActions(input()));
    await waitFor(() => expect(result.current.videoUseState).toBe("pending"));
    expect(readChapter).toHaveBeenCalledWith({ schemaVersion: 1, projectId: "project-a", chapterId: "chapter-001" });
    expect(result.current.videoUseRevision).toBe(4);
    expect(result.current.videoUseInputSha).toBe("a".repeat(64));
    expect(result.current.hyperFramesState).toBe("idle");
  });

  it("only restores the completed state when HyperFrames is accepted or noop", async () => {
    const readChapter = vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 5,
      videoUseState: "accepted" as const,
      hyperFramesState: "noop" as const,
      inputSha256: "b".repeat(64),
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { readChapter } });
    const { result } = renderHook(() => useEditingWorkbenchActions(input()));
    await waitFor(() => expect(result.current.videoUseState).toBe("accepted"));
    expect(result.current.videoUseRevision).toBe(5);
    expect(result.current.hyperFramesState).toBe("noop");
  });

  it("restores a blocked diagnostic without treating a malformed artifact as idle", async () => {
    const readChapter = vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      videoUseState: "blocked" as const,
      hyperFramesState: "blocked" as const,
      message: "video-use artifact JSON 无效",
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", { configurable: true, value: { readChapter } });
    const { result } = renderHook(() => useEditingWorkbenchActions(input()));
    await waitFor(() => expect(result.current.videoUseState).toBe("blocked"));
    expect(result.current.error).toContain("artifact JSON 无效");
    expect(result.current.videoUseRevision).toBeUndefined();
  });
});

function input(overrides: Partial<Parameters<typeof useEditingWorkbenchActions>[0]> = {}) {
  const slot = overrides.remotionShotSlots?.[0];
  const shotId = slot?.target.kind === "shot" ? slot.target.shotId : "shot-001";
  return {
    projectId: "project-a",
    episodeId: "chapter-001",
    projectName: "道劫",
    aspectRatio: "9:16",
    storyboards: [{
      id: shotId,
      episodeId: "chapter-001",
      index: 1,
      trackKey: "opening",
      trackId: "opening",
      duration: 2,
      durationTarget: 2,
      prompt: "shot",
      videoDesc: "shot",
      assetIds: [],
      state: "ready",
      stale: false,
      mediaRef: { kind: "image", path: "project-file://shot.png" },
      audioRef: { kind: "audio", path: "project-file://shot.wav" },
      speaker: "旁白",
      speakerId: "narrator",
      line: "shot",
      ttsSpokenText: "shot",
      voiceStyle: "neutral",
      requiresFixedVoice: true,
    }] satisfies StoryboardItem[],
    remotionShotSlots: overrides.remotionShotSlots,
    ...overrides,
  };
}
