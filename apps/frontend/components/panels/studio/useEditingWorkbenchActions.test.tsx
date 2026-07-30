// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
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
