import path from "node:path";
import type { RemotionBrowserStatus } from "../../../contracts/remotion-browser-status";
import type {
  RemotionShotRenderInput,
  RemotionChapterRenderInput,
  RemotionTimelineRenderInput,
  RemotionRenderProgress,
  RemotionRenderWorkerResult,
} from "./remotion-render-worker";
import {
  validateRemotionRenderWorkerEvent,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  type RemotionRenderWorkerEvent,
} from "./remotion-render-worker-protocol";

export interface UtilityProcessLike {
  on(event: "message", listener: (message: unknown) => void): UtilityProcessLike;
  on(event: "exit", listener: (code: number) => void): UtilityProcessLike;
  off(event: "message", listener: (message: unknown) => void): UtilityProcessLike;
  off(event: "exit", listener: (code: number) => void): UtilityProcessLike;
  postMessage(message: unknown): void;
  kill(): boolean;
}

export type RemotionRenderUtilityInput =
  | Omit<RemotionTimelineRenderInput, "browserExecutable">
  | Omit<RemotionShotRenderInput, "browserExecutable">
  | Omit<RemotionChapterRenderInput, "browserExecutable">;

export interface RemotionRenderBrowserProbe {
  status: RemotionBrowserStatus;
  executablePath?: string;
}

export interface RemotionRenderUtilityOptions {
  workerPath: string;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: (
    modulePath: string,
    args: string[],
    options: { cwd?: string; serviceName: string },
  ) => UtilityProcessLike;
  cwd?: string;
  cancelGracePeriodMs?: number;
  emitProgress: (progress: RemotionRenderProgress) => void;
}

interface ActiveRequest {
  requestId: string;
  jobId: string;
  expectedOutputPath: string;
  child: UtilityProcessLike;
  resolve: (result: RemotionRenderWorkerResult) => void;
  reject: (error: Error) => void;
  onMessage: (message: unknown) => void;
  onExit: (code: number) => void;
  cancelTimer?: ReturnType<typeof setTimeout>;
  cancelRequested: boolean;
}

