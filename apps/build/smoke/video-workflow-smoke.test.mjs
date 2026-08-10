import { describe, expect, it } from "vitest";
import {
  buildApplyAcceptedExpression,
  evaluateAcceptedApplySmoke,
  evaluateSourceStoryboardGate,
  evaluateVideoWorkflowStatus,
} from "./video-workflow-smoke.mjs";

function status(videoUse = {}, overrides = {}) {
  const checkedAt = 100;
  const base = (pluginId, displayName) => ({
    schemaVersion: 1,
    pluginId,
    displayName,
    sourceUrl: "https://example.invalid",
    sourceCommit: "a".repeat(40),
    license: "MIT",
    appVersion: "0.0.0",
    pluginVersion: "1",
    runtimeState: "ready",
    checkedAt,
    dependencies: {},
  });
  return {
    schemaVersion: 1,
    checkedAt,
    plugins: [
      base("remotion", "Remotion"),
      { ...base("video-use", "video-use"), ...videoUse },
      base("hyperframes", "HyperFrames"),
      { ...base("seedance-prompt", "Seedance Prompt Skill"), runtimeState: "deferred" },
    ].map((plugin) => ({ ...plugin, ...(overrides[plugin.pluginId] || {}) })),
  };
}

describe("video-workflow read-only smoke status", () => {
  it("reports exact alignment-model-missing and remains fail-closed", () => {
    const result = evaluateVideoWorkflowStatus(status({ runtimeState: "blocked", runtimeCode: "alignment-model-missing", message: "模型缺失" }));
    expect(result).toMatchObject({ ok: false, state: "blocked", code: "alignment-model-missing" });
    expect(result.mutatingCalls).toBeUndefined();
  });

  it("accepts only all four ready plugin states", () => {
    expect(evaluateVideoWorkflowStatus(status()).ok).toBe(true);
    expect(evaluateVideoWorkflowStatus(status({}, { hyperframes: { runtimeState: "needs-runtime" } })).ok).toBe(false);
  });

  it("rejects malformed or incomplete status without attempting a mutation", () => {
    const result = evaluateVideoWorkflowStatus({ schemaVersion: 1, checkedAt: 1, plugins: [] });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "status.plugin-missing")).toBe(true);
  });
});

