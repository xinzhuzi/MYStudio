import { describe, expect, it } from "vitest";
import {
  RemotionRenderUtilitySupervisor,
  type RemotionRenderUtilityInput,
} from "./remotion-render-utility";

class FakeUtilityProcess {
  posted: unknown[] = [];
  killed = false;
  postError: Error | undefined;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).add(listener as (value: unknown) => void);
    return this;
  }

  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "exit", listener: (code: number) => void): this;
  off(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).delete(listener as (value: unknown) => void);
    return this;
  }

  postMessage(message: unknown): void {
    if (this.postError) throw this.postError;
    this.posted.push(message);
  }
  kill(): boolean { this.killed = true; return true; }
  reply(message: unknown): void { this.messageListeners.forEach((listener) => listener(message)); }
  exit(code: number): void { this.exitListeners.forEach((listener) => listener(code)); }
}

const input = {
  plan: { jobId: "job-1" },
  bundlePath: "/tmp/bundle",
  outputPath: "/tmp/output.mp4",
  remotionVersion: "4.0.499",
  mediaUrlByClipId: {},
} as unknown as RemotionRenderUtilityInput;

function inputFor(jobId: string): RemotionRenderUtilityInput {
  return {
    ...input,
    plan: { jobId },
    outputPath: `/tmp/${jobId}.mp4`,
  } as unknown as RemotionRenderUtilityInput;
}

describe("RemotionRenderUtilitySupervisor", () => {
  it("freshly probes browser before forking and forwards progress/result", async () => {
    const child = new FakeUtilityProcess();
    const progress: string[] = [];
    let forkCount = 0;
    let forkOptions: { cwd?: string; serviceName: string } | undefined;
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      cwd: "/runtime/remotion-runtime",
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" }),
      fork: (_modulePath, _args, options) => {
        forkCount += 1;
        forkOptions = options;
        return child;
      },
      emitProgress: (event) => progress.push(`${event.stage}:${event.ratio}`),
    });
    const promise = supervisor.render(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forkCount).toBe(1);
    expect(forkOptions).toEqual({
      cwd: "/runtime/remotion-runtime",
      serviceName: "MYStudio Remotion Render",
    });
    const command = child.posted[0] as { input: { browserExecutable: string }; requestId: string };
    expect(command.input.browserExecutable).toBe("/runtime/headless-shell");
    child.reply({ kind: "progress", requestId: command.requestId, progress: { jobId: "job-1", stage: "rendering", ratio: 0.5 } });
    child.reply({ kind: "result", requestId: command.requestId, result: { success: true, jobId: "job-1", outputPath: "/tmp/output.mp4", composition: {} } });
    await expect(promise).resolves.toMatchObject({ success: true, outputPath: "/tmp/output.mp4" });
    expect(progress).toEqual(["rendering:0.5"]);
  });

  it("uses independent fresh utility processes for distinct concurrent jobs", async () => {
    const children = [new FakeUtilityProcess(), new FakeUtilityProcess()];
    let forkIndex = 0;
    let activeProbes = 0;
    let maxActiveProbes = 0;
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => {
        activeProbes += 1;
        maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeProbes -= 1;
        return { status: { state: "ready" as const, remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" };
      },
      fork: () => children[forkIndex++]!,
      cancelGracePeriodMs: 100,
      emitProgress: () => undefined,
    });

    const firstPromise = supervisor.render(inputFor("job-1"));
    const secondPromise = supervisor.render(inputFor("job-2"));
    await waitFor(() => forkIndex === 2);
    expect(forkIndex).toBe(2);
    expect(maxActiveProbes).toBe(1);

    const firstCommand = children[0]!.posted[0] as { requestId: string };
    const secondCommand = children[1]!.posted[0] as { requestId: string };
    expect(supervisor.cancel("job-1")).toMatchObject({ success: true, canceled: true });
    expect(children[0]!.posted.at(-1)).toMatchObject({ action: "cancel", jobId: "job-1" });
    expect(children[1]!.posted).toHaveLength(1);

    children[0]!.reply({ kind: "result", requestId: firstCommand.requestId, result: { success: false, jobId: "job-1", canceled: true, error: "cancelled" } });
    children[1]!.reply({ kind: "result", requestId: secondCommand.requestId, result: { success: true, jobId: "job-2", outputPath: "/tmp/job-2.mp4", composition: {} } });
    await expect(firstPromise).resolves.toMatchObject({ success: false, canceled: true });
    await expect(secondPromise).resolves.toMatchObject({ success: true, jobId: "job-2" });
    expect(children[1]!.killed).toBe(false);
  });

  it("cancels only the active utility process and does not start when browser is unavailable", async () => {
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => ({ status: { state: "not-installed", remotionVersion: "4.0.499" } }),
      fork: () => child,
      emitProgress: () => undefined,
    });
    await expect(supervisor.render(input)).resolves.toMatchObject({ success: false, jobId: "job-1" });
    expect(child.posted).toHaveLength(0);

    const ready = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" }),
      fork: () => child,
      cancelGracePeriodMs: 10,
      emitProgress: () => undefined,
    });
    const promise = ready.render(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready.cancel("job-1")).toMatchObject({ success: true, canceled: true });
    const cancelCommand = child.posted.at(-1) as { action: string; jobId: string };
    expect(cancelCommand).toMatchObject({ action: "cancel", jobId: "job-1" });
    await expect(promise).resolves.toMatchObject({ success: false, canceled: true });
    expect(child.killed).toBe(true);
  });

  it("cancels a job while its serialized browser probe is still running", async () => {
    const child = new FakeUtilityProcess();
    let probeStarted = false;
    let releaseProbe: () => void = () => undefined;
    const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => {
        probeStarted = true;
        await probeGate;
        return { status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" };
      },
      fork: () => child,
      emitProgress: () => undefined,
    });

    const promise = supervisor.render(input);
    await waitFor(() => probeStarted);
    expect(supervisor.cancel("job-1")).toMatchObject({ success: true, canceled: true });
    releaseProbe();
    await expect(promise).resolves.toMatchObject({ success: false, canceled: true });
    expect(child.posted).toHaveLength(0);
  });

  it("cleans up when the initial render command cannot be posted", async () => {
    const child = new FakeUtilityProcess();
    child.postError = new Error("render IPC closed");
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" }),
      fork: () => child,
      emitProgress: () => undefined,
    });

    await expect(supervisor.render(input)).resolves.toMatchObject({
      success: false,
      canceled: false,
      error: "render IPC closed",
    });
    expect(supervisor.isRunning).toBe(false);
    expect(child.killed).toBe(true);
  });

  it("finishes the render when the cancel command cannot be posted", async () => {
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionRenderUtilitySupervisor({
      workerPath: "/app/remotion-render-worker.cjs",
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/runtime/headless-shell" }),
      fork: () => child,
      emitProgress: () => undefined,
    });

    const promise = supervisor.render(input);
    await waitFor(() => child.posted.length === 1);
    child.postError = new Error("cancel IPC closed");
    expect(supervisor.cancel("job-1")).toMatchObject({
      success: false,
      canceled: false,
      error: "cancel IPC closed",
    });
    await expect(promise).resolves.toMatchObject({ success: false, canceled: false });
    expect(supervisor.isRunning).toBe(false);
    expect(child.killed).toBe(true);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for utility processes");
}
