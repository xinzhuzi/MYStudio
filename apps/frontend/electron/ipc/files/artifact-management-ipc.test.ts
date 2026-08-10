// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { DeletionPlan } from "@/types/artifacts";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { applyInventoryDiscrepancyBlockers } from "./artifact-management-ipc";

function makePlan(): DeletionPlan {
  return {
    planId: "plan-discrepancy",
    schemaVersion: "1.0.0",
    projectId: "project-1",
    chapterId: "chapter-1",
    scope: "chapter",
    createdAt: 1,
    fingerprint: "fingerprint",
    deleteItems: [],
    migrateItems: [],
    retainItems: [],
    blockerItems: [],
    backupImpact: [],
    byteTotals: { deleteBytes: 0, migrateBytes: 0, retainBytes: 0, totalBytes: 0 },
    confirmationRequired: { type: "chapter-id", value: "chapter-1" },
    executionAllowed: true,
  };
}

describe("artifact deletion plan discrepancy gate", () => {
  it("leaves a clean plan unchanged", () => {
    const plan = makePlan();
    expect(applyInventoryDiscrepancyBlockers(plan, [])).toBe(plan);
  });

  it("surfaces every discrepancy and disables execution", () => {
    const gated = applyInventoryDiscrepancyBlockers(makePlan(), [
      {
        type: "missing-index",
        description: "磁盘文件不在实时索引",
        affectedArtifacts: ["media-library:media-file:exports/chapter-1/report.json"],
      },
      {
        type: "live-vs-disk",
        description: "实时记录与磁盘内容不同",
        affectedArtifacts: [],
      },
    ]);

    expect(gated.executionAllowed).toBe(false);
    expect(gated.blockerItems).toHaveLength(2);
    expect(gated.blockerItems.map((item) => item.artifactId)).toEqual([
      "__inventory_discrepancy__0",
      "__inventory_discrepancy__1",
    ]);
    expect(gated.blockerItems[0]?.reason).toContain("exports/chapter-1/report.json");
    expect(gated.blockerItems[1]?.reason).toContain("请先同步结构化状态并刷新盘点");
  });
});
