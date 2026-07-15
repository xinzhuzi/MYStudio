import { afterEach, describe, expect, it } from "vitest";
import type {
  AutoEditingResult,
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderRecord,
} from "@/types/editing";
import { useProjectStore } from "./project-store";
import {
  createEditingStore,
  mergeEditingStoreState,
  partializeEditingStoreState,
} from "./editing-store";

const originalProjectState = useProjectStore.getState();

afterEach(() => {
  useProjectStore.setState(originalProjectState, true);
});

describe("editing store", () => {
  it("saves and activates versions, executes history and protects manual projects", () => {
    const store = createEditingStore();
    store.getState().setActiveProjectId("project-1");
    expect(store.getState().saveEditingProject(project())).toEqual({
      success: true,
      editingProjectId: "editing-1",
    });
    expect(store.getState().getCurrentEditingProject("episode-1")?.id).toBe(
      "editing-1",
    );
    expect(store.getState().saveTimelineRenderRecord(renderRecord())).toEqual({
      success: true,
      editingProjectId: "editing-1",
      jobId: "render-1",
    });

    const moved = store.getState().executeCommand("editing-1", {
      type: "clip.move",
      clipId: "clip-1",
      trackId: "track-1",
      startUs: 500_000,
      issuedAt: 20,
    });
    expect(moved.success).toBe(true);
    expect(store.getState().editingProjects["editing-1"]).toMatchObject({
      revision: 2,
      manuallyEdited: true,
    });
    expect(
      store.getState().timelineRenderRecordsByEditingProjectId["editing-1"],
    ).toMatchObject({ editingRevision: 1 });
    expect(
      store.getState().saveTimelineRenderRecord(renderRecord()),
    ).toMatchObject({
      success: false,
      issue: { code: "editing.persistence.render_record_mismatch" },
    });

    const overwrite = store.getState().saveEditingProject(project());
    expect(overwrite).toMatchObject({
      success: false,
      issue: { code: "editing.project.manual_protected" },
    });
    expect(store.getState().editingProjects["editing-1"]?.revision).toBe(2);

    expect(store.getState().undo("editing-1", 30).success).toBe(true);
    expect(store.getState().editingProjects["editing-1"]?.clips[0]?.startUs).toBe(0);
    expect(store.getState().redo("editing-1", 40).success).toBe(true);
    expect(store.getState().editingProjects["editing-1"]?.clips[0]?.startUs).toBe(
      500_000,
    );
  });

  it("partializes only the active application project and omits history", () => {
    const store = createEditingStore();
    store.setState({
      activeProjectId: "project-1",
      editingProjects: {
        "editing-1": project(),
        "editing-2": project({ id: "editing-2", projectId: "project-2" }),
      },
      currentEditingProjectIdByEpisode: {
        "episode-1": "editing-1",
        "episode-2": "editing-2",
      },
      historyByEditingProjectId: {
        "editing-1": {
          present: project(),
          past: [],
          future: [],
          limit: 100,
        },
      },
      autoEditingRuns: {
        "run-1": autoRun(),
        "run-2": autoRun({
          id: "run-2",
          projectId: "project-2",
          episodeId: "episode-2",
          editingProjectId: "editing-2",
        }),
      },
      autoEditingRunIdsByEpisode: {
        "episode-1": ["run-1"],
        "episode-2": ["run-2"],
      },
      timelineRenderRecordsByEditingProjectId: {
        "editing-1": renderRecord(),
        "editing-2": renderRecord({
          projectId: "project-2",
          episodeId: "episode-2",
          editingProjectId: "editing-2",
        }),
      },
    });

    expect(partializeEditingStoreState(store.getState())).toEqual({
      activeProjectId: "project-1",
      editingProjects: { "editing-1": project() },
      currentEditingProjectIdByEpisode: { "episode-1": "editing-1" },
      autoEditingRuns: { "run-1": autoRun() },
      autoEditingRunIdsByEpisode: { "episode-1": ["run-1"] },
      timelineRenderRecordsByEditingProjectId: {
        "editing-1": renderRecord(),
      },
    });
  });

  it("validates unknown persisted projects and rejects cross-project records", () => {
    useProjectStore.setState({ activeProjectId: "project-1" });
    const current = createEditingStore().getState();
    const invalid = structuredClone(project()) as unknown as Record<string, unknown>;
    const clips = invalid.clips as Array<Record<string, unknown>>;
    const firstClip = clips[0];
    if (!firstClip) throw new Error("测试夹具缺少片段");
    firstClip.durationUs = 0;
    const merged = mergeEditingStoreState(
      {
        activeProjectId: "stale-router-id",
        editingProjects: {
          "editing-1": project(),
          invalid,
          wrongScope: project({ id: "wrong-scope", projectId: "project-2" }),
        },
        currentEditingProjectIdByEpisode: {
          "episode-1": "editing-1",
          "episode-2": "wrong-scope",
        },
        autoEditingRuns: {
          "run-1": autoRun(),
          wrongScopeRun: autoRun({
            id: "wrong-scope-run",
            projectId: "project-2",
          }),
        },
        autoEditingRunIdsByEpisode: {
          "episode-1": ["run-1", "wrongScopeRun"],
        },
        timelineRenderRecordsByEditingProjectId: {
          "editing-1": renderRecord(),
          "wrong-scope": renderRecord({
            projectId: "project-2",
            editingProjectId: "wrong-scope",
          }),
          "missing-project": renderRecord({ editingProjectId: "missing-project" }),
        },
      },
      current,
    );

    expect(merged.activeProjectId).toBe("project-1");
    expect(Object.keys(merged.editingProjects)).toEqual(["editing-1"]);
    expect(merged.currentEditingProjectIdByEpisode).toEqual({
      "episode-1": "editing-1",
    });
    expect(merged.autoEditingRuns).toEqual({ "run-1": autoRun() });
    expect(merged.autoEditingRunIdsByEpisode).toEqual({
      "episode-1": ["run-1"],
    });
    expect(merged.timelineRenderRecordsByEditingProjectId).toEqual({
      "editing-1": renderRecord(),
    });
    expect(merged.persistenceWarnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "editing.clip.duration",
        "editing.persistence.project_scope",
        "editing.persistence.auto_run_scope",
        "editing.persistence.render_record_scope",
        "editing.persistence.render_record_project",
      ]),
    );
  });

  it("preserves failed runs and atomically commits a new draft with stale updates", () => {
    const store = createEditingStore();
    store.getState().setActiveProjectId("project-1");
    store.getState().saveEditingProject(project());
    const currentBeforeFailure =
      store.getState().currentEditingProjectIdByEpisode["episode-1"];

    expect(
      store.getState().saveAutoEditingRun(
        autoRun({
          id: "run-failed",
          stage: "failed",
          editingProjectId: undefined,
          error: "素材缺失",
        }),
      ),
    ).toEqual({ success: true, runId: "run-failed" });
    expect(
      store.getState().currentEditingProjectIdByEpisode["episode-1"],
    ).toBe(currentBeforeFailure);

    const nextProject = project({
      id: "editing-2",
      sourceSnapshotHash: "snapshot-2",
      createdAt: 20,
      updatedAt: 20,
    });
    const run = autoRun({
      id: "run-2",
      sourceSnapshotHash: "snapshot-2",
      editingProjectId: "editing-2",
      startedAt: 20,
      updatedAt: 30,
      completedAt: 30,
    });
    const result: AutoEditingResult = {
      run,
      project: nextProject,
      reusedExistingDraft: false,
    };

    expect(
      store
        .getState()
        .commitAutoEditingResult(result, ["editing-1"], 30),
    ).toEqual({
      success: true,
      editingProjectId: "editing-2",
      runId: "run-2",
    });
    expect(store.getState().editingProjects["editing-1"]).toMatchObject({
      stale: true,
      staleReason: "source snapshot changed",
      revision: 1,
    });
    expect(store.getState().getCurrentEditingProject("episode-1")?.id).toBe(
      "editing-2",
    );
    expect(store.getState().autoEditingRuns).toMatchObject({
      "run-failed": { stage: "failed" },
      "run-2": { stage: "completed", editingProjectId: "editing-2" },
    });
  });

  it("rechecks manual protection before an automatic result commit", () => {
    const store = createEditingStore();
    store.getState().setActiveProjectId("project-1");
    store.getState().saveEditingProject(project());
    store.getState().executeCommand("editing-1", {
      type: "clip.move",
      clipId: "clip-1",
      trackId: "track-1",
      startUs: 500_000,
      issuedAt: 20,
    });
    const protectedProject = store.getState().editingProjects["editing-1"];
    const result: AutoEditingResult = {
      run: autoRun(),
      project: project(),
      reusedExistingDraft: false,
    };

    expect(
      store.getState().commitAutoEditingResult(result, [], 30),
    ).toMatchObject({
      success: false,
      issue: { code: "editing.project.manual_protected" },
    });
    expect(store.getState().editingProjects["editing-1"]).toBe(
      protectedProject,
    );
    expect(store.getState().autoEditingRuns).toEqual({});
  });
});

