// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletionPlan } from "@/types/artifacts";

type RegisteredHandler = (event: unknown, payload: unknown) => unknown | Promise<unknown>;

const ipcTestState = vi.hoisted(() => ({
  handlers: new Map<string, RegisteredHandler>(),
  executeDeletion: vi.fn(),
  queryRecovery: vi.fn(),
  registerDeletionPlan: vi.fn(),
  resolveProjectRootPath: vi.fn(),
  scanProjectInventory: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: RegisteredHandler) => {
      ipcTestState.handlers.set(channel, handler);
    }),
  },
}));
vi.mock("@/electron/artifacts/artifact-inventory-service", () => ({
  scanProjectInventory: ipcTestState.scanProjectInventory,
}));
vi.mock("@/electron/artifacts/artifact-deletion-service", () => ({
  executeDeletion: ipcTestState.executeDeletion,
  queryRecovery: ipcTestState.queryRecovery,
  registerDeletionPlan: ipcTestState.registerDeletionPlan,
}));
vi.mock("@/electron/storage/storage-paths", () => ({
  resolveProjectRootPath: ipcTestState.resolveProjectRootPath,
}));

import {
  applyInventoryDiscrepancyBlockers,
  configureArtifactManagementIpc,
} from "./artifact-management-ipc";

function getRegisteredHandler(channel: string): RegisteredHandler {
  const handler = ipcTestState.handlers.get(channel);
  expect(handler, `${channel} should be registered`).toBeTypeOf("function");
  return handler as RegisteredHandler;
}

beforeEach(() => {
  configureArtifactManagementIpc({ getDataDir: () => "data-root" });
  ipcTestState.executeDeletion.mockReset();
  ipcTestState.queryRecovery.mockReset();
  ipcTestState.registerDeletionPlan.mockReset();
  ipcTestState.registerDeletionPlan.mockImplementation((plan) => plan);
  ipcTestState.resolveProjectRootPath.mockReset();
  ipcTestState.scanProjectInventory.mockReset();
});

function makePlan(): DeletionPlan {
  return {
    planId: "plan-discrepancy",
    schemaVersion: "1.0.0",
    projectId: "project-1",
    chapterId: "chapter-1",
    scope: "chapter",
    selectedArtifactIds: [],
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

describe("artifact deletion plan registration", () => {
  it("returns the immutable main-process registered fingerprint", async () => {
    ipcTestState.scanProjectInventory.mockResolvedValue({
      success: true,
      data: {
        projectId: "project-1",
        artifacts: [{
          id: "novel:novel-chapter:chapter-1",
          projectId: "project-1",
          chapterId: "chapter-1",
          stage: "novel",
          kind: "novel-chapter",
          state: "active",
          name: "第一章",
          createdAt: 1,
          updatedAt: 1,
          physicalRefs: [],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: "delete-exclusive-downstream",
        }],
        discrepancies: [],
        blockers: [],
        summary: {},
      },
    });
    ipcTestState.registerDeletionPlan.mockImplementation((plan) => ({
      ...plan,
      fingerprint: "registered-sha256",
    }));

    const result = await getRegisteredHandler("artifact-plan-deletion")({}, {
      projectId: "project-1",
      chapterId: "chapter-1",
      scope: "chapter",
    });

    expect(result).toMatchObject({ success: true, data: { fingerprint: "registered-sha256" } });
    expect(ipcTestState.registerDeletionPlan).toHaveBeenCalledTimes(1);
  });
});

describe("artifact management registered IPC boundary", () => {
  it.each([
    ["artifact-inventory-scan", { projectId: "project-1", unexpectedPath: "/tmp/outside" }],
    ["artifact-get-project-artifacts", { projectId: "project-1", chapterId: "chapter-1" }],
    ["artifact-plan-deletion", {
      projectId: "project-1",
      chapterId: "chapter-1",
      scope: "chapter",
      targetPaths: ["/tmp/outside"],
    }],
    ["artifact-execute-deletion", {
      planId: "plan-1",
      fingerprint: "fingerprint-1",
      confirmation: { type: "chapter", chapterId: "chapter-1" },
      physicalPath: "/tmp/outside",
    }],
    ["artifact-deletion-recovery-query", { projectId: "project-1", chapterId: "chapter-1" }],
    ["artifact-update-metadata", {
      projectId: "project-1",
      artifactId: "artifact-1",
      updates: { notes: "reviewed", status: "active" },
    }],
  ] as const)("%s rejects unknown fields before domain services", async (channel, payload) => {
    const result = await getRegisteredHandler(channel)({}, payload);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("INVALID_PAYLOAD"),
    });
    expect(ipcTestState.scanProjectInventory).not.toHaveBeenCalled();
    expect(ipcTestState.executeDeletion).not.toHaveBeenCalled();
    expect(ipcTestState.queryRecovery).not.toHaveBeenCalled();
    expect(ipcTestState.registerDeletionPlan).not.toHaveBeenCalled();
    expect(ipcTestState.resolveProjectRootPath).not.toHaveBeenCalled();
  });

  it("passes a decoded inventory request to the scan service", async () => {
    ipcTestState.scanProjectInventory.mockResolvedValue({ success: false, error: "SCAN_SENTINEL" });

    const result = await getRegisteredHandler("artifact-inventory-scan")({}, {
      projectId: "project-1",
      chapterId: "chapter-1",
    });

    expect(ipcTestState.scanProjectInventory).toHaveBeenCalledWith(
      "data-root",
      "project-1",
      "chapter-1",
      undefined,
    );
    expect(result).toEqual({ success: false, error: "SCAN_SENTINEL" });
  });
});
