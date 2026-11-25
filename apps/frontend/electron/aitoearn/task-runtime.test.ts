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

  it("does not fire a far-future schedule immediately via setTimeout overflow", async () => {
    // 09-10 P0-2 回归:>24.8 天的定时曾被 setTimeout 溢出截断成 1ms 立即发布。
    vi.useFakeTimers();
    try {
      const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000; // 2_592_000_000 > 2^31-1
      const scheduled = { ...task("scheduled"), scheduledAt: new Date(nowMs + thirtyDaysMs).toISOString() };
      const tasks = new Map([[scheduled.id, scheduled]]);
      const executeScheduled = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const runtime = new SelfMediaTaskRuntime(
        tasks,
        { get: () => undefined },
        async () => undefined,
        undefined,
        { now: () => nowMs, executeScheduled },
      );
      runtime.schedule(scheduled);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(executeScheduled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(thirtyDaysMs - 1_000 - 1);
      expect(executeScheduled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(executeScheduled).toHaveBeenCalledOnce();
      expect(tasks.get(scheduled.id)?.status).toBe("success");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("L6 闸门", () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");

    function batchTask(role: SelfMediaTask["batchRole"], scheduledAtMs: number): SelfMediaTask {
      return {
        ...task("scheduled"),
        id: `batch-${role}`,
        attemptId: `attempt-batch-${role}`,
        batchId: "batch-1",
        batchRole: role,
        scheduledAt: new Date(scheduledAtMs).toISOString(),
      };
    }

    it("delays by the given milliseconds instead of publishing: rearm does not recompute from scheduledAt", async () => {
      vi.useFakeTimers();
      try {
        // scheduledAt 已过期——schedule() 会得到 0 毫秒延时;闸门顺延 40 秒,
        // 重挂必须按给定的 delayMs 走,而不是回到过期的 scheduledAt(那会忙等)。
        const member = batchTask("member", base - 60_000);
        const tasks = new Map([[member.id, member]]);
        const executeScheduled = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
        const gateCalls: number[] = [];
        const runtime = new SelfMediaTaskRuntime(
          tasks,
          { get: () => undefined },
          async () => undefined,
          undefined,
          {
            now: () => base,
            executeScheduled,
            gateScheduled: (_task, nowMs) => {
              gateCalls.push(nowMs);
              return gateCalls.length === 1 ? { action: "delay", delayMs: 40_000 } : { action: "execute" };
            },
          },
        );
        runtime.schedule(member);
        await vi.advanceTimersByTimeAsync(1);
        expect(executeScheduled).not.toHaveBeenCalled();
        expect(tasks.get(member.id)?.status).toBe("scheduled");
        await vi.advanceTimersByTimeAsync(39_998);
        expect(executeScheduled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(gateCalls).toHaveLength(2);
        expect(executeScheduled).toHaveBeenCalledOnce();
        expect(tasks.get(member.id)?.status).toBe("success");
      } finally {
        vi.useRealTimers();
      }
    });

    it("fails the scheduled task without publishing when the gate says fail", async () => {
      vi.useFakeTimers();
      try {
        const member = batchTask("member", base + 1_000);
        const tasks = new Map([[member.id, member]]);
        const executeScheduled = vi.fn();
        const runtime = new SelfMediaTaskRuntime(
          tasks,
          { get: () => undefined },
          async () => undefined,
          undefined,
          {
            now: () => base,
            executeScheduled,
            gateScheduled: () => ({ action: "fail", code: "batch-verification-failed", message: "首发验证未通过，本条未发布" }),
          },
        );
        runtime.schedule(member);
        await vi.advanceTimersByTimeAsync(1_000);
        await runtime.waitForIdle();
        expect(executeScheduled).not.toHaveBeenCalled();
        expect(tasks.get(member.id)).toMatchObject({
          status: "failure",
          error: { code: "batch-verification-failed", message: "首发验证未通过，本条未发布", retryable: false },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("abort() turns a scheduled task into a non-retryable failure", async () => {
      const member = batchTask("member", base + 60_000);
      const tasks = new Map([[member.id, member]]);
      const runtime = new SelfMediaTaskRuntime(tasks, { get: () => undefined }, async () => undefined);
      const aborted = await runtime.abort(member, "batch-verification-failed", "首发验证未通过，本条未发布");
      expect(aborted.status).toBe("failure");
      expect(aborted.error).toMatchObject({ code: "batch-verification-failed", retryable: false });
      expect(tasks.get(member.id)?.status).toBe("failure");
    });

    it("does not republish a task canceled while parked behind the gate", async () => {
      vi.useFakeTimers();
      try {
        const member = batchTask("member", base + 1_000);
        const tasks = new Map([[member.id, member]]);
        const executeScheduled = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
        const runtime = new SelfMediaTaskRuntime(
          tasks,
          { get: () => undefined },
          async () => undefined,
          undefined,
          {
            now: () => base,
            executeScheduled,
            gateScheduled: () => ({ action: "delay", delayMs: 30_000 }),
          },
        );
        runtime.schedule(member);
        await vi.advanceTimersByTimeAsync(1);
        // 顺延等待期间被取消:unschedule 清掉重挂定时
        runtime.unschedule(member.id);
        const canceled = applySelfMediaTaskResult(tasks.get(member.id)!, { status: "canceled" });
        tasks.set(member.id, canceled);
        await vi.advanceTimersByTimeAsync(60_000);
        await runtime.waitForIdle();
        expect(executeScheduled).not.toHaveBeenCalled();
        expect(tasks.get(member.id)?.status).toBe("canceled");
      } finally {
        vi.useRealTimers();
      }
    });

    it("after a restart runs the expired verification first and spaces members by the gate", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(base);
      try {
        // 重启场景:新建运行时、整批已过期,recover() 把欠点任务排成立即触发。
        // 闸门按批次表放行:验证先过,成员从验证放行时刻起满 5 分钟才过。
        const verification = batchTask("verification", base - 120_000);
        const member = { ...batchTask("member", base - 60_000), id: "batch-member", attemptId: "attempt-batch-member" };
        const tasks = new Map([[verification.id, verification], [member.id, member]]);
        const executeScheduled = vi.fn(async (_executed: SelfMediaTask) => ({ status: "success" as const, progress: 100 }));
        let verificationReleasedAt: number | null = null;
        const runtime = new SelfMediaTaskRuntime(
          tasks,
          { get: () => undefined },
          async () => undefined,
          undefined,
          {
            now: () => Date.now(),
            executeScheduled,
            gateScheduled: (t, nowMs) => {
              if (t.batchRole === "verification") {
                verificationReleasedAt = nowMs;
                return { action: "execute" };
              }
              const sinceVerification = nowMs - (verificationReleasedAt ?? nowMs);
              return sinceVerification >= 300_000
                ? { action: "execute" }
                : { action: "delay", delayMs: 300_000 - sinceVerification };
            },
          },
        );
        await runtime.recover();
        // recover() 只挂定时,先推一拍让验证任务真正执行
        await vi.advanceTimersByTimeAsync(0);
        await runtime.waitForIdle();
        // 验证已放行,成员还在闸门外等间隔
        expect(executeScheduled).toHaveBeenCalledTimes(1);
        expect(executeScheduled.mock.calls[0]?.[0]?.id).toBe(verification.id);
        expect(tasks.get(member.id)?.status).toBe("scheduled");
        await vi.advanceTimersByTimeAsync(300_000);
        await runtime.waitForIdle();
        expect(executeScheduled).toHaveBeenCalledTimes(2);
        expect(executeScheduled.mock.calls[1]?.[0]?.id).toBe(member.id);
        expect(tasks.get(verification.id)?.status).toBe("success");
        expect(tasks.get(member.id)?.status).toBe("success");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