function project(updates: Partial<EditingProjectV1> = {}): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "自动草案",
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
    tracks: [
      {
        id: "track-1",
        kind: "video",
        name: "主画面",
        order: 0,
        clipIds: ["clip-1"],
        muted: false,
        locked: false,
      },
    ],
    clips: [
      {
        id: "clip-1",
        trackId: "track-1",
        name: "分镜 1",
        source: {
          kind: "storyboardImage",
          path: "/shot.png",
          evidence: { storyboardId: "sb-1" },
        },
        startUs: 0,
        durationUs: 4_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 0,
        muted: true,
      },
    ],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 10,
    updatedAt: 10,
    ...updates,
  };
}

function autoRun(updates: Partial<AutoEditingRun> = {}): AutoEditingRun {
  return {
    id: "run-1",
    projectId: "project-1",
    episodeId: "episode-1",
    sourceSnapshotHash: "snapshot-1",
    presetId: "story-driven-v1",
    stage: "completed",
    decisions: [],
    warnings: [],
    editingProjectId: "editing-1",
    startedAt: 10,
    updatedAt: 20,
    completedAt: 20,
    ...updates,
  };
}

function renderRecord(
  updates: Partial<TimelineRenderRecord> = {},
): TimelineRenderRecord {
  const hash = "a".repeat(64);
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    editingProjectId: "editing-1",
    editingRevision: 1,
    sourceSnapshotHash: "snapshot-1",
    completedAt: 30,
    evidence: {
      jobId: "render-1",
      path: "/tmp/output.mp4",
      sizeBytes: 1024,
      mtimeMs: 20,
      sha256: hash,
      duration: 4,
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
    },
    ...updates,
  };
}
