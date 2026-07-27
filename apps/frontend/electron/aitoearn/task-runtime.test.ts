import { describe, expect, it, vi } from "vitest";
import { applySelfMediaTaskResult, SelfMediaTaskRuntime } from "./task-runtime";
import type { SelfMediaTask } from "../../types/self-media";

const task = (status: SelfMediaTask["status"], projectId = "p1"): SelfMediaTask => ({
  id: `${status}-1`, attemptId: "a1", projectId, providerId: "aitoearn-local", accountId: "acct",
  sourceAssetIds: ["asset"], status, progress: 10, scheduledAt: status === "scheduled" ? "2026-01-01T00:00:01.000Z" : undefined,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("SelfMediaTaskRuntime", () => {
  it("lists only the requested project in deterministic order", () => {
    const tasks = new Map([["b", task("running", "p1")], ["a", task("success", "p2")]]);
    const runtime = new SelfMediaTaskRuntime(tasks, { get: () => undefined }, async () => undefined);
    expect(runtime.list("p1").map((item) => item.projectId)).toEqual(["p1"]);
  });

  it("rehydrates running tasks by polling and persists the terminal evidence", async () => {
    const running = task("running");
    const tasks = new Map<string, SelfMediaTask>([[running.id, running]]);
    const persist = vi.fn(async () => undefined);
    const poll = vi.fn(async () => ({ status: "partial" as const, progress: 65, error: { code: "review", message: "待审核", providerId: "aitoearn-local" as const, retryable: false } }));
    const runtime = new SelfMediaTaskRuntime(tasks, { get: () => ({ poll, publish: vi.fn(), listAccounts: vi.fn(), startLogin: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), id: "aitoearn-local", publishMode: "per-account", summary: { id: "aitoearn-local", displayName: "local", enabled: true } }) as never }, persist);
    await runtime.recover();
    expect(poll).toHaveBeenCalledOnce();
    expect(tasks.get(running.id)?.status).toBe("partial");
    expect(tasks.get(running.id)?.error?.code).toBe("review");
    expect(persist).toHaveBeenCalled();
  });

  it("executes a recovered schedule through the injected publish callback instead of polling", async () => {
    vi.useFakeTimers();
    try {
      const scheduled = task("scheduled");
      const tasks = new Map([[scheduled.id, scheduled]]);
      const poll = vi.fn();
      const executeScheduled = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const runtime = new SelfMediaTaskRuntime(
        tasks,
        { get: () => ({ poll }) as never },
        async () => undefined,
        undefined,
        { now: () => Date.parse("2026-01-01T00:00:00.000Z"), executeScheduled },
      );
      await runtime.recover();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(executeScheduled).toHaveBeenCalledOnce();
      expect(poll).not.toHaveBeenCalled();
      expect(tasks.get(scheduled.id)?.status).toBe("success");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps polling a provider task until it reaches a terminal state", async () => {
    vi.useFakeTimers();
    try {
      const running = { ...task("running"), providerTaskId: "provider-1" };
      const tasks = new Map([[running.id, running]]);
      const poll = vi.fn()
        .mockResolvedValueOnce({ status: "running" as const, progress: 50 })
        .mockResolvedValueOnce({ status: "audit" as const, progress: 100 });
      const runtime = new SelfMediaTaskRuntime(
        tasks,
        { get: () => ({ poll }) as never },
        async () => undefined,
        undefined,
        { pollIntervalMs: 500 },
      );
      await runtime.recover();
      expect(poll).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(500);
      expect(poll).toHaveBeenCalledTimes(2);
      expect(tasks.get(running.id)?.status).toBe("audit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid state transition instead of assigning the status", () => {
    const completed = task("success");
    expect(() => applySelfMediaTaskResult(completed, { status: "running" })).toThrow("Invalid self-media task transition");
    expect(completed.status).toBe("success");
  });

  it("turns an invalid scheduled date into a failure without scheduling immediate work", async () => {
    vi.useFakeTimers();
    try {
      const scheduled = { ...task("scheduled"), scheduledAt: "not-a-date" };
      const tasks = new Map([[scheduled.id, scheduled]]);
      const executeScheduled = vi.fn();
      const runtime = new SelfMediaTaskRuntime(
        tasks,
        { get: () => undefined },
        async () => undefined,
        undefined,
        { executeScheduled },
      );
      runtime.schedule(scheduled);
      await runtime.waitForIdle();
      expect(vi.getTimerCount()).toBe(0);
      expect(executeScheduled).not.toHaveBeenCalled();
      expect(tasks.get(scheduled.id)).toMatchObject({ status: "failure", error: { code: "invalid-scheduled-time" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a provider result that arrives after dispose", async () => {
    let resolvePoll!: (result: { status: "success" }) => void;
    const running = { ...task("running"), providerTaskId: "provider-1" };
    const tasks = new Map([[running.id, running]]);
    const poll = vi.fn(() => new Promise<{ status: "success" }>((resolve) => { resolvePoll = resolve; }));
    const persist = vi.fn(async () => undefined);
    const runtime = new SelfMediaTaskRuntime(tasks, { get: () => ({ poll }) as never }, persist);
    const polling = runtime.poll(running);
    await Promise.resolve();
    const disposing = runtime.dispose();
    resolvePoll({ status: "success" });
    await Promise.all([polling, disposing]);
    expect(tasks.get(running.id)?.status).toBe("running");
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not let a late poll overwrite a canceled task", async () => {
    let resolvePoll!: (result: { status: "success" }) => void;
    const running = { ...task("running"), providerTaskId: "provider-1" };
    const tasks = new Map<string, SelfMediaTask>([[running.id, running]]);
    const poll = vi.fn(() => new Promise<{ status: "success" }>((resolve) => { resolvePoll = resolve; }));
    const runtime = new SelfMediaTaskRuntime(tasks, { get: () => ({ poll }) as never }, async () => undefined);
    const polling = runtime.poll(running);
    await Promise.resolve();
    const canceled = applySelfMediaTaskResult(running, { status: "canceled" });
    tasks.set(running.id, canceled);
    resolvePoll({ status: "success" });
    await expect(polling).resolves.toEqual(canceled);
    expect(tasks.get(running.id)?.status).toBe("canceled");
  });

  it("does not let a late scheduled publish overwrite a canceled task", async () => {
    let resolvePublish!: (result: { status: "success" }) => void;
    let markPublishStarted!: () => void;
    const publishStarted = new Promise<void>((resolve) => { markPublishStarted = resolve; });
    const scheduled = task("scheduled");
    const tasks = new Map([[scheduled.id, scheduled]]);
    const executeScheduled = vi.fn(() => new Promise<{ status: "success" }>((resolve) => {
      resolvePublish = resolve;
      markPublishStarted();
    }));
    const runtime = new SelfMediaTaskRuntime(
      tasks,
      { get: () => undefined },
      async () => undefined,
      undefined,
      { executeScheduled },
    );
    const executing = runtime.execute(scheduled);
    await publishStarted;
    const running = tasks.get(scheduled.id)!;
    expect(running.status).toBe("running");
    const canceled = applySelfMediaTaskResult(running, { status: "canceled" });
    tasks.set(scheduled.id, canceled);
    resolvePublish({ status: "success" });
    await expect(executing).resolves.toEqual(canceled);
    expect(tasks.get(scheduled.id)?.status).toBe("canceled");
  });
});
