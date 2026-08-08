import { describe, expect, it, vi } from "vitest";
import type { DeletionPlan } from "@/types/artifacts";
import {
  executeArtifactDeletionPlan,
  getDeletionPlanConfirmation,
  isDeletionPlanConfirmationValid,
} from "./artifact-store";

function makePlan(scope: DeletionPlan["scope"]): DeletionPlan {
  return {
    planId: "plan-controller-test",
    schemaVersion: "1.0.0",
    projectId: "project-controller-test",
    chapterId: "chapter-controller-test",
    scope,
    createdAt: 1,
    fingerprint: "fingerprint-controller-test",
    deleteItems: [{
      artifactId: "novel:novel-chapter:chapter-controller-test",
      kind: "novel-chapter",
      stage: "novel",
      name: "第一章",
    }],
    migrateItems: [],
    retainItems: [],
    blockerItems: [],
    backupImpact: [],
    byteTotals: { deleteBytes: 0, migrateBytes: 0, retainBytes: 0, totalBytes: 0 },
    confirmationRequired: scope === "chapter"
      ? { type: "chapter-id", value: "chapter-controller-test" }
      : { type: "artifact-count", count: 1 },
    executionAllowed: true,
  };
}

describe("artifact deletion controller", () => {
  it("rejects a chapter plan when no typed confirmation reached the controller", async () => {
    const execute = vi.fn();
    vi.stubGlobal("window", { artifactDeletion: { execute } });

    await expect(executeArtifactDeletionPlan(makePlan("chapter"))).resolves.toMatchObject({
      success: false,
      error: "confirmation-mismatch",
    });
    expect(execute).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a mismatched confirmation before touching IPC", async () => {
    const execute = vi.fn();
    vi.stubGlobal("window", { artifactDeletion: { execute } });
    const plan = makePlan("chapter");

    await expect(executeArtifactDeletionPlan(plan, {
      type: "chapter",
      chapterId: "other-chapter",
    })).resolves.toMatchObject({ success: false, error: "confirmation-mismatch" });
    expect(execute).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("submits the reviewed plan and exact fingerprint through one bridge call", async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, journalState: "committed", data: {} });
    vi.stubGlobal("window", { artifactDeletion: { execute } });
    const plan = makePlan("artifacts");
    const confirmation = getDeletionPlanConfirmation(plan);

    expect(getDeletionPlanConfirmation(plan)).toEqual({ type: "artifacts", artifactCount: 1 });
    expect(isDeletionPlanConfirmationValid(plan, { type: "artifacts", artifactCount: 1 })).toBe(true);
    await expect(executeArtifactDeletionPlan(plan, confirmation)).resolves.toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledWith({
      planId: plan.planId,
      fingerprint: plan.fingerprint,
      confirmation: { type: "artifacts", artifactCount: 1 },
    });
    vi.unstubAllGlobals();
  });
});