export class RemotionRenderUtilitySupervisor {
  private readonly activeByJobId = new Map<string, ActiveRequest>();
  private readonly activeByRequestId = new Map<string, ActiveRequest>();
  private readonly startingJobIds = new Set<string>();
  private readonly canceledStartingJobIds = new Set<string>();
  private browserProbeTail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly options: RemotionRenderUtilityOptions) {
    if (!path.isAbsolute(options.workerPath)) throw new Error("Remotion render worker 路径必须是绝对路径");
    if (options.cwd !== undefined && !path.isAbsolute(options.cwd)) throw new Error("Remotion render utility cwd 必须是绝对路径");
  }

  render(input: RemotionRenderUtilityInput): Promise<RemotionRenderWorkerResult> {
    const fallbackJobId = readJobId(input);
    if (this.disposed) {
      return Promise.resolve(failed(fallbackJobId, "Remotion render utility process 已关闭"));
    }
    if (this.activeByJobId.has(fallbackJobId) || this.startingJobIds.has(fallbackJobId)) {
      return Promise.resolve({
        success: false,
        jobId: fallbackJobId,
        canceled: false,
        error: `Remotion utility 渲染任务正在运行: ${fallbackJobId}`,
      });
    }
    this.startingJobIds.add(fallbackJobId);
    return this.startRender(input, fallbackJobId)
      .finally(() => {
        this.startingJobIds.delete(fallbackJobId);
        this.canceledStartingJobIds.delete(fallbackJobId);
      });
  }

  cancel(jobId: string): { success: boolean; jobId: string; canceled: boolean; error?: string } {
    const normalized = typeof jobId === "string" ? jobId.trim() : "";
    if (!normalized) return { success: false, jobId: "unknown", canceled: false, error: "渲染任务 ID 不能为空" };
    const active = this.activeByJobId.get(normalized);
    if (!active) {
      if (this.startingJobIds.has(normalized)) {
        this.canceledStartingJobIds.add(normalized);
        return { success: true, jobId: normalized, canceled: true };
      }
      return { success: false, jobId: normalized, canceled: false, error: `未找到运行中的 Remotion 渲染任务: ${normalized}` };
    }
    if (!active.cancelRequested) {
      active.cancelRequested = true;
      try {
        active.child.postMessage({
          schemaVersion: 1,
          requestId: active.requestId,
          action: "cancel",
          jobId: normalized,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.finish(active, failed(normalized, message), true);
        return { success: false, jobId: normalized, canceled: false, error: message };
      }
      active.cancelTimer = setTimeout(() => {
        if (this.activeByRequestId.get(active.requestId) !== active) return;
        this.finish(active, {
          success: false,
          jobId: normalized,
          canceled: true,
          error: `Remotion utility 渲染已取消: ${normalized}`,
        }, true);
      }, this.options.cancelGracePeriodMs ?? 2_000);
    }
    return { success: true, jobId: normalized, canceled: true };
  }

  dispose(): void {
    this.disposed = true;
    for (const active of [...this.activeByRequestId.values()]) {
      active.cancelTimer && clearTimeout(active.cancelTimer);
      this.detach(active);
      this.activeByJobId.delete(active.jobId);
      this.activeByRequestId.delete(active.requestId);
      active.child.kill();
      active.reject(new Error("Remotion render utility process 已关闭"));
    }
  }

  get isRunning(): boolean {
    return this.startingJobIds.size > 0 || this.activeByRequestId.size > 0;
  }

  private async startRender(
    input: RemotionRenderUtilityInput,
    fallbackJobId: string,
  ): Promise<RemotionRenderWorkerResult> {
    let browser: RemotionRenderBrowserProbe;
    try {
      browser = await this.probeBrowserInOrder();
    } catch (error) {
      return failed(fallbackJobId, error instanceof Error ? error.message : String(error));
    }
    if (this.canceledStartingJobIds.has(fallbackJobId)) {
      return {
        success: false,
        jobId: fallbackJobId,
        canceled: true,
        error: `Remotion utility 渲染已取消: ${fallbackJobId}`,
      };
    }
    if (browser.status.state !== "ready" || !browser.executablePath || !path.isAbsolute(browser.executablePath)) {
      return failed(fallbackJobId, browser.status.message ?? `Remotion Headless Shell 未就绪: ${browser.status.state}`);
    }
    if (this.disposed) return failed(fallbackJobId, "Remotion render utility process 已关闭");

    const requestId = `remotion-render-${++this.sequence}`;
    let child: UtilityProcessLike;
    try {
      child = this.options.fork(this.options.workerPath, [], {
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        serviceName: "MYStudio Remotion Render",
      });
    } catch (error) {
      return failed(fallbackJobId, error instanceof Error ? error.message : String(error));
    }
    return new Promise((resolve, reject) => {
      const active = {} as ActiveRequest;
      Object.assign(active, {
        requestId,
        jobId: fallbackJobId,
        expectedOutputPath: input.outputPath,
        child,
        resolve,
        reject,
        onMessage: (message) => this.handleMessage(active, message),
        onExit: (code) => this.handleExit(active, code),
        cancelRequested: false,
      });
      this.activeByJobId.set(active.jobId, active);
      this.activeByRequestId.set(active.requestId, active);
      child.on("message", active.onMessage);
      child.on("exit", active.onExit);
      try {
        child.postMessage({
          schemaVersion: 1,
          requestId,
          action: "render",
          input: { ...input, browserExecutable: browser.executablePath },
        });
      } catch (error) {
        this.finish(active, failed(active.jobId, error instanceof Error ? error.message : String(error)), true);
      }
    });
  }

  private async probeBrowserInOrder(): Promise<RemotionRenderBrowserProbe> {
    const previous = this.browserProbeTail;
    let release: () => void = () => undefined;
    this.browserProbeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.disposed) throw new Error("Remotion render utility process 已关闭");
      return await this.options.probeBrowser();
    } finally {
      release();
    }
  }

  private handleMessage(active: ActiveRequest, message: unknown): void {
    if (this.activeByRequestId.get(active.requestId) !== active) return;
    const validated = validateRemotionRenderWorkerEvent(message);
    if (!validated.success) {
      this.finish(active, failed(active.jobId, validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")), true);
      return;
    }
    const event = validated.value;
    if (event.requestId !== active.requestId) {
      this.finish(active, failed(active.jobId, "Remotion render worker requestId 与当前请求不匹配"), true);
      return;
    }
    if (event.kind === "progress") {
      if (event.progress.jobId !== active.jobId) {
        this.finish(active, failed(active.jobId, "Remotion render worker progress jobId 与当前任务不匹配"), true);
        return;
      }
      this.options.emitProgress(event.progress);
      return;
    }
    if (event.kind === "error") {
      this.finish(active, failed(active.jobId, event.message), true);
      return;
    }
    if (event.result.jobId !== active.jobId
      || (event.result.success && event.result.outputPath !== active.expectedOutputPath)) {
      this.finish(active, failed(active.jobId, "Remotion render worker result 与当前任务不匹配"), true);
      return;
    }
    this.finish(active, event.result);
  }

  private handleExit(active: ActiveRequest, code: number): void {
    if (this.activeByRequestId.get(active.requestId) !== active) return;
    if (active.cancelRequested) {
      this.finish(active, { success: false, jobId: active.jobId, canceled: true, error: `Remotion utility 渲染已取消: ${active.jobId}` });
      return;
    }
    this.finish(active, failed(active.jobId, `Remotion render utility process 退出(code=${code})`));
  }

  private finish(
    active: ActiveRequest,
    result: RemotionRenderWorkerResult,
    terminateChild = false,
  ): void {
    if (this.activeByRequestId.get(active.requestId) !== active) return;
    active.cancelTimer && clearTimeout(active.cancelTimer);
    this.detach(active);
    this.activeByJobId.delete(active.jobId);
    this.activeByRequestId.delete(active.requestId);
    if (terminateChild) active.child.kill();
    active.resolve(result);
  }

  private detach(active: ActiveRequest): void {
    active.child.off("message", active.onMessage);
    active.child.off("exit", active.onExit);
  }
}

function failed(jobId: string, error: string): RemotionRenderWorkerResult {
  return { success: false, jobId, canceled: false, error };
}

function readJobId(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const record = value as { jobId?: unknown; plan?: { jobId?: unknown } };
  const jobId = record.jobId ?? record.plan?.jobId;
  return typeof jobId === "string" && jobId.trim() ? jobId.trim() : "unknown";
}
