import type { SelfMediaTask, SelfMediaTaskError, SelfMediaTaskStatus } from "../../types/self-media";
import { decodeSelfMediaTaskResult } from "../../lib/self-media/ipc-contract";
import { reduceSelfMediaTask } from "../../lib/self-media/task-state";
import type { SelfMediaProviderAdapter, SelfMediaProviderTaskResult } from "./provider-registry";

export type TaskRuntimeClock = () => number;
export type ScheduledTaskExecutor = (task: SelfMediaTask) => Promise<SelfMediaProviderTaskResult>;
export type TaskRuntimeErrorMapper = (task: SelfMediaTask, error: unknown) => SelfMediaTaskError;

export interface SelfMediaTaskRuntimeOptions {
  now?: TaskRuntimeClock;
  pollIntervalMs?: number;
  executeScheduled?: ScheduledTaskExecutor;
  mapError?: TaskRuntimeErrorMapper;
}

const TERMINAL: readonly SelfMediaTaskStatus[] = ["success", "failure", "partial", "audit", "canceled", "expired-login"];
const isTerminal = (status: SelfMediaTaskStatus) => TERMINAL.includes(status);

/** Main-process journal runtime. It deliberately owns no IPC channels or secrets. */
export class SelfMediaTaskRuntime {
  private readonly jobs = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly now: TaskRuntimeClock;
  private readonly pollIntervalMs: number;
  private disposed = false;

  constructor(
    private readonly tasks: Map<string, SelfMediaTask>,
    private readonly providers: { get(id: SelfMediaTask["providerId"]): SelfMediaProviderAdapter | undefined },
    private readonly persist: () => Promise<void>,
    private readonly emit?: (task: SelfMediaTask) => void,
    private readonly options: SelfMediaTaskRuntimeOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  list(projectId: string): SelfMediaTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async recover(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (isTerminal(task.status)) continue;
      if (task.status === "scheduled") this.schedule(task);
      else if (task.status === "running") await this.poll(task);
    }
  }

  schedule(task: SelfMediaTask): void {
    if (this.disposed || isTerminal(task.status) || this.jobs.has(task.id)) return;
    if (!task.scheduledAt) {
      this.track(this.fail(task, "invalid-scheduled-time", "定时任务缺少发布时间"));
      return;
    }
    const timestamp = Date.parse(task.scheduledAt);
    if (!Number.isFinite(timestamp)) {
      this.track(this.fail(task, "invalid-scheduled-time", "定时任务的发布时间无效"));
      return;
    }
    const delay = Math.max(0, timestamp - this.now());
    this.jobs.set(task.id, setTimeout(() => {
      this.jobs.delete(task.id);
      this.track(this.execute(task));
    }, delay));
  }

  async execute(task: SelfMediaTask): Promise<SelfMediaTask> {
    const current = this.tasks.get(task.id) ?? task;
    if (this.disposed || isTerminal(current.status)) return current;
    if (!this.options.executeScheduled) {
      return this.fail(current, "schedule-context-missing", "定时任务缺少可恢复的发布上下文");
    }
    const running = await this.apply(current, { status: "running", progress: current.progress });
    if (this.disposed || this.tasks.get(running.id) !== running || running.status !== "running") {
      return this.tasks.get(running.id) ?? running;
    }
    try {
      const next = await this.apply(running, await this.options.executeScheduled(running));
      this.watch(next);
      return next;
    } catch (error) {
      return this.apply(running, {
        status: "failure",
        error: this.mapError(running, error),
      });
    }
  }

  async poll(task: SelfMediaTask): Promise<SelfMediaTask> {
    const operation = this.pollInternal(task);
    this.track(operation);
    return operation;
  }

  watch(task: SelfMediaTask): void {
    if (this.disposed) return;
    if (task.status === "scheduled") {
      this.schedule(task);
      return;
    }
    if (task.status !== "running" || !task.providerTaskId || this.jobs.has(task.id)) return;
    this.jobs.set(task.id, setTimeout(() => {
      this.jobs.delete(task.id);
      this.track(this.poll(task));
    }, this.pollIntervalMs));
  }

  unschedule(taskId: string): void {
    const timer = this.jobs.get(taskId);
    if (timer) clearTimeout(timer);
    this.jobs.delete(taskId);
  }

