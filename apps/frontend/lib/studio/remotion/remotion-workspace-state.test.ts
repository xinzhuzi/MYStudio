import { describe, expect, it } from "vitest";
import {
  canTransitionRemotionStatus,
  createRemotionRenderJobId,
  transitionRemotionRenderJob,
} from "./remotion-workspace-state";
import { makeSucceededShotJob, TEST_SHA_A, TEST_SHA_B, TEST_SHA_C } from "./remotion-workspace-test-fixtures";

describe("Remotion render job identity and state transitions", () => {
  it("creates a canonical job id independent of object key insertion order", async () => {
    const identity = {
      projectId: "project-a",
      target: { kind: "shot" as const, chapterId: "chapter-001", shotId: "shot-001", shotRevision: 1 },
      inputHash: TEST_SHA_A,
      bundleContentHash: TEST_SHA_B,
      renderSettingsHash: TEST_SHA_C,
    };
    const reordered = {
      renderSettingsHash: TEST_SHA_C,
      bundleContentHash: TEST_SHA_B,
      inputHash: TEST_SHA_A,
      target: { shotRevision: 1, shotId: "shot-001", chapterId: "chapter-001", kind: "shot" as const },
      projectId: "project-a",
    };

    const first = await createRemotionRenderJobId(identity);
    const second = await createRemotionRenderJobId(reordered);
    expect(first).toBe(second);
    expect(first).toMatch(/^shot:[a-f0-9]{64}$/);
  });

  it("does not use timestamps in logical identity", async () => {
    const base = makeSucceededShotJob();
    const identity = {
      projectId: base.projectId,
      target: base.target,
      inputHash: base.inputHash,
      bundleContentHash: base.bundleContentHash,
      renderSettingsHash: base.renderSettingsHash,
    };
    expect(await createRemotionRenderJobId(identity)).toBe(await createRemotionRenderJobId({ ...identity }));
  });

  it("documents legal retry and invalidation transitions", () => {
    expect(canTransitionRemotionStatus("ready", "queued")).toBe(true);
    expect(canTransitionRemotionStatus("failed", "queued")).toBe(true);
    expect(canTransitionRemotionStatus("succeeded", "stale")).toBe(true);
    expect(canTransitionRemotionStatus("pending", "succeeded")).toBe(false);
  });

  it("increments attempts when queued and records running timestamps", () => {
    const ready = {
      ...makeSucceededShotJob(),
      status: "ready" as const,
      attempt: 0,
      progress: 0,
      startedAt: undefined,
      completedAt: undefined,
      outputPath: undefined,
      evidencePath: undefined,
    };
    const queued = transitionRemotionRenderJob(ready, { status: "queued", at: 200 });
    expect(queued.success).toBe(true);
    if (!queued.success) return;
    expect(queued.value.attempt).toBe(1);

    const running = transitionRemotionRenderJob(queued.value, { status: "running", at: 210 });
    expect(running.success).toBe(true);
    if (!running.success) return;
    expect(running.value.startedAt).toBe(210);
  });

  it("requires evidence-first data before succeeded", () => {
    const running = {
      ...makeSucceededShotJob(),
      status: "running" as const,
      progress: 0.8,
      completedAt: undefined,
      outputPath: undefined,
      evidencePath: undefined,
    };
    const result = transitionRemotionRenderJob(running, { status: "succeeded", at: 300 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.path === "$.evidencePath")).toBe(true);
    }
  });

  it("requires structured failure details and rejects illegal jumps", () => {
    const running = { ...makeSucceededShotJob(), status: "running" as const, completedAt: undefined };
    expect(transitionRemotionRenderJob(running, { status: "failed", at: 300 }).success).toBe(false);

    const pending = { ...running, status: "pending" as const, startedAt: undefined };
    expect(transitionRemotionRenderJob(pending, { status: "succeeded", at: 300 }).success).toBe(false);
  });
});
