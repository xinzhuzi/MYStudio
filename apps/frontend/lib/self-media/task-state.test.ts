import { describe, expect, it } from "vitest";
import { reduceSelfMediaTask } from "./task-state";
import type { SelfMediaTask } from "@/types/self-media";

function createTask(status: SelfMediaTask["status"] = "draft"): SelfMediaTask {
  return {
    id: "task-1",
    attemptId: "attempt-1",
    projectId: "project-1",
    providerId: "aitoearn-local",
    accountId: "account-1",
    sourceAssetIds: ["asset-1"],
    status,
    progress: 0,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

describe("reduceSelfMediaTask", () => {
  it("keeps the explicit schedule and running lifecycle", () => {
    const scheduled = reduceSelfMediaTask(createTask(), {
      type: "schedule",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    });
    const running = reduceSelfMediaTask(scheduled, { type: "start", providerTaskId: "provider-1" });
    const success = reduceSelfMediaTask(running, { type: "succeed", resultUrl: "https://example.test/result" });

    expect(scheduled.status).toBe("scheduled");
    expect(running.providerTaskId).toBe("provider-1");
    expect(success).toMatchObject({ status: "success", progress: 100 });
  });

  it("rejects transitions from a terminal state", () => {
    expect(() => reduceSelfMediaTask(createTask("success"), { type: "start" })).toThrow(
      "Invalid self-media task transition",
    );
  });
});