describe("video-workflow accepted apply smoke report", () => {
  const successfulInput = {
    ui: {
      projectOpened: true,
      workflowOpened: true,
      workbenchOpened: true,
      reviewResult: "accepted",
      reviewPending: "false",
      reviewStatus: "已确认",
      videoUseMode: "editable-edl",
      reviewAlert: "",
      previewStatus: "accepted",
      hyperFramesStatus: "noop",
      remotionReady: true,
      workbenchSlotCount: "43",
      workbenchSlotReady: "true",
      remotionScope: { currentShotSlots: 43 },
    },
    sourceUnchanged: true,
    projection: { persisted: true, revision: 2, clipCount: 43 },
    artifacts: {
      videoUseMode: "editable-edl",
      videoUseStatus: "accepted",
      videoUseStage: "ready",
      reviewerMatches: true,
      hyperFramesStatus: "noop",
    },
  };

  it("accepts only the full UI confirmation, clone projection, and source safety evidence", () => {
    expect(evaluateAcceptedApplySmoke(successfulInput)).toMatchObject({ ok: true, state: "accepted", issues: [] });
  });

  it("fails closed when applying changes the source or does not persist the clone EditingProject", () => {
    const result = evaluateAcceptedApplySmoke({
      ...successfulInput,
      sourceUnchanged: false,
      projection: { persisted: false },
    });
    expect(result).toMatchObject({ ok: false, state: "blocked" });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["source.mutated", "clone.editing"]));
  });

  it("requires post-apply current-slot diagnostics from both the queue and ready workbench", () => {
    const result = evaluateAcceptedApplySmoke({
      ...successfulInput,
      ui: { ...successfulInput.ui, workbenchSlotCount: "", workbenchSlotReady: "" },
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ui.remotion-slot-diagnostic" }),
    ]));
  });

  it("requires a separate clean MP4 and projects flat mode to that source", () => {
    const result = evaluateAcceptedApplySmoke({
      ui: { ...successfulInput.ui, videoUseMode: "flat-shot-mp4" },
      sourceUnchanged: true,
      projection: { persisted: true, visualSourcePath: "/tmp/clean-flat.mp4" },
      artifacts: {
        ...successfulInput.artifacts,
        videoUseMode: "flat-shot-mp4",
        flatShotMp4Path: "/tmp/clean-flat.mp4",
        previewPath: "/tmp/preview.mp4",
        previewSubtitlesBurnedIn: true,
        flatPathDiffersFromPreview: true,
      },
      expectedMode: "flat-shot-mp4",
    });
    expect(result).toMatchObject({ ok: true, state: "accepted", issues: [] });
  });

  it("rejects flat mode when the preview is reused as the clean source", () => {
    const result = evaluateAcceptedApplySmoke({
      ui: { ...successfulInput.ui, videoUseMode: "flat-shot-mp4" },
      sourceUnchanged: true,
      projection: { persisted: true, visualSourcePath: "/tmp/preview.mp4" },
      artifacts: {
        ...successfulInput.artifacts,
        videoUseMode: "flat-shot-mp4",
        flatShotMp4Path: "/tmp/preview.mp4",
        previewPath: "/tmp/preview.mp4",
        previewSubtitlesBurnedIn: true,
        flatPathDiffersFromPreview: false,
      },
      expectedMode: "flat-shot-mp4",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("clone.flat-preview-reuse");
  });

  it("opens the Radix stage menu with pointer events and matches the workbench item by its label", () => {
    const expression = buildApplyAcceptedExpression({
      projectId: "project-a",
      projectName: "隔离项目",
      chapterId: "chapter-001",
      revision: 2,
      reviewer: "smoke",
      timeoutMs: 1_000,
    });
    expect(expression).toContain("new PointerEvent('pointerdown'");
    expect(expression).toContain("normalize(node).includes('视频工作台')");
    expect(expression).toContain("可交互元素");
    expect(expression).toContain("waitForOptional");
    expect(expression).toContain("window.remotionQueue?.get");
    expect(expression).toContain("applyDeadline");
    expect(expression).toContain("applyTimedOut");
    expect(expression).toContain("const remotionScope = await window.remotionQueue?.get");
    expect(expression).toContain("data-video-use-mode-select");
  });
});

describe("video-workflow accepted apply source preflight", () => {
  it("blocks an accepted historical artifact when the current storyboard source is stale", () => {
    const result = evaluateSourceStoryboardGate([
      { id: "shot-001", episodeId: "chapter-001", state: "ready", stale: false },
      { id: "shot-002", episodeId: "chapter-001", state: "ready", stale: true, staleReason: "source changed" },
    ], "chapter-001");

    expect(result).toMatchObject({
      ok: false,
      state: "blocked",
      storyboardCount: 2,
      blockedStoryboards: [{ id: "shot-002", stale: true, reason: "source changed" }],
    });
  });

  it("allows only ready, non-stale storyboards into the isolated apply path", () => {
    expect(evaluateSourceStoryboardGate([
      { id: "shot-001", episodeId: "chapter-001", state: "ready", stale: false },
    ], "chapter-001")).toMatchObject({ ok: true, state: "ready", storyboardCount: 1 });
  });

  it("allows stale ready storyboards only with the explicit reuse-existing policy", () => {
    expect(evaluateSourceStoryboardGate([
      { id: "shot-001", episodeId: "chapter-001", state: "ready", stale: true, staleReason: "paid regeneration deferred" },
    ], "chapter-001", "reuse-existing")).toMatchObject({
      ok: true,
      state: "ready",
      storyboardCount: 1,
      message: expect.stringContaining("reuse-existing"),
    });
  });
});