  async waitForIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.jobs.values()) clearTimeout(timer);
    this.jobs.clear();
    await this.waitForIdle();
  }

  private track(operation: Promise<unknown>): void {
    this.inFlight.add(operation);
    void operation.then(
      () => this.inFlight.delete(operation),
      () => this.inFlight.delete(operation),
    );
  }

  private async pollInternal(task: SelfMediaTask): Promise<SelfMediaTask> {
    const current = this.tasks.get(task.id) ?? task;
    if (this.disposed || isTerminal(current.status)) return current;
    const provider = this.providers.get(current.providerId);
    if (!provider) return this.fail(current, "invalid-provider", "provider 无效");
    try {
      const next = await this.apply(current, await provider.poll(current));
      this.watch(next);
      return next;
    } catch (error) {
      return this.apply(current, {
        status: "failure",
        error: this.mapError(current, error),
      });
    }
  }

  private async fail(task: SelfMediaTask, code: string, message: string): Promise<SelfMediaTask> {
    return this.apply(task, { status: "failure", error: { code, message, providerId: task.providerId, retryable: false } });
  }

  private mapError(task: SelfMediaTask, error: unknown): SelfMediaTaskError {
    return this.options.mapError?.(task, error) ?? {
      code: "provider-request-failed",
      message: error instanceof Error ? error.message : "provider 请求失败",
      providerId: task.providerId,
      retryable: true,
    };
  }

  private async apply(task: SelfMediaTask, result: SelfMediaProviderTaskResult): Promise<SelfMediaTask> {
    const current = this.tasks.get(task.id);
    if (this.disposed || !current || current.attemptId !== task.attemptId || isTerminal(current.status)) return current ?? task;
    const next = applySelfMediaTaskResult(current, result, this.now);
    this.tasks.set(next.id, next);
    if (isTerminal(next.status)) this.unschedule(next.id);
    await this.persist();
    if (this.disposed) return this.tasks.get(task.id) ?? task;
    this.emit?.(next);
    return next;
  }
}

export function applySelfMediaTaskResult(
  task: SelfMediaTask,
  rawResult: unknown,
  now: TaskRuntimeClock = Date.now,
): SelfMediaTask {
  const result = decodeSelfMediaTaskResult(rawResult);
  let next = task;
  const requested = result.status;

  if (requested && requested !== next.status) {
    if ((next.status === "draft" || next.status === "scheduled") && requested !== "canceled" && requested !== "scheduled") {
      next = reduceSelfMediaTask(next, { type: "start", providerTaskId: result.providerTaskId });
    }
    switch (requested) {
      case "scheduled":
        if (!next.scheduledAt || !Number.isFinite(Date.parse(next.scheduledAt))) throw new Error("Invalid self-media scheduled transition");
        next = reduceSelfMediaTask(next, { type: "schedule", scheduledAt: next.scheduledAt });
        break;
      case "running":
        if (next.status !== "running") next = reduceSelfMediaTask(next, { type: "start", providerTaskId: result.providerTaskId });
        break;
      case "success":
        next = reduceSelfMediaTask(next, { type: "succeed", resultUrl: result.resultUrl });
        break;
      case "failure":
        next = reduceSelfMediaTask(next, {
          type: "fail",
          error: result.error ?? {
            code: "provider-request-failed",
            message: "provider 返回了失败状态，但没有错误证据",
            providerId: task.providerId,
            retryable: true,
          },
        });
        break;
      case "partial":
        next = reduceSelfMediaTask(next, { type: "partial", error: result.error });
        break;
      case "audit":
        next = reduceSelfMediaTask(next, { type: "audit" });
        break;
      case "canceled":
        next = reduceSelfMediaTask(next, { type: "cancel" });
        break;
      case "expired-login":
        next = reduceSelfMediaTask(next, { type: "expire-login" });
        break;
      case "draft":
        throw new Error(`Invalid self-media task transition: ${task.status} -> ${requested}`);
      default: {
        const exhaustive: never = requested;
        return exhaustive;
      }
    }
  }

  const progress = result.progress === undefined
    ? next.progress
    : Math.max(0, Math.min(100, result.progress));
  return {
    ...next,
    progress: next.status === "success" ? 100 : progress,
    providerTaskId: result.providerTaskId ?? next.providerTaskId,
    resultUrl: result.resultUrl ?? next.resultUrl,
    error: result.error ?? next.error,
    updatedAt: new Date(now()).toISOString(),
  };
}
