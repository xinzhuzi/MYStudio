// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemotionQueueScopeReply } from "@rendering/plugins/remotion/queue/remotion-queue-ipc";
import type { RemotionQueueNotification } from "@rendering/plugins/remotion/queue/remotion-render-queue";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { useRemotionQueueScope } from "./useRemotionQueueScope";

function makeJob(status: RemotionRenderJobV1["status"], shotId = "shot-001"): RemotionRenderJobV1 {
  return {
    schemaVersion: 1,
    jobId: `job-${shotId}`,
    projectId: "project-a",
    target: { kind: "shot", chapterId: "chapter-001", shotId, shotRevision: 1 },
    inputHash: "a".repeat(64),
    bundleContentHash: "b".repeat(64),
    renderSettingsHash: "c".repeat(64),
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    status,
    attempt: 1,
    progress: status === "succeeded" ? 1 : 0.4,
    createdAt: 1,
  };
}

describe("useRemotionQueueScope", () => {
  afterEach(() => {
    delete window.remotionQueue;
  });

  it("loads only the active project/chapter and refreshes after a matching notification", async () => {
    let jobs = [makeJob("running")];
    const listeners: Array<(notification: RemotionQueueNotification) => void> = [];
    const get = vi.fn(async ({ projectId, chapterId }: { projectId: string; chapterId: string }): Promise<RemotionQueueScopeReply> => ({
      projectId,
      chapterId,
      jobs,
      currentShotSlots: [],
    }));
    window.remotionQueue = {
      get,
      onJob: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    } as unknown as NonNullable<Window["remotionQueue"]>;

    const view = renderHook(() => useRemotionQueueScope("project-a", "chapter-001"));
    await waitFor(() => expect(view.result.current.jobs[0]?.status).toBe("running"));
    expect(view.result.current.loaded).toBe(true);
    expect(get).toHaveBeenCalledWith({ projectId: "project-a", chapterId: "chapter-001" });

    jobs = [makeJob("succeeded")];
    listeners[0]?.({ type: "job", projectId: "project-b", chapterId: "chapter-001", jobId: "other", status: "succeeded" });
    expect(get).toHaveBeenCalledTimes(1);
    listeners[0]?.({ type: "job", projectId: "project-a", chapterId: "chapter-001", jobId: "job-shot-001", status: "succeeded" });
    await waitFor(() => expect(view.result.current.jobs[0]?.status).toBe("succeeded"));
    expect(view.result.current.currentShotSlots).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("projects verified current shot slots together with queue jobs", async () => {
    const slot = makeCurrentSlot();
    window.remotionQueue = {
      get: vi.fn(async () => ({
        projectId: "project-a",
        chapterId: "chapter-001",
        jobs: [slot.job],
        currentShotSlots: [slot],
      })),
      onJob: () => () => undefined,
    } as unknown as NonNullable<Window["remotionQueue"]>;

    const view = renderHook(() => useRemotionQueueScope("project-a", "chapter-001"));
    await waitFor(() => expect(view.result.current.currentShotSlots).toHaveLength(1));
    expect(view.result.current.loaded).toBe(true);
    expect(view.result.current.currentShotSlots[0]?.target).toEqual(slot.target);
  });
});
