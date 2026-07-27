import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RemotionBrowserUtilitySupervisor,
} from "./remotion-browser-utility";

class FakeUtilityProcess {
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();
  posted: unknown[] = [];
  killed = false;

  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    if (event === "message") this.messageListeners.add(listener as (message: unknown) => void);
    else this.exitListeners.add(listener as (code: number) => void);
    return this;
  }

  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "exit", listener: (code: number) => void): this;
  off(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    if (event === "message") this.messageListeners.delete(listener as (message: unknown) => void);
    else this.exitListeners.delete(listener as (code: number) => void);
    return this;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  reply(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  exit(code: number): void {
    this.exitListeners.forEach((listener) => listener(code));
  }
}

describe("RemotionBrowserUtilitySupervisor", () => {
  it("forks a fresh utility process for each completed operation", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-fresh-"));
    const children: FakeUtilityProcess[] = [];
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: () => {
        const child = new FakeUtilityProcess();
        children.push(child);
        return child;
      },
    });

    const status = supervisor.probeStatus();
    const statusRequest = children[0].posted[0] as { requestId: string };
    children[0].reply({
      kind: "result",
      requestId: statusRequest.requestId,
      status: { state: "not-installed", remotionVersion: "4.0.499" },
    });
    await status;

    const download = supervisor.downloadWithExecutable(() => {});
    const downloadRequest = children[1].posted[0] as { requestId: string };
    children[1].reply({
      kind: "result",
      requestId: downloadRequest.requestId,
      status: { state: "ready", remotionVersion: "4.0.499" },
      executablePath: "/tmp/headless-shell",
    });
    await download;

    expect(children).toHaveLength(2);
    expect(children[0]).not.toBe(children[1]);
    expect(children.every((child) => child.killed)).toBe(true);
    supervisor.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("fails closed when a worker event uses the wrong request id", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-request-id-"));
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: () => child,
    });

    const operation = supervisor.probeStatus();
    child.reply({
      kind: "error",
      requestId: "wrong-request-id",
      message: "unexpected worker response",
    });
    const outcome = await Promise.race([
      operation.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({
          kind: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), 25);
      }),
    ]);

    supervisor.dispose();
    expect(outcome).toEqual({
      kind: "rejected",
      message: "Remotion 浏览器 worker requestId 与当前请求不匹配",
    });
    expect(child.killed).toBe(true);
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("pins runtime cwd and uses a fresh worker for status and download", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-runtime-"));
    const children: FakeUtilityProcess[] = [];
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: (_modulePath, _args, options) => {
        expect(options.cwd).toBe(path.join(userData, "remotion-runtime"));
        const child = new FakeUtilityProcess();
        children.push(child);
        return child;
      },
    });
    const probe = supervisor.probeStatus();
    const probeChild = children[0]!;
    const probeRequest = probeChild.posted[0] as { requestId: string; action: string };
    expect(probeRequest.action).toBe("status");
    probeChild.reply({
      kind: "result",
      requestId: probeRequest.requestId,
      status: { state: "not-installed", remotionVersion: "4.0.499" },
    });
    await expect(probe).resolves.toMatchObject({ status: { state: "not-installed" } });
    expect(probeChild.killed).toBe(true);

    const ratios: number[] = [];
    const download = supervisor.downloadWithExecutable((progress) => ratios.push(progress.ratio));
    const downloadChild = children[1]!;
    const downloadRequest = downloadChild.posted[0] as { requestId: string; action: string };
    expect(downloadRequest.action).toBe("download");
    downloadChild.reply({
      kind: "progress",
      requestId: downloadRequest.requestId,
      progress: { phase: "downloading", ratio: 0.25, remotionVersion: "4.0.499" },
    });
    downloadChild.reply({
      kind: "result",
      requestId: downloadRequest.requestId,
      status: { state: "ready", remotionVersion: "4.0.499" },
      executablePath: "/tmp/headless-shell",
    });
    await expect(download).resolves.toEqual({
      status: { state: "ready", remotionVersion: "4.0.499" },
      executablePath: "/tmp/headless-shell",
    });
    expect(ratios).toEqual([0.25]);
    expect(downloadChild.killed).toBe(true);
    expect(children).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(userData, "remotion-runtime/package.json"), "utf8"))).toMatchObject({
      name: "@mystudio/remotion-runtime",
      version: "4.0.499",
      private: true,
    });
    supervisor.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("turns an unexpected utility exit into a rejected operation", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-exit-"));
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: () => child,
    });
    const status = supervisor.status();
    child.exit(17);
    await expect(status).rejects.toThrow("退出(code=17)");
    supervisor.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("allows only one browser operation at a time", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-single-"));
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: () => child,
    });
    const first = supervisor.status();
    await expect(supervisor.download(() => {})).rejects.toThrow(
      "同一时间只允许一个浏览器 utility 操作",
    );
    const request = child.posted[0] as { requestId: string };
    child.reply({
      kind: "result",
      requestId: request.requestId,
      status: { state: "not-installed", remotionVersion: "4.0.499" },
    });
    await first;
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("kills and rejects the active worker during cleanup", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-dispose-"));
    const child = new FakeUtilityProcess();
    const supervisor = new RemotionBrowserUtilitySupervisor({
      userDataDir: userData,
      remotionVersion: "4.0.499",
      workerPath: "/app/remotion-browser-worker.cjs",
      fork: () => child,
    });
    const status = supervisor.status();
    supervisor.dispose();
    expect(child.killed).toBe(true);
    await expect(status).rejects.toThrow("utility process 已关闭");
    fs.rmSync(userData, { recursive: true, force: true });
  });
});
